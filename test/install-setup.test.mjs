// install-setup tests: the permanent baseline skills (notably fcore-check)
// ship verbatim from FleetCore's .claude/skills/, not via the manifest.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { OPTIONAL_SKILLS } from '../scripts/lib/baseline.mjs';

const BASE = process.cwd();

function makeGitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'fcore-install-'));
  const g = (args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  };
  g(['init', '-q']);
  return dir;
}

test('install-setup ships fcore-check verbatim from .claude/skills', () => {
  const target = makeGitRepo();
  try {
    const r = spawnSync(process.execPath,
      [join(BASE, 'scripts/install-setup.mjs'), target], { encoding: 'utf8' });
    assert.equal(r.status, 0, `install-setup failed: ${r.stderr}`);

    const skill = '.claude/skills/fcore-check/SKILL.md';
    const rubric = '.claude/skills/fcore-check/references/rubric.md';
    const lifecycle = '.claude/skills/fcore-check/references/lifecycle.md';
    assert.ok(existsSync(join(target, skill)), 'SKILL.md installed');
    assert.ok(existsSync(join(target, rubric)), 'rubric.md installed');
    assert.ok(existsSync(join(target, lifecycle)), 'lifecycle.md installed');

    // byte-identical to the source of truth under FleetCore's .claude/skills
    assert.equal(readFileSync(join(target, skill), 'utf8'),
      readFileSync(join(BASE, skill), 'utf8'), 'SKILL.md matches FleetCore source');
    assert.equal(readFileSync(join(target, rubric), 'utf8'),
      readFileSync(join(BASE, rubric), 'utf8'), 'rubric.md matches FleetCore source');
    assert.equal(readFileSync(join(target, lifecycle), 'utf8'),
      readFileSync(join(BASE, lifecycle), 'utf8'), 'lifecycle.md matches FleetCore source');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('install-setup ships only the five setup scripts + lib, no FleetCore-dev tooling', () => {
  const target = makeGitRepo();
  try {
    const r = spawnSync(process.execPath,
      [join(BASE, 'scripts/install-setup.mjs'), target], { encoding: 'utf8' });
    assert.equal(r.status, 0, `install-setup failed: ${r.stderr}`);

    const base = '.claude/fcore-onboard/scripts';
    for (const f of ['inventory-extract.mjs', 'apply.mjs', 'check.mjs', 'report.mjs', 'audit.mjs',
      'lib/extract.mjs', 'lib/manifest.mjs', 'lib/audit/checks.mjs', 'lib/audit/util.mjs', 'lib/template.mjs']) {
      assert.ok(existsSync(join(target, base, f)), `${f} must ship`);
    }
    // FleetCore-dev tooling depends on FleetCore-side test/ and spec/ and must NOT ship.
    for (const f of ['build-starter.mjs', 'build-fixture.mjs', 'validate-assert.mjs',
      'rule-check-map.mjs', 'docs-consistency.mjs', 'install-setup.mjs']) {
      assert.ok(!existsSync(join(target, base, f)), `${f} must NOT ship`);
    }
    // The two FleetCore-side-only skills stay home.
    assert.ok(!existsSync(join(target, '.claude/skills/fcore-onboard')), 'fcore-onboard must NOT ship');
    assert.ok(!existsSync(join(target, '.claude/skills/validate-setup')), 'validate-setup must NOT ship');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('install-setup stages optional lifecycle skills (not live), keeps discovery/generation FleetCore-only', () => {
  const target = makeGitRepo();
  try {
    const r = spawnSync(process.execPath,
      [join(BASE, 'scripts/install-setup.mjs'), target], { encoding: 'utf8' });
    assert.equal(r.status, 0, `install-setup failed: ${r.stderr}`);

    // Optional skills (lifecycle + UI-verification) are NOT installed to
    // their live path by a plain setup (R-55: opt-in). They ARE staged in
    // the setup window so fcore-apply can copy any the user selects; staged
    // copies match the FleetCore source at each entry's own `src` (which
    // differs from `dst` for the UI-verification skills — templates-sourced,
    // not dual-role in .claude/skills/).
    for (const { name, src } of OPTIONAL_SKILLS) {
      assert.ok(!existsSync(join(target, `.claude/skills/${name}`)),
        `${name} must NOT be installed live by a plain setup`);
      const staged = `.claude/fcore-onboard/optional-skills/${name}/SKILL.md`;
      assert.ok(existsSync(join(target, staged)), `${name} staged in setup window`);
      assert.equal(readFileSync(join(target, staged), 'utf8'),
        readFileSync(join(BASE, `${src}/SKILL.md`), 'utf8'),
        `${name} staged copy matches FleetCore source at ${src}`);
    }
    // Discovery/generation meta-skills run FROM the FleetCore clone and stay home.
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
    assert.ok(existsSync(join(target, '.claude/fcore-onboard/scripts/lib/orchestration/schemas.mjs')),
      'scripts/lib/orchestration rides along');
    assert.ok(existsSync(join(target, '.claude/fcore-onboard/templates/orchestration/template-registry.json')),
      'templates/orchestration rides along');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('install-setup warns on pre-existing baseline paths, then still copies', () => {
  const target = makeGitRepo();
  try {
    mkdirSync(join(target, '.claude/skills/docs-manager'), { recursive: true });
    writeFileSync(join(target, '.claude/skills/docs-manager/SKILL.md'), 'project-owned content\n');

    const r = spawnSync(process.execPath,
      [join(BASE, 'scripts/install-setup.mjs'), target], { encoding: 'utf8' });
    assert.equal(r.status, 0, `install-setup failed: ${r.stderr}`);
    assert.match(r.stderr, /overwriting existing \.claude\/skills\/docs/, 'warning names the colliding path');

    // The copy still proceeds — baseline wins (setup is branch-reversible).
    assert.equal(readFileSync(join(target, '.claude/skills/docs-manager/SKILL.md'), 'utf8'),
      readFileSync(join(BASE, '.claude/skills/docs-manager/SKILL.md'), 'utf8'), 'SKILL.md matches FleetCore source');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('install-setup refuses target == fcore checkout', () => {
  const r = spawnSync(process.execPath,
    [join(BASE, 'scripts/install-setup.mjs'), BASE], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'must exit non-zero');
  assert.match(r.stderr, /overlaps the FleetCore checkout/);
  assert.equal(r.stdout.indexOf('installed:'), -1, 'nothing copied');
});

test('install-setup refuses target nested inside the fcore checkout', () => {
  const inside = join(BASE, 'scripts'); // exists, inside base — guard fires before any write
  const r = spawnSync(process.execPath,
    [join(BASE, 'scripts/install-setup.mjs'), inside], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'must exit non-zero');
  assert.match(r.stderr, /overlaps the FleetCore checkout/);
  assert.ok(!existsSync(join(inside, '.claude')), 'nothing written inside base');
});

test('install-setup refuses fcore checkout nested inside the target', () => {
  const parent = dirname(BASE); // always contains the fcore checkout
  const r = spawnSync(process.execPath,
    [join(BASE, 'scripts/install-setup.mjs'), parent], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'must exit non-zero');
  assert.match(r.stderr, /overlaps the FleetCore checkout/);
  assert.equal(r.stdout.indexOf('installed:'), -1, 'nothing copied');
});
