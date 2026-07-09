// scaffold.mjs — pure generation planner for the scaffolder agent (C4, DD-1).
//
// planGeneration(blueprint, registry, readTemplate) computes every
// manifest-tracked file the scaffolder writes: agents, paired skills, and
// payload docs — content, target path, template id, pinned version. Pure
// given its inputs and deterministic in output order (blueprint order for
// agents; skill ids sorted per specialist; blueprint.docs order), so the
// same blueprint + Agent Base state always yields byte-identical files AND a
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

// readTemplate(kind, id) -> template/doc source text, or null when Agent Base
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
      e(`agent ${agent.name}: template ${agent.templateId}.template.md missing from Agent Base`);
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
        e(`skill ${skillId}: template missing from Agent Base`);
        continue;
      }
      if (!checkPin(meta, source, `skill template ${skillId}`)) continue;
      const { content, errors: instErrors } = instantiateTemplate(source, specialist.slots);
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
      e(`doc ${docPath}: ${id}.md missing from Agent Base payload`);
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

export const ROUTING_REGION_START = '<!-- agent-base:orchestration-routing:start -->';
export const ROUTING_REGION_END = '<!-- agent-base:orchestration-routing:end -->';

// Body for the routing region, derived purely from the blueprint. Returns null
// when routing_policy is `manual` (or absent) — the main loop keeps deciding by
// hand and no region is emitted.
export function renderOrchestrationRouting(blueprint) {
  const dr = blueprint?.dispatch_rules ?? {};
  const policy = dr.routing_policy;
  if (policy !== 'always' && policy !== 'threshold') return null;
  const orchestrator = blueprint?.orchestrator?.name ?? 'feature-orchestrator';
  const trigger = policy === 'always'
    ? 'For any feature-shaped request — work that adds or changes product behavior —'
    : `When a request spans ${dr.agent_team_min_scopes}+ layers (the agent-team threshold) or is otherwise discrete, trackable, multi-step work,`;
  return [
    '## Orchestration routing',
    '',
    `This repo has a generated orchestration fleet (R-56). ${trigger} do NOT`,
    'implement it inline. Instead:',
    '',
    '1. Capture it as a Backlog item in `tasks.md` (canonical format:',
    '   `docs/orchestration/tasks-format.md`) with its `scope:` layers and',
    '   acceptance criteria.',
    `2. Invoke the \`${orchestrator}\` agent on that item — it dispatches layer`,
    '   specialists per `docs/orchestration/dispatch-rules.md`, verifies their',
    '   reports, and gates at the PR.',
    '',
    'Smaller or single-layer changes proceed inline as usual.',
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
