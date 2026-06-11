// install-setup tests: the permanent baseline skills (notably base-check)
// ship verbatim from Agent Base's .claude/skills/, not via the manifest.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const BASE = process.cwd();

function makeGitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'aikit-install-'));
  const g = (args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  };
  g(['init', '-q']);
  return dir;
}

test('install-setup ships base-check verbatim from .claude/skills', () => {
  const target = makeGitRepo();
  try {
    const r = spawnSync(process.execPath,
      [join(BASE, 'scripts/install-setup.mjs'), target], { encoding: 'utf8' });
    assert.equal(r.status, 0, `install-setup failed: ${r.stderr}`);

    const skill = '.claude/skills/base-check/SKILL.md';
    const rubric = '.claude/skills/base-check/references/rubric.md';
    assert.ok(existsSync(join(target, skill)), 'SKILL.md installed');
    assert.ok(existsSync(join(target, rubric)), 'rubric.md installed');

    // byte-identical to the source of truth under Agent Base's .claude/skills
    assert.equal(readFileSync(join(target, skill), 'utf8'),
      readFileSync(join(BASE, skill), 'utf8'), 'SKILL.md matches Agent Base source');
    assert.equal(readFileSync(join(target, rubric), 'utf8'),
      readFileSync(join(BASE, rubric), 'utf8'), 'rubric.md matches Agent Base source');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('install-setup ships only the five setup scripts + lib, no Agent Base-dev tooling', () => {
  const target = makeGitRepo();
  try {
    const r = spawnSync(process.execPath,
      [join(BASE, 'scripts/install-setup.mjs'), target], { encoding: 'utf8' });
    assert.equal(r.status, 0, `install-setup failed: ${r.stderr}`);

    const base = '.claude/agent-base-setup/scripts';
    for (const f of ['inventory-extract.mjs', 'apply.mjs', 'check.mjs', 'report.mjs', 'audit.mjs',
      'lib/extract.mjs', 'lib/manifest.mjs', 'lib/audit/checks.mjs', 'lib/audit/util.mjs', 'lib/template.mjs']) {
      assert.ok(existsSync(join(target, base, f)), `${f} must ship`);
    }
    // Agent Base-dev tooling depends on Agent Base-side test/ and spec/ and must NOT ship.
    for (const f of ['build-starter.mjs', 'build-fixture.mjs', 'validate-assert.mjs',
      'rule-check-map.mjs', 'docs-consistency.mjs', 'install-setup.mjs']) {
      assert.ok(!existsSync(join(target, base, f)), `${f} must NOT ship`);
    }
    // The two Agent Base-side-only skills stay home.
    assert.ok(!existsSync(join(target, '.claude/skills/base-setup')), 'base-setup must NOT ship');
    assert.ok(!existsSync(join(target, '.claude/skills/validate-setup')), 'validate-setup must NOT ship');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('install-setup ships orchestration lifecycle skills, keeps discovery/generation Agent Base-only', () => {
  const target = makeGitRepo();
  try {
    const r = spawnSync(process.execPath,
      [join(BASE, 'scripts/install-setup.mjs'), target], { encoding: 'utf8' });
    assert.equal(r.status, 0, `install-setup failed: ${r.stderr}`);

    // Lifecycle skills ship verbatim (invoked in the target's life post-generation).
    for (const id of ['retro', 'log-report', 'eval-runner', 'tracker-sync']) {
      const skill = `.claude/skills/${id}/SKILL.md`;
      assert.ok(existsSync(join(target, skill)), `${id} SKILL.md installed`);
      assert.equal(readFileSync(join(target, skill), 'utf8'),
        readFileSync(join(BASE, skill), 'utf8'), `${id} matches Agent Base source`);
    }
    // Discovery/generation meta-skills run FROM the Agent Base clone and stay home.
    for (const id of ['structure-detector', 'dependency-mapper', 'convention-detector',
      'interview-guide', 'blueprint-generator', 'handoff-validator',
      'agent-instantiator', 'skill-instantiator', 'drift-checker']) {
      assert.ok(!existsSync(join(target, `.claude/skills/${id}`)), `${id} must NOT ship`);
    }
    // Same for the orchestration meta-agents.
    for (const a of ['repo-analyst', 'requirements-interviewer', 'plan-synthesizer',
      'scaffolder', 'evaluator']) {
      assert.ok(!existsSync(join(target, `.claude/agents/${a}.md`)), `${a} must NOT ship`);
    }
    // Orchestration engine + templates ride along with the wholesale copies.
    assert.ok(existsSync(join(target, '.claude/agent-base-setup/scripts/lib/orchestration/schemas.mjs')),
      'scripts/lib/orchestration rides along');
    assert.ok(existsSync(join(target, '.claude/agent-base-setup/templates/orchestration/template-registry.json')),
      'templates/orchestration rides along');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
