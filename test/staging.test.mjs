import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { stageRelease, listStaged, pruneStaged, SENTINEL } from '../bin/lib/staging.mjs';
import { bootstrapPrompt } from '../bin/lib/prompts.mjs';

function fakePackage(version = '1.2.3') {
  const root = mkdtempSync(join(tmpdir(), 'ab-pkg-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fcore', version }));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'audit.mjs'), '// stub\n');
  return root;
}

test('stageRelease copies once and is idempotent (sentinel)', () => {
  const home = mkdtempSync(join(tmpdir(), 'ab-home-'));
  const pkgRoot = fakePackage('1.2.3');

  const first = stageRelease({ pkgRoot, home });
  assert.equal(first.dev, false);
  assert.equal(first.copied, true);
  assert.equal(first.tag, 'v1.2.3');
  assert.ok(existsSync(join(first.path, SENTINEL)));
  assert.ok(existsSync(join(first.path, 'scripts', 'audit.mjs')));

  const again = stageRelease({ pkgRoot, home });
  assert.equal(again.copied, false);
  assert.equal(again.path, first.path);
});

test('stageRelease redoes a partial stage (no sentinel)', () => {
  const home = mkdtempSync(join(tmpdir(), 'ab-home-'));
  const pkgRoot = fakePackage('1.2.3');
  const { path } = stageRelease({ pkgRoot, home });

  rmSync(join(path, SENTINEL)); // simulate interrupted copy
  rmSync(join(path, 'scripts', 'audit.mjs'));
  const redo = stageRelease({ pkgRoot, home });
  assert.equal(redo.copied, true);
  assert.ok(existsSync(join(redo.path, 'scripts', 'audit.mjs')));
});

test('stageRelease from a clone (.git present) skips staging', () => {
  const home = mkdtempSync(join(tmpdir(), 'ab-home-'));
  const pkgRoot = fakePackage('1.2.3');
  mkdirSync(join(pkgRoot, '.git'));

  const r = stageRelease({ pkgRoot, home });
  assert.equal(r.dev, true);
  assert.equal(r.copied, false);
  assert.equal(r.path, pkgRoot);
  assert.equal(listStaged(home).length, 0);
});

test('listStaged sorts newest first and flags partial stages', () => {
  const home = mkdtempSync(join(tmpdir(), 'ab-home-'));
  for (const v of ['1.0.0', '1.2.0', '1.1.0']) stageRelease({ pkgRoot: fakePackage(v), home });
  rmSync(join(listStaged(home)[2].path, SENTINEL));

  const tags = listStaged(home);
  assert.deepEqual(tags.map((e) => e.tag), ['v1.2.0', 'v1.1.0', 'v1.0.0']);
  assert.deepEqual(tags.map((e) => e.partial), [false, false, true]);
});

test('pruneStaged keeps the newest N', () => {
  const home = mkdtempSync(join(tmpdir(), 'ab-home-'));
  for (const v of ['1.0.0', '1.1.0', '1.2.0', '1.3.0']) stageRelease({ pkgRoot: fakePackage(v), home });

  const removed = pruneStaged({ keep: 2, home });
  assert.deepEqual(removed, ['v1.1.0', 'v1.0.0']);
  assert.deepEqual(listStaged(home).map((e) => e.tag), ['v1.3.0', 'v1.2.0']);
});

test('pruneStaged sweeps stale orphaned partial dirs, keeps fresh ones', () => {
  const home = mkdtempSync(join(tmpdir(), 'ab-home-'));
  const { path } = stageRelease({ pkgRoot: fakePackage('1.0.0'), home });
  const versions = join(path, '..');
  mkdirSync(join(versions, 'v0.9.0.partial-111'));
  mkdirSync(join(versions, 'v0.8.0.partial-222'));

  // fresh partials survive (could belong to a concurrent in-flight stage)
  assert.deepEqual(pruneStaged({ keep: 5, home }), []);

  const stale = Date.now() + 2 * 60 * 60 * 1000; // pretend 2h have passed
  const removed = pruneStaged({ keep: 5, home, now: stale });
  assert.deepEqual(removed.sort(), ['v0.8.0.partial-222', 'v0.9.0.partial-111']);
  assert.ok(existsSync(path)); // staged release untouched
  assert.deepEqual(listStaged(home).map((e) => e.tag), ['v1.0.0']);
});

test('bootstrapPrompt references the right skill and immutability note', () => {
  const p = bootstrapPrompt({ command: 'fleet-config', checkoutPath: '/stage/v1.2.3', targetPath: '/proj' });
  assert.match(p, /\/stage\/v1\.2\.3\/\.claude\/skills\/fcore-fleet-config\/SKILL\.md/);
  assert.match(p, /target \/proj/);
  assert.match(p, /never `git pull`/);

  const dev = bootstrapPrompt({ command: 'onboard', checkoutPath: '/clone', dev: true });
  assert.match(dev, /fcore-onboard\/SKILL\.md/);
  assert.match(dev, /pull --ff-only/);

  assert.throws(() => bootstrapPrompt({ command: 'audit', checkoutPath: '/x' }), /no bootstrap prompt/);
});
