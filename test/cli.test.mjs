import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildFixture } from './fixtures/defs.mjs';
import { runInventory } from '../scripts/inventory-extract.mjs';

const BIN = join(import.meta.dirname, '..', 'bin', 'agent-base.mjs');
const APPLY = join(import.meta.dirname, '..', 'scripts', 'apply.mjs');
const CHECK = join(import.meta.dirname, '..', 'scripts', 'check.mjs');
const FIXTURES = join(import.meta.dirname, 'fixtures', 'orchestration');

const run = (args, opts = {}) =>
  spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', ...opts });

test('cli: --help prints command surface, exit 0', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  for (const cmd of ['setup', 'orchestrate', 'refresh', 'install', 'audit', 'sync', 'tracker-sync', 'starter', 'headless-guard', 'cache']) {
    assert.match(r.stdout, new RegExp(`\\b${cmd}\\b`), `help mentions ${cmd}`);
  }
});

test('cli: no command prints help, exit 2', () => {
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /Usage: agent-base/);
});

test('cli: --version matches package.json', () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
  const r = run(['--version']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), pkg.version);
});

test('cli: unknown command exits 2', () => {
  const r = run(['frobnicate']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown command frobnicate/);
});

test('cli: Object.prototype keys are unknown commands, not delegations', () => {
  for (const cmd of ['toString', '__proto__', 'hasOwnProperty']) {
    const r = run([cmd]);
    assert.equal(r.status, 2, `${cmd} exits 2`);
    assert.match(r.stderr, new RegExp(`unknown command ${cmd}`));
  }
});

test('cli: delegated command propagates underlying exit code (audit usage error → 2)', () => {
  const r = run(['audit', '--bogus-flag']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown flag --bogus-flag/);
});

test('cli: headless-guard delegation produces guard output lines', () => {
  const root = mkdtempSync(join(tmpdir(), 'ab-cli-'));
  cpSync(join(FIXTURES, 'tasks-canonical.md'), join(root, 'tasks.md'));
  const r = run(['headless-guard', '--root', root]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^run=true$/m);
  assert.match(r.stdout, /^reason=eligible-task$/m);
  assert.match(r.stdout, /^task=T-001$/m);
});

test('cli: setup --no-launch drops the launcher skill and prints the prompt', () => {
  const target = mkdtempSync(join(tmpdir(), 'ab-cli-target-'));
  const r = run(['setup', target, '--no-launch']);
  assert.equal(r.status, 0);
  // repo has .git → dev mode, no staging into the real home
  assert.match(r.stdout, /running from clone/);
  assert.match(r.stdout, /\/agent-base-bootstrap/);
  assert.match(r.stdout, /base-setup\/SKILL\.md/);
  assert.ok(existsSync(join(target, '.claude', 'skills', 'agent-base-bootstrap', 'SKILL.md')));
});

test('cli: setup --print touches nothing and prints the prompt only', () => {
  const target = mkdtempSync(join(tmpdir(), 'ab-cli-target-'));
  const r = run(['setup', target, '--print']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Paste this prompt/);
  assert.ok(!existsSync(join(target, '.claude')));
});

test('cli: bootstrap command rejects unknown flags', () => {
  const r = run(['setup', '--frobnicate']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown flag --frobnicate/);
});

test('cli: bootstrap command rejects a nonexistent target path', () => {
  const r = run(['setup', join(tmpdir(), 'ab-cli-no-such-dir-7f3a'), '--print']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /target is not an existing directory/);
});

test('cli: bootstrap command rejects a file as target', () => {
  const target = mkdtempSync(join(tmpdir(), 'ab-cli-target-'));
  const file = join(target, 'somefile');
  writeFileSync(file, 'x\n');
  const r = run(['setup', file, '--print']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /target is not an existing directory/);
});

test('cli: bootstrap command rejects extra positional args', () => {
  const target = mkdtempSync(join(tmpdir(), 'ab-cli-target-'));
  const r = run(['setup', target, target]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /expected at most one path/);
});

test('cli: packaging guard — zero deps and staging-critical paths in the files whitelist', () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
  // staging copies only the package dir; runtime deps would land in a sibling
  // node_modules and silently break every staged release
  assert.equal(pkg.dependencies, undefined);
  for (const p of ['bin', 'scripts', 'templates', '.claude', 'spec']) {
    assert.ok(pkg.files.includes(p), `files whitelist ships ${p}`);
  }
  for (const p of ['test', 'notes']) {
    assert.ok(!pkg.files.includes(p), `files whitelist excludes ${p}`);
  }
  // a files-listed dir overrides .gitignore for its contents, so the local
  // settings file needs an explicit negation or `npm pack` leaks it
  assert.ok(pkg.files.includes('!.claude/settings.local.json'));
});

test('cli: cache prune rejects bad --keep', () => {
  const r = run(['cache', 'prune', '--keep', 'lots']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--keep must be a non-negative integer/);
});

test('cli: cache list rejects unexpected args', () => {
  const r = run(['cache', 'list', '--bogus']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unexpected args --bogus/);
});

test('cli: piped stdio never auto-launches — falls back to the skill drop', () => {
  // no flags + claude possibly on PATH: the TTY gate must take the fallback
  // path; timeout turns a regression (hung interactive session) into a fail
  const target = mkdtempSync(join(tmpdir(), 'ab-cli-target-'));
  const r = run(['setup', target], { timeout: 30000 });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\/agent-base-bootstrap/);
  assert.doesNotMatch(r.stdout, /launching Claude Code/);
  assert.ok(existsSync(join(target, '.claude', 'skills', 'agent-base-bootstrap', 'SKILL.md')));
});

test('cli: cache list/prune honor AGENT_BASE_HOME', () => {
  const home = mkdtempSync(join(tmpdir(), 'ab-cli-home-'));
  const env = { ...process.env, AGENT_BASE_HOME: home };

  const empty = run(['cache', 'list'], { env });
  assert.equal(empty.status, 0);
  assert.match(empty.stdout, /no staged releases/);

  for (const v of ['1.0.0', '1.1.0', '1.2.0']) {
    const dir = join(home, '.agent-base', 'versions', `v${v}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.agent-base-staged'), 'x\n');
  }
  const list = run(['cache', 'list'], { env });
  assert.equal(list.status, 0);
  assert.match(list.stdout, /^v1\.2\.0 /m);

  const prune = run(['cache', 'prune', '--keep', '1'], { env });
  assert.equal(prune.status, 0);
  assert.match(prune.stdout, /pruned: v1\.1\.0, v1\.0\.0/);
  assert.ok(existsSync(join(home, '.agent-base', 'versions', 'v1.2.0')));
  assert.ok(!existsSync(join(home, '.agent-base', 'versions', 'v1.0.0')));
});

test('cli: apply --dry-run with no value exits nonzero WITHOUT applying', () => {
  const repo = buildFixture('claude-only');
  try {
    const inv = runInventory({ root: repo, outDir: '.setup', allowDirty: false });
    // a real apply under this manifest would DELETE CLAUDE.md
    const entries = [];
    for (const f of inv.files) {
      if (f.path === 'CLAUDE.md') for (const id of f.nodes) entries.push({ node: id, op: 'drop', reason: 'test' });
      else entries.push({ file: f.path, op: 'keep-file' });
    }
    for (const c of inv.sweepCandidates) entries.push({ file: c.file, op: 'out-of-scope', reason: 'test' });
    writeFileSync(join(repo, '.setup', 'manifest.json'),
      JSON.stringify({ schemaVersion: 1, entries, jsonMerges: [] }, null, 2));
    const r = spawnSync(process.execPath, [APPLY, '--root', repo, '--dry-run'], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--dry-run requires a value/);
    assert.ok(existsSync(join(repo, 'CLAUDE.md')), 'missing --dry-run value must never fall through to a real apply');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('cli: check value flags require values', () => {
  const r = spawnSync(process.execPath, [CHECK, '--templates'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--templates requires a value/);
  const r2 = spawnSync(process.execPath, [CHECK, '--root', '--json'], { encoding: 'utf8' });
  assert.equal(r2.status, 2);
  assert.match(r2.stderr, /--root requires a value/);
});
