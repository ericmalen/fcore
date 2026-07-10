// skills-cli tests: `fcore skills list|add|remove` manage the opt-in
// optional lifecycle skills (R-55), copying from this checkout and tracking the
// selection in the project marker's `optionalSkills`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { buildMarker, writeMarker, readMarker } from '../scripts/lib/marker.mjs';

const BIN = join(import.meta.dirname, '..', 'bin', 'fcore.mjs');
const run = (args) => spawnSync(process.execPath, [BIN, 'skills', ...args], { encoding: 'utf8' });

// A minimal set-up project: a valid marker is the precondition for managing
// optionals (you cannot opt into skills on a non-set-up repo).
function setUpProject() {
  const dir = mkdtempSync(join(tmpdir(), 'skills-cli-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeMarker(dir, buildMarker({ standard: '1.0.0', setupAt: '2026-01-01' }));
  return dir;
}

test('skills list shows all optionals as available when none selected', () => {
  const dir = setUpProject();
  try {
    const r = run(['list', dir]);
    assert.equal(r.status, 0, r.stderr);
    for (const name of ['checklist-intake', 'log-report', 'eval-runner', 'tracker-sync']) {
      assert.match(r.stdout, new RegExp(`\\[available\\]\\s+${name}`));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skills add installs the skill and records it in the marker', () => {
  const dir = setUpProject();
  try {
    const r = run(['add', 'checklist-intake', dir]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(dir, '.claude/skills/checklist-intake/SKILL.md')), 'skill copied');
    assert.deepEqual(readMarker(dir).optionalSkills, ['checklist-intake']);
    // list now reflects it as installed
    const l = run(['list', dir]);
    assert.match(l.stdout, /\[installed\]\s+checklist-intake/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skills add is idempotent on a re-add', () => {
  const dir = setUpProject();
  try {
    assert.equal(run(['add', 'eval-runner', dir]).status, 0);
    const again = run(['add', 'eval-runner', dir]);
    assert.equal(again.status, 0);
    assert.match(again.stdout, /already installed/);
    assert.deepEqual(readMarker(dir).optionalSkills, ['eval-runner']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skills remove deletes the skill and drops it from the marker', () => {
  const dir = setUpProject();
  try {
    run(['add', 'checklist-intake', dir]);
    run(['add', 'tracker-sync', dir]);
    const r = run(['remove', 'checklist-intake', dir]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!existsSync(join(dir, '.claude/skills/checklist-intake')), 'skill dir removed');
    assert.deepEqual(readMarker(dir).optionalSkills, ['tracker-sync']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skills remove of the last optional drops the field entirely', () => {
  const dir = setUpProject();
  try {
    run(['add', 'checklist-intake', dir]);
    run(['remove', 'checklist-intake', dir]);
    assert.ok(!('optionalSkills' in readMarker(dir)), 'field omitted when none remain');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skills add of an unknown skill exits 2 and lists valid names', () => {
  const dir = setUpProject();
  try {
    const r = run(['add', 'made-up', dir]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown optional skill/);
    assert.match(r.stderr, /checklist-intake/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skills add without a name exits 2', () => {
  const r = run(['add']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /expected a skill name/);
});

test('skills add on a project without a marker exits 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skills-cli-bare-'));
  try {
    const r = run(['add', 'checklist-intake', dir]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no fcore marker/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
