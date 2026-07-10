import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'orchestration');
const EVALS = join(FIXTURES, 'evals');

// E2 acceptance: every roster agent of the maxi synthesized blueprint has
// >= 2 goldens (and meets its own evalRequirements.minGoldens), and every
// golden parses to the eval-runner format — non-empty `task` string plus a
// non-empty `expectedProperties` checklist of non-empty strings.
const bp = JSON.parse(readFileSync(join(FIXTURES, 'maxi-repo.synthesized.blueprint.json'), 'utf8'));
const roster = [...bp.specialists, bp.orchestrator];

for (const agent of roster) {
  const dir = join(EVALS, agent.name);
  const quota = Math.max(2, agent.evalRequirements?.minGoldens ?? 0);

  test(`E2 quota: ${agent.name} has >= ${quota} goldens`, () => {
    assert.ok(existsSync(dir), `missing evals dir for ${agent.name}`);
    const goldens = readdirSync(dir).filter((f) => f.endsWith('.json'));
    assert.ok(goldens.length >= quota, `${agent.name}: ${goldens.length}/${quota} goldens`);
  });

  test(`E2 format: every ${agent.name} golden parses`, () => {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const golden = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      assert.equal(typeof golden.task, 'string', `${file}: task must be a string`);
      assert.ok(golden.task.trim().length > 0, `${file}: task must be non-empty`);
      assert.ok(Array.isArray(golden.expectedProperties), `${file}: expectedProperties must be an array`);
      assert.ok(golden.expectedProperties.length > 0, `${file}: checklist must be non-empty`);
      for (const prop of golden.expectedProperties) {
        assert.equal(typeof prop, 'string', `${file}: every property must be a string`);
        assert.ok(prop.trim().length > 0, `${file}: empty property`);
      }
    }
  });
}

// No orphan golden dirs — every evals/<agent> dir maps to a roster agent, or
// is the reserved "routing" dir (main-loop routing-decision goldens, R-56 —
// not an agent, so it never appears in the roster; validateBlueprint rejects
// any agent actually named "routing", so the two can never collide).
test('E2 hygiene: every evals dir matches a roster agent or the reserved "routing" dir', () => {
  const names = new Set(roster.map((a) => a.name));
  for (const dir of readdirSync(EVALS, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    assert.ok(names.has(dir.name) || dir.name === 'routing', `evals/${dir.name} has no matching roster agent`);
  }
});

// ── Routing goldens (R-56): does the main loop defer to the fleet? ─────────
//
// maxi's routing_policy is "threshold" — routing goldens are required (one
// qualifying multi-layer request, one non-qualifying single-layer request).
// mini's policy is "manual" (see orchestration-schemas tests) — no routing
// region is ever emitted for it, so routing goldens are exempt there.

test('E3 routing quota: maxi (threshold policy) has >= 2 routing goldens', () => {
  assert.equal(bp.dispatch_rules.routing_policy, 'threshold');
  const dir = join(EVALS, 'routing');
  assert.ok(existsSync(dir), 'missing evals/routing dir for a threshold/always routing_policy');
  const goldens = readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(goldens.length >= 2, `routing: ${goldens.length}/2 goldens`);
});

test('E3 format: every routing golden parses', () => {
  const dir = join(EVALS, 'routing');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const golden = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    assert.equal(typeof golden.task, 'string', `${file}: task must be a string`);
    assert.ok(golden.task.trim().length > 0, `${file}: task must be non-empty`);
    assert.ok(Array.isArray(golden.expectedProperties), `${file}: expectedProperties must be an array`);
    assert.ok(golden.expectedProperties.length > 0, `${file}: checklist must be non-empty`);
    for (const prop of golden.expectedProperties) {
      assert.equal(typeof prop, 'string', `${file}: every property must be a string`);
      assert.ok(prop.trim().length > 0, `${file}: empty property`);
    }
  }
});
