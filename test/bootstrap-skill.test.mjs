import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { writeBootstrapSkill, BOOTSTRAP_SKILL_DIR } from '../bin/lib/bootstrap-skill.mjs';
import { findClaude, launchClaude } from '../bin/lib/launch.mjs';

test('writeBootstrapSkill drops a self-deleting launcher pointing at the staged skill', () => {
  const target = mkdtempSync(join(tmpdir(), 'ab-target-'));
  const file = writeBootstrapSkill({
    command: 'setup',
    checkoutPath: '/stage/v1.2.3',
    targetPath: target,
  });

  assert.equal(file, join(target, BOOTSTRAP_SKILL_DIR, 'SKILL.md'));
  assert.ok(existsSync(file));
  const body = readFileSync(file, 'utf8');
  assert.match(body, /^name: agent-base-bootstrap$/m);
  assert.match(body, /Delete this skill's directory NOW/);
  assert.match(body, /\/stage\/v1\.2\.3\/\.claude\/skills\/base-setup\/SKILL\.md/);
  assert.match(body, /re-run their `npx … setup` command/);
  assert.match(body, /never `git pull`/); // staged-release provenance, not dev
});

test('writeBootstrapSkill carries the command through (refresh, dev clone)', () => {
  const target = mkdtempSync(join(tmpdir(), 'ab-target-'));
  const file = writeBootstrapSkill({
    command: 'refresh',
    checkoutPath: '/clone',
    targetPath: target,
    dev: true,
  });
  const body = readFileSync(file, 'utf8');
  assert.match(body, /base-refresh\/SKILL\.md/);
  assert.match(body, /pull --ff-only/); // dev provenance line
});

test('findClaude returns null on win32 and for a missing binary', () => {
  assert.equal(findClaude({ platform: 'win32' }), null);
  assert.equal(findClaude({ cmd: 'definitely-not-a-real-cli-7f3a' }), null);
});

test('launchClaude passes through the exit code; null when the spawn fails', () => {
  // node --version stands in for a clean interactive session (exit 0)
  assert.equal(launchClaude({ cmd: process.execPath, prompt: '--version' }), 0);
  assert.equal(launchClaude({ cmd: 'definitely-not-a-real-cli-7f3a', prompt: 'x' }), null);
});
