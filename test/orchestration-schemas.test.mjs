import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  validateRepoProfile,
  validateDecisionsDoc,
  validateBlueprint,
  validateHandoffLog,
  DECISION_ENUMS,
} from '../scripts/lib/orchestration/schemas.mjs';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'orchestration');
const loadFixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));

// ── validateRepoProfile (A1) ────────────────────────────────────────────────

test('validateRepoProfile: maxi-repo profile fixture validates clean', () => {
  assert.deepEqual(validateRepoProfile(loadFixture('maxi-repo.profile.json')), []);
});

test('validateRepoProfile: mini-repo profile fixture validates clean', () => {
  assert.deepEqual(validateRepoProfile(loadFixture('mini-repo.profile.json')), []);
});

test('validateRepoProfile: non-object inputs are rejected outright', () => {
  for (const input of [null, undefined, [], 'profile', 42]) {
    assert.deepEqual(validateRepoProfile(input), ['profile must be an object']);
  }
});

test('validateRepoProfile: malformed fixture — wrong schemaVersion, empty layers', () => {
  assert.deepEqual(validateRepoProfile(loadFixture('profile-malformed-empty-layers.json')), [
    'schemaVersion must be 1 (got 2)',
    'layers must be a non-empty array',
  ]);
});

test('validateRepoProfile: malformed fixture — bad type enum, empty packageManager, non-string ci', () => {
  assert.deepEqual(validateRepoProfile(loadFixture('profile-malformed-bad-enums.json')), [
    'type must be one of monorepo | single-package (got hybrid)',
    'packageManager must be a non-empty string',
    'ci must be a string or null (null = no CI detected)',
  ]);
});

test('validateRepoProfile: malformed fixture — broken layer entries, edges, conventions, gaps', () => {
  assert.deepEqual(validateRepoProfile(loadFixture('profile-malformed-bad-layer.json')), [
    'layers[0].stack must be a non-empty string',
    'layers[0].testCmd must be a string or null (null = not detected)',
    'layers[1] must be an object',
    'internalEdges[0].from "ui" is not a layer name',
    'internalEdges[1] is a self-edge ("api")',
    'conventions.commitStyle must be a string or null (null = not detected)',
    'gaps[1] must be a non-empty string',
  ]);
});

test('validateRepoProfile: internalEdges entries checked for shape, strings, duplicates', () => {
  const profile = loadFixture('maxi-repo.profile.json');
  profile.internalEdges = [
    'ui->shared',
    { from: 'ui' },
    { from: 'api', to: 'shared' },
    { from: 'api', to: 'shared' },
  ];
  assert.deepEqual(validateRepoProfile(profile), [
    'internalEdges[0] must be an object ({ from: consumer, to: provider })',
    'internalEdges[1].to must be a non-empty string layer name',
    'internalEdges: duplicate edge api→shared',
  ]);
});

test('validateRepoProfile: commands must be string or null, never omitted or mistyped', () => {
  const profile = loadFixture('mini-repo.profile.json');
  delete profile.layers[0].testCmd;       // omitted
  profile.layers[0].buildCmd = false;     // mistyped
  assert.deepEqual(validateRepoProfile(profile), [
    'layers[0].testCmd must be a string or null (null = not detected)',
    'layers[0].buildCmd must be a string or null (null = not detected)',
  ]);
});

test('validateRepoProfile: missing top-level fields all report', () => {
  assert.deepEqual(validateRepoProfile({}), [
    'schemaVersion must be 1 (got undefined)',
    'name must be a non-empty string',
    'type must be one of monorepo | single-package (got undefined)',
    'layers must be a non-empty array',
    'internalEdges must be an array ([] = no internal dependencies)',
    'packageManager must be a non-empty string',
    'ci must be a string or null (null = no CI detected)',
    'conventions must be an object',
    'gaps must be an array',
  ]);
});

// ── validateDecisionsDoc (A2) ───────────────────────────────────────────────

test('validateDecisionsDoc: maxi-repo decisions fixture validates clean', () => {
  assert.deepEqual(validateDecisionsDoc(loadFixture('maxi-repo.decisions.json')), []);
});

test('validateDecisionsDoc: mini-repo decisions fixture validates clean', () => {
  assert.deepEqual(validateDecisionsDoc(loadFixture('mini-repo.decisions.json')), []);
});

test('validateDecisionsDoc: non-object inputs are rejected outright', () => {
  for (const input of [null, undefined, [], 'decisions', 42]) {
    assert.deepEqual(validateDecisionsDoc(input), ['decisions must be an object']);
  }
});

test('validateDecisionsDoc: every enum value of every field validates', () => {
  for (const [field, values] of Object.entries(DECISION_ENUMS)) {
    for (const value of values) {
      const doc = { ...loadFixture('maxi-repo.decisions.json'), [field]: value };
      assert.deepEqual(validateDecisionsDoc(doc), []);
    }
  }
});

test('validateDecisionsDoc: malformed fixture — wrong schemaVersion, missing field', () => {
  assert.deepEqual(validateDecisionsDoc(loadFixture('decisions-malformed-bad-version.json')), [
    'schemaVersion must be 1 (got 2)',
    'humanGatePlacement must be one of pre-merge | pre-dispatch-and-pre-merge (got undefined)',
  ]);
});

test('validateDecisionsDoc: malformed fixture — out-of-enum values', () => {
  assert.deepEqual(validateDecisionsDoc(loadFixture('decisions-malformed-bad-enums.json')), [
    'tddPolicy must be one of test-first | test-with-change | optional (got tdd)',
    'reviewGates must be one of every-task | every-merge | risk-based (got always)',
    'qaDepth must be one of unit-only | unit-and-integration | full-pyramid (got e2e)',
  ]);
});

test('validateDecisionsDoc: malformed fixture — wrong types', () => {
  assert.deepEqual(validateDecisionsDoc(loadFixture('decisions-malformed-bad-types.json')), [
    'tddPolicy must be one of test-first | test-with-change | optional (got true)',
    'reviewGates must be one of every-task | every-merge | risk-based (got every-merge)',
    'qaDepth must be one of unit-only | unit-and-integration | full-pyramid (got 3)',
    'humanGatePlacement must be one of pre-merge | pre-dispatch-and-pre-merge (got null)',
  ]);
});

test('validateDecisionsDoc: missing top-level fields all report', () => {
  const errors = validateDecisionsDoc({});
  assert.equal(errors.length, 1 + Object.keys(DECISION_ENUMS).length);
  assert.equal(errors[0], 'schemaVersion must be 1 (got undefined)');
});

// ── validateBlueprint (A3) ──────────────────────────────────────────────────

test('validateBlueprint: maxi-repo blueprint fixture validates clean', () => {
  assert.deepEqual(validateBlueprint(loadFixture('maxi-repo.blueprint.json')), []);
});

test('validateBlueprint: non-object inputs are rejected outright', () => {
  for (const input of [null, undefined, [], 'blueprint', 42]) {
    assert.deepEqual(validateBlueprint(input), ['blueprint must be an object']);
  }
});

test('validateBlueprint: malformed fixture — wrong schemaVersion type, everything missing', () => {
  assert.deepEqual(validateBlueprint(loadFixture('blueprint-malformed-empty.json')), [
    'schemaVersion must be 1 (got 1)',
    'specialists must be a non-empty array',
    'orchestrator must be an object',
    'dispatch_rules must be an object',
    'docs must be an array',
  ]);
});

test('validateBlueprint: malformed fixture — broken specialist entry and duplicate name', () => {
  assert.deepEqual(validateBlueprint(loadFixture('blueprint-malformed-bad-specialist.json')), [
    'specialists[0].templateId must be a non-empty string',
    'specialists[0].slots: slot name "LayerPath" must be kebab-case (DD-5)',
    'specialists[0].slots["test-cmd"] must be a non-empty string',
    'specialists[0].turnLimit must be a positive integer',
    'specialists[0].tools must be a non-empty array',
    'specialists[0].evalRequirements.minGoldens must be a positive integer',
    'specialists: duplicate name "api-engineer"',
  ]);
});

test('validateBlueprint: malformed fixture — version pin tripwire, bad dispatch_rules, bad docs', () => {
  assert.deepEqual(validateBlueprint(loadFixture('blueprint-malformed-bad-dispatch.json')), [
    'specialists[0].templateVersion is not allowed — version pins live in the generation manifest (DD-13)',
    'orchestrator.evalRequirements.minGoldens must be a positive integer',
    'dispatch_rules.subagent_max_scopes must be a positive integer',
    'dispatch_rules.agent_team_on_cross_repo must be a boolean',
    'dispatch_rules.pipeline_when[0] must be one of scheduled | multi_day (got nightly)',
    'dispatch_rules.dispatch_order: duplicate layer "api"',
    'docs must be an array',
  ]);
});

test('validateBlueprint: orchestrator name colliding with a specialist is rejected', () => {
  const bp = loadFixture('maxi-repo.blueprint.json');
  bp.orchestrator.name = bp.specialists[0].name;
  assert.deepEqual(validateBlueprint(bp), [
    `orchestrator.name "${bp.specialists[0].name}" collides with a specialist name`,
  ]);
});

test('validateBlueprint: dispatch_order required ([] = unconstrained) and item-checked', () => {
  const missing = loadFixture('maxi-repo.blueprint.json');
  delete missing.dispatch_rules.dispatch_order;
  assert.deepEqual(validateBlueprint(missing), [
    'dispatch_rules.dispatch_order must be an array of layer names ([] = no internal ordering constraints)',
  ]);

  const bad = loadFixture('maxi-repo.blueprint.json');
  bad.dispatch_rules.dispatch_order = ['shared', '', 3];
  assert.deepEqual(validateBlueprint(bad), [
    'dispatch_rules.dispatch_order[1] must be a non-empty string',
    'dispatch_rules.dispatch_order[2] must be a non-empty string',
  ]);
});

test('validateBlueprint: missing top-level fields all report', () => {
  assert.deepEqual(validateBlueprint({}), [
    'schemaVersion must be 1 (got undefined)',
    'specialists must be a non-empty array',
    'orchestrator must be an object',
    'dispatch_rules must be an object',
    'docs must be an array',
  ]);
});

test('validateBlueprint: modelTier must be a logical tier, not a concrete model id', () => {
  const blueprint = loadFixture('maxi-repo.blueprint.json');
  blueprint.specialists[0].modelTier = 'opus-4';   // model id, not a tier
  blueprint.orchestrator.modelTier = 'sonet';      // typo
  assert.deepEqual(validateBlueprint(blueprint), [
    'specialists[0].modelTier must be one of haiku | sonnet | opus (got opus-4)',
    'orchestrator.modelTier must be one of haiku | sonnet | opus (got sonet)',
  ]);
});

test('validateBlueprint: non-object specialist and non-string tool entries report by index', () => {
  const blueprint = loadFixture('maxi-repo.blueprint.json');
  blueprint.specialists.push('qa-agent');
  blueprint.orchestrator.tools = ['Read', '', 'Agent'];
  assert.deepEqual(validateBlueprint(blueprint), [
    'specialists[4] must be an object',
    'orchestrator.tools[1] must be a non-empty string',
  ]);
});

test('validateBlueprint: inverted dispatch tiers are rejected', () => {
  const blueprint = loadFixture('maxi-repo.blueprint.json');
  blueprint.dispatch_rules.subagent_max_scopes = 5;   // ≥ agent_team_min_scopes (3)
  assert.deepEqual(validateBlueprint(blueprint), [
    'dispatch_rules tiers must be ordered: subagent_max_scopes (5) must be < agent_team_min_scopes (3)',
  ]);
  blueprint.dispatch_rules.subagent_max_scopes = 3;   // equal is also dead team tier
  assert.equal(validateBlueprint(blueprint).length, 1);
});

// ── Phase B synthesized blueprints (B8 goldens) ─────────────────────────────
// Pipeline outputs committed as goldens (regenerated by plan-synthesizer from
// the golden profiles + decisions fixtures). C3 acceptance instantiates these.

test('B8 golden: maxi synthesized blueprint validates with ≥4 specialists', () => {
  const bp = loadFixture('maxi-repo.synthesized.blueprint.json');
  assert.deepEqual(validateBlueprint(bp), []);
  assert.ok(bp.specialists.length >= 4, `expected ≥4 specialists, got ${bp.specialists.length}`);
});

test('B8 golden: mini synthesized blueprint validates and selects the generic template', () => {
  const bp = loadFixture('mini-repo.synthesized.blueprint.json');
  assert.deepEqual(validateBlueprint(bp), []);
  const generic = bp.specialists.filter((s) => s.templateId === 'generic-specialist');
  assert.ok(generic.length >= 1, 'mini blueprint must select generic-specialist at least once');
});

// ── validateHandoffLog (A5) ─────────────────────────────────────────────────

test('validateHandoffLog: success fixture with optional capture fields validates clean', () => {
  assert.deepEqual(validateHandoffLog(loadFixture('handoff-success.json')), []);
});

test('validateHandoffLog: failed-dispatch fixture validates clean', () => {
  assert.deepEqual(validateHandoffLog(loadFixture('handoff-failed-dispatch.json')), []);
});

test('validateHandoffLog: fixture omitting optional fields validates clean', () => {
  assert.deepEqual(validateHandoffLog(loadFixture('handoff-minimal.json')), []);
});

test('validateHandoffLog: non-object inputs are rejected outright', () => {
  for (const input of [null, undefined, [], 'entry', 42]) {
    assert.deepEqual(validateHandoffLog(input), ['handoff-log entry must be an object']);
  }
});

test('validateHandoffLog: missing required fields all report', () => {
  assert.deepEqual(validateHandoffLog({}), [
    'timestamp must be an ISO 8601 string (got undefined)',
    'from_agent must be a non-empty string',
    'to_agent must be a non-empty string',
    'task_id must match T-### (got undefined)',
    'artifacts must be an array',
    'decision_summary must be a non-empty string',
    'duration_ms must be a non-negative integer',
    'status must be one of success | failed | blocked (got undefined)',
    'retry_count must be a non-negative integer',
  ]);
});

test('validateHandoffLog: failure_reason coupling to status enforced both ways', () => {
  const success = loadFixture('handoff-success.json');
  success.failure_reason = 'should not be here';
  assert.deepEqual(validateHandoffLog(success), ['failure_reason must be absent or null on success']);

  const failed = loadFixture('handoff-failed-dispatch.json');
  delete failed.failure_reason;
  assert.deepEqual(validateHandoffLog(failed), ['failure_reason must be a non-empty string when status is failed']);
});

test('validateHandoffLog: bad timestamp, status, and counters report', () => {
  const entry = loadFixture('handoff-minimal.json');
  entry.timestamp = 'yesterday-ish';
  entry.status = 'crashed';
  entry.duration_ms = -1;
  entry.retry_count = 1.5;
  assert.deepEqual(validateHandoffLog(entry), [
    'timestamp must be an ISO 8601 string (got yesterday-ish)',
    'duration_ms must be a non-negative integer',
    'status must be one of success | failed | blocked (got crashed)',
    'retry_count must be a non-negative integer',
  ]);
});

test('validateHandoffLog: optional capture fields validated only when present', () => {
  const entry = loadFixture('handoff-minimal.json');
  entry.model = '';
  entry.turns_used = 0;
  entry.turn_limit = 'thirty';
  assert.deepEqual(validateHandoffLog(entry), [
    'model must be a non-empty string when present',
    'turns_used must be a positive integer when present',
    'turn_limit must be a positive integer when present',
  ]);
});

test('validateBlueprint: reserved slot names rejected (injected-slot shadowing guard)', () => {
  const blueprint = loadFixture('maxi-repo.blueprint.json');
  blueprint.specialists[0].slots.name = 'shadow';
  blueprint.orchestrator.slots['turn-limit'] = '99';
  blueprint.orchestrator.slots['dispatch-order'] = 'shared first';
  assert.deepEqual(validateBlueprint(blueprint), [
    'specialists[0].slots: "name" is reserved (injected from blueprint fields at instantiation)',
    'orchestrator.slots: "turn-limit" is reserved (injected from blueprint fields at instantiation)',
    'orchestrator.slots: "dispatch-order" is reserved (injected from blueprint fields at instantiation)',
  ]);
});
