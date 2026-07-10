import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { parseTasksMd, renderTasksMd } from '../scripts/lib/orchestration/parse-tasks.mjs';
import { validateSyncPlan, validateTaskBacklog } from '../scripts/lib/orchestration/schemas.mjs';
import {
  applyImports, applyPrunes, computeSyncPlan, renderSyncReport, DEFAULT_STATE_MAPS,
} from '../scripts/lib/orchestration/tracker-sync.mjs';
import {
  adoAuthHeader, buildStatePatch, buildWiql, normalizeAdoItem, workItemIdFromRef,
} from '../scripts/lib/orchestration/tracker-ado.mjs';
import {
  buildGhListArgs, buildGhUpdateArgs, issueNumberFromRef, normalizeGhIssue,
} from '../scripts/lib/orchestration/tracker-gh.mjs';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'orchestration');
const loadJson = (name) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));

// An ADO-linked backlog exercising every plan class against
// tracker-items-ado.json: AB#230 update→active, AB#229 update→done,
// AB#231 tracker-done-task-open, AB#250 missing-tracker-item,
// AB#232 import, AB#233 done+unmatched (ignored).
const ADO_TASKS = `# Tasks

## Backlog

- [ ] T-001 | scope: api | Rate-limit the tagging endpoint
  - ref: AB#231
- [ ] T-003 | scope: db | Old import nobody filed
  - ref: AB#250

## In Progress

- [~] T-002 | scope: ui | Bilingual toggle on catalogue page (owner: feature-orchestrator)
  - ref: AB#230

## Done

- [x] T-000 | scope: shared | Extract tag schema to types.ts (commit: abc1234)
  - ref: AB#229
`;

// ── computeSyncPlan (pure core) ─────────────────────────────────────────────

test('computeSyncPlan: full matrix — import, both update directions, both lookup conflicts', () => {
  const { doc, errors } = parseTasksMd(ADO_TASKS);
  assert.deepEqual(errors, []);
  const plan = computeSyncPlan(doc, loadJson('tracker-items-ado.json'), 'ado');

  assert.deepEqual(validateSyncPlan(plan), []);
  assert.deepEqual(plan.imports, [{
    externalId: 'AB#232',
    title: 'Add audit log for tag deletions',
    url: 'https://dev.azure.com/org/proj/_workitems/edit/232',
  }]);
  assert.deepEqual(plan.statusUpdates.sort((a, b) => a.taskId.localeCompare(b.taskId)), [
    { taskId: 'T-000', externalId: 'AB#229', to: 'done', comment: 'commit: abc1234' },
    { taskId: 'T-002', externalId: 'AB#230', to: 'active', comment: 'owner: feature-orchestrator' },
  ]);
  assert.deepEqual(plan.conflicts.map((c) => c.kind).sort(), [
    'missing-tracker-item', 'tracker-done-task-open',
  ]);
  // T-000/AB#229 still needs a push to reach done — not pruned pre-push
  // (the pure core cannot know the push will succeed; the CLI prunes it
  // only after confirming the push).
  assert.deepEqual(plan.prunes, []);
});

test('computeSyncPlan: a Done task already synced with the tracker is pruned (no push needed)', () => {
  const { doc } = parseTasksMd(
    '# Tasks\n\n## Backlog\n\n## In Progress\n\n## Done\n\n'
    + '- [x] T-001 | scope: api | Old, already synced (commit: abc1234)\n  - ref: AB#500\n',
  );
  const items = [{ externalId: 'AB#500', title: 'Old, already synced', state: 'done', url: null }];
  const plan = computeSyncPlan(doc, items, 'ado');
  assert.deepEqual(plan.prunes, ['T-001']);
  assert.deepEqual(plan.statusUpdates, []);   // already in sync, nothing to push
  assert.deepEqual(plan.conflicts, []);
});

test('computeSyncPlan: blocked Backlog task pushes intake with blocked comment', () => {
  const { doc } = parseTasksMd(
    '# Tasks\n\n## Backlog\n\n- [ ] T-001 | scope: api | Flaky migration\n  - ref: AB#240\n  - blocked: see handoff-log entry 12\n\n## In Progress\n\n## Done\n',
  );
  const items = [{ externalId: 'AB#240', title: 'Flaky migration', state: 'active', url: null }];
  const plan = computeSyncPlan(doc, items, 'ado');
  assert.deepEqual(plan.statusUpdates, [
    { taskId: 'T-001', externalId: 'AB#240', to: 'intake', comment: 'blocked: see handoff-log entry 12' },
  ]);
});

test('computeSyncPlan: duplicate refs conflict, first task wins the mapping', () => {
  const { doc } = parseTasksMd(
    '# Tasks\n\n## Backlog\n\n- [ ] T-001 | scope: api | First\n  - ref: #9\n\n## In Progress\n\n- [~] T-002 | scope: ui | Second\n  - ref: #9\n\n## Done\n',
  );
  // parser allows it (structure), validator + plan both flag it
  const plan = computeSyncPlan(doc, [{ externalId: '#9', title: 'First', state: 'intake', url: null }], 'gh');
  assert.deepEqual(plan.conflicts, [
    { kind: 'duplicate-ref', detail: 'ref "#9" appears on T-001 and T-002' },
  ]);
  assert.deepEqual(plan.statusUpdates, []);   // T-001 backlog/intake matches item state
});

test('computeSyncPlan: items with unmapped (null) state are skipped', () => {
  const { doc } = parseTasksMd('# Tasks\n\n## Backlog\n\n## In Progress\n\n## Done\n');
  const items = [{ externalId: 'AB#1', title: 'Scrum-state item', state: null, url: null }];
  const plan = computeSyncPlan(doc, items, 'ado');
  assert.deepEqual(plan, { platform: 'ado', imports: [], statusUpdates: [], conflicts: [], prunes: [] });
});

test('computeSyncPlan → applyImports → recompute is idempotent', () => {
  const { doc } = parseTasksMd(ADO_TASKS);
  const items = loadJson('tracker-items-ado.json');
  const plan = computeSyncPlan(doc, items, 'ado');

  const after = applyImports(doc, plan.imports);
  assert.deepEqual(validateTaskBacklog(after), []);

  // simulate the tracker accepting the status pushes
  const pushedItems = items.map((it) => {
    const u = plan.statusUpdates.find((x) => x.externalId === it.externalId);
    return u ? { ...it, state: u.to } : it;
  });

  const second = computeSyncPlan(after, pushedItems, 'ado');
  assert.deepEqual(second.imports, []);
  assert.deepEqual(second.statusUpdates, []);
  // unresolved conflicts persist by design — humans clear them
  assert.deepEqual(second.conflicts.map((c) => c.kind).sort(), [
    'missing-tracker-item', 'tracker-done-task-open',
  ]);
  // T-000/AB#229 is now confirmed done in the tracker — the recompute (as
  // the CLI does post-push) picks it up as an already-synced prune.
  assert.deepEqual(second.prunes, ['T-000']);
});

test('applyPrunes: removes only the named Done tasks, other sections and input untouched', () => {
  const { doc } = parseTasksMd(ADO_TASKS);
  const after = applyPrunes(doc, ['T-000']);
  assert.deepEqual(after.done, []);
  assert.equal(after.backlog.length, doc.backlog.length);
  assert.equal(after.inProgress.length, doc.inProgress.length);
  // canonical render parses back clean
  const { doc: reparsed, errors } = parseTasksMd(renderTasksMd(after));
  assert.deepEqual(errors, []);
  assert.deepEqual(reparsed, after);
  // input doc untouched
  assert.equal(doc.done.length, 1);
});

test('applyImports: triage-blocked shape, sequential ids, round-trips through renderer', () => {
  const { doc } = parseTasksMd(ADO_TASKS);
  const after = applyImports(doc, [
    { externalId: 'AB#232', title: 'Add audit log for tag deletions', url: null },
    { externalId: 'AB#260', title: 'Second import', url: null },
  ]);
  const added = after.backlog.slice(-2);
  assert.deepEqual(added.map((t) => t.id), ['T-004', 'T-005']);   // max was T-003
  assert.deepEqual(added[0], {
    id: 'T-004',
    scope: ['triage'],
    title: 'Add audit log for tag deletions',
    owner: null,
    commit: null,
    ref: 'AB#232',
    ac: [],
    blocked: 'needs human scoping (imported from AB#232)',
  });
  // canonical render parses back clean
  const { doc: reparsed, errors } = parseTasksMd(renderTasksMd(after));
  assert.deepEqual(errors, []);
  assert.deepEqual(reparsed, after);
  // input doc untouched
  assert.equal(doc.backlog.length, 2);
});

test('renderSyncReport: covers every plan section', () => {
  const { doc } = parseTasksMd(ADO_TASKS);
  const report = renderSyncReport(computeSyncPlan(doc, loadJson('tracker-items-ado.json'), 'ado'));
  assert.match(report, /imports → Backlog: 1/);
  assert.match(report, /\+ AB#232 "Add audit log for tag deletions"/);
  assert.match(report, /~ AB#230 → active \(T-002; owner: feature-orchestrator\)/);
  assert.match(report, /prunes → tasks\.md Done: 0/);
  assert.match(report, /! \[tracker-done-task-open\]/);
});

test('renderSyncReport: lists pruned task ids', () => {
  const { doc } = parseTasksMd(
    '# Tasks\n\n## Backlog\n\n## In Progress\n\n## Done\n\n'
    + '- [x] T-001 | scope: api | Old, already synced (commit: abc1234)\n  - ref: AB#500\n',
  );
  const items = [{ externalId: 'AB#500', title: 'Old, already synced', state: 'done', url: null }];
  const report = renderSyncReport(computeSyncPlan(doc, items, 'ado'));
  assert.match(report, /prunes → tasks\.md Done: 1/);
  assert.match(report, /- T-001/);
});

// ── ADO adapter (pure helpers) ──────────────────────────────────────────────

test('normalizeAdoItem: raw REST fixture maps to the contract; unknown state → null', () => {
  const raw = loadJson('tracker-raw-ado.json').value;
  assert.deepEqual(normalizeAdoItem(raw[0]), {
    externalId: 'AB#231',
    title: 'Rate-limit the tagging endpoint',
    state: 'intake',
    rawState: 'To Do',
    url: 'https://dev.azure.com/org/proj/_workitems/edit/231',
  });
  assert.equal(normalizeAdoItem(raw[1]).state, 'active');     // Doing
  assert.equal(normalizeAdoItem(raw[1]).url, null);
  assert.equal(normalizeAdoItem(raw[2]).state, null);         // Resolved — not in basic map
  assert.equal(normalizeAdoItem(raw[2]).rawState, 'Resolved');
  // agile map reads Active/New/Closed
  assert.equal(normalizeAdoItem({ id: 1, fields: { 'System.Title': 't', 'System.State': 'Closed' } }, 'agile').state, 'done');
});

test('buildStatePatch / buildWiql / adoAuthHeader / workItemIdFromRef', () => {
  assert.deepEqual(buildStatePatch('done'), [
    { op: 'add', path: '/fields/System.State', value: 'Done' },
  ]);
  assert.deepEqual(buildStatePatch('active', 'agile'), [
    { op: 'add', path: '/fields/System.State', value: 'Active' },
  ]);
  assert.match(buildWiql("o'proj").query, /\[System.TeamProject\] = 'o''proj'/);
  assert.equal(adoAuthHeader('pat123'), `Basic ${Buffer.from(':pat123').toString('base64')}`);
  assert.equal(workItemIdFromRef('AB#231'), 231);
  assert.equal(workItemIdFromRef('#231'), null);
  assert.deepEqual(Object.keys(DEFAULT_STATE_MAPS.ado), ['basic', 'agile']);
});

// ── GitHub adapter (pure helpers) ───────────────────────────────────────────

test('normalizeGhIssue: raw gh-list fixture maps open/label/closed states', () => {
  const raw = loadJson('tracker-raw-gh.json');
  assert.deepEqual(normalizeGhIssue(raw[0]), {
    externalId: '#17',
    title: 'Return 404 JSON body on missing asset',
    state: 'intake',
    url: 'https://github.com/owner/repo/issues/17',
  });
  assert.equal(normalizeGhIssue(raw[1]).state, 'active');   // in-progress label
  assert.equal(normalizeGhIssue(raw[2]).state, 'done');     // CLOSED
});

test('buildGhUpdateArgs: per-state argv sequences, comment appended', () => {
  assert.deepEqual(buildGhUpdateArgs({ externalId: '#17', to: 'done', comment: 'commit: abc1234' }), [
    ['issue', 'close', '17', '--reason', 'completed'],
    ['issue', 'comment', '17', '--body', 'commit: abc1234'],
  ]);
  assert.deepEqual(buildGhUpdateArgs({ externalId: '#17', to: 'active', comment: null }), [
    ['issue', 'edit', '17', '--add-label', 'in-progress', '--remove-label', 'blocked'],
  ]);
  assert.deepEqual(buildGhUpdateArgs({ externalId: 'owner/repo#9', to: 'intake', comment: 'blocked: x' }), [
    ['issue', 'edit', '9', '--remove-label', 'in-progress', '--add-label', 'blocked'],
    ['issue', 'comment', '9', '--body', 'blocked: x'],
  ]);
  assert.deepEqual(buildGhListArgs(), [
    'issue', 'list', '--json', 'number,title,state,labels,url', '--state', 'all', '--limit', '200',
  ]);
  assert.deepEqual(buildGhListArgs(1000).slice(-2), ['--limit', '1000']);
  assert.equal(issueNumberFromRef('#45'), 45);
  assert.equal(issueNumberFromRef('owner/repo#45'), 45);
  assert.equal(issueNumberFromRef('AB#45'), null);
});

// ── CLI (offline mode via --items-file) ─────────────────────────────────────

const CLI = join(import.meta.dirname, '..', 'scripts', 'tracker-sync.mjs');

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
}

test('CLI: dry-run prints the plan, writes nothing, exits 1 on conflicts', () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-dry-'));
  try {
    writeFileSync(join(root, 'tasks.md'), ADO_TASKS);
    const res = runCli(
      ['--target', root, '--platform', 'ado', '--items-file', join(FIXTURES, 'tracker-items-ado.json')],
      root,
    );
    assert.equal(res.status, 1);   // 2 conflicts in the matrix
    assert.match(res.stdout, /imports → Backlog: 1/);
    assert.equal(readFileSync(join(root, 'tasks.md'), 'utf8'), ADO_TASKS);   // untouched
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: --apply writes valid tasks.md, skips pushes offline, second run imports nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-apply-'));
  try {
    writeFileSync(join(root, 'tasks.md'), ADO_TASKS);
    const items = join(FIXTURES, 'tracker-items-ado.json');
    const first = runCli(['--target', root, '--platform', 'ado', '--items-file', items, '--apply', '--json'], root);
    assert.equal(first.status, 1);   // conflicts persist
    const firstPlan = JSON.parse(first.stdout);
    assert.equal(firstPlan.applied, true);
    assert.equal(firstPlan.offline, true);
    assert.equal(firstPlan.pushed, 0);
    assert.equal(firstPlan.imports.length, 1);
    // T-000/AB#229 needs a push to reach done; offline mode skips the push,
    // so it is left in Done, unpruned, awaiting a real sync.
    assert.equal(firstPlan.prunes.length, 0);

    const text = readFileSync(join(root, 'tasks.md'), 'utf8');
    const { doc, errors } = parseTasksMd(text);
    assert.deepEqual(errors, []);
    assert.deepEqual(validateTaskBacklog(doc), []);
    const imported = doc.backlog.at(-1);
    assert.deepEqual(imported.scope, ['triage']);
    assert.equal(imported.ref, 'AB#232');
    assert.match(imported.blocked, /needs human scoping/);
    assert.ok(doc.done.some((t) => t.id === 'T-000'));

    const second = runCli(['--target', root, '--platform', 'ado', '--items-file', items, '--apply', '--json'], root);
    assert.equal(JSON.parse(second.stdout).imports.length, 0);   // idempotent
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: --apply prunes an already-synced Done task, offline', () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-prune-'));
  try {
    writeFileSync(
      join(root, 'tasks.md'),
      '# Tasks\n\n## Backlog\n\n## In Progress\n\n## Done\n\n'
      + '- [x] T-001 | scope: api | Old, already synced (commit: abc1234)\n  - ref: AB#500\n',
    );
    const itemsPath = join(root, 'items.json');
    writeFileSync(itemsPath, JSON.stringify([
      { externalId: 'AB#500', title: 'Old, already synced', state: 'done', url: null },
    ]));
    const res = runCli(['--target', root, '--platform', 'ado', '--items-file', itemsPath, '--apply', '--json'], root);
    assert.equal(res.status, 0);
    const plan = JSON.parse(res.stdout);
    assert.deepEqual(plan.prunes, ['T-001']);

    const { doc } = parseTasksMd(readFileSync(join(root, 'tasks.md'), 'utf8'));
    assert.deepEqual(doc.done, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: clean in-sync run exits 0; missing tasks.md and bad platform exit 2', () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-clean-'));
  try {
    writeFileSync(join(root, 'tasks.md'), '# Tasks\n\n## Backlog\n\n## In Progress\n\n## Done\n');
    writeFileSync(join(root, 'items.json'), '[]');
    const clean = runCli(['--target', root, '--platform', 'gh', '--items-file', join(root, 'items.json')], root);
    assert.equal(clean.status, 0);

    const noTasks = runCli(['--target', join(root, 'nope'), '--platform', 'gh', '--items-file', join(root, 'items.json')], root);
    assert.equal(noTasks.status, 2);
    assert.match(noTasks.stderr, /no tasks\.md/);

    const badPlatform = runCli(['--target', root, '--platform', 'jira'], root);
    assert.equal(badPlatform.status, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
