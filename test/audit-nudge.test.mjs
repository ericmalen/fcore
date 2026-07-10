import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { execPath } from 'node:process';

const BASE_ROOT = new URL('..', import.meta.url).pathname;
const NUDGE = join(BASE_ROOT, '.claude/skills/fcore-check/scripts/audit-nudge.mjs');

// Run the hook in `cwd`, pointing it at FleetCore via FCORE_HOME unless told not to.
function runNudge(cwd, { withBase = true } = {}) {
  const env = { ...process.env };
  let fakeHome = null;
  if (withBase) env.FCORE_HOME = BASE_ROOT;
  else {
    delete env.FCORE_HOME;
    // audit-nudge also probes ~/tools/fcore (a documented install location);
    // point HOME (and USERPROFILE, for Windows) at an empty temp dir so the
    // "no FleetCore checkout reachable" premise holds on machines with a real checkout there.
    fakeHome = mkdtempSync(join(tmpdir(), 'nudge-home-'));
    env.HOME = fakeHome;
    env.USERPROFILE = fakeHome;
  }
  const res = spawnSync(execPath, [NUDGE], { cwd, env, encoding: 'utf8' });
  if (fakeHome) rmSync(fakeHome, { recursive: true, force: true });
  return res;
}

test('always exits 0 and nudges when the repo has audit findings', () => {
  const root = mkdtempSync(join(tmpdir(), 'nudge-dirty-'));
  try {
    // No AGENTS.md, no CLAUDE.md → guaranteed R-01 error + R-10 warning.
    writeFileSync(join(root, 'placeholder.txt'), 'x');
    const res = runNudge(root);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /\[fcore\] AI-config audit found/);
    assert.match(res.stdout, /fcore-check skill/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('silent on a clean set-up project (use the FleetCore-built starter)', () => {
  const starter = mkdtempSync(join(tmpdir(), 'nudge-clean-'));
  rmSync(starter, { recursive: true, force: true }); // build-starter needs an empty/new dir
  try {
    const build = spawnSync(execPath, [join(BASE_ROOT, 'scripts/build-starter.mjs'), starter],
      { encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr);
    const res = runNudge(starter);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), '');
  } finally { rmSync(starter, { recursive: true, force: true }); }
});

test('silent when no FleetCore checkout is reachable', () => {
  const root = mkdtempSync(join(tmpdir(), 'nudge-nokit-'));
  try {
    writeFileSync(join(root, 'placeholder.txt'), 'x'); // would be dirty IF an FleetCore checkout were found
    const res = runNudge(root, { withBase: false });
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('finds the npx-staged release at the marker pin when no other checkout exists', () => {
  // realpathSync: macOS tmpdir is a symlink, which would defeat audit.mjs's
  // resolve()-based isMain check when spawned from the staged copy.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nudge-staged-')));
  const fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'nudge-stagedhome-')));
  try {
    // Project with a marker pinning v9.9.9 and guaranteed audit findings (no AGENTS.md).
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', 'fcore.json'),
      JSON.stringify({ standard: '9.9.9', toolRepo: 'https://example.invalid/x', setupAt: '2026-01-01', githubCodeReview: false }));
    // Staged release at ~/.fcore/versions/v9.9.9 — real audit scripts.
    const staged = join(fakeHome, '.fcore', 'versions', 'v9.9.9');
    mkdirSync(join(staged, 'scripts'), { recursive: true });
    cpSync(join(BASE_ROOT, 'scripts', 'audit.mjs'), join(staged, 'scripts', 'audit.mjs'));
    cpSync(join(BASE_ROOT, 'scripts', 'lib'), join(staged, 'scripts', 'lib'), { recursive: true });

    const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
    delete env.FCORE_HOME;
    const res = spawnSync(execPath, [NUDGE], { cwd: root, env, encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /\[fcore\] AI-config audit found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  }
});
