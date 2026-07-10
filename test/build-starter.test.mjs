import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { audit } from '../scripts/audit.mjs';
import { runSyncBaseline } from '../scripts/sync-baseline.mjs';
import { BASELINE_COPIES } from '../scripts/lib/baseline.mjs';
import { baselineFileHashes } from '../scripts/lib/sync-plan.mjs';

const BUILD = join(import.meta.dirname, '..', 'scripts', 'build-starter.mjs');
const BASE_VERSION = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
).version;

const run = (args, opts = {}) =>
  spawnSync(process.execPath, [BUILD, ...args], { encoding: 'utf8', ...opts });

test('starter build: empty dir → exit 0, files written, version printed', () => {
  const target = mkdtempSync(join(tmpdir(), 'ab-starter-'));
  try {
    const r = run([target]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`starter → .+ \\(v${BASE_VERSION.replaceAll('.', '\\.')}\\)`));
    assert.match(r.stdout, /Next steps:/);
    assert.match(r.stdout, /fcore-check/);
    for (const rel of [
      'AGENTS.md', 'CLAUDE.md', '.gitignore', 'README.md',
      '.claude/settings.json', '.vscode/settings.json',
      '.claude/skills/README.md', '.claude/skills/fcore-check/SKILL.md',
      '.claude/skills/fcore-check/references/lifecycle.md',
      '.claude/fcore.json',
    ]) {
      assert.ok(existsSync(join(target, rel)), `starter ships ${rel}`);
    }
    const marker = JSON.parse(readFileSync(join(target, '.claude/fcore.json'), 'utf8'));
    assert.equal(marker.standard, BASE_VERSION);
    assert.equal(marker.githubCodeReview, false);
    const readme = readFileSync(join(target, 'README.md'), 'utf8');
    assert.match(readme, /AGENTS\.md/);
    assert.match(readme, /fcore-check/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('starter build: non-empty dir → exit 2, refusing message, untouched', () => {
  const target = mkdtempSync(join(tmpdir(), 'ab-starter-'));
  try {
    writeFileSync(join(target, 'precious.txt'), 'keep me\n');
    const r = run([target]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /refusing/);
    assert.ok(!existsSync(join(target, 'AGENTS.md')), 'nothing written');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('starter build: file as target → exit 2, refusing message, no stack trace', () => {
  const parent = mkdtempSync(join(tmpdir(), 'ab-starter-'));
  try {
    const file = join(parent, 'somefile');
    writeFileSync(file, 'x\n');
    const r = run([file]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /refusing/);
    assert.doesNotMatch(r.stderr, /ENOTDIR|at .*node:/, 'friendly refusal, not a crash');
    assert.equal(readFileSync(file, 'utf8'), 'x\n', 'target file untouched');
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('starter build: --git with git unavailable → exit 1, loud failure', () => {
  const target = mkdtempSync(join(tmpdir(), 'ab-starter-'));
  try {
    // empty PATH → spawnSync('git') hits ENOENT (r.error, status null) —
    // exactly the path the old fail-open code swallowed
    const r = run([target, '--git'], { env: { ...process.env, PATH: '' } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /git step failed/);
    assert.ok(!existsSync(join(target, '.git')), 'no half-made repo reported as success');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('starter build: no dir argument → exit 2, usage', () => {
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage:/);
});

test('starter build: output is audit-clean', () => {
  const target = mkdtempSync(join(tmpdir(), 'ab-starter-'));
  try {
    const r = run([target]);
    assert.equal(r.status, 0, r.stderr);
    const report = audit({ root: target, strict: true });
    assert.deepEqual(report.findings, [], JSON.stringify(report.findings, null, 2));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('starter build: ships the full permanent baseline, byte-identical to source', () => {
  const target = mkdtempSync(join(tmpdir(), 'ab-starter-'));
  try {
    const r = run([target]);
    assert.equal(r.status, 0, r.stderr);
    for (const [, dst] of BASELINE_COPIES) {
      assert.ok(existsSync(join(target, dst)), `starter ships ${dst}`);
    }
    assert.ok(existsSync(join(target, '.claude/agents/README.md')), 'agents folder README (R-48)');
    // src == dst for every baseline pair, so the same walk hashes both sides
    const want = baselineFileHashes(join(import.meta.dirname, '..'));
    const got = baselineFileHashes(target);
    assert.deepEqual([...got.entries()].sort(), [...want.entries()].sort(),
      'baseline trees byte-identical to FleetCore source');
    assert.ok(want.size > 0, 'parity oracle is non-empty');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('starter build: fresh starter is repair-complete (sync-baseline no-op)', () => {
  const target = mkdtempSync(join(tmpdir(), 'ab-starter-'));
  try {
    const r = run([target]);
    assert.equal(r.status, 0, r.stderr);
    const res = runSyncBaseline({
      root: target, fcoreRoot: join(import.meta.dirname, '..'), upgrade: true, json: true,
    });
    assert.equal(res.exitCode, 0);
    assert.equal(res.payload.applied, false);
    assert.match(res.message, /already at latest/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// Minimal fake FleetCore root: enough for build-starter to run (its fcoreRoot
// is derived from its own file location, so the script must be copied too).
function seedFakeBase(version, { git = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'ab-fakebase-'));
  const SRC = join(import.meta.dirname, '..');
  for (const d of ['scripts', 'templates', '.claude/skills', '.claude/agents']) {
    cpSync(join(SRC, d), join(base, d), { recursive: true });
  }
  writeFileSync(join(base, 'package.json'), JSON.stringify({ version }));
  if (git) spawnSync('git', ['init', '-q', join(base)], { encoding: 'utf8' });
  return base;
}

test('starter build: untagged dev clone → dangling-pin warning, exit 0', () => {
  const base = seedFakeBase('9.9.9', { git: true });
  const target = mkdtempSync(join(tmpdir(), 'ab-starter-'));
  try {
    const r = spawnSync(process.execPath, [join(base, 'scripts/build-starter.mjs'), target], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /warning: tag v9\.9\.9 not found/);
    assert.ok(existsSync(join(target, 'AGENTS.md')), 'warning is non-fatal');
  } finally {
    for (const d of [base, target]) rmSync(d, { recursive: true, force: true });
  }
});

test('starter build: staged release (no .git) → no pin warning', () => {
  const base = seedFakeBase('9.9.9');
  const target = mkdtempSync(join(tmpdir(), 'ab-starter-'));
  try {
    const r = spawnSync(process.execPath, [join(base, 'scripts/build-starter.mjs'), target], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /warning/);
  } finally {
    for (const d of [base, target]) rmSync(d, { recursive: true, force: true });
  }
});

test('starter build: --git → repo on main, one commit, clean tree', () => {
  const target = mkdtempSync(join(tmpdir(), 'ab-starter-'));
  try {
    const r = run([target, '--git']);
    assert.equal(r.status, 0, r.stderr);
    const git = (args) => spawnSync('git', ['-C', target, ...args], { encoding: 'utf8' });
    assert.equal(git(['branch', '--show-current']).stdout.trim(), 'main');
    assert.equal(git(['rev-list', '--count', 'HEAD']).stdout.trim(), '1');
    assert.equal(git(['status', '--porcelain']).stdout.trim(), '', 'working tree clean');
    assert.match(git(['log', '-1', '--format=%s']).stdout, /fcore starter/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
