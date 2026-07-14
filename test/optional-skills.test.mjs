// Self-audit (scripts/audit.mjs) only walks .claude/skills/, so templates-
// sourced optional skills (src !== dst, e.g. ui-verify-web) never get an
// R-17..R-26 house-style pass here in FleetCore's own checkout — they're
// audited on the project side after install instead. This test compensates
// with a direct house-style check against every OPTIONAL_SKILLS entry's src.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { OPTIONAL_SKILLS } from '../scripts/lib/baseline.mjs';

const BASE = process.cwd();
const STACK_SKILLS_PREFIX = 'templates/stack-skills/';
const catalog = JSON.parse(readFileSync(join(BASE, 'templates', 'stack-skills', 'catalog.json'), 'utf8'));
const registry = JSON.parse(
  readFileSync(join(BASE, 'templates', 'orchestration', 'template-registry.json'), 'utf8'),
);

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, 'SKILL.md must start with --- frontmatter ---');
  const name = m[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = m[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return { name, description };
}

for (const { name, src } of OPTIONAL_SKILLS) {
  test(`optional skill "${name}": house style at its own src (${src})`, () => {
    const dir = join(BASE, src);
    const skillPath = join(dir, 'SKILL.md');
    assert.ok(existsSync(skillPath), `${skillPath} must exist`);

    const text = readFileSync(skillPath, 'utf8');
    const { name: fmName, description } = parseFrontmatter(text);

    assert.equal(fmName, name, 'R-17: frontmatter name matches folder'); // folder === last src segment === name for every entry
    assert.ok(description, 'R-19/21: description present');
    assert.ok(description.length <= 1024, `R-19: description ${description.length} chars, must be <= 1024`);
    assert.match(description, /\bwhen(ever)?\b/i, 'R-21: description states when to use it');

    const lineCount = text.split('\n').length;
    assert.ok(lineCount <= 200, `R-20: SKILL.md is ${lineCount} lines, must be <= 200`);

    assert.ok(!existsSync(join(dir, 'README.md')), 'R-48: no per-skill README');
  });
}

// ── stack-skills catalog ⇄ OPTIONAL_SKILLS consistency (R-55 stack skills) ──
// Every catalog.json entry needs a matching OPTIONAL_SKILLS entry (so
// fcore-fleet-config/fcore skills add can install it) and vice versa —
// neither side may drift from the other, or an installed skill would have
// no matching evidence rule (or a matchable skill would have nothing to
// install).

test('stack-skills: catalog keys and OPTIONAL_SKILLS stack-tier entries cover each other exactly', () => {
  const stackTierNames = OPTIONAL_SKILLS
    .filter((s) => s.src.startsWith(STACK_SKILLS_PREFIX))
    .map((s) => s.name);
  assert.deepEqual(stackTierNames.sort(), Object.keys(catalog.skills).sort());
});

for (const [name, meta] of Object.entries(catalog.skills)) {
  test(`stack-skills catalog entry "${name}": provenance and evidence fields are well-formed`, () => {
    assert.ok(Array.isArray(meta.stackEvidence) && meta.stackEvidence.length > 0,
      `${name} must declare at least one stackEvidence keyword`);
    assert.ok(typeof meta.origin === 'string' && meta.origin.length > 0, `${name} must declare origin`);
    assert.ok(typeof meta.upstream === 'string' && meta.upstream.length > 0, `${name} must declare upstream`);
    assert.ok(typeof meta.license === 'string' && meta.license.length > 0, `${name} must declare license`);

    const entry = OPTIONAL_SKILLS.find((s) => s.name === name);
    assert.ok(entry, `${name} must have a matching OPTIONAL_SKILLS entry`);
    assert.equal(entry.src, `${STACK_SKILLS_PREFIX}${name}`);
    assert.ok(existsSync(join(BASE, entry.src)), `${entry.src} must exist`);

    assert.ok(!registry.skills[name], `${name} collides with a templated pairedSkills id in template-registry.json`);
    assert.ok(!registry.agents[name], `${name} collides with a generated agent templateId in template-registry.json`);
  });
}
