import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripEmptyOptionalSections, instantiate } from '../scripts/lib/template.mjs';

const BASE_ROOT = new URL('..', import.meta.url).pathname;

const TPL = [
  '# Title',
  '',
  '<!-- agent-base:slot:intro -->',
  '',
  '## Overview',
  '<!-- agent-base:optional -->',
  '',
  '<!-- agent-base:slot:overview -->',
  '',
  '## Do Not',
  '',
  '<!-- agent-base:slot:do-not -->',
  '',
].join('\n');

test('empty optional section is removed; mandatory section stays', () => {
  const out = instantiate(TPL, () => undefined); // nothing filled
  assert.ok(!out.includes('## Overview'), 'empty optional Overview should be gone');
  assert.ok(out.includes('## Do Not'), 'mandatory Do Not stays even when empty (R-03)');
  assert.ok(!out.includes('agent-base:optional'), 'optional markers are stripped');
  assert.ok(!out.includes('agent-base:slot'), 'slot markers are stripped');
});

test('filled optional section is kept with its content and no markers', () => {
  const out = instantiate(TPL, (name) => (name === 'overview' ? 'Real overview text.' : undefined));
  assert.ok(out.includes('## Overview'), 'filled optional section stays');
  assert.ok(out.includes('Real overview text.'));
  assert.ok(!out.includes('agent-base:optional'));
});

test('stripEmptyOptionalSections preserves byte content of kept sections', () => {
  const filled = new Set(['overview']);
  const pruned = stripEmptyOptionalSections(TPL, filled);
  assert.ok(pruned.includes('## Overview'));
  assert.ok(pruned.includes('## Do Not'));
  // intro/do-not are mandatory (no optional marker) → never removed
  assert.ok(pruned.includes('<!-- agent-base:slot:intro -->'));
});

test('no optional markers → text is returned unchanged', () => {
  const plain = '# A\n\n## B\n\nbody\n';
  assert.equal(stripEmptyOptionalSections(plain, new Set()), plain);
});

test('starter AGENTS template drops Overview/Architecture, keeps Do Not + More Context footer', () => {
  const tpl = readFileSync(join(BASE_ROOT, 'templates', 'instructions', 'AGENTS.md'), 'utf8');
  const out = instantiate(tpl); // starter: nothing filled
  for (const gone of ['## Overview', '## Architecture']) {
    assert.ok(!out.includes(gone), `${gone} should be removed in starter`);
  }
  assert.ok(out.includes('## Do Not'), 'Do Not stays (R-03)');
  // More Context is non-optional: its footer always points adopters at the
  // installed .claude/ assets, even on a starter repo with no routed content.
  assert.ok(out.includes('## More Context'), 'More Context stays in starter');
  assert.ok(out.includes('.claude/skills/'), 'footer points at installed assets');
  assert.ok(!out.includes('agent-base:'), 'no leftover agent-base markers');
});
