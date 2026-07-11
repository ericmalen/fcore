import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, cpSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { runSyncBaseline } from '../scripts/sync-baseline.mjs';
import { buildMarker, readMarker, writeMarker } from '../scripts/lib/marker.mjs';
import { BASELINE_COPIES } from '../scripts/lib/baseline.mjs';

const BASE_ROOT = join(import.meta.dirname, '..');
// "current" must track the live package version or every release bump breaks this suite
const BASE_VERSION = JSON.parse(readFileSync(join(BASE_ROOT, 'package.json'), 'utf8')).version;

function seedProject(root, markerExtra = {}) {
  mkdirSync(join(root, '.claude/skills/fcore-check'), { recursive: true });
  writeFileSync(join(root, '.claude/skills/fcore-check/SKILL.md'), readFileSync(
    join(BASE_ROOT, '.claude/skills/fcore-check/SKILL.md'), 'utf8'));
  writeMarker(root, buildMarker({
    standard: BASE_VERSION,
    pin: `v${BASE_VERSION}`,
    setupAt: '2026-01-01',
    lastSyncedAt: '2026-01-01',
    ...markerExtra,
  }));
}

test('sync-baseline --check current when pin matches fcore-root version', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-chk-'));
  try {
    seedProject(root);
    const res = runSyncBaseline({ root, fcoreRoot: BASE_ROOT, check: true, json: true });
    assert.equal(res.exitCode, 0);
    assert.equal(res.payload.behind, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sync-baseline --check behind when pin is older', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-behind-'));
  try {
    seedProject(root, { standard: '0.9.0', pin: 'v0.9.0' });
    const res = runSyncBaseline({ root, fcoreRoot: BASE_ROOT, check: true, json: true });
    assert.equal(res.payload.behind, true);
    assert.equal(res.exitCode, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sync-baseline --report lists updates when pin is behind', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-rpt-'));
  const oldBase = mkdtempSync(join(tmpdir(), 'sync-oldkit-'));
  try {
    mkdirSync(join(oldBase, '.claude/skills'), { recursive: true });
    cpSync(join(BASE_ROOT, '.claude/skills/fcore-check'), join(oldBase, '.claude/skills/fcore-check'), { recursive: true });
    writeFileSync(join(oldBase, '.claude/skills/fcore-check/SKILL.md'), 'old-version\n');
    seedProject(root, { standard: '0.9.0', pin: 'v0.9.0' });
    const res = runSyncBaseline({
      root, fcoreRoot: BASE_ROOT, oldFcoreRoot: oldBase, report: true, json: true,
    });
    assert.equal(res.exitCode, 0);
    assert.ok(res.payload.updateCount >= 1);
  } finally {
    for (const d of [root, oldBase]) rmSync(d, { recursive: true, force: true });
  }
});

function seedOldKit() {
  const oldBase = mkdtempSync(join(tmpdir(), 'sync-oldkit-'));
  mkdirSync(join(oldBase, '.claude/skills'), { recursive: true });
  cpSync(join(BASE_ROOT, '.claude/skills/fcore-check'), join(oldBase, '.claude/skills/fcore-check'), { recursive: true });
  writeFileSync(join(oldBase, '.claude/skills/fcore-check/SKILL.md'), 'old-version\n');
  return oldBase;
}

test('sync-baseline --upgrade applies updates and bumps marker pin', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-up-'));
  const oldBase = seedOldKit();
  try {
    seedProject(root, { standard: '0.9.0', pin: 'v0.9.0' });
    // Project file matches the old release exactly → safe update, no conflict.
    writeFileSync(join(root, '.claude/skills/fcore-check/SKILL.md'), 'old-version\n');
    // Non-canonical marker field must survive the upgrade rewrite.
    const markerPath = join(root, '.claude/fcore.json');
    const seeded = JSON.parse(readFileSync(markerPath, 'utf8'));
    writeFileSync(markerPath, JSON.stringify({ ...seeded, customField: 'keep-me' }, null, 2) + '\n');

    const res = runSyncBaseline({
      root, fcoreRoot: BASE_ROOT, oldFcoreRoot: oldBase, upgrade: true, json: true,
    });
    assert.equal(res.exitCode, 0);
    assert.equal(res.payload.applied, true);
    assert.equal(res.payload.conflictCount, 0);

    const synced = readFileSync(join(root, '.claude/skills/fcore-check/SKILL.md'), 'utf8');
    assert.equal(synced, readFileSync(join(BASE_ROOT, '.claude/skills/fcore-check/SKILL.md'), 'utf8'));

    const baseVersion = JSON.parse(readFileSync(join(BASE_ROOT, 'package.json'), 'utf8')).version;
    const marker = readMarker(root);
    assert.equal(marker.pin, `v${baseVersion}`);
    assert.equal(marker.standard, baseVersion);
    assert.equal(marker.setupAt, '2026-01-01');
    assert.equal(marker.lastSyncedAt, new Date().toISOString().slice(0, 10));
    assert.equal(marker.customField, 'keep-me');
  } finally {
    for (const d of [root, oldBase]) rmSync(d, { recursive: true, force: true });
  }
});

test('sync-baseline --upgrade migrates a pre-v2.0.0 project: marker, optionalSkills, and orphaned old-named dirs', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-migrate-'));
  const oldBase = mkdtempSync(join(tmpdir(), 'sync-migrate-old-'));
  try {
    // Simulate a v1.3.x project: legacy marker + old-named skill dirs, no
    // trace of the current .claude/fcore.json or fcore-*/docs-manager names.
    mkdirSync(join(root, '.claude/skills/base-check'), { recursive: true });
    writeFileSync(join(root, '.claude/skills/base-check/SKILL.md'), 'pre-rebrand content\n');
    mkdirSync(join(root, '.claude/skills/retro'), { recursive: true });
    writeFileSync(join(root, '.claude/skills/retro/SKILL.md'), 'pre-rebrand retro\n');
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude/agent-base.json'), JSON.stringify({
      standard: '1.3.0',
      toolRepo: 'https://github.com/ericmalen/agent-base',
      pin: 'v1.3.0',
      setupAt: '2026-01-01',
      lastSyncedAt: '2026-01-01',
      githubCodeReview: false,
      optionalSkills: ['retro'],
    }, null, 2) + '\n');

    const res = runSyncBaseline({
      root, fcoreRoot: BASE_ROOT, oldFcoreRoot: oldBase, upgrade: true, json: true,
    });
    assert.equal(res.exitCode, 0);
    assert.equal(res.payload.applied, true);
    assert.equal(res.payload.conflictCount, 0);

    // Marker migrated: canonical path written, legacy path gone, fields translated.
    assert.ok(!existsSync(join(root, '.claude/agent-base.json')), 'legacy marker removed');
    const marker = readMarker(root);
    assert.equal(marker.toolRepo, 'https://github.com/ericmalen/fcore');
    assert.deepEqual(marker.optionalSkills, ['checklist-intake']);

    // New-named baseline skill + selected optional skill added under new names.
    assert.ok(existsSync(join(root, '.claude/skills/fcore-check/SKILL.md')));
    assert.ok(existsSync(join(root, '.claude/skills/checklist-intake/SKILL.md')));

    // Old-named dirs surfaced as removed, but never auto-deleted.
    assert.ok(res.payload.removed.includes('.claude/skills/base-check/SKILL.md'));
    assert.ok(res.payload.removed.includes('.claude/skills/retro/SKILL.md'));
    assert.ok(existsSync(join(root, '.claude/skills/base-check/SKILL.md')), 'orphan left in place, not deleted');
  } finally {
    for (const d of [root, oldBase]) rmSync(d, { recursive: true, force: true });
  }
});

test('sync-baseline --upgrade restores missing baseline files at current pin', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-fix-'));
  try {
    // Current pin, but only fcore-check present — rest of the baseline missing.
    seedProject(root);
    const res = runSyncBaseline({ root, fcoreRoot: BASE_ROOT, upgrade: true, json: true });
    assert.equal(res.exitCode, 0);
    assert.equal(res.payload.applied, true);
    assert.ok(res.payload.updateCount >= 1);
    assert.equal(res.payload.conflictCount, 0);
    assert.match(res.message, /restored .* at v/);

    assert.equal(
      readFileSync(join(root, '.claude/skills/docs-manager/SKILL.md'), 'utf8'),
      readFileSync(join(BASE_ROOT, '.claude/skills/docs-manager/SKILL.md'), 'utf8'));

    const marker = readMarker(root);
    assert.equal(marker.pin, `v${BASE_VERSION}`);
    assert.equal(marker.lastSyncedAt, new Date().toISOString().slice(0, 10));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sync-baseline --report at current pin lists missing baseline files', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-rpt-fix-'));
  try {
    seedProject(root);
    const res = runSyncBaseline({ root, fcoreRoot: BASE_ROOT, report: true, json: true });
    assert.equal(res.exitCode, 0);
    assert.equal(res.payload.behind, false);
    assert.ok(res.payload.updateCount >= 1);
    assert.match(res.message, /missing baseline file/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sync-baseline --upgrade at current pin: restores missing, leaves local edits, exit 0', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-drift-'));
  try {
    seedProject(root);
    for (const [src, dst] of BASELINE_COPIES) {
      cpSync(join(BASE_ROOT, src), join(root, dst), { recursive: true });
    }
    writeFileSync(join(root, '.claude/skills/docs-manager/SKILL.md'), 'deliberate local edit\n');
    rmSync(join(root, '.claude/skills/git-conventions'), { recursive: true });

    const res = runSyncBaseline({ root, fcoreRoot: BASE_ROOT, upgrade: true, json: true });
    assert.equal(res.exitCode, 0);
    assert.equal(res.payload.applied, true);
    assert.equal(res.payload.conflictCount, 1);
    assert.match(res.message, /left untouched/);

    assert.equal(
      readFileSync(join(root, '.claude/skills/git-conventions/SKILL.md'), 'utf8'),
      readFileSync(join(BASE_ROOT, '.claude/skills/git-conventions/SKILL.md'), 'utf8'));
    assert.equal(
      readFileSync(join(root, '.claude/skills/docs-manager/SKILL.md'), 'utf8'),
      'deliberate local edit\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sync-baseline --upgrade at current pin: local edits alone are a no-op, exit 0', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-drift-noop-'));
  try {
    seedProject(root);
    for (const [src, dst] of BASELINE_COPIES) {
      cpSync(join(BASE_ROOT, src), join(root, dst), { recursive: true });
    }
    writeFileSync(join(root, '.claude/skills/docs-manager/SKILL.md'), 'deliberate local edit\n');

    const res = runSyncBaseline({ root, fcoreRoot: BASE_ROOT, upgrade: true, json: true });
    assert.equal(res.exitCode, 0);
    assert.equal(res.payload.applied, false);
    assert.equal(res.payload.conflictCount, 1);
    assert.match(res.message, /already at latest/);
    assert.equal(
      readFileSync(join(root, '.claude/skills/docs-manager/SKILL.md'), 'utf8'),
      'deliberate local edit\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sync-baseline --upgrade refuses when pin is ahead of target: exit 2, no writes', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-ahead-'));
  const stale = mkdtempSync(join(tmpdir(), 'sync-stale-'));
  try {
    seedProject(root);
    // Stale fcore checkout reports an older version than the project pin.
    writeFileSync(join(stale, 'package.json'), JSON.stringify({ version: '0.1.0' }));

    const res = runSyncBaseline({ root, fcoreRoot: stale, upgrade: true, json: true });
    assert.equal(res.exitCode, 2);
    assert.match(res.error, /ahead of target/);

    const marker = readMarker(root);
    assert.equal(marker.pin, `v${BASE_VERSION}`);
    assert.equal(marker.standard, BASE_VERSION);
    assert.ok(!existsSync(join(root, '.claude/skills/docs-manager')));
  } finally {
    for (const d of [root, stale]) rmSync(d, { recursive: true, force: true });
  }
});

test('sync-baseline --upgrade: symlinked baseline path is a conflict, never written through', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-lnk-'));
  const victim = mkdtempSync(join(tmpdir(), 'sync-victim-'));
  try {
    seedProject(root);
    // Committed symlink at a baseline dst: updates would land out-of-tree.
    symlinkSync(victim, join(root, '.claude/skills/docs-manager'));

    const res = runSyncBaseline({ root, fcoreRoot: BASE_ROOT, upgrade: true, json: true });
    // Plan classifies the symlinked paths as conflicts (drift at a current
    // pin); the rest of the baseline is still repaired around them.
    assert.equal(res.exitCode, 0, res.error ?? res.message);
    assert.ok(res.payload.conflicts.some((c) => /symlink/.test(c.reason)));
    assert.ok(res.payload.conflicts.every((c) => !/docs\/SKILL\.md$/.test(c.path)
      || /symlink/.test(c.reason)));

    // Nothing crosses the link; sibling skills restored normally.
    assert.ok(!existsSync(join(victim, 'SKILL.md')));
    assert.ok(existsSync(join(root, '.claude/skills/git-conventions/SKILL.md')));
  } finally {
    for (const d of [root, victim]) rmSync(d, { recursive: true, force: true });
  }
});

test('sync-baseline --upgrade no-op at current pin with complete baseline', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-noop-'));
  try {
    seedProject(root);
    for (const [src, dst] of BASELINE_COPIES) {
      cpSync(join(BASE_ROOT, src), join(root, dst), { recursive: true });
    }
    const res = runSyncBaseline({ root, fcoreRoot: BASE_ROOT, upgrade: true, json: true });
    assert.equal(res.exitCode, 0);
    assert.equal(res.payload.applied, false);
    assert.match(res.message, /already at latest/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sync-baseline --upgrade blocked by local edit: exit 1, no writes', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-cfl-'));
  const oldBase = seedOldKit();
  try {
    seedProject(root, { standard: '0.9.0', pin: 'v0.9.0' });
    // Differs from both old and new release → local edit conflict.
    writeFileSync(join(root, '.claude/skills/fcore-check/SKILL.md'), 'local edit\n');

    const res = runSyncBaseline({
      root, fcoreRoot: BASE_ROOT, oldFcoreRoot: oldBase, upgrade: true, json: true,
    });
    assert.equal(res.exitCode, 1);
    assert.ok(res.payload.conflicts.some(
      (c) => c.path === '.claude/skills/fcore-check/SKILL.md'));

    // Nothing applied: file and marker untouched.
    assert.equal(readFileSync(join(root, '.claude/skills/fcore-check/SKILL.md'), 'utf8'), 'local edit\n');
    const marker = readMarker(root);
    assert.equal(marker.pin, 'v0.9.0');
    assert.equal(marker.standard, '0.9.0');
  } finally {
    for (const d of [root, oldBase]) rmSync(d, { recursive: true, force: true });
  }
});

test('sync-baseline --upgrade at current pin: file-where-dir-expected is drift, repair survives', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-type-'));
  try {
    seedProject(root);
    // A regular FILE squats where the baseline ships the docs skill DIR.
    writeFileSync(join(root, '.claude/skills/docs-manager'), 'i am a file\n');

    const res = runSyncBaseline({ root, fcoreRoot: BASE_ROOT, upgrade: true, json: true });
    assert.equal(res.exitCode, 0, res.error ?? res.message);
    assert.equal(res.payload.applied, true);
    assert.ok(res.payload.conflictCount >= 1);
    assert.ok(res.payload.conflicts.every((c) => /file where the baseline needs a directory/.test(c.reason)
      || /local edit/.test(c.reason)));

    // Squatting file untouched; the rest of the baseline restored around it.
    assert.equal(readFileSync(join(root, '.claude/skills/docs-manager'), 'utf8'), 'i am a file\n');
    assert.ok(existsSync(join(root, '.claude/skills/git-conventions/SKILL.md')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sync-baseline (R-55): unselected optional skill is never synced or reported removed', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-opt-none-'));
  try {
    seedProject(root); // no optionalSkills in marker
    // A leftover optional skill on disk is invisible to a project that did not
    // select it — sync neither upgrades it nor flags it as removed.
    cpSync(join(BASE_ROOT, '.claude/skills/checklist-intake'), join(root, '.claude/skills/checklist-intake'), { recursive: true });
    writeFileSync(join(root, '.claude/skills/checklist-intake/SKILL.md'), 'stale local copy\n');

    const res = runSyncBaseline({ root, fcoreRoot: BASE_ROOT, report: true, json: true });
    assert.equal(res.exitCode, 0);
    assert.ok(!res.payload.updates.some((p) => p.startsWith('.claude/skills/checklist-intake')));
    assert.ok(!res.payload.removed.some((p) => p.startsWith('.claude/skills/checklist-intake')));
    // Left exactly as-is — not touched.
    assert.equal(readFileSync(join(root, '.claude/skills/checklist-intake/SKILL.md'), 'utf8'), 'stale local copy\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sync-baseline (R-55): a selected optional skill is repaired like the baseline', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-opt-sel-'));
  try {
    seedProject(root, { optionalSkills: ['checklist-intake'] });
    // Selected but missing on disk → restored from the pinned release.
    const res = runSyncBaseline({ root, fcoreRoot: BASE_ROOT, upgrade: true, json: true });
    assert.equal(res.exitCode, 0, res.error ?? res.message);
    assert.equal(
      readFileSync(join(root, '.claude/skills/checklist-intake/SKILL.md'), 'utf8'),
      readFileSync(join(BASE_ROOT, '.claude/skills/checklist-intake/SKILL.md'), 'utf8'));
    // Selection survives the marker rewrite.
    assert.deepEqual(readMarker(root).optionalSkills, ['checklist-intake']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sync-baseline (R-55): a src !== dst optional skill (templates-sourced) is repaired from src, written to dst', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-opt-srcdst-'));
  try {
    seedProject(root, { optionalSkills: ['ui-verify-web'] });
    // Selected but missing on disk → restored from the pinned release, read
    // from BASE_ROOT's templates/optional-skills/ui-verify-web (the live repo
    // layout), written to the project's .claude/skills/ui-verify-web.
    const res = runSyncBaseline({ root, fcoreRoot: BASE_ROOT, upgrade: true, json: true });
    assert.equal(res.exitCode, 0, res.error ?? res.message);
    assert.equal(
      readFileSync(join(root, '.claude/skills/ui-verify-web/SKILL.md'), 'utf8'),
      readFileSync(join(BASE_ROOT, 'templates/optional-skills/ui-verify-web/SKILL.md'), 'utf8'));
    assert.deepEqual(readMarker(root).optionalSkills, ['ui-verify-web']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sync-baseline checkout failure: exit 2 result (no throw), no temp-dir leak', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-clone-'));
  const repo = mkdtempSync(join(tmpdir(), 'sync-repo-'));
  try {
    const git = (...args) => {
      const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
    };
    git('init', '-q');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-q', '-m', 'x');
    git('tag', 'v0.2.0'); // pin v0.1.0 exists in the marker only — clone at it must fail
    seedProject(root, { standard: '0.1.0', pin: 'v0.1.0', toolRepo: repo });

    const before = new Set(readdirSync(tmpdir()).filter((d) => d.startsWith('fcore-sync-')));
    const res = runSyncBaseline({ root, upgrade: true, json: true });
    assert.equal(res.exitCode, 2);
    assert.match(res.error, /baseline checkout failed/);
    const leaked = readdirSync(tmpdir())
      .filter((d) => d.startsWith('fcore-sync-') && !before.has(d));
    assert.deepEqual(leaked, []);
  } finally {
    for (const d of [root, repo]) rmSync(d, { recursive: true, force: true });
  }
});
