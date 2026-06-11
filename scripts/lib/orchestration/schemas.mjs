// schemas.mjs — syntactic validators for orchestration artifacts (DD-2).
// Error-string-array style per scripts/lib/manifest.mjs validateShape:
// shapes only; semantic invariants (e.g. slot coverage against templates)
// live with the consuming skills and agents.
//
// Validators (one per artifact, all exported from this module — §9.1):
//   validateRepoProfile        — docs/orchestration/repo-profile.json (A1)
//   validateDecisionsDoc       — docs/orchestration/decisions.json (A2)
//   validateBlueprint          — docs/orchestration/blueprint.json (A3)
//   validateTaskBacklog        — parsed tasks.md (A4; parser in parse-tasks.mjs)
//   validateHandoffLog         — one handoff-log.jsonl entry (A5)
//   validateGenerationManifest — docs/orchestration/generation-manifest.json (C4)

const REPO_TYPES = new Set(['monorepo', 'single-package']);
const PIPELINE_WHEN = new Set(['scheduled', 'multi_day']);   // §9.3 / DD-4
const SLOT_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;             // kebab-case (DD-5)
// Logical tiers, not concrete model ids — ids churn with releases; the
// scaffolder (C4) owns the tier → concrete-model map.
const MODEL_TIERS = new Set(['haiku', 'sonnet', 'opus']);
// Slot names the instantiators inject from blueprint fields: the quartet on
// every agent, plus dispatch-order on the orchestrator (rendered from
// dispatch_rules.dispatch_order).
const RESERVED_SLOTS = new Set(['name', 'tools', 'model-tier', 'turn-limit', 'dispatch-order']);

const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
const isStringOrNull = (v) => v === null || typeof v === 'string';
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkStringArray(arr, field, e) {
  if (!Array.isArray(arr)) {
    e(`${field} must be an array`);
    return;
  }
  arr.forEach((item, i) => {
    if (!isNonEmptyString(item)) e(`${field}[${i}] must be a non-empty string`);
  });
}

// ── repo-profile (A1) ───────────────────────────────────────────────────────

export function validateRepoProfile(profile) {
  if (!isPlainObject(profile)) return ['profile must be an object'];
  const errors = [];
  const e = (m) => errors.push(m);

  if (profile.schemaVersion !== 1) e(`schemaVersion must be 1 (got ${profile.schemaVersion})`);
  if (!isNonEmptyString(profile.name)) e('name must be a non-empty string');
  if (!REPO_TYPES.has(profile.type)) {
    e(`type must be one of ${[...REPO_TYPES].join(' | ')} (got ${profile.type})`);
  }

  if (!Array.isArray(profile.layers) || profile.layers.length === 0) {
    e('layers must be a non-empty array');
  } else {
    profile.layers.forEach((layer, i) => {
      const where = `layers[${i}]`;
      if (!isPlainObject(layer)) {
        e(`${where} must be an object`);
        return;
      }
      for (const field of ['name', 'path', 'stack']) {
        if (!isNonEmptyString(layer[field])) e(`${where}.${field} must be a non-empty string`);
      }
      // Commands must be present: a string when detected, explicit null when
      // not — discovery may not omit them silently (gaps[] is where absence
      // is reported as a finding).
      for (const field of ['testCmd', 'buildCmd']) {
        if (!isStringOrNull(layer[field])) {
          e(`${where}.${field} must be a string or null (null = not detected)`);
        }
      }
    });
  }

  // Internal dependency edges (B2): { from: consumer, to: provider }, both
  // layer names. [] is the normal single-package / no-internal-deps result —
  // required so "none found" is a recorded fact, not an omission.
  if (!Array.isArray(profile.internalEdges)) {
    e('internalEdges must be an array ([] = no internal dependencies)');
  } else {
    const layerNames = new Set(
      (Array.isArray(profile.layers) ? profile.layers : [])
        .filter(isPlainObject).map((l) => l.name).filter(isNonEmptyString),
    );
    const seenEdges = new Set();
    profile.internalEdges.forEach((edge, i) => {
      const where = `internalEdges[${i}]`;
      if (!isPlainObject(edge)) {
        e(`${where} must be an object ({ from: consumer, to: provider })`);
        return;
      }
      for (const field of ['from', 'to']) {
        if (!isNonEmptyString(edge[field])) {
          e(`${where}.${field} must be a non-empty string layer name`);
        } else if (layerNames.size > 0 && !layerNames.has(edge[field])) {
          e(`${where}.${field} "${edge[field]}" is not a layer name`);
        }
      }
      if (isNonEmptyString(edge.from) && edge.from === edge.to) {
        e(`${where} is a self-edge ("${edge.from}")`);
      }
      const key = `${edge.from}→${edge.to}`;
      if (seenEdges.has(key)) e(`internalEdges: duplicate edge ${edge.from}→${edge.to}`);
      seenEdges.add(key);
    });
  }

  if (!isNonEmptyString(profile.packageManager)) e('packageManager must be a non-empty string');
  if (!isStringOrNull(profile.ci)) e('ci must be a string or null (null = no CI detected)');

  if (!isPlainObject(profile.conventions)) {
    e('conventions must be an object');
  } else {
    for (const field of ['naming', 'branching', 'commitStyle']) {
      if (!isStringOrNull(profile.conventions[field])) {
        e(`conventions.${field} must be a string or null (null = not detected)`);
      }
    }
  }

  checkStringArray(profile.gaps, 'gaps', e);

  return errors;
}

// ── decisions-doc (A2) ──────────────────────────────────────────────────────

// Every decision field is a finite enum — the interview (B5/B6) maps answers
// onto these values; no free-text policy fields. Arrays (not Sets) so field
// and value order is stable for the renderer and error messages.
export const DECISION_ENUMS = {
  tddPolicy: ['test-first', 'test-with-change', 'optional'],
  reviewGates: ['every-task', 'every-merge', 'risk-based'],
  securityRequirements: ['review-all-changes', 'review-sensitive-paths', 'none'],
  qaDepth: ['unit-only', 'unit-and-integration', 'full-pyramid'],
  definitionOfDone: ['tests-pass', 'tests-and-review', 'tests-review-docs'],
  humanGatePlacement: ['pre-merge', 'pre-dispatch-and-pre-merge'],
};

export function validateDecisionsDoc(doc) {
  if (!isPlainObject(doc)) return ['decisions must be an object'];
  const errors = [];
  const e = (m) => errors.push(m);

  if (doc.schemaVersion !== 1) e(`schemaVersion must be 1 (got ${doc.schemaVersion})`);
  for (const [field, values] of Object.entries(DECISION_ENUMS)) {
    if (!values.includes(doc[field])) {
      e(`${field} must be one of ${values.join(' | ')} (got ${doc[field]})`);
    }
  }

  return errors;
}

// ── orchestration-blueprint (A3) ────────────────────────────────────────────

// Shared shape for the orchestrator config and each specialist entry.
// Slot-coverage against actual templates is C1 lint / B7 handoff-validator
// territory, not here.
function checkAgentConfig(agent, where, e) {
  if (!isPlainObject(agent)) {
    e(`${where} must be an object`);
    return;
  }
  if (!isNonEmptyString(agent.name)) e(`${where}.name must be a non-empty string`);
  if (!isNonEmptyString(agent.templateId)) e(`${where}.templateId must be a non-empty string`);
  // Version pins live in the generation manifest, never in the blueprint —
  // deliberate tripwire, not generic unknown-key rejection (DD-13).
  if ('templateVersion' in agent) {
    e(`${where}.templateVersion is not allowed — version pins live in the generation manifest (DD-13)`);
  }
  if (!isPlainObject(agent.slots)) {
    e(`${where}.slots must be an object`);
  } else {
    for (const [key, value] of Object.entries(agent.slots)) {
      if (!SLOT_NAME_RE.test(key)) e(`${where}.slots: slot name "${key}" must be kebab-case (DD-5)`);
      // Instantiation injects these from blueprint fields; a declared slot
      // with the same name would be silently shadowed.
      if (RESERVED_SLOTS.has(key)) e(`${where}.slots: "${key}" is reserved (injected from blueprint fields at instantiation)`);
      if (!isNonEmptyString(value)) e(`${where}.slots["${key}"] must be a non-empty string`);
    }
  }
  if (!MODEL_TIERS.has(agent.modelTier)) {
    e(`${where}.modelTier must be one of ${[...MODEL_TIERS].join(' | ')} (got ${agent.modelTier})`);
  }
  if (!Number.isInteger(agent.turnLimit) || agent.turnLimit < 1) {
    e(`${where}.turnLimit must be a positive integer`);
  }
  if (!Array.isArray(agent.tools) || agent.tools.length === 0) {
    e(`${where}.tools must be a non-empty array`);
  } else {
    agent.tools.forEach((tool, i) => {
      if (!isNonEmptyString(tool)) e(`${where}.tools[${i}] must be a non-empty string`);
    });
  }
  if (!isPlainObject(agent.evalRequirements)
      || !Number.isInteger(agent.evalRequirements.minGoldens)
      || agent.evalRequirements.minGoldens < 1) {
    e(`${where}.evalRequirements.minGoldens must be a positive integer`);
  }
}

export function validateBlueprint(blueprint) {
  if (!isPlainObject(blueprint)) return ['blueprint must be an object'];
  const errors = [];
  const e = (m) => errors.push(m);

  if (blueprint.schemaVersion !== 1) e(`schemaVersion must be 1 (got ${blueprint.schemaVersion})`);

  if (!Array.isArray(blueprint.specialists) || blueprint.specialists.length === 0) {
    e('specialists must be a non-empty array');
  } else {
    blueprint.specialists.forEach((s, i) => checkAgentConfig(s, `specialists[${i}]`, e));
    const seen = new Set();
    for (const s of blueprint.specialists) {
      if (!isPlainObject(s) || !isNonEmptyString(s.name)) continue;
      if (seen.has(s.name)) e(`specialists: duplicate name "${s.name}"`);
      seen.add(s.name);
    }
  }

  checkAgentConfig(blueprint.orchestrator, 'orchestrator', e);

  // The instantiators tell the orchestrator apart from specialists by name,
  // and every agent lands at .claude/agents/<name>.md — a specialist sharing
  // the orchestrator's name would collide on both counts.
  if (Array.isArray(blueprint.specialists) && isPlainObject(blueprint.orchestrator)
      && isNonEmptyString(blueprint.orchestrator.name)
      && blueprint.specialists.some((s) => isPlainObject(s) && s.name === blueprint.orchestrator.name)) {
    e(`orchestrator.name "${blueprint.orchestrator.name}" collides with a specialist name`);
  }

  // Key names verbatim from §9.3 — the one snake_case island in the kit.
  const dr = blueprint.dispatch_rules;
  if (!isPlainObject(dr)) {
    e('dispatch_rules must be an object');
  } else {
    for (const field of ['subagent_max_scopes', 'agent_team_min_scopes']) {
      if (!Number.isInteger(dr[field]) || dr[field] < 1) {
        e(`dispatch_rules.${field} must be a positive integer`);
      }
    }
    // Tiers must be ordered or every scope count routes to subagents and the
    // team tier is dead data (DD-4).
    if (Number.isInteger(dr.subagent_max_scopes) && Number.isInteger(dr.agent_team_min_scopes)
        && dr.subagent_max_scopes >= dr.agent_team_min_scopes) {
      e(`dispatch_rules tiers must be ordered: subagent_max_scopes (${dr.subagent_max_scopes}) must be < agent_team_min_scopes (${dr.agent_team_min_scopes})`);
    }
    if (typeof dr.agent_team_on_cross_repo !== 'boolean') {
      e('dispatch_rules.agent_team_on_cross_repo must be a boolean');
    }
    if (!Array.isArray(dr.pipeline_when)) {
      e('dispatch_rules.pipeline_when must be an array');
    } else {
      dr.pipeline_when.forEach((v, i) => {
        if (!PIPELINE_WHEN.has(v)) {
          e(`dispatch_rules.pipeline_when[${i}] must be one of scheduled | multi_day (got ${v})`);
        }
      });
    }
    // Derived by deriveDispatchOrder from profile internalEdges (§9.3):
    // provider-first total order of layer names, [] = no internal ordering
    // constraints. Shape-only here; agreement with the profile is the
    // synthesizer's contract (B8).
    if (!Array.isArray(dr.dispatch_order)) {
      e('dispatch_rules.dispatch_order must be an array of layer names ([] = no internal ordering constraints)');
    } else {
      const seenLayers = new Set();
      dr.dispatch_order.forEach((v, i) => {
        if (!isNonEmptyString(v)) {
          e(`dispatch_rules.dispatch_order[${i}] must be a non-empty string`);
          return;
        }
        if (seenLayers.has(v)) e(`dispatch_rules.dispatch_order: duplicate layer "${v}"`);
        seenLayers.add(v);
      });
    }
  }

  checkStringArray(blueprint.docs, 'docs', e);

  return errors;
}

// ── task-backlog (A4) ───────────────────────────────────────────────────────

const TASK_ID_RE = /^T-\d{3,}$/;
const BACKLOG_SECTIONS = ['backlog', 'inProgress', 'done'];

// Validates the PARSED form ({ backlog, inProgress, done } — what
// parseTasksMd emits and renderTasksMd consumes). Section membership encodes
// status; semantic invariants beyond the parser's syntax checks live here so
// programmatically built docs get the same gate.
export function validateTaskBacklog(doc) {
  if (!isPlainObject(doc)) return ['task backlog must be an object'];
  const errors = [];
  const e = (m) => errors.push(m);

  const seen = new Set();
  for (const section of BACKLOG_SECTIONS) {
    if (!Array.isArray(doc[section])) {
      e(`${section} must be an array`);
      continue;
    }
    doc[section].forEach((t, i) => {
      const where = `${section}[${i}]`;
      if (!isPlainObject(t)) {
        e(`${where} must be an object`);
        return;
      }
      if (typeof t.id !== 'string' || !TASK_ID_RE.test(t.id)) {
        e(`${where}.id must match T-### (got ${t.id})`);
      } else if (seen.has(t.id)) {
        e(`duplicate task id "${t.id}"`);
      } else {
        seen.add(t.id);
      }
      if (!isNonEmptyString(t.title)) e(`${where}.title must be a non-empty string`);
      if (!Array.isArray(t.scope) || t.scope.length === 0) {
        e(`${where}.scope must be a non-empty array`);
      } else {
        t.scope.forEach((s, j) => {
          if (!isNonEmptyString(s)) e(`${where}.scope[${j}] must be a non-empty string`);
        });
      }
      for (const field of ['owner', 'commit', 'blocked']) {
        if (!(field in t) || !isStringOrNull(t[field])) {
          e(`${where}.${field} must be a string or null`);
        }
      }
      checkStringArray(t.ac, `${where}.ac`, e);
      // Failure protocol (D2): a blocked task sits in Backlog awaiting
      // re-dispatch — a blocked line anywhere else is a state error.
      if (section !== 'backlog' && isNonEmptyString(t.blocked)) {
        e(`${where} ("${t.id}") has a blocked line — blocked tasks belong in Backlog`);
      }
    });
  }

  return errors;
}

// ── generation-manifest (C4) ────────────────────────────────────────────────

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

const MANIFEST_KEYS = new Set(['schemaVersion', 'generated']);
const MANIFEST_ENTRY_KEYS = new Set(['path', 'templateId', 'templateVersion', 'sha256']);

// Scaffolder-owned record of every generated file (DD-13): path → template
// id, pinned template version, content SHA. Deliberately NO timestamps —
// re-scaffolding the same blueprint must be byte-identical, manifest
// included — so unknown keys are REJECTED here (unique among the kit's
// validators): any extra field is a determinism leak waiting to happen.
export function validateGenerationManifest(manifest) {
  if (!isPlainObject(manifest)) return ['generation manifest must be an object'];
  const errors = [];
  const e = (m) => errors.push(m);

  if (manifest.schemaVersion !== 1) e(`schemaVersion must be 1 (got ${manifest.schemaVersion})`);
  for (const key of Object.keys(manifest)) {
    if (!MANIFEST_KEYS.has(key)) e(`unknown key "${key}" — the manifest is deterministic state, no extra fields`);
  }

  if (!Array.isArray(manifest.generated) || manifest.generated.length === 0) {
    e('generated must be a non-empty array');
    return errors;
  }
  const seen = new Set();
  manifest.generated.forEach((entry, i) => {
    const where = `generated[${i}]`;
    if (!isPlainObject(entry)) {
      e(`${where} must be an object`);
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!MANIFEST_ENTRY_KEYS.has(key)) e(`${where}: unknown key "${key}"`);
    }
    if (!isNonEmptyString(entry.path)) {
      e(`${where}.path must be a non-empty string`);
    } else {
      if (entry.path.startsWith('/') || entry.path.split('/').includes('..')) {
        e(`${where}.path must be root-relative without ".." (got ${entry.path})`);
      }
      if (seen.has(entry.path)) e(`generated: duplicate path "${entry.path}"`);
      seen.add(entry.path);
    }
    if (!isNonEmptyString(entry.templateId)) e(`${where}.templateId must be a non-empty string`);
    if (typeof entry.templateVersion !== 'string' || !SEMVER_RE.test(entry.templateVersion)) {
      e(`${where}.templateVersion must be semver x.y.z (got ${entry.templateVersion})`);
    }
    if (typeof entry.sha256 !== 'string' || !SHA256_RE.test(entry.sha256)) {
      e(`${where}.sha256 must be a 64-char lowercase hex digest`);
    }
  });

  return errors;
}

// ── handoff-log (A5) ────────────────────────────────────────────────────────

const HANDOFF_STATUSES = new Set(['success', 'failed', 'blocked']);

// Validates ONE handoff-log.jsonl entry (the orchestrator appends one entry
// per dispatch/return, DD-11). `model`, `turns_used`, `turn_limit` stay
// optional until capture is verified per runtime (D7). Log entries use
// snake_case throughout, matching dispatch_rules (§9.3).
export function validateHandoffLog(entry) {
  if (!isPlainObject(entry)) return ['handoff-log entry must be an object'];
  const errors = [];
  const e = (m) => errors.push(m);

  if (!isNonEmptyString(entry.timestamp) || Number.isNaN(Date.parse(entry.timestamp))) {
    e(`timestamp must be an ISO 8601 string (got ${entry.timestamp})`);
  }
  for (const field of ['from_agent', 'to_agent']) {
    if (!isNonEmptyString(entry[field])) e(`${field} must be a non-empty string`);
  }
  if (typeof entry.task_id !== 'string' || !TASK_ID_RE.test(entry.task_id)) {
    e(`task_id must match T-### (got ${entry.task_id})`);
  }
  checkStringArray(entry.artifacts, 'artifacts', e);
  if (!isNonEmptyString(entry.decision_summary)) e('decision_summary must be a non-empty string');
  if (!Number.isInteger(entry.duration_ms) || entry.duration_ms < 0) {
    e('duration_ms must be a non-negative integer');
  }
  if (!HANDOFF_STATUSES.has(entry.status)) {
    e(`status must be one of ${[...HANDOFF_STATUSES].join(' | ')} (got ${entry.status})`);
  }
  if (!Number.isInteger(entry.retry_count) || entry.retry_count < 0) {
    e('retry_count must be a non-negative integer');
  }
  if (entry.status === 'success') {
    if (entry.failure_reason != null) e('failure_reason must be absent or null on success');
  } else if (HANDOFF_STATUSES.has(entry.status) && !isNonEmptyString(entry.failure_reason)) {
    e(`failure_reason must be a non-empty string when status is ${entry.status}`);
  }
  // Optional capture fields (D7) — validated only when present.
  if ('model' in entry && !isNonEmptyString(entry.model)) {
    e('model must be a non-empty string when present');
  }
  for (const field of ['turns_used', 'turn_limit']) {
    if (field in entry && (!Number.isInteger(entry[field]) || entry[field] < 1)) {
      e(`${field} must be a positive integer when present`);
    }
  }

  return errors;
}
