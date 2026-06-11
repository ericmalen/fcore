import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, devNull } from 'node:os';
import { spawnSync } from 'node:child_process';
import { execPath } from 'node:process';

const BASE_ROOT = new URL('..', import.meta.url).pathname;
const NUDGE = join(BASE_ROOT, '.claude/skills/docs/scripts/docs-nudge.mjs');
const CEILING = realpathSync(tmpdir());

const CFG = { tier: 'T3', codePaths: ['src/'], docsPaths: ['docs/', 'README.md'] };
const SRC_AND_DOCS = {
  'src/app.js': 'export const x = 1;\n',
  'docs/guide.md': '# Guide\n',
  'README.md': '# Demo\n',
};

// Hermetic env: no inherited git context, no user/system git config, and
// repo discovery can never escape the temp tree (GIT_CEILING_DIRECTORIES).
function isolatedEnv() {
  const env = { ...process.env };
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

function makeRepo({ cfg = CFG, files = SRC_AND_DOCS, commit = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docs-nudge-'));
  git(dir, '-c', 'init.defaultBranch=main', 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  if (cfg) {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'docs-paths.json'), JSON.stringify(cfg));
  }
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  if (commit) {
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'init');
  }
  return dir;
}

function runNudge(dir, mode) {
  const args = mode === undefined ? [NUDGE] : [NUDGE, mode];
  return spawnSync(execPath, args, { cwd: dir, env: isolatedEnv(), encoding: 'utf8' });
}

const baselineOf = (dir) => join(dir, '.git', 'agent-base-docs-baseline');
const nudgedOf = (dir) => join(dir, '.git', 'agent-base-docs-nudged');

// ── matches(): direct unit tests ────────────────────────────────────────────
// docs-nudge.mjs exports matches() but also runs its CLI at module top level,
// and EVERY top-level path calls process.exit — a plain import would kill the
// test process. Stub process.exit and evaluate the module from a throwaway
// repo with no docs-paths.json (mode undefined), so evaluation is inert.
async function importMatches() {
  const dir = mkdtempSync(join(tmpdir(), 'docs-nudge-import-'));
  const origExit = process.exit;
  const origCwd = process.cwd();
  const origCeiling = process.env.GIT_CEILING_DIRECTORIES;
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir, env: isolatedEnv(), encoding: 'utf8' });
    process.env.GIT_CEILING_DIRECTORIES = CEILING;
    process.chdir(dir);
    process.exit = () => {};
    const mod = await import(new URL('../.claude/skills/docs/scripts/docs-nudge.mjs', import.meta.url));
    return mod.matches;
  } finally {
    process.exit = origExit;
    if (origCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = origCeiling;
    process.chdir(origCwd);
    rmSync(dir, { recursive: true, force: true });
  }
}
const matches = await importMatches();

test('matches: "*.ext" patterns are suffix matches at any depth', () => {
  assert.equal(matches('README.md', ['*.md']), true);
  assert.equal(matches('docs/deep/file.md', ['*.md']), true);
  assert.equal(matches('file.mdx', ['*.md']), false);
  assert.equal(matches('file.txt', ['*.md']), false);
  assert.equal(matches('FILE.MD', ['*.md']), false); // case-sensitive
});

test('matches: "dir/" patterns are prefix matches without collisions', () => {
  assert.equal(matches('docs/a.md', ['docs/']), true);
  assert.equal(matches('docs/sub/b.md', ['docs/']), true);
  assert.equal(matches('docs2/a.md', ['docs/']), false);
  assert.equal(matches('predocs/a.md', ['docs/']), false);
  // actual behavior: a "dir/" pattern does not match the bare dir path itself
  // (harmless in practice — git reports files, never bare directories)
  assert.equal(matches('docs', ['docs/']), false);
});

test('matches: bare patterns match exactly or as a path-segment prefix', () => {
  assert.equal(matches('scripts', ['scripts']), true);
  assert.equal(matches('scripts/x.mjs', ['scripts']), true);
  assert.equal(matches('scripts2/x.mjs', ['scripts']), false); // "scripts" must not swallow "scripts2"
  assert.equal(matches('scripts.bak', ['scripts']), false);
  assert.equal(matches('README.md', ['README.md']), true);
  assert.equal(matches('docs/README.md', ['README.md']), false);
});

test('matches: empty pattern list matches nothing; any pattern suffices', () => {
  assert.equal(matches('src/app.js', []), false);
  assert.equal(matches('src/app.js', ['docs/', '*.md', 'src/']), true);
});

// ── hook behavior, end to end ───────────────────────────────────────────────

test('session-start records HEAD as baseline and resets the nudge marker', () => {
  const dir = makeRepo();
  try {
    const res = runNudge(dir, 'session-start');
    assert.equal(res.status, 0);
    assert.equal(res.stdout, '');
    assert.equal(readFileSync(baselineOf(dir), 'utf8'), git(dir, 'rev-parse', 'HEAD'));
    assert.equal(readFileSync(nudgedOf(dir), 'utf8'), '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('session-start on a repo with no commits records EMPTY', () => {
  const dir = makeRepo({ files: {}, commit: false });
  try {
    const res = runNudge(dir, 'session-start');
    assert.equal(res.status, 0);
    assert.equal(readFileSync(baselineOf(dir), 'utf8'), 'EMPTY');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('stop nudges on an unstaged code edit, once per session, and session-start re-arms', () => {
  // Pins the parsing bug class noted at docs-nudge.mjs lines 21-23: porcelain
  // lines are "XY path" where X may be a space, so trimming the raw output
  // beheads the FIRST line's path (' M src/app.js' → 'rc/app.js', which no
  // longer matches codePaths). The unstaged edit here is the only — therefore
  // first — porcelain line; the nudge fires only if the path survives intact.
  const dir = makeRepo();
  try {
    runNudge(dir, 'session-start');
    writeFileSync(join(dir, 'src', 'app.js'), 'export const x = 2;\n'); // tracked, modified, unstaged
    const stop1 = runNudge(dir, 'stop');
    assert.equal(stop1.status, 0);
    assert.match(stop1.stdout, /\[docs-nudge\] Code changed this session/);
    assert.equal(readFileSync(nudgedOf(dir), 'utf8'), 'fired');

    const stop2 = runNudge(dir, 'stop'); // one nudge per session, maximum
    assert.equal(stop2.status, 0);
    assert.equal(stop2.stdout, '');

    runNudge(dir, 'session-start'); // new session re-arms the marker
    const stop3 = runNudge(dir, 'stop');
    assert.equal(stop3.status, 0);
    assert.match(stop3.stdout, /\[docs-nudge\]/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('unstaged docs edit on the first porcelain line suppresses the nudge', () => {
  // Converse pin of the same bug class: if the docs path were beheaded the
  // docs change would go unseen and a false nudge would fire.
  const dir = makeRepo();
  try {
    runNudge(dir, 'session-start');
    writeFileSync(join(dir, 'src', 'app.js'), 'export const x = 2;\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'code change'); // code touched via baseline..HEAD
    writeFileSync(join(dir, 'docs', 'guide.md'), '# Guide v2\n'); // only porcelain line
    const res = runNudge(dir, 'stop');
    assert.equal(res.status, 0);
    assert.equal(res.stdout, '');
    assert.equal(readFileSync(nudgedOf(dir), 'utf8'), ''); // never fired
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('committed code change since baseline triggers; CHANGELOG.md mention follows docsPaths', () => {
  const cfg = { tier: 'T2', codePaths: ['src/'], docsPaths: ['docs/', 'CHANGELOG.md'] };
  const dir = makeRepo({ cfg, files: { ...SRC_AND_DOCS, 'CHANGELOG.md': '# Changelog\n' } });
  try {
    runNudge(dir, 'session-start');
    writeFileSync(join(dir, 'src', 'app.js'), 'export const x = 3;\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'feature'); // worktree clean: only baseline..HEAD sees it
    const res = runNudge(dir, 'stop');
    assert.equal(res.status, 0);
    assert.match(res.stdout, /\[docs-nudge\]/);
    assert.match(res.stdout, /and CHANGELOG\.md/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('stop without a prior session-start still nudges on an untracked code file', () => {
  const dir = makeRepo();
  try {
    writeFileSync(join(dir, 'src', 'new-helper.js'), 'export const y = 1;\n'); // "?? src/new-helper.js"
    const res = runNudge(dir, 'stop'); // no baseline, no marker file
    assert.equal(res.status, 0);
    assert.match(res.stdout, /\[docs-nudge\]/);
    assert.equal(readFileSync(nudgedOf(dir), 'utf8'), 'fired');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('docs-only changes stay silent', () => {
  const dir = makeRepo();
  try {
    runNudge(dir, 'session-start');
    writeFileSync(join(dir, 'docs', 'guide.md'), '# Guide v2\n');
    writeFileSync(join(dir, 'docs', 'new.md'), '# New\n');
    const res = runNudge(dir, 'stop');
    assert.equal(res.status, 0);
    assert.equal(res.stdout, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('tier T1 never nudges', () => {
  const dir = makeRepo({ cfg: { tier: 'T1', codePaths: ['src/'], docsPaths: ['docs/'] } });
  try {
    runNudge(dir, 'session-start');
    writeFileSync(join(dir, 'src', 'app.js'), 'export const x = 9;\n');
    const res = runNudge(dir, 'stop');
    assert.equal(res.status, 0);
    assert.equal(res.stdout, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('stop is silent and exits 0 when docs-paths.json is missing', () => {
  const dir = makeRepo({ cfg: null, files: { 'src/app.js': 'export const x = 1;\n' } });
  try {
    runNudge(dir, 'session-start');
    writeFileSync(join(dir, 'src', 'app.js'), 'export const x = 2;\n');
    const res = runNudge(dir, 'stop');
    assert.equal(res.status, 0);
    assert.equal(res.stdout, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('exits 0 silently outside a git repository, in every mode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-nudge-norepo-'));
  try {
    for (const mode of ['session-start', 'stop', 'bogus']) {
      const res = runNudge(dir, mode);
      assert.equal(res.status, 0, `mode ${mode}`);
      assert.equal(res.stdout, '', `mode ${mode}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('unknown or missing mode exits 0 without recording state', () => {
  const dir = makeRepo();
  try {
    for (const res of [runNudge(dir, 'bogus'), runNudge(dir)]) {
      assert.equal(res.status, 0);
      assert.equal(res.stdout, '');
    }
    assert.equal(existsSync(baselineOf(dir)), false);
    assert.equal(existsSync(nudgedOf(dir)), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
