import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { run, parseRules, parseEmitted, parseEscalation } from '../scripts/rule-check-map.mjs';

const BASE_ROOT = fileURLToPath(new URL('..', import.meta.url));

test('Agent Base rule↔check map is intact (no orphan rules, no stale emissions)', () => {
  assert.deepEqual(run(BASE_ROOT), []);
});

// Hardening: RULE_DEF_RE only matches single-line definitions. A reflowed
// definition would silently vanish from both sets while the gate stays green —
// pin the live totals so any parse regression (or unannounced rule change)
// surfaces here and the numbers get updated consciously.
test('live rule/emission totals match the spec (parse-regression tripwire)', () => {
  const { defined, mechanicalAudit } = parseRules(
    readFileSync(join(BASE_ROOT, 'spec', 'rules.md'), 'utf8'));
  const emitted = parseEmitted(
    readFileSync(join(BASE_ROOT, 'scripts', 'lib', 'audit', 'checks.mjs'), 'utf8'));
  assert.equal(defined.size, 50);
  assert.equal(mechanicalAudit.size, 39);
  assert.equal(emitted.size, 40);
});

test('live strict-escalation arrows match audit.mjs (9 arrows, in sync)', () => {
  const { strictArrows } = parseRules(
    readFileSync(join(BASE_ROOT, 'spec', 'rules.md'), 'utf8'));
  const escalation = parseEscalation(
    readFileSync(join(BASE_ROOT, 'scripts', 'audit.mjs'), 'utf8'));
  assert.equal(strictArrows.size, 9);
  assert.deepEqual([...strictArrows.entries()].sort(), [...escalation.entries()].sort());
});

test('parser ignores judgment-only rules and Agent Base-CI rules for the audit requirement', () => {
  const rules = parseRules([
    '**R-90 · A mechanical audit rule** · mechanical · audit, warning',
    '**R-91 · A judgment rule** · judgment · rubric',
    '**R-92 · An Agent Base-CI rule** · mechanical · Agent Base CI',
    '**R-93 · A *(compat)* rule** · mechanical · audit, warning',
  ].join('\n'));
  assert.deepEqual([...rules.mechanicalAudit].sort(), ['R-90', 'R-93']);
  assert.ok(rules.defined.has('R-91') && rules.defined.has('R-92'));
});

test('parseEmitted finds F() rule emissions in either quote style', () => {
  const emitted = parseEmitted("out.push(F('R-01','error',...)); out.push(F(\"R-44\", 'warning'));");
  assert.deepEqual([...emitted].sort(), ['R-01', 'R-44']);
});

// Build a minimal Agent Base-shaped tree so run() can read the files.
// audit.mjs (the STRICT_ESCALATION carrier) is optional — absent means
// an empty escalation map.
function seedKit(rules, checks, auditSrc) {
  const root = mkdtempSync(join(tmpdir(), 'rcm-'));
  mkdirSync(join(root, 'spec'), { recursive: true });
  mkdirSync(join(root, 'scripts', 'lib', 'audit'), { recursive: true });
  writeFileSync(join(root, 'spec', 'rules.md'), rules);
  writeFileSync(join(root, 'scripts', 'lib', 'audit', 'checks.mjs'), checks);
  if (auditSrc != null) writeFileSync(join(root, 'scripts', 'audit.mjs'), auditSrc);
  return root;
}

test('orphaning a mechanical rule (defined, never checked) fails the gate', () => {
  const root = seedKit(
    '**R-01 · Present** · mechanical · audit, error\n**R-99 · Orphan** · mechanical · audit, warning\n',
    "out.push(F('R-01', 'error', 'AGENTS.md', 'x'));\n"
  );
  try {
    const f = run(root);
    assert.equal(f.length, 1);
    assert.equal(f[0].rule, 'R-99');
    assert.equal(f[0].kind, 'orphan-rule');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a check emitting an undefined/retired rule fails the gate', () => {
  const root = seedKit(
    '**R-01 · Present** · mechanical · audit, error\n',
    "out.push(F('R-01', 'error', 'x', 'y'));\nout.push(F('R-40', 'warning', 'x', 'retired'));\n"
  );
  try {
    const f = run(root);
    assert.equal(f.length, 1);
    assert.equal(f[0].rule, 'R-40');
    assert.equal(f[0].kind, 'unknown-emission');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('strict-escalation drift fails the gate in both directions', () => {
  const rules = [
    '**R-01 · Escalating** · mechanical · audit, info → warning',
    '**R-02 · Plain** · mechanical · audit, warning',
  ].join('\n') + '\n';
  const checks = "out.push(F('R-01', 'info', 'x', 'y'));\nout.push(F('R-02', 'warning', 'x', 'y'));\n";
  const inSync = seedKit(rules, checks, "const STRICT_ESCALATION = {\n  'R-01': 'warning',\n};\n");
  const missing = seedKit(rules, checks, 'const STRICT_ESCALATION = {};\n');
  const wrongTarget = seedKit(rules, checks, "const STRICT_ESCALATION = {\n  'R-01': 'error',\n};\n");
  const stale = seedKit(rules, checks, "const STRICT_ESCALATION = {\n  'R-01': 'warning',\n  'R-02': 'error',\n};\n");
  try {
    assert.deepEqual(run(inSync), []);
    assert.deepEqual(run(missing).map((f) => [f.rule, f.kind]), [['R-01', 'missing-escalation']]);
    assert.deepEqual(run(wrongTarget).map((f) => [f.rule, f.kind]), [['R-01', 'missing-escalation']]);
    assert.deepEqual(run(stale).map((f) => [f.rule, f.kind]), [['R-02', 'stale-escalation']]);
  } finally {
    for (const r of [inSync, missing, wrongTarget, stale]) rmSync(r, { recursive: true, force: true });
  }
});
