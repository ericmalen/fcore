import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, devNull } from 'node:os';
import { spawnSync } from 'node:child_process';
import { execPath } from 'node:process';

const BASE_ROOT = new URL('..', import.meta.url).pathname;
const IMPACT = join(BASE_ROOT, '.claude/skills/docs/scripts/docs-impact.mjs');
const CEILING = realpathSync(tmpdir());

const CFG = { tier: 'T3', codePaths: ['src/'], docsPaths: ['docs/', 'README.md'] };

// Hermetic env: never inherit CI context (GITHUB_EVENT_PATH!) or user/system
// git config, and repo discovery cannot escape the temp tree.
function isolatedEnv() {
  const env = { ...process.env };
  delete env.GITHUB_EVENT_PATH;
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = devNull;
  env.GIT_CEILING_DIRECTORIES = CEILING;
  return env;
}

function git(dir, ...args) {
  const r = spawnSync('git', args, { cwd: dir, env: isolatedEnv(), encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

// Temp repo with one initial commit covering code, docs, and neutral paths.
// Returns { dir, base } where base is the initial commit sha.
function makeRepo(cfg = CFG) {
  const dir = mkdtempSync(join(tmpdir(), 'docs-impact-'));
  git(dir, '-c', 'init.defaultBranch=main', 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'docs-paths.json'), JSON.stringify(cfg));
  for (const [rel, content] of Object.entries({
    'src/app.js': 'export const x = 1;\n',
    'docs/guide.md': '# Guide\n',
    'README.md': '# Demo\n',
    'notes.txt': 'neither code nor docs\n',
  })) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return { dir, base: git(dir, 'rev-parse', 'HEAD') };
}

// Write files, stage, commit with one -m per message paragraph.
function commit(dir, files, ...messages) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', ...messages.flatMap((m) => ['-m', m]));
}

// `event`, when given, is written under .git/ (invisible to diffs) and passed
// via GITHUB_EVENT_PATH — the script's PR-description surface.
function runImpact(dir, args, { event } = {}) {
  const env = isolatedEnv();
  if (event !== undefined) {
    const eventPath = join(dir, '.git', 'event.json');
    writeFileSync(eventPath, event);
    env.GITHUB_EVENT_PATH = eventPath;
  }
  return spawnSync(execPath, [IMPACT, ...args], { cwd: dir, env, encoding: 'utf8' });
}

// ── CLI / config gates ──────────────────────────────────────────────────────

test('missing --base is a usage error (exit 2)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-impact-usage-'));
  try {
    const res = runImpact(dir, []);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /usage: docs-impact/);
    const dangling = runImpact(dir, ['--base']); // flag without a value
    assert.equal(dangling.status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('no docs-paths.json → not configured, skip with exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-impact-nocfg-'));
  try {
    const res = runImpact(dir, ['--base', 'HEAD']);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /not configured/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('tier T1 skips by design (exit 0)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-impact-t1-'));
  try {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'docs-paths.json'), JSON.stringify({ ...CFG, tier: 'T1' }));
    const res = runImpact(dir, ['--base', 'HEAD']);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /tier T1/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── decision matrix ─────────────────────────────────────────────────────────

test('no code paths changed → pass', () => {
  const { dir, base } = makeRepo();
  try {
    commit(dir, { 'notes.txt': 'updated\n' }, 'edit notes');
    const res = runImpact(dir, ['--base', base]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /no code paths changed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('docs updated alongside code → pass', () => {
  const { dir, base } = makeRepo();
  try {
    commit(dir, { 'src/app.js': 'export const x = 2;\n', 'docs/guide.md': '# Guide v2\n' }, 'feature with docs');
    const res = runImpact(dir, ['--base', base]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /docs updated alongside code/);
    assert.match(res.stdout, /docs\/guide\.md/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('code-only change without a declaration fails (exit 1) naming the code', () => {
  const { dir, base } = makeRepo();
  try {
    commit(dir, { 'src/app.js': 'export const x = 2;\n' }, 'tweak engine');
    const res = runImpact(dir, ['--base', base]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /docs-impact: FAIL/);
    assert.match(res.stderr, /src\/app\.js/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── declaration surface 1: commit message trailer ───────────────────────────

test('commit-trailer declaration (em dash) is accepted', () => {
  const { dir, base } = makeRepo();
  try {
    commit(dir, { 'src/app.js': 'export const x = 2;\n' },
      'refactor', 'Docs: not-needed — internal refactor, no behavior change');
    const res = runImpact(dir, ['--base', base]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /declaration found \(commit message\)/);
    assert.match(res.stdout, /internal refactor, no behavior change/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('trailer grammar: ASCII hyphen, case-insensitive, any commit in the range', () => {
  const { dir, base } = makeRepo();
  try {
    commit(dir, { 'src/a.js': 'export const a = 1;\n' },
      'step one', 'DOCS: Not-Needed - covered by existing runbook');
    commit(dir, { 'src/b.js': 'export const b = 1;\n' }, 'step two');
    const res = runImpact(dir, ['--base', base]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /declaration found \(commit message\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('declaration reason must be at least 10 characters', () => {
  const short = makeRepo();
  const exact = makeRepo();
  try {
    commit(short.dir, { 'src/app.js': 'export const x = 2;\n' },
      'tweak', 'Docs: not-needed — too short'); // 9-char reason → rejected
    const rejected = runImpact(short.dir, ['--base', short.base]);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /docs-impact: FAIL/);

    commit(exact.dir, { 'src/app.js': 'export const x = 2;\n' },
      'tweak', 'Docs: not-needed — ten chars!'); // exactly 10 → accepted
    const accepted = runImpact(exact.dir, ['--base', exact.base]);
    assert.equal(accepted.status, 0);
  } finally {
    rmSync(short.dir, { recursive: true, force: true });
    rmSync(exact.dir, { recursive: true, force: true });
  }
});

test('a mid-line mention is not a declaration (line-anchored grammar)', () => {
  const { dir, base } = makeRepo();
  try {
    commit(dir, { 'src/app.js': 'export const x = 2;\n' },
      'tweak', 'see Docs: not-needed — quoted in passing, not declared');
    const res = runImpact(dir, ['--base', base]);
    assert.equal(res.status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── declaration surface 2: GitHub PR description ────────────────────────────

test('PR-description declaration via GITHUB_EVENT_PATH (CRLF body)', () => {
  const { dir, base } = makeRepo();
  try {
    commit(dir, { 'src/app.js': 'export const x = 2;\n' }, 'rename internals');
    const event = JSON.stringify({
      pull_request: { body: 'Refactor.\r\n\r\nDocs: not-needed — verified rename leaves docs accurate\r\n' },
    });
    const res = runImpact(dir, ['--base', base], { event });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /declaration found \(PR description\)/);
    assert.match(res.stdout, /verified rename leaves docs accurate/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('PR description takes precedence over a commit trailer', () => {
  const { dir, base } = makeRepo();
  try {
    commit(dir, { 'src/app.js': 'export const x = 2;\n' },
      'tweak', 'Docs: not-needed — commit-level reason here');
    const event = JSON.stringify({
      pull_request: { body: 'Docs: not-needed — pr-level reason wins here\n' },
    });
    const res = runImpact(dir, ['--base', base], { event });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /\(PR description\)/);
    assert.match(res.stdout, /pr-level reason wins here/);
    assert.ok(!res.stdout.includes('commit-level reason here'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('malformed event JSON falls through; with no trailer the gate still fails', () => {
  const { dir, base } = makeRepo();
  try {
    commit(dir, { 'src/app.js': 'export const x = 2;\n' }, 'tweak engine');
    const res = runImpact(dir, ['--base', base], { event: '{ not json' });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /docs-impact: FAIL/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
