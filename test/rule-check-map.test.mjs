import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { run, parseRules, parseEmitted } from '../scripts/rule-check-map.mjs';

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

// Build a minimal Agent Base-shaped tree so run() can read both files.
function seedKit(rules, checks) {
  const root = mkdtempSync(join(tmpdir(), 'rcm-'));
  mkdirSync(join(root, 'spec'), { recursive: true });
  mkdirSync(join(root, 'scripts', 'lib', 'audit'), { recursive: true });
  writeFileSync(join(root, 'spec', 'rules.md'), rules);
  writeFileSync(join(root, 'scripts', 'lib', 'audit', 'checks.mjs'), checks);
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
