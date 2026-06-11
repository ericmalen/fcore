import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { execPath } from 'node:process';

const KIT_ROOT = new URL('..', import.meta.url).pathname;
const NUDGE = join(KIT_ROOT, '.claude/skills/base-check/scripts/audit-nudge.mjs');

// Run the hook in `cwd`, pointing it at the kit via AI_KIT_HOME unless told not to.
function runNudge(cwd, { withKit = true } = {}) {
  const env = { ...process.env };
  let fakeHome = null;
  if (withKit) env.AI_KIT_HOME = KIT_ROOT;
  else {
    delete env.AI_KIT_HOME;
    // audit-nudge also probes ~/tools/agent-base (a documented install location);
    // point HOME (and USERPROFILE, for Windows) at an empty temp dir so the
    // "no kit reachable" premise holds on machines with a real checkout there.
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
    assert.match(res.stdout, /\[agent-base\] AI-config audit found/);
    assert.match(res.stdout, /base-check skill/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('silent on a clean set-up project (use the kit-built starter)', () => {
  const starter = mkdtempSync(join(tmpdir(), 'nudge-clean-'));
  rmSync(starter, { recursive: true, force: true }); // build-starter needs an empty/new dir
  try {
    const build = spawnSync(execPath, [join(KIT_ROOT, 'scripts/build-starter.mjs'), starter],
      { encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr);
    const res = runNudge(starter);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), '');
  } finally { rmSync(starter, { recursive: true, force: true }); }
});

test('silent when no kit checkout is reachable', () => {
  const root = mkdtempSync(join(tmpdir(), 'nudge-nokit-'));
  try {
    writeFileSync(join(root, 'placeholder.txt'), 'x'); // would be dirty IF a kit were found
    const res = runNudge(root, { withKit: false });
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
