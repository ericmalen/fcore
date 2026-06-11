// F-2 regression: validate-assert reads the setup report from git history
// when base-verify has removed .setup/ before merge. The original F-2 fix
// used `git log -1 -- <path>`, which returns the DELETION commit; the follow-up
// `git show <deletion>:<path>` then fails, leaving the report empty so every
// dropped-but-documented sentinel reads as SILENT-LOSS. The guard is
// --diff-filter=AM (skip the delete, find the report-generation commit). This
// test reproduces that exact post-merge-prep state and asserts no false loss.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { fixtures } from './fixtures/defs.mjs';

const VALIDATE_ASSERT = join(process.cwd(), 'scripts', 'validate-assert.mjs');
const FIXTURE = 'mixed-messy';

function git(dir, ...args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return (r.stdout ?? '').trim();
}

// Build a repo in the state base-verify leaves behind: the report was
// generated and committed, then .setup/ was git-rm'd in a later commit.
// Sentinels live ONLY in the report's drop section — never in the working
// tree — so the report read is the only thing standing between "accounted"
// and a false SILENT-LOSS.
function repoAfterMergePrep() {
  const dir = mkdtempSync(join(tmpdir(), 'aikit-f2-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');

  // Working tree: AI surfaces with NO sentinels in them.
  writeFileSync(join(dir, 'AGENTS.md'), '# Project\n\nGeneric assembled content.\n');

  // Setup report documenting every sentinel as a reviewed drop.
  mkdirSync(join(dir, '.setup'), { recursive: true });
  const dropBlock = fixtures[FIXTURE].sentinels
    .map((s) => `### node \`${s}\`\n**Reason:** documented drop\n\n\`\`\`\n${s} — dropped with review\n\`\`\`\n`)
    .join('\n');
  writeFileSync(join(dir, '.setup', 'report.md'),
    `# Setup review report\n\n## 1. Dropped content\n\n${dropBlock}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'chore(setup): report + converged gates');

  // base-verify merge prep: remove the setup tooling in its own commit.
  git(dir, 'rm', '-q', '-r', '.setup');
  git(dir, 'commit', '-qm', 'chore(setup): remove setup-time tooling');
  return dir;
}

function runAssert(dir) {
  const r = spawnSync(process.execPath,
    [VALIDATE_ASSERT, '--fixture', FIXTURE, '--dir', dir, '--json'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(r.stdout);
}

test('F-2: report read survives the .setup deletion commit (no false SILENT-LOSS)', () => {
  const dir = repoAfterMergePrep();
  try {
    const res = runAssert(dir);
    // The report was readable from history despite the deletion commit on top.
    assert.equal(res.reportUnreadable, false, 'report should be read from the Add/Modify commit, not the delete');
    // Every sentinel is accounted via the report — none silently lost.
    for (const [s, status] of Object.entries(res.sentinels)) {
      assert.equal(status, 'accounted-in-report', `${s} must be accounted via report, got ${status}`);
    }
    assert.ok(!res.failures.some((f) => f.includes('SILENT LOSS')),
      `no SILENT LOSS failures expected, got: ${res.failures.join(' | ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F-2: genuinely missing report is flagged inconclusive, not reported as silent loss', () => {
  // No .setup/ ever committed → the fallback finds no Add/Modify commit.
  const dir = mkdtempSync(join(tmpdir(), 'aikit-f2-noreport-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'AGENTS.md'), '# Project\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  try {
    const res = runAssert(dir);
    assert.equal(res.reportUnreadable, true, 'absent report must be signalled as unreadable');
    assert.ok(res.failures.some((f) => f.includes('report.md unreadable')),
      'unreadable report must surface as its own distinct failure, not as silent loss');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
