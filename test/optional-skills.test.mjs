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
