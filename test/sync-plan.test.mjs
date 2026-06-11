import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { planBaselineSync } from '../scripts/lib/sync-plan.mjs';

function write(root, rel, text) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

test('planBaselineSync: unchanged kit match, safe update, local conflict', () => {
  const project = mkdtempSync(join(tmpdir(), 'sync-proj-'));
  const oldKit = mkdtempSync(join(tmpdir(), 'sync-old-'));
  const newKit = mkdtempSync(join(tmpdir(), 'sync-new-'));
  try {
    write(oldKit, '.claude/skills/base-check/SKILL.md', 'v1\n');
    write(newKit, '.claude/skills/base-check/SKILL.md', 'v2\n');
    write(project, '.claude/skills/base-check/SKILL.md', 'v1\n');

    const safe = planBaselineSync(project, oldKit, newKit);
    assert.deepEqual(safe.conflicts, []);
    assert.ok(safe.updates.includes('.claude/skills/base-check/SKILL.md'));

    write(project, '.claude/skills/base-check/SKILL.md', 'local-edit\n');
    const conflict = planBaselineSync(project, oldKit, newKit);
    assert.equal(conflict.conflicts.length, 1);
    assert.equal(conflict.updates.length, 0);
  } finally {
    for (const d of [project, oldKit, newKit]) rmSync(d, { recursive: true, force: true });
  }
});
