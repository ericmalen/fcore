import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildMarker, readMarker, validateMarker, writeMarker, LEGACY_MARKER_PATH } from '../scripts/lib/marker.mjs';

test('buildMarker emits semver pin and sync dates', () => {
  const m = buildMarker({
    standard: '1.4.0',
    setupAt: '2026-03-01',
    lastSyncedAt: '2026-06-11',
    githubCodeReview: false,
  });
  assert.equal(m.standard, '1.4.0');
  assert.equal(m.pin, 'v1.4.0');
  assert.equal(m.toolRepo, 'https://github.com/ericmalen/fcore');
  assert.equal(m.setupAt, '2026-03-01');
  assert.equal(m.lastSyncedAt, '2026-06-11');
});

test('readMarker round-trips from disk', () => {
  const root = mkdtempSync(join(tmpdir(), 'marker-'));
  try {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude/fcore.json'), JSON.stringify(buildMarker({
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

test('readMarker falls back to the pre-v2.0.0 marker and translates old field values', () => {
  const root = mkdtempSync(join(tmpdir(), 'marker-'));
  try {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, LEGACY_MARKER_PATH), JSON.stringify({
      standard: '1.3.0',
      toolRepo: 'https://github.com/ericmalen/agent-base',
      pin: 'v1.3.0',
      setupAt: '2026-01-01',
      lastSyncedAt: '2026-01-01',
      githubCodeReview: false,
      optionalSkills: ['retro', 'tracker-sync'],
    }, null, 2));
    const m = readMarker(root);
    assert.equal(validateMarker(m).length, 0);
    assert.equal(m.toolRepo, 'https://github.com/ericmalen/fcore');
    assert.deepEqual(m.optionalSkills, ['checklist-intake', 'tracker-sync']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readMarker prefers the canonical marker over a leftover legacy one', () => {
  const root = mkdtempSync(join(tmpdir(), 'marker-'));
  try {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, LEGACY_MARKER_PATH), JSON.stringify({
      standard: '1.3.0', toolRepo: 'https://github.com/ericmalen/agent-base',
      setupAt: '2026-01-01', githubCodeReview: false,
    }, null, 2));
    writeFileSync(join(root, '.claude/fcore.json'), JSON.stringify(buildMarker({
      standard: '2.0.0', setupAt: '2026-07-01',
    }), null, 2));
    const m = readMarker(root);
    assert.equal(m.standard, '2.0.0');
    assert.equal(m.toolRepo, 'https://github.com/ericmalen/fcore');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('writeMarker deletes a leftover legacy marker once the canonical one is written', () => {
  const root = mkdtempSync(join(tmpdir(), 'marker-'));
  try {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, LEGACY_MARKER_PATH), '{ "standard": "1.3.0" }\n');
    writeMarker(root, buildMarker({ standard: '2.0.0', setupAt: '2026-07-01' }));
    assert.ok(!existsSync(join(root, LEGACY_MARKER_PATH)), 'legacy marker removed');
    assert.equal(JSON.parse(readFileSync(join(root, '.claude/fcore.json'), 'utf8')).standard, '2.0.0');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('writeMarker refuses to write through a symlink at the marker path', () => {
  const root = mkdtempSync(join(tmpdir(), 'marker-'));
  try {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, 'victim.json'), '{ "keep": "me" }\n');
    symlinkSync(join(root, 'victim.json'), join(root, '.claude/fcore.json'));
    assert.throws(() => writeMarker(root, buildMarker({ standard: '1.0.0' })), /symlink/);
    assert.equal(readFileSync(join(root, 'victim.json'), 'utf8'), '{ "keep": "me" }\n',
      'bytes behind the symlink must never be clobbered');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validateMarker treats explicit null required fields as missing', () => {
  const errors = validateMarker({
    present: true,
    standard: null,
    toolRepo: null,
    setupAt: null,
    githubCodeReview: null,
  });
  assert.equal(errors.length, 4);
  assert.ok(errors.every((e) => e.includes('missing required field')));
});

test('buildMarker emits optionalSkills only when non-empty, sorted', () => {
  const none = buildMarker({ standard: '1.0.0', setupAt: '2026-01-01' });
  assert.ok(!('optionalSkills' in none), 'omitted when empty (markers stay byte-stable)');
  const some = buildMarker({
    standard: '1.0.0', setupAt: '2026-01-01', optionalSkills: ['tracker-sync', 'checklist-intake'],
  });
  assert.deepEqual(some.optionalSkills, ['checklist-intake', 'tracker-sync']);
});

test('validateMarker checks optionalSkills shape and membership (R-55)', () => {
  const base = { present: true, standard: '1.0.0', toolRepo: 'x', setupAt: '2026-01-01', githubCodeReview: false };
  assert.equal(validateMarker({ ...base, optionalSkills: ['checklist-intake', 'eval-runner'] }).length, 0);
  assert.equal(validateMarker({ ...base }).length, 0, 'absent optionalSkills is valid');
  assert.ok(validateMarker({ ...base, optionalSkills: 'checklist-intake' })
    .some((e) => /must be an array/.test(e)));
  assert.ok(validateMarker({ ...base, optionalSkills: ['checklist-intake', 'made-up'] })
    .some((e) => /unknown skill/.test(e)));
});
