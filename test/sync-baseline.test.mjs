import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runSyncBaseline } from '../scripts/sync-baseline.mjs';
import { buildMarker, readMarker, writeMarker } from '../scripts/lib/marker.mjs';
import { BASELINE_COPIES } from '../scripts/lib/baseline.mjs';

const BASE_ROOT = join(import.meta.dirname, '..');
// "current" must track the live package version or every release bump breaks this suite
const BASE_VERSION = JSON.parse(readFileSync(join(BASE_ROOT, 'package.json'), 'utf8')).version;

function seedProject(root, markerExtra = {}) {
  mkdirSync(join(root, '.claude/skills/base-check'), { recursive: true });
  writeFileSync(join(root, '.claude/skills/base-check/SKILL.md'), readFileSync(
    join(BASE_ROOT, '.claude/skills/base-check/SKILL.md'), 'utf8'));
  writeMarker(root, buildMarker({
    standard: BASE_VERSION,
    pin: `v${BASE_VERSION}`,
    setupAt: '2026-01-01',
    lastSyncedAt: '2026-01-01',
    ...markerExtra,
  }));
}

test('sync-baseline --check current when pin matches base-root version', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-chk-'));
  try {
    seedProject(root);
    const res = runSyncBaseline({ root, baseRoot: BASE_ROOT, check: true, json: true });
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
    const res = runSyncBaseline({ root, baseRoot: BASE_ROOT, check: true, json: true });
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
    cpSync(join(BASE_ROOT, '.claude/skills/base-check'), join(oldBase, '.claude/skills/base-check'), { recursive: true });
    writeFileSync(join(oldBase, '.claude/skills/base-check/SKILL.md'), 'old-version\n');
    seedProject(root, { standard: '0.9.0', pin: 'v0.9.0' });
    const res = runSyncBaseline({
      root, baseRoot: BASE_ROOT, oldBaseRoot: oldBase, report: true, json: true,
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
  cpSync(join(BASE_ROOT, '.claude/skills/base-check'), join(oldBase, '.claude/skills/base-check'), { recursive: true });
  writeFileSync(join(oldBase, '.claude/skills/base-check/SKILL.md'), 'old-version\n');
  return oldBase;
}

test('sync-baseline --upgrade applies updates and bumps marker pin', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-up-'));
  const oldBase = seedOldKit();
  try {
    seedProject(root, { standard: '0.9.0', pin: 'v0.9.0' });
    // Project file matches the old release exactly → safe update, no conflict.
    writeFileSync(join(root, '.claude/skills/base-check/SKILL.md'), 'old-version\n');
    // Non-canonical marker field must survive the upgrade rewrite.
    const markerPath = join(root, '.claude/agent-base.json');
    const seeded = JSON.parse(readFileSync(markerPath, 'utf8'));
    writeFileSync(markerPath, JSON.stringify({ ...seeded, customField: 'keep-me' }, null, 2) + '\n');

    const res = runSyncBaseline({
      root, baseRoot: BASE_ROOT, oldBaseRoot: oldBase, upgrade: true, json: true,
    });
    assert.equal(res.exitCode, 0);
    assert.equal(res.payload.applied, true);
    assert.equal(res.payload.conflictCount, 0);

    const synced = readFileSync(join(root, '.claude/skills/base-check/SKILL.md'), 'utf8');
    assert.equal(synced, readFileSync(join(BASE_ROOT, '.claude/skills/base-check/SKILL.md'), 'utf8'));

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

test('sync-baseline --upgrade restores missing baseline files at current pin', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-fix-'));
  try {
    // Current pin, but only base-check present — rest of the baseline missing.
    seedProject(root);
    const res = runSyncBaseline({ root, baseRoot: BASE_ROOT, upgrade: true, json: true });
    assert.equal(res.exitCode, 0);
    assert.equal(res.payload.applied, true);
    assert.ok(res.payload.updateCount >= 1);
    assert.equal(res.payload.conflictCount, 0);
    assert.match(res.message, /restored .* at v/);

    assert.equal(
      readFileSync(join(root, '.claude/skills/docs/SKILL.md'), 'utf8'),
      readFileSync(join(BASE_ROOT, '.claude/skills/docs/SKILL.md'), 'utf8'));

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
    const res = runSyncBaseline({ root, baseRoot: BASE_ROOT, report: true, json: true });
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
    writeFileSync(join(root, '.claude/skills/docs/SKILL.md'), 'deliberate local edit\n');
    rmSync(join(root, '.claude/skills/retro'), { recursive: true });

    const res = runSyncBaseline({ root, baseRoot: BASE_ROOT, upgrade: true, json: true });
    assert.equal(res.exitCode, 0);
    assert.equal(res.payload.applied, true);
    assert.equal(res.payload.conflictCount, 1);
    assert.match(res.message, /left untouched/);

    assert.equal(
      readFileSync(join(root, '.claude/skills/retro/SKILL.md'), 'utf8'),
      readFileSync(join(BASE_ROOT, '.claude/skills/retro/SKILL.md'), 'utf8'));
    assert.equal(
      readFileSync(join(root, '.claude/skills/docs/SKILL.md'), 'utf8'),
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
    writeFileSync(join(root, '.claude/skills/docs/SKILL.md'), 'deliberate local edit\n');

    const res = runSyncBaseline({ root, baseRoot: BASE_ROOT, upgrade: true, json: true });
    assert.equal(res.exitCode, 0);
    assert.equal(res.payload.applied, false);
    assert.equal(res.payload.conflictCount, 1);
    assert.match(res.message, /already at latest/);
    assert.equal(
      readFileSync(join(root, '.claude/skills/docs/SKILL.md'), 'utf8'),
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
    // Stale base checkout reports an older version than the project pin.
    writeFileSync(join(stale, 'package.json'), JSON.stringify({ version: '0.1.0' }));

    const res = runSyncBaseline({ root, baseRoot: stale, upgrade: true, json: true });
    assert.equal(res.exitCode, 2);
    assert.match(res.error, /ahead of target/);

    const marker = readMarker(root);
    assert.equal(marker.pin, `v${BASE_VERSION}`);
    assert.equal(marker.standard, BASE_VERSION);
    assert.ok(!existsSync(join(root, '.claude/skills/docs')));
  } finally {
    for (const d of [root, stale]) rmSync(d, { recursive: true, force: true });
  }
});

test('sync-baseline --upgrade no-op at current pin with complete baseline', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-noop-'));
  try {
    seedProject(root);
    for (const [src, dst] of BASELINE_COPIES) {
      cpSync(join(BASE_ROOT, src), join(root, dst), { recursive: true });
    }
    const res = runSyncBaseline({ root, baseRoot: BASE_ROOT, upgrade: true, json: true });
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
    writeFileSync(join(root, '.claude/skills/base-check/SKILL.md'), 'local edit\n');

    const res = runSyncBaseline({
      root, baseRoot: BASE_ROOT, oldBaseRoot: oldBase, upgrade: true, json: true,
    });
    assert.equal(res.exitCode, 1);
    assert.ok(res.payload.conflicts.some(
      (c) => c.path === '.claude/skills/base-check/SKILL.md'));

    // Nothing applied: file and marker untouched.
    assert.equal(readFileSync(join(root, '.claude/skills/base-check/SKILL.md'), 'utf8'), 'local edit\n');
    const marker = readMarker(root);
    assert.equal(marker.pin, 'v0.9.0');
    assert.equal(marker.standard, '0.9.0');
  } finally {
    for (const d of [root, oldBase]) rmSync(d, { recursive: true, force: true });
  }
});
