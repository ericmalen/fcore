import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildMarker, readMarker, validateMarker } from '../scripts/lib/marker.mjs';

test('buildMarker emits semver pin and sync dates', () => {
  const m = buildMarker({
    standard: '1.4.0',
    setupAt: '2026-03-01',
    lastSyncedAt: '2026-06-11',
    githubCodeReview: false,
  });
  assert.equal(m.standard, '1.4.0');
  assert.equal(m.pin, 'v1.4.0');
  assert.equal(m.toolRepo, 'https://github.com/ericmalen/agent-base');
  assert.equal(m.setupAt, '2026-03-01');
  assert.equal(m.lastSyncedAt, '2026-06-11');
});

test('readMarker round-trips from disk', () => {
  const root = mkdtempSync(join(tmpdir(), 'marker-'));
  try {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude/agent-base.json'), JSON.stringify(buildMarker({
      standard: '1.0.0',
      setupAt: '2026-01-01',
    }), null, 2));
    const m = readMarker(root);
    assert.equal(validateMarker(m).length, 0);
    assert.equal(m.pin, 'v1.0.0');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
