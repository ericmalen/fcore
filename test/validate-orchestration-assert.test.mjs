import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, readFileSync, existsSync, cpSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { parseTasksMd, renderTasksMd } from '../scripts/lib/orchestration/parse-tasks.mjs';

const ROOT = join(import.meta.dirname, '..');
const BUILD_CLI = join(ROOT, 'scripts', 'build-orchestrated-fixture.mjs');
const ASSERT_CLI = join(ROOT, 'scripts', 'validate-orchestration-assert.mjs');

let TEMPLATE_DIR;
let TEMPLATE_BASE_SHA;

before(() => {
  TEMPLATE_DIR = mkdtempSync(join(tmpdir(), 'orch-assert-template-'));
  rmSync(TEMPLATE_DIR, { recursive: true, force: true });
  const res = spawnSync(process.execPath, [BUILD_CLI, TEMPLATE_DIR, '--seed-ref', '--seed-blocked'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  TEMPLATE_BASE_SHA = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: TEMPLATE_DIR, encoding: 'utf8' }).stdout.trim();
});

after(() => {
  rmSync(TEMPLATE_DIR, { recursive: true, force: true });
});

// Every test gets its own filesystem copy of the built fixture — cheap
// (no re-generation) and isolated (mutations never leak across tests).
function cloneFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'orch-assert-case-'));
  rmSync(dir, { recursive: true, force: true });
  cpSync(TEMPLATE_DIR, dir, { recursive: true });
  return dir;
}

function readTasks(dir) {
  return parseTasksMd(readFileSync(join(dir, 'tasks.md'), 'utf8')).doc;
}
function writeTasks(dir, doc) {
  writeFileSync(join(dir, 'tasks.md'), renderTasksMd(doc));
}
function appendLog(dir, entry) {
  const p = join(dir, 'docs', 'orchestration', 'handoff-log.jsonl');
  mkdirSync(join(dir, 'docs', 'orchestration'), { recursive: true });
  appendFileSync(p, `${JSON.stringify(entry)}\n`);
}
function commitAll(dir, msg) {
  spawnSync('git', ['add', '-A'], { cwd: dir });
  const r = spawnSync('git', ['commit', '-qm', msg], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
}
function runAssert(args) {
  const res = spawnSync(process.execPath, [ASSERT_CLI, ...args, '--json'], { encoding: 'utf8' });
  return { res, json: res.stdout ? JSON.parse(res.stdout) : null };
}
function checkFor(json, namePattern) {
  return json.checks.find((c) => namePattern.test(c.name));
}

// ── pruned (no-ref task) ─────────────────────────────────────────────────

test('pruned: task deleted + one completion entry with a resolvable ancestor commit → all pass', () => {
  const dir = cloneFixture();
  try {
    const doc = readTasks(dir);
    doc.backlog = doc.backlog.filter((t) => t.id !== 'T-101');
    writeTasks(dir, doc);
    appendLog(dir, {
      timestamp: '2026-07-09T10:00:00Z', from_agent: 'feature-orchestrator', to_agent: 'api-engineer',
      task_id: 'T-101', artifacts: ['apps/api/src/routes.ts'], decision_summary: 'Added route.',
      duration_ms: 45000, status: 'success', retry_count: 0,
    });
    const workSha = commitAll(dir, 'T-101: add route');
    appendLog(dir, {
      timestamp: '2026-07-09T10:05:00Z', event: 'completion', from_agent: 'feature-orchestrator',
      task_id: 'T-101', title: 'Add GET /assets/:id route returning an asset stub', scope: ['api'], commit: workSha,
    });
    commitAll(dir, 'T-101: log completion');

    const { res, json } = runAssert(['--dir', dir, '--task', 'T-101', '--expect', 'pruned', '--base', TEMPLATE_BASE_SHA]);
    assert.equal(res.status, 0, JSON.stringify(json));
    assert.ok(json.checks.every((c) => c.pass), JSON.stringify(json.checks.filter((c) => !c.pass)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pruned: task still sitting in Done fails the absence check', () => {
  const dir = cloneFixture();
  try {
    const doc = readTasks(dir);
    const t = doc.backlog.find((tk) => tk.id === 'T-101');
    doc.backlog = doc.backlog.filter((tk) => tk.id !== 'T-101');
    doc.done.push({ ...t, commit: 'deadbeef' });
    writeTasks(dir, doc);
    commitAll(dir, 'left T-101 in Done');

    const { res, json } = runAssert(['--dir', dir, '--task', 'T-101', '--expect', 'pruned']);
    assert.equal(res.status, 1);
    assert.equal(checkFor(json, /is absent from tasks\.md/).pass, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pruned: missing completion entry fails the count check', () => {
  const dir = cloneFixture();
  try {
    const doc = readTasks(dir);
    doc.backlog = doc.backlog.filter((t) => t.id !== 'T-101');
    writeTasks(dir, doc);
    commitAll(dir, 'pruned without logging completion');

    const { res, json } = runAssert(['--dir', dir, '--task', 'T-101', '--expect', 'pruned']);
    assert.equal(res.status, 1);
    const c = checkFor(json, /exactly one completion entry/);
    assert.equal(c.pass, false);
    assert.match(c.detail, /found 0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pruned: duplicate completion entries fail the count check', () => {
  const dir = cloneFixture();
  try {
    const doc = readTasks(dir);
    doc.backlog = doc.backlog.filter((t) => t.id !== 'T-101');
    writeTasks(dir, doc);
    const sha = commitAll(dir, 'pruned');
    for (let i = 0; i < 2; i++) {
      appendLog(dir, {
        timestamp: '2026-07-09T10:00:00Z', event: 'completion', from_agent: 'feature-orchestrator',
        task_id: 'T-101', title: 'x', scope: ['api'], commit: sha,
      });
    }
    commitAll(dir, 'double-logged completion');

    const { res, json } = runAssert(['--dir', dir, '--task', 'T-101', '--expect', 'pruned']);
    assert.equal(res.status, 1);
    const c = checkFor(json, /exactly one completion entry/);
    assert.equal(c.pass, false);
    assert.match(c.detail, /found 2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pruned: a bogus commit SHA in the completion entry fails resolution', () => {
  const dir = cloneFixture();
  try {
    const doc = readTasks(dir);
    doc.backlog = doc.backlog.filter((t) => t.id !== 'T-101');
    writeTasks(dir, doc);
    appendLog(dir, {
      timestamp: '2026-07-09T10:00:00Z', event: 'completion', from_agent: 'feature-orchestrator',
      task_id: 'T-101', title: 'x', scope: ['api'], commit: 'not-a-real-sha',
    });
    commitAll(dir, 'pruned with a bogus commit');

    const { res, json } = runAssert(['--dir', dir, '--task', 'T-101', '--expect', 'pruned']);
    assert.equal(res.status, 1);
    assert.equal(checkFor(json, /commit resolves in git/).pass, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pruned: a leftover docs/orchestration/runs/<task>/ dir fails cleanup check', () => {
  const dir = cloneFixture();
  try {
    const doc = readTasks(dir);
    doc.backlog = doc.backlog.filter((t) => t.id !== 'T-101');
    writeTasks(dir, doc);
    const sha = commitAll(dir, 'pruned');
    appendLog(dir, {
      timestamp: '2026-07-09T10:00:00Z', event: 'completion', from_agent: 'feature-orchestrator',
      task_id: 'T-101', title: 'x', scope: ['api'], commit: sha,
    });
    mkdirSync(join(dir, 'docs', 'orchestration', 'runs', 'T-101'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'orchestration', 'runs', 'T-101', 'note.txt'), 'leftover scratch note');
    commitAll(dir, 'log completion, forgot to clean up runs/');

    const { res, json } = runAssert(['--dir', dir, '--task', 'T-101', '--expect', 'pruned']);
    assert.equal(res.status, 1);
    assert.equal(checkFor(json, /was deleted/).pass, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pruned: a commit touching docs/orchestration/runs/ fails the never-committed check', () => {
  const dir = cloneFixture();
  try {
    // docs/orchestration/runs/ is gitignored (R-57) — `git add -A` alone would
    // never stage it. Force-add to simulate the violation this check exists
    // to catch: something bypassing the ignore.
    const runFile = join(dir, 'docs', 'orchestration', 'runs', 'T-101', 'note.txt');
    mkdirSync(join(dir, 'docs', 'orchestration', 'runs', 'T-101'), { recursive: true });
    writeFileSync(runFile, 'oops, committed');
    spawnSync('git', ['add', '-f', 'docs/orchestration/runs/T-101/note.txt'], { cwd: dir });
    const r = spawnSync('git', ['commit', '-qm', 'accidentally committed a runs/ path'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    rmSync(join(dir, 'docs', 'orchestration', 'runs', 'T-101'), { recursive: true, force: true });

    const doc = readTasks(dir);
    doc.backlog = doc.backlog.filter((t) => t.id !== 'T-101');
    writeTasks(dir, doc);
    const sha = commitAll(dir, 'pruned');
    appendLog(dir, {
      timestamp: '2026-07-09T10:00:00Z', event: 'completion', from_agent: 'feature-orchestrator',
      task_id: 'T-101', title: 'x', scope: ['api'], commit: sha,
    });
    commitAll(dir, 'log completion');

    const { res, json } = runAssert(['--dir', dir, '--task', 'T-101', '--expect', 'pruned', '--base', TEMPLATE_BASE_SHA]);
    assert.equal(res.status, 1);
    assert.equal(checkFor(json, /no commit since .* touches/).pass, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pruned: a malformed handoff-log line fails the schema check', () => {
  const dir = cloneFixture();
  try {
    appendFileSync(join(dir, 'docs', 'orchestration', 'handoff-log.jsonl'), 'not even json\n');
    commitAll(dir, 'malformed log line');

    const { res, json } = runAssert(['--dir', dir, '--task', 'T-101', '--expect', 'pruned']);
    assert.equal(res.status, 1);
    const c = checkFor(json, /valid JSON matching the schema/);
    assert.equal(c.pass, false);
    assert.match(c.detail, /1 malformed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── done-with-ref (ref-carrying task stays in Done) ─────────────────────

test('done-with-ref: task in Done with ref intact + one completion entry → all pass', () => {
  const dir = cloneFixture();
  try {
    const doc = readTasks(dir);
    const t = doc.backlog.find((tk) => tk.id === 'T-104');
    doc.backlog = doc.backlog.filter((tk) => tk.id !== 'T-104');
    writeFileSync(join(dir, 'apps', 'api', 'src', 'four-oh-four.mjs'), 'export const notFound = () => ({ error: "not found" });\n');
    const sha = commitAll(dir, 'T-104: return 404 JSON body');
    doc.done.push({ ...t, commit: sha });
    writeTasks(dir, doc);
    appendLog(dir, {
      timestamp: '2026-07-09T10:00:00Z', event: 'completion', from_agent: 'feature-orchestrator',
      task_id: 'T-104', title: t.title, scope: t.scope, commit: sha,
    });
    commitAll(dir, 'T-104: move to Done, log completion');

    const { res, json } = runAssert(['--dir', dir, '--task', 'T-104', '--expect', 'done-with-ref']);
    assert.equal(res.status, 0, JSON.stringify(json.checks.filter((c) => !c.pass)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('done-with-ref: ref stripped on the Done task fails the ref-intact check', () => {
  const dir = cloneFixture();
  try {
    const doc = readTasks(dir);
    const t = doc.backlog.find((tk) => tk.id === 'T-104');
    doc.backlog = doc.backlog.filter((tk) => tk.id !== 'T-104');
    writeFileSync(join(dir, 'apps', 'api', 'src', 'four-oh-four.mjs'), 'export const notFound = () => ({ error: "not found" });\n');
    const sha = commitAll(dir, 'T-104: work');
    doc.done.push({ ...t, ref: null, commit: sha });
    writeTasks(dir, doc);
    appendLog(dir, {
      timestamp: '2026-07-09T10:00:00Z', event: 'completion', from_agent: 'feature-orchestrator',
      task_id: 'T-104', title: t.title, scope: t.scope, commit: sha,
    });
    commitAll(dir, 'moved to Done but stripped ref');

    const { res, json } = runAssert(['--dir', dir, '--task', 'T-104', '--expect', 'done-with-ref']);
    assert.equal(res.status, 1);
    assert.equal(checkFor(json, /still carries its ref/).pass, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── blocked ──────────────────────────────────────────────────────────────

test('blocked: task in Backlog with a blocked: line, retries within limit → all pass', () => {
  const dir = cloneFixture();
  try {
    const doc = readTasks(dir);
    const t = doc.backlog.find((tk) => tk.id === 'T-199');
    t.blocked = 'see handoff-log entry 2026-07-09T10:01:00Z';
    writeTasks(dir, doc);
    appendLog(dir, {
      timestamp: '2026-07-09T10:00:00Z', from_agent: 'feature-orchestrator', to_agent: 'api-engineer',
      task_id: 'T-199', artifacts: [], decision_summary: 'first attempt failed.',
      duration_ms: 20000, status: 'failed', failure_reason: 'assertion could not be satisfied', retry_count: 0,
    });
    appendLog(dir, {
      timestamp: '2026-07-09T10:01:00Z', from_agent: 'feature-orchestrator', to_agent: 'api-engineer',
      task_id: 'T-199', artifacts: [], decision_summary: 'retry failed.',
      duration_ms: 20000, status: 'failed', failure_reason: 'assertion could not be satisfied', retry_count: 1,
    });
    commitAll(dir, 'T-199: blocked after one retry');

    const { res, json } = runAssert(['--dir', dir, '--task', 'T-199', '--expect', 'blocked']);
    assert.equal(res.status, 0, JSON.stringify(json.checks.filter((c) => !c.pass)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('blocked: retry_count exceeding 1 fails the retry-limit check', () => {
  const dir = cloneFixture();
  try {
    const doc = readTasks(dir);
    const t = doc.backlog.find((tk) => tk.id === 'T-199');
    t.blocked = 'see handoff-log';
    writeTasks(dir, doc);
    appendLog(dir, {
      timestamp: '2026-07-09T10:00:00Z', from_agent: 'feature-orchestrator', to_agent: 'api-engineer',
      task_id: 'T-199', artifacts: [], decision_summary: 'silently retried too many times.',
      duration_ms: 20000, status: 'failed', failure_reason: 'assertion could not be satisfied', retry_count: 2,
    });
    commitAll(dir, 'T-199: protocol violation');

    const { res, json } = runAssert(['--dir', dir, '--task', 'T-199', '--expect', 'blocked']);
    assert.equal(res.status, 1);
    assert.equal(checkFor(json, /never exceed one retry/).pass, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('blocked: a completion entry present is a protocol violation', () => {
  const dir = cloneFixture();
  try {
    const doc = readTasks(dir);
    const t = doc.backlog.find((tk) => tk.id === 'T-199');
    t.blocked = 'see handoff-log';
    writeTasks(dir, doc);
    appendLog(dir, {
      timestamp: '2026-07-09T10:00:00Z', event: 'completion', from_agent: 'feature-orchestrator',
      task_id: 'T-199', title: t.title, scope: t.scope, commit: 'deadbeef',
    });
    commitAll(dir, 'T-199: blocked yet somehow logged complete');

    const { res, json } = runAssert(['--dir', dir, '--task', 'T-199', '--expect', 'blocked']);
    assert.equal(res.status, 1);
    assert.equal(checkFor(json, /no completion entry/).pass, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('blocked: runs/<task>/ cleanliness is skipped (task never completed)', () => {
  const dir = cloneFixture();
  try {
    const doc = readTasks(dir);
    const t = doc.backlog.find((tk) => tk.id === 'T-199');
    t.blocked = 'see handoff-log';
    writeTasks(dir, doc);
    mkdirSync(join(dir, 'docs', 'orchestration', 'runs', 'T-199'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'orchestration', 'runs', 'T-199', 'partial.txt'), 'work in progress');
    commitAll(dir, 'T-199: blocked mid-work, runs/ not yet cleaned (expected)');

    const { res, json } = runAssert(['--dir', dir, '--task', 'T-199', '--expect', 'blocked']);
    assert.equal(res.status, 0, JSON.stringify(json.checks.filter((c) => !c.pass)));
    assert.match(checkFor(json, /runs\/<task>\/ check skipped/).name, /skipped/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── usage errors ─────────────────────────────────────────────────────────

test('usage: missing required flags or an unknown --expect value exits 2', () => {
  const dir = cloneFixture();
  try {
    assert.equal(spawnSync(process.execPath, [ASSERT_CLI, '--dir', dir]).status, 2);
    assert.equal(spawnSync(process.execPath, [ASSERT_CLI, '--dir', dir, '--task', 'T-101']).status, 2);
    assert.equal(spawnSync(process.execPath, [ASSERT_CLI, '--dir', dir, '--task', 'T-101', '--expect', 'nonsense']).status, 2);
    assert.equal(spawnSync(process.execPath, [ASSERT_CLI, '--dir', '/no/such/dir', '--task', 'T-101', '--expect', 'pruned']).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
