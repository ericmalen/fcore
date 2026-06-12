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

test('planBaselineSync: unchanged Agent Base match, safe update, local conflict', () => {
  const project = mkdtempSync(join(tmpdir(), 'sync-proj-'));
  const oldBase = mkdtempSync(join(tmpdir(), 'sync-old-'));
  const newBase = mkdtempSync(join(tmpdir(), 'sync-new-'));
  try {
    write(oldBase, '.claude/skills/base-check/SKILL.md', 'v1\n');
    write(newBase, '.claude/skills/base-check/SKILL.md', 'v2\n');
    write(project, '.claude/skills/base-check/SKILL.md', 'v1\n');

    const safe = planBaselineSync(project, oldBase, newBase);
    assert.deepEqual(safe.conflicts, []);
    assert.ok(safe.updates.includes('.claude/skills/base-check/SKILL.md'));

    write(project, '.claude/skills/base-check/SKILL.md', 'local-edit\n');
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
    write(project, '.claude/skills/docs/SKILL.md', 'real file\n');
    write(outside, 'secret/leak.md', 'out-of-tree content\n');
    // Symlinked dir and symlinked file pointing out of the baseline tree.
    symlinkSync(join(outside, 'secret'), join(project, '.claude/skills/docs/linked-dir'));
    symlinkSync(join(outside, 'secret/leak.md'), join(project, '.claude/skills/docs/linked-file.md'));

    const hashes = baselineFileHashes(project); // must not throw or hash through links
    assert.ok(hashes.has('.claude/skills/docs/SKILL.md'), 'real file hashed');
    for (const path of hashes.keys()) {
      assert.ok(!path.includes('linked-dir') && !path.includes('linked-file'),
        `symlink leaked into hashes: ${path}`);
    }
  } finally {
    for (const d of [project, outside]) rmSync(d, { recursive: true, force: true });
  }
});
