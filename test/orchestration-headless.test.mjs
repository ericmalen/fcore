import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { parseTasksMd } from '../scripts/lib/orchestration/parse-tasks.mjs';
import { decideHeadlessRun } from '../scripts/lib/orchestration/headless-guard.mjs';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'orchestration');
const GUARD_CLI = join(import.meta.dirname, '..', 'scripts', 'headless-guard.mjs');
const loadText = (name) => readFileSync(join(FIXTURES, name), 'utf8');
const parse = (text) => parseTasksMd(text).doc;

// ── guard decision matrix (F4) ──────────────────────────────────────────────

test('decideHeadlessRun: happy path picks the first eligible Backlog task', () => {
  const doc = parse(loadText('tasks-canonical.md'));
  assert.deepEqual(decideHeadlessRun({ tasksDoc: doc, openBranches: [] }), {
    run: true, reason: 'eligible-task', taskId: 'T-001',
  });
});

test('decideHeadlessRun: open orch/ PR branch skips, even with eligible tasks', () => {
  const doc = parse(loadText('tasks-canonical.md'));
  assert.deepEqual(
    decideHeadlessRun({ tasksDoc: doc, openBranches: ['feature/x', 'orch/run-12'] }),
    { run: false, reason: 'orchestrator-pr-open' },
  );
  // custom prefix respected
  assert.equal(
    decideHeadlessRun({ tasksDoc: doc, openBranches: ['orch/run-12'], branchPrefix: 'bot/' }).run,
    true,
  );
});

test('decideHeadlessRun: empty Backlog skips', () => {
  const doc = parse('# Tasks\n\n## Backlog\n\n## In Progress\n\n## Done\n');
  assert.deepEqual(decideHeadlessRun({ tasksDoc: doc }), { run: false, reason: 'backlog-empty' });
});

test('decideHeadlessRun: blocked-only and triage-only Backlogs skip', () => {
  const blocked = parse(
    '# Tasks\n\n## Backlog\n\n- [ ] T-001 | scope: api | Flaky\n  - blocked: see handoff log\n\n## In Progress\n\n## Done\n',
  );
  assert.deepEqual(decideHeadlessRun({ tasksDoc: blocked }), { run: false, reason: 'backlog-all-blocked' });

  // triage imports awaiting scoping never trigger a paid run, even without a
  // blocked line (belt and braces — tracker-sync always writes both)
  const triage = parse(
    '# Tasks\n\n## Backlog\n\n- [ ] T-002 | scope: triage | Imported item\n  - ref: AB#9\n\n## In Progress\n\n## Done\n',
  );
  assert.deepEqual(decideHeadlessRun({ tasksDoc: triage }), { run: false, reason: 'backlog-all-blocked' });
});

test('decideHeadlessRun: skips blocked/triage tasks but runs the next eligible one', () => {
  const doc = parse(
    '# Tasks\n\n## Backlog\n\n- [ ] T-001 | scope: triage | Import\n  - blocked: needs human scoping (imported from #9)\n- [ ] T-002 | scope: api | Real work\n\n## In Progress\n\n## Done\n',
  );
  assert.deepEqual(decideHeadlessRun({ tasksDoc: doc }), {
    run: true, reason: 'eligible-task', taskId: 'T-002',
  });
});

// ── paired CI templates (DD-15) ─────────────────────────────────────────────

const CI = join(import.meta.dirname, '..', 'templates', 'ci');
const gh = readFileSync(join(CI, 'orchestrator-run.github.yml'), 'utf8');
const ado = readFileSync(join(CI, 'orchestrator-run.ado.yml'), 'utf8');

test('orchestrator-run templates: both carry the headless invariants', () => {
  for (const [name, text] of [['github', gh], ['ado', ado]]) {
    assert.match(text, /cron: '0 5 \* \* 1-5'/, `${name}: weekday cron schedule`);
    assert.match(text, /npm i -g @anthropic-ai\/claude-code/, `${name}: installs the Claude CLI`);
    assert.match(text, /claude -p "/, `${name}: headless claude -p invocation`);
    assert.match(text, /--max-turns 80/, `${name}: turn cap`);
    assert.match(text, /headless-guard/, `${name}: decisions come from the guard CLI`);
    assert.match(text, /ANTHROPIC_API_KEY/, `${name}: API key from platform secrets`);
    assert.match(text, /orch\/run-/, `${name}: work branch under orch/`);
    assert.match(text, /tracker-sync/, `${name}: optional tracker-sync chain`);
    assert.match(text, /do NOT push and do NOT open a PR/, `${name}: agent never pushes`);
  }
  assert.match(gh, /workflow_dispatch/, 'github: manual trigger');
  assert.match(gh, /concurrency:/, 'github: overlap guard');
});

test('orchestrator-run templates: never auto-merge (D5)', () => {
  for (const [name, text] of [['github', gh], ['ado', ado]]) {
    assert.doesNotMatch(text, /pr merge/, `${name}: no gh pr merge`);
    assert.doesNotMatch(text, /autoComplete/, `${name}: no ADO auto-complete`);
    assert.doesNotMatch(text, /merge --/, `${name}: no merge commands`);
  }
});

test('orchestrator-run templates: step sequences are structurally paired', () => {
  const ghSteps = [...gh.matchAll(/^ {6}- name: (.+)$/gm)].map((m) => m[1]);
  const adoSteps = [...ado.matchAll(/^ {4}displayName: (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(ghSteps, [
    'Resolve FleetCore npx spec',
    'Guard - decide whether to run',
    'Tracker sync (optional)',
    'Run feature-orchestrator headless',
    'Push branch and open PR',
  ]);
  // ADO carries one extra display name for its schedule block; the step
  // sequence after it must match GitHub's exactly.
  assert.deepEqual(adoSteps.filter((s) => s !== 'scheduled orchestrator run'), ghSteps);
});

// ── headless-guard CLI wrapper (scripts/headless-guard.mjs) ─────────────────

test('headless-guard CLI: emits run/reason/task lines for an eligible backlog', () => {
  const root = mkdtempSync(join(tmpdir(), 'ab-guard-'));
  cpSync(join(FIXTURES, 'tasks-canonical.md'), join(root, 'tasks.md'));
  const r = spawnSync(process.execPath, [GUARD_CLI, '--root', root], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'run=true\nreason=eligible-task\ntask=T-001\n');
});

test('headless-guard CLI: open orchestrator branch skips the run', () => {
  const root = mkdtempSync(join(tmpdir(), 'ab-guard-'));
  cpSync(join(FIXTURES, 'tasks-canonical.md'), join(root, 'tasks.md'));
  const branches = join(root, 'open-branches.json');
  writeFileSync(branches, JSON.stringify(['orch/run-123', 'feature/x']));
  const r = spawnSync(process.execPath, [GUARD_CLI, '--root', root, '--open-branches', branches], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'run=false\nreason=orchestrator-pr-open\ntask=\n');
});

test('headless-guard CLI: missing tasks.md exits 1; bad flag exits 2', () => {
  const root = mkdtempSync(join(tmpdir(), 'ab-guard-'));
  const missing = spawnSync(process.execPath, [GUARD_CLI, '--root', root], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  const usage = spawnSync(process.execPath, [GUARD_CLI, '--nope'], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
});
