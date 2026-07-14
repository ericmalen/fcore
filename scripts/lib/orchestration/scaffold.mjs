// scaffold.mjs — pure generation planner for the scaffolder agent (C4, DD-1).
//
// planGeneration(blueprint, registry, readTemplate) computes every
// manifest-tracked file the scaffolder writes: agents, paired skills, and
// payload docs — content, target path, template id, pinned version. Pure
// given its inputs and deterministic in output order (blueprint order for
// agents; skill ids sorted per specialist; blueprint.docs order), so the
// same blueprint + FleetCore state always yields byte-identical files AND a
// byte-identical manifest (no timestamps, DD-13).
//
// Living state (tasks.md, handoff-log.jsonl, checklists/) is deliberately
// NOT planned here and never manifest-tracked: those files are owned by the
// running system after creation; tracking them would turn every legitimate
// append into a drift conflict.

import { createHash } from 'node:crypto';
import { instantiateTemplate } from './instantiate.mjs';
import { renderDispatchOrder } from './dispatch-order.mjs';

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

// The exact slot map generation feeds an agent template: the blueprint entry's
// own slots plus the injected quartet, plus — for the orchestrator — the
// rendered dispatch order (injected so the prose can't drift from the
// blueprint's dispatch_rules.dispatch_order). Keyed by NAME, not reference, so
// re-instantiation from a freshly parsed blueprint (drift-checker) derives
// byte-identical slots. Exported as the single source of this derivation: the
// drift-checker imports it rather than hand-copying, which would silently
// diverge the moment a new slot is injected here.
export function agentSlots(agent, blueprint) {
  const slots = {
    ...agent.slots,
    name: agent.name,
    tools: agent.tools.join(', '),
    'model-tier': agent.modelTier,
    'turn-limit': String(agent.turnLimit),
  };
  if (agent.name === blueprint.orchestrator?.name) {
    slots['dispatch-order'] = renderDispatchOrder(blueprint.dispatch_rules?.dispatch_order);
  }
  return slots;
}

// Slots only agent templates carry: paired-skill templates receive the same
// specialist slot map minus these. Exported as the single source of the
// filter — planGeneration, the drift-checker, and the skill-instantiator all
// import it rather than hand-copying which keys are agent-only.
export const AGENT_ONLY_SLOTS = new Set(['layer-context']);

export function skillSlots(slots) {
  return Object.fromEntries(
    Object.entries(slots).filter(([key]) => !AGENT_ONLY_SLOTS.has(key)),
  );
}

// readTemplate(kind, id) -> template/doc source text, or null when FleetCore
// has no such file ('agent' | 'skill' | 'doc').
// Returns { files: [{ path, templateId, templateVersion, content }], errors }.
// files is [] whenever errors is non-empty — all-or-nothing, no partial plans.
export function planGeneration(blueprint, registry, readTemplate) {
  const errors = [];
  const e = (m) => errors.push(m);
  const files = [];
  const plannedPaths = new Set();

  // A registry sha256 pin that disagrees with the actual template source
  // means someone edited a template without updating the registry — refuse
  // to generate from an unpinned state (C5 version-bump discipline).
  const checkPin = (reg, source, what) => {
    if (reg.sha256 && sha256(source) !== reg.sha256) {
      e(`${what}: source drifted from registry pin — bump version and update sha256`);
      return false;
    }
    return true;
  };
  const push = (file) => {
    if (plannedPaths.has(file.path)) {
      e(`duplicate generated path "${file.path}" — two blueprint entries collide`);
      return;
    }
    plannedPaths.add(file.path);
    files.push(file);
  };

  for (const agent of [...blueprint.specialists, blueprint.orchestrator]) {
    const reg = registry.agents[agent.templateId];
    if (!reg) {
      e(`agent ${agent.name}: templateId "${agent.templateId}" not in registry`);
      continue;
    }
    const source = readTemplate('agent', agent.templateId);
    if (source === null) {
      e(`agent ${agent.name}: template ${agent.templateId}.template.md missing from FleetCore`);
      continue;
    }
    if (!checkPin(reg, source, `agent template ${agent.templateId}`)) continue;
    const { content, errors: instErrors } = instantiateTemplate(source, agentSlots(agent, blueprint));
    if (instErrors.length) {
      instErrors.forEach((m) => e(`agent ${agent.name}: ${m}`));
      continue;
    }
    push({
      path: `.claude/agents/${agent.name}.md`,
      templateId: agent.templateId,
      templateVersion: reg.version,
      content,
    });
  }

  for (const specialist of blueprint.specialists) {
    const paired = [...(specialist.pairedSkills ?? [])].sort();
    for (const skillId of paired) {
      const meta = registry.skills[skillId];
      if (!meta) {
        e(`skill ${skillId} (for ${specialist.name}): not in registry`);
        continue;
      }
      const source = readTemplate('skill', skillId);
      if (source === null) {
        e(`skill ${skillId}: template missing from FleetCore`);
        continue;
      }
      if (!checkPin(meta, source, `skill template ${skillId}`)) continue;
      const { content, errors: instErrors } = instantiateTemplate(source, skillSlots(specialist.slots));
      if (instErrors.length) {
        instErrors.forEach((m) => e(`skill ${skillId} (for ${specialist.name}): ${m}`));
        continue;
      }
      push({
        path: `.claude/skills/${skillId}/SKILL.md`,
        templateId: skillId,
        templateVersion: meta.version,
        content,
      });
    }
  }

  // The orchestration README (update flow, ownership, rollback) ships with
  // every generation regardless of blueprint.docs.
  for (const docPath of ['docs/orchestration/README.md', ...blueprint.docs]) {
    const id = docPath.split('/').pop().replace(/\.md$/, '');
    const reg = registry.docs[id];
    if (!reg) {
      e(`doc ${docPath}: "${id}" not in registry`);
      continue;
    }
    const source = readTemplate('doc', id);
    if (source === null) {
      e(`doc ${docPath}: ${id}.md missing from FleetCore payload`);
      continue;
    }
    if (!checkPin(reg, source, `doc ${id}`)) continue;
    push({ path: docPath, templateId: id, templateVersion: reg.version, content: source });
  }

  return errors.length ? { files: [], errors } : { files, errors: [] };
}

// USER-EDIT detection (C5): a previously generated file whose on-disk bytes
// no longer match its manifest SHA was touched by a human — regeneration
// must stop and report, never overwrite. readTargetFile(path) -> current
// content or null when the file is gone (a deleted file is not a conflict;
// regeneration recreates it).
export function findUserEdits(priorManifest, readTargetFile) {
  return priorManifest.generated
    .filter((entry) => {
      const onDisk = readTargetFile(entry.path);
      return onDisk !== null && sha256(onDisk) !== entry.sha256;
    })
    .map((entry) => entry.path);
}

// Orphan detection for a re-run (B4): a path the PRIOR manifest tracked that
// the freshly planned files no longer include — e.g. a layer's specialist
// dropped from the blueprint, or a paired skill un-selected. Runs only after
// findUserEdits has cleared, so a hand-edited orphan already stopped the run
// upstream — this never deletes anything a human touched. Living state
// (tasks.md, handoff log, checklists, the AGENTS.md routing region) is never
// manifest-tracked, so it can never appear here.
export function findOrphans(priorManifest, plannedFiles) {
  const plannedPaths = new Set(plannedFiles.map((f) => f.path));
  return priorManifest.generated
    .filter((entry) => !plannedPaths.has(entry.path))
    .map((entry) => entry.path);
}

// ── always-loaded routing block (R-56) ──────────────────────────────────────
//
// The orchestration trigger the MAIN LOOP reads. Generated agents teach the
// fleet how to act once invoked; nothing told the main loop WHEN to invoke it,
// so multi-layer requests got built inline. This region lands in the target's
// AGENTS.md (inherited by CLAUDE.md via @AGENTS.md). It is living instruction
// state — upserted between markers, never manifest-tracked (same class as
// tasks.md): a human may edit the prose around it without tripping drift.

export const ROUTING_REGION_START = '<!-- fcore:orchestration-routing:start -->';
export const ROUTING_REGION_END = '<!-- fcore:orchestration-routing:end -->';

// Body for the routing region, derived purely from the blueprint. Returns null
// when routing_policy is `manual` (or absent) — the main loop keeps deciding by
// hand and no region is emitted. Imperative + concrete examples (rather than
// abstract "feature-shaped") — R-56's own eval coverage (evals/routing/,
// eval-runner SKILL.md) exists specifically to measure and tighten this
// wording, since it is the one link in the trigger chain that is prose, not
// a mechanical gate.
export function renderOrchestrationRouting(blueprint) {
  const dr = blueprint?.dispatch_rules ?? {};
  const policy = dr.routing_policy;
  if (policy !== 'always' && policy !== 'threshold') return null;
  const orchestrator = blueprint?.orchestrator?.name ?? 'feature-orchestrator';
  const trigger = policy === 'always'
    ? 'any feature-shaped request — work that adds or changes product behavior (e.g. "add password reset", "let users export their data")'
    : `a request spanning ${dr.agent_team_min_scopes}+ layers (the agent-team threshold) — e.g. a new endpoint plus its schema plus its UI — or otherwise discrete, trackable, multi-step work`;
  return [
    '## Orchestration routing',
    '',
    `This repo has a generated orchestration fleet (R-56). For ${trigger},`,
    'you MUST NOT implement it inline yourself. Instead:',
    '',
    '1. Capture it as a Backlog item in `tasks.md` (canonical format:',
    '   `docs/orchestration/tasks-format.md`) with its `scope:` layers and',
    '   acceptance criteria.',
    `2. Invoke the \`${orchestrator}\` agent on that item — it dispatches layer`,
    '   specialists per `docs/orchestration/dispatch-rules.md`, verifies their',
    '   reports, and gates at the PR.',
    '',
    'Proceed inline as usual for anything smaller — a one-line fix, a typo, a',
    'single-file tweak, or anything scoped to one layer.',
  ].join('\n');
}

// Idempotent managed-region upsert. body===null removes the region; otherwise
// replace-in-place when the markers exist, append a fresh block when they do
// not. Re-running with the same body yields byte-identical text.
export function upsertManagedRegion(text, startMarker, endMarker, body) {
  const src = text ?? '';
  const startIdx = src.indexOf(startMarker);
  const endIdx = src.indexOf(endMarker);
  const hasRegion = startIdx !== -1 && endIdx !== -1 && endIdx > startIdx;

  if (body == null) {
    if (!hasRegion) return src;
    const before = src.slice(0, startIdx).replace(/\n*$/, '');
    const after = src.slice(endIdx + endMarker.length).replace(/^\n*/, '');
    const joined = after ? `${before}\n\n${after}` : `${before}\n`;
    return joined.replace(/\n*$/, '\n');
  }

  const block = `${startMarker}\n${body}\n${endMarker}`;
  if (hasRegion) {
    return src.slice(0, startIdx) + block + src.slice(endIdx + endMarker.length);
  }
  const base = src.replace(/\n*$/, '');
  return (base ? `${base}\n\n` : '') + block + '\n';
}

// ── ephemeral run artifacts (R-57) ──────────────────────────────────────────

// Ephemeral per-task outputs (screenshots, transcripts) dispatched
// specialists may write during a task; the orchestrator deletes the run
// directory at completion. Never committed, never manifest-tracked (same
// class as tasks.md).
export const RUNS_DIR = 'docs/orchestration/runs';

// Idempotent .gitignore append: adds RUNS_DIR (as a directory entry) when no
// existing line already covers it — an exact match or a parent-dir entry,
// with or without a trailing slash. Mirrors checkOrchestrationRuns's
// coverage test (R-57) so "covered" means the same thing on both sides.
export function ensureGitignoreCovers(text, dirPath) {
  const src = text ?? '';
  const lines = src.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const covered = lines.some((l) => {
    const pat = l.replace(/^\//, '').replace(/\/$/, '');
    return pat === dirPath || `${dirPath}/`.startsWith(`${pat}/`);
  });
  if (covered) return src;
  const base = src.replace(/\n*$/, '');
  return (base ? `${base}\n` : '') + `${dirPath}/\n`;
}

// ── inline layer context ────────────────────────────────────────────────────
//
// Value for the generic-specialist `layer-context` slot: the layer-specific
// knowledge discovery captures (commands, dependency edges, repo gaps) that
// otherwise never reaches generated agents beyond an opaque stack label.
// Substituted INTO the agent file, so the manifest sha and existing drift
// machinery cover it for free — no separate file class, no extra rule.
// Pure function of (profile, layerName): the same profile always yields the
// same block, so re-computation from a freshly parsed profile (blueprint
// synthesis, drift-checker, re-scaffold) is byte-identical. Stack and test
// command are NOT repeated here — they have their own slots.

const LAYER_CONTEXT_LINE_CAP = 15;

export function layerContextSlot(profile, layerName) {
  const layer = profile.layers.find((l) => l.name === layerName);
  if (!layer) throw new Error(`layerContextSlot: no layer named "${layerName}" in profile`);

  const fmt = (v) => (v ? `\`${v}\`` : 'none detected');
  const consumes = profile.internalEdges
    .filter((e) => e.from === layerName).map((e) => e.to).sort();
  const consumedBy = profile.internalEdges
    .filter((e) => e.to === layerName).map((e) => e.from).sort();

  const head = [
    `- Build: ${fmt(layer.buildCmd)}`,
    `- Manifest: ${fmt(layer.manifestPath)}`,
    `- Consumes (dispatch order is provider-first): ${consumes.length ? consumes.join(', ') : 'none'}`,
    `- Consumed by: ${consumedBy.length ? consumedBy.join(', ') : 'none'}`,
  ];

  // Gaps get whatever budget remains under the cap; a repo with more gaps
  // than fit is summarized rather than allowed to bloat the agent file.
  const gapsBlock = [];
  if (profile.gaps.length > 0) {
    const allowedGapLines = LAYER_CONTEXT_LINE_CAP - head.length - 1; // reserve the header line
    const fitsAll = profile.gaps.length <= allowedGapLines;
    const shown = fitsAll ? profile.gaps : profile.gaps.slice(0, Math.max(0, allowedGapLines - 1));
    const omitted = profile.gaps.length - shown.length;
    gapsBlock.push('', 'Known repo gaps:');
    for (const g of shown) gapsBlock.push(`- ${g}`);
    if (omitted > 0) {
      gapsBlock.push(`- (+${omitted} more — see \`docs/orchestration/repo-profile.json\` gaps[])`);
    }
  }

  return [...head, ...gapsBlock].join('\n');
}

// Manifest for a plan — same entry order as files; validates against
// validateGenerationManifest. The manifest itself is written alongside the
// files but never lists itself.
export function manifestFor(files) {
  return {
    schemaVersion: 1,
    generated: files.map(({ path, templateId, templateVersion, content }) => ({
      path,
      templateId,
      templateVersion,
      sha256: sha256(content),
    })),
  };
}
