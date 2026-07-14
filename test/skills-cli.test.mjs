// skills-cli tests: `fcore skills list|add|remove` manage the opt-in
// optional skills (R-55: lifecycle + UI-verification), copying from this
// checkout and tracking the selection in the project marker's
// `optionalSkills`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { buildMarker, writeMarker, readMarker } from '../scripts/lib/marker.mjs';
import { OPTIONAL_NAMES } from '../scripts/lib/baseline.mjs';

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
    for (const name of OPTIONAL_NAMES) {
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

test('skills add of a templates-sourced skill (src !== dst) installs at the live dst path', () => {
  const dir = setUpProject();
  try {
    const r = run(['add', 'ui-verify-web', dir]);
    assert.equal(r.status, 0, r.stderr);
    const dst = join(dir, '.claude/skills/ui-verify-web/SKILL.md');
    assert.ok(existsSync(dst), 'skill copied to live dst');
    assert.equal(readFileSync(dst, 'utf8'),
      readFileSync(join(import.meta.dirname, '..', 'templates/optional-skills/ui-verify-web/SKILL.md'), 'utf8'),
      'copy matches the templates/ source, not a .claude/skills/ dual-role source');
    assert.deepEqual(readMarker(dir).optionalSkills, ['ui-verify-web']);

    const rem = run(['remove', 'ui-verify-web', dir]);
    assert.equal(rem.status, 0, rem.stderr);
    assert.ok(!existsSync(join(dir, '.claude/skills/ui-verify-web')), 'skill dir removed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skills add installs the web-UI generation pair (vendored LICENSE rides along)', () => {
  const dir = setUpProject();
  try {
    for (const name of ['frontend-design', 'app-ui-craft']) {
      const r = run(['add', name, dir]);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(existsSync(join(dir, `.claude/skills/${name}/SKILL.md`)), `${name} copied`);
    }
    assert.ok(existsSync(join(dir, '.claude/skills/frontend-design/LICENSE.txt')),
      'vendored license copied with frontend-design');
    assert.deepEqual(readMarker(dir).optionalSkills, ['app-ui-craft', 'frontend-design']);
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
