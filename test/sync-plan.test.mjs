import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { planBaselineSync, baselineFileHashes } from '../scripts/lib/sync-plan.mjs';

function write(root, rel, text) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

test('planBaselineSync: unchanged FleetCore match, safe update, local conflict', () => {
  const project = mkdtempSync(join(tmpdir(), 'sync-proj-'));
  const oldBase = mkdtempSync(join(tmpdir(), 'sync-old-'));
  const newBase = mkdtempSync(join(tmpdir(), 'sync-new-'));
  try {
    write(oldBase, '.claude/skills/fcore-check/SKILL.md', 'v1\n');
    write(newBase, '.claude/skills/fcore-check/SKILL.md', 'v2\n');
    write(project, '.claude/skills/fcore-check/SKILL.md', 'v1\n');

    const safe = planBaselineSync(project, oldBase, newBase);
    assert.deepEqual(safe.conflicts, []);
    assert.ok(safe.updates.includes('.claude/skills/fcore-check/SKILL.md'));

    write(project, '.claude/skills/fcore-check/SKILL.md', 'local-edit\n');
    const conflict = planBaselineSync(project, oldBase, newBase);
    assert.equal(conflict.conflicts.length, 1);
    assert.equal(conflict.updates.length, 0);
  } finally {
    for (const d of [project, oldBase, newBase]) rmSync(d, { recursive: true, force: true });
  }
});

test('baselineFileHashes: symlinks under a baseline dir are skipped, never followed', () => {
  const project = mkdtempSync(join(tmpdir(), 'sync-link-proj-'));
  const outside = mkdtempSync(join(tmpdir(), 'sync-link-out-'));
  try {
    write(project, '.claude/skills/docs-manager/SKILL.md', 'real file\n');
    write(outside, 'secret/leak.md', 'out-of-tree content\n');
    // Symlinked dir and symlinked file pointing out of the baseline tree.
    symlinkSync(join(outside, 'secret'), join(project, '.claude/skills/docs-manager/linked-dir'));
    symlinkSync(join(outside, 'secret/leak.md'), join(project, '.claude/skills/docs-manager/linked-file.md'));

    const hashes = baselineFileHashes(project); // must not throw or hash through links
    assert.ok(hashes.has('.claude/skills/docs-manager/SKILL.md'), 'real file hashed');
    for (const path of hashes.keys()) {
      assert.ok(!path.includes('linked-dir') && !path.includes('linked-file'),
        `symlink leaked into hashes: ${path}`);
    }
  } finally {
    for (const d of [project, outside]) rmSync(d, { recursive: true, force: true });
  }
});

test('planBaselineSync: type mismatches and symlinked paths are conflicts, not updates', () => {
  const project = mkdtempSync(join(tmpdir(), 'sync-type-proj-'));
  const base = mkdtempSync(join(tmpdir(), 'sync-type-base-'));
  const outside = mkdtempSync(join(tmpdir(), 'sync-type-out-'));
  try {
    write(base, '.claude/skills/docs-manager/SKILL.md', 'shipped\n');
    write(base, '.claude/skills/checklist-intake/SKILL.md', 'shipped\n');
    write(base, '.claude/agents/docs-auditor.md', 'shipped\n');
    // File where the baseline needs a directory.
    write(project, '.claude/skills/docs-manager', 'i am a file\n');
    // Directory where the baseline ships a file.
    mkdirSync(join(project, '.claude/agents/docs-auditor.md'), { recursive: true });
    // Symlink in the path of a missing file. checklist-intake is an optional skill (R-55),
    // so it only participates when the project selected it.
    mkdirSync(join(project, '.claude/skills'), { recursive: true });
    symlinkSync(outside, join(project, '.claude/skills/checklist-intake'));

    const plan = planBaselineSync(project, base, base, { optionalSkills: ['checklist-intake'] });
    assert.deepEqual(plan.updates, []);
    const reasons = new Map(plan.conflicts.map((c) => [c.path, c.reason]));
    assert.match(reasons.get('.claude/skills/docs-manager/SKILL.md'), /file where the baseline needs a directory/);
    assert.match(reasons.get('.claude/agents/docs-auditor.md'), /directory where the baseline ships a file/);
    assert.match(reasons.get('.claude/skills/checklist-intake/SKILL.md'), /symlink/);
  } finally {
    for (const d of [project, base, outside]) rmSync(d, { recursive: true, force: true });
  }
});

test('planBaselineSync: files dropped from the new baseline land in removed, untouched', () => {
  const project = mkdtempSync(join(tmpdir(), 'sync-rm-proj-'));
  const oldBase = mkdtempSync(join(tmpdir(), 'sync-rm-old-'));
  const newBase = mkdtempSync(join(tmpdir(), 'sync-rm-new-'));
  try {
    write(oldBase, '.claude/skills/docs-manager/SKILL.md', 'v1\n');
    write(oldBase, '.claude/skills/docs-manager/dropped.md', 'v1\n');
    write(newBase, '.claude/skills/docs-manager/SKILL.md', 'v2\n');
    write(project, '.claude/skills/docs-manager/SKILL.md', 'v1\n');
    write(project, '.claude/skills/docs-manager/dropped.md', 'v1\n');

    const plan = planBaselineSync(project, oldBase, newBase);
    assert.deepEqual(plan.removed, ['.claude/skills/docs-manager/dropped.md']);
    assert.equal(plan.summary.removedCount, 1);
    assert.ok(!plan.updates.includes('.claude/skills/docs-manager/dropped.md'));
    assert.ok(!plan.conflicts.some((c) => c.path === '.claude/skills/docs-manager/dropped.md'));
  } finally {
    for (const d of [project, oldBase, newBase]) rmSync(d, { recursive: true, force: true });
  }
});
