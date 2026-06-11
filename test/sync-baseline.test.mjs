import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runSyncBaseline } from '../scripts/sync-baseline.mjs';
import { buildMarker, readMarker, writeMarker } from '../scripts/lib/marker.mjs';

const KIT_ROOT = join(import.meta.dirname, '..');

function seedProject(root, markerExtra = {}) {
  mkdirSync(join(root, '.claude/skills/base-check'), { recursive: true });
  writeFileSync(join(root, '.claude/skills/base-check/SKILL.md'), readFileSync(
    join(KIT_ROOT, '.claude/skills/base-check/SKILL.md'), 'utf8'));
  writeMarker(root, buildMarker({
    standard: '1.0.0',
    pin: 'v1.0.0',
    setupAt: '2026-01-01',
    lastSyncedAt: '2026-01-01',
    ...markerExtra,
  }));
}

test('sync-baseline --check current when pin matches kit-root version', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-chk-'));
  try {
    seedProject(root);
    const res = runSyncBaseline({ root, kitRoot: KIT_ROOT, check: true, json: true });
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
    const res = runSyncBaseline({ root, kitRoot: KIT_ROOT, check: true, json: true });
    assert.equal(res.payload.behind, true);
    assert.equal(res.exitCode, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sync-baseline --report lists updates when pin is behind', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-rpt-'));
  const oldKit = mkdtempSync(join(tmpdir(), 'sync-oldkit-'));
  try {
    mkdirSync(join(oldKit, '.claude/skills'), { recursive: true });
    cpSync(join(KIT_ROOT, '.claude/skills/base-check'), join(oldKit, '.claude/skills/base-check'), { recursive: true });
    writeFileSync(join(oldKit, '.claude/skills/base-check/SKILL.md'), 'old-version\n');
    seedProject(root, { standard: '0.9.0', pin: 'v0.9.0' });
    const res = runSyncBaseline({
      root, kitRoot: KIT_ROOT, oldKitRoot: oldKit, report: true, json: true,
    });
    assert.equal(res.exitCode, 0);
    assert.ok(res.payload.updateCount >= 1);
  } finally {
    for (const d of [root, oldKit]) rmSync(d, { recursive: true, force: true });
  }
});

function seedOldKit() {
  const oldKit = mkdtempSync(join(tmpdir(), 'sync-oldkit-'));
  mkdirSync(join(oldKit, '.claude/skills'), { recursive: true });
  cpSync(join(KIT_ROOT, '.claude/skills/base-check'), join(oldKit, '.claude/skills/base-check'), { recursive: true });
  writeFileSync(join(oldKit, '.claude/skills/base-check/SKILL.md'), 'old-version\n');
  return oldKit;
}

test('sync-baseline --upgrade applies updates and bumps marker pin', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-up-'));
  const oldKit = seedOldKit();
  try {
    seedProject(root, { standard: '0.9.0', pin: 'v0.9.0' });
    // Project file matches the old kit exactly → safe update, no conflict.
    writeFileSync(join(root, '.claude/skills/base-check/SKILL.md'), 'old-version\n');

    const res = runSyncBaseline({
      root, kitRoot: KIT_ROOT, oldKitRoot: oldKit, upgrade: true, json: true,
    });
    assert.equal(res.exitCode, 0);
    assert.equal(res.payload.applied, true);
    assert.equal(res.payload.conflictCount, 0);

    const synced = readFileSync(join(root, '.claude/skills/base-check/SKILL.md'), 'utf8');
    assert.equal(synced, readFileSync(join(KIT_ROOT, '.claude/skills/base-check/SKILL.md'), 'utf8'));

    const kitVersion = JSON.parse(readFileSync(join(KIT_ROOT, 'package.json'), 'utf8')).version;
    const marker = readMarker(root);
    assert.equal(marker.pin, `v${kitVersion}`);
    assert.equal(marker.standard, kitVersion);
    assert.equal(marker.setupAt, '2026-01-01');
    assert.equal(marker.lastSyncedAt, new Date().toISOString().slice(0, 10));
  } finally {
    for (const d of [root, oldKit]) rmSync(d, { recursive: true, force: true });
  }
});

test('sync-baseline --upgrade blocked by local edit: exit 1, no writes', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-cfl-'));
  const oldKit = seedOldKit();
  try {
    seedProject(root, { standard: '0.9.0', pin: 'v0.9.0' });
    // Differs from both old and new kit → local edit conflict.
    writeFileSync(join(root, '.claude/skills/base-check/SKILL.md'), 'local edit\n');

    const res = runSyncBaseline({
      root, kitRoot: KIT_ROOT, oldKitRoot: oldKit, upgrade: true, json: true,
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
    for (const d of [root, oldKit]) rmSync(d, { recursive: true, force: true });
  }
});
