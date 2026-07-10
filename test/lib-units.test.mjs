import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateShape, isAllowedTarget } from '../scripts/lib/manifest.mjs';
import { parseFrontmatter, stripFences } from '../scripts/lib/audit/util.mjs';

// ── validateShape ───────────────────────────────────────────────────────────

test('validateShape: canonical manifest exercising every op validates clean', () => {
  const manifest = {
    schemaVersion: 1,
    entries: [
      { node: 'n0001', op: 'move', target: 'AGENTS.md', slot: 'conventions' },
      { node: 'n0002', op: 'split', ranges: [
        { lines: [1, 4], target: 'AGENTS.md' },
        { lines: [5, 9], op: 'drop', reason: 'stale tooling notes' },
      ] },
      { file: 'KEEP.md', op: 'keep-file' },
      { node: 'n0003', op: 'drop', reason: 'duplicates AGENTS.md' },
      { node: 'n0004', op: 'merge', literal: 'merged text', target: 'CLAUDE.md' },
      { node: 'n0005', op: 'supersede', catalogSkill: 'docs-manager' },
      { file: 'NOTES.txt', op: 'out-of-scope', reason: 'human-only notes' },
    ],
    jsonMerges: [{ file: '.vscode/settings.json', base: 'templates/settings/vscode.json' }],
    installs: [
      { file: '.claude/settings.json', template: 'templates/settings/claude.json' },
      { file: '.claude/fcore.json', literal: '{}' },
    ],
  };
  assert.deepEqual(validateShape(manifest), []);
});

test('validateShape: top-level shape errors', () => {
  assert.deepEqual(validateShape({ schemaVersion: 2, entries: [] }),
    ['schemaVersion must be 1 (got 2)']);
  assert.deepEqual(validateShape({ schemaVersion: 1, entries: 'nope' }),
    ['entries must be an array']);
  assert.deepEqual(validateShape({}),
    ['schemaVersion must be 1 (got undefined)', 'entries must be an array']);
});

test('validateShape: path-bearing fields reject traversal and absolute paths', () => {
  assert.deepEqual(
    validateShape({ schemaVersion: 1, entries: [
      { node: 'n1', op: 'move', target: '.claude/../../etc/passwd' },
      { node: 'n2', op: 'merge', literal: '../outside.md', target: 'AGENTS.md' },
    ] }),
    [
      'entries[0]: target must be a relative path without ".." (got ".claude/../../etc/passwd")',
      'entries[1]: literal must be a relative path without ".." (got "../outside.md")',
    ]);
  assert.deepEqual(
    validateShape({ schemaVersion: 1, entries: [], installs: [
      { file: '/etc/passwd', literal: 'x' },
    ] }),
    ['installs[0]: file must be a relative path without ".." (got "/etc/passwd")']);
});

test('isAllowedTarget: rejects traversal even when the pattern would match', () => {
  assert.equal(isAllowedTarget('.claude/../../etc/foo'), false);
  assert.equal(isAllowedTarget('/AGENTS.md'), false);
  assert.equal(isAllowedTarget('.claude\\settings.json'), false);
  assert.equal(isAllowedTarget('.claude/settings.json'), true);
});

test('validateShape: unknown op is rejected', () => {
  assert.deepEqual(
    validateShape({ schemaVersion: 1, entries: [{ node: 'A#1', op: 'rename' }] }),
    ['entries[0]: unknown op "rename"']);
});

test('validateShape: move requires node and target', () => {
  assert.deepEqual(validateShape({ schemaVersion: 1, entries: [{ op: 'move' }] }), [
    'entries[0]: op "move" requires "node"',
    'entries[0]: move requires "target"',
  ]);
});

test('validateShape: split requires non-empty ranges', () => {
  const msg = 'entries[0]: split requires non-empty "ranges"';
  assert.deepEqual(
    validateShape({ schemaVersion: 1, entries: [{ node: 'n1', op: 'split', ranges: [] }] }),
    [msg]);
  assert.deepEqual(
    validateShape({ schemaVersion: 1, entries: [{ node: 'n1', op: 'split' }] }),
    [msg]);
});

test('validateShape: node ids must be bare generated tokens (no traversal)', () => {
  const idMsg = (i, id) => `entries[${i}]: node id must match [A-Za-z0-9_-]+ (got "${id}")`;
  assert.deepEqual(
    validateShape({ schemaVersion: 1, entries: [
      { node: '../../secret', op: 'drop', reason: 'x' },
      { node: 'nodes/n1', op: 'drop', reason: 'x' },
      { node: 'OLD.md#1', op: 'drop', reason: 'x' },
      { node: 'n0001', op: 'drop', reason: 'x' }, // valid
    ] }),
    [idMsg(0, '../../secret'), idMsg(1, 'nodes/n1'), idMsg(2, 'OLD.md#1')]);
});

test('validateShape: catalogSkill must be a bare skill name', () => {
  const msg = (i, s) => `entries[${i}]: catalogSkill must be a bare skill name (got "${s}")`;
  assert.deepEqual(
    validateShape({ schemaVersion: 1, entries: [
      { node: 'n1', op: 'supersede', catalogSkill: '../escape' },
      { node: 'n2', op: 'supersede', catalogSkill: 'a/b' },
      { node: 'n3', op: 'supersede', catalogSkill: 'a\\b' },
      { node: 'n4', op: 'supersede', catalogSkill: '..' },
      { node: 'n5', op: 'supersede', catalogSkill: 'docs-manager' }, // valid
    ] }),
    [msg(0, '../escape'), msg(1, 'a/b'), msg(2, 'a\\b'), msg(3, '..')]);
});

test('validateShape: split range line bounds, targets, and drop reasons', () => {
  const manifest = {
    schemaVersion: 1,
    entries: [{ node: 'n1', op: 'split', ranges: [
      { lines: [0, 2], target: 'AGENTS.md' },   // 1-based: start < 1
      { lines: [5, 2], target: 'AGENTS.md' },   // end < start
      { lines: [1.5, 3], target: 'AGENTS.md' }, // non-integer
      { lines: [1, 2] },                        // no target, not a drop
      { lines: [1, 2], op: 'drop' },            // drop without reason
      { lines: [3, 4], target: 'AGENTS.md' },   // valid
    ] }],
  };
  const lineMsg = (j) => `entries[0].ranges[${j}]: lines must be [start, end], 1-based, start <= end`;
  assert.deepEqual(validateShape(manifest), [
    lineMsg(0),
    lineMsg(1),
    lineMsg(2),
    'entries[0].ranges[3]: range requires "target" (or op:"drop" with reason)',
    'entries[0].ranges[4]: drop range requires "reason"',
  ]);
});

test('validateShape: drop, merge, and supersede field requirements', () => {
  const manifest = {
    schemaVersion: 1,
    entries: [
      { node: 'n1', op: 'drop' },
      { node: 'n2', op: 'merge' },
      { node: 'n3', op: 'supersede' },
    ],
  };
  assert.deepEqual(validateShape(manifest), [
    'entries[0]: drop requires "reason"',
    'entries[1]: merge requires "literal"',
    'entries[1]: merge requires "target"',
    'entries[2]: supersede requires "catalogSkill"',
  ]);
});

test('validateShape: file ops require file; out-of-scope requires reason', () => {
  const manifest = {
    schemaVersion: 1,
    entries: [
      { op: 'keep-file' },
      { file: 'NOTES.txt', op: 'out-of-scope' },
      { op: 'out-of-scope' },
    ],
  };
  assert.deepEqual(validateShape(manifest), [
    'entries[0]: op "keep-file" requires "file"',
    'entries[1]: out-of-scope requires "reason"',
    'entries[2]: op "out-of-scope" requires "file"',
    'entries[2]: out-of-scope requires "reason"',
  ]);
});

test('validateShape: jsonMerges and installs shapes', () => {
  const manifest = {
    schemaVersion: 1,
    entries: [],
    jsonMerges: [{}],
    installs: [{}, { file: 'a.json', template: 't.json', literal: '{}' }],
  };
  assert.deepEqual(validateShape(manifest), [
    'jsonMerges[0]: requires "file"',
    'jsonMerges[0]: requires "base" (FleetCore template path)',
    'installs[0]: requires "file"',
    'installs[0]: requires "template" or "literal"',
    'installs[1]: "template" and "literal" are mutually exclusive',
  ]);
});

test('isAllowedTarget: FleetCore-canonical and AI-surface targets pass, code paths do not', () => {
  // FleetCore-canonical target patterns
  assert.equal(isAllowedTarget('AGENTS.md'), true);
  assert.equal(isAllowedTarget('packages/api/AGENTS.md'), true); // nested compat
  assert.equal(isAllowedTarget('.claude/skills/docs-manager/SKILL.md'), true);
  assert.equal(isAllowedTarget('docs/ai/overview.md'), true);
  // recognized AI-config surfaces (via classifySurface)
  assert.equal(isAllowedTarget('.cursorrules'), true);
  assert.equal(isAllowedTarget('GEMINI.md'), true);
  // out of scope unless inventoried
  assert.equal(isAllowedTarget('src/evil.js'), false);
  assert.equal(isAllowedTarget('README.md'), false);
  assert.equal(isAllowedTarget('README.md', new Set(['README.md'])), true);
});

// ── parseFrontmatter ────────────────────────────────────────────────────────

test('parseFrontmatter: valid block with quoting, bare keys, and nesting rules', () => {
  const text = [
    '---',
    'name: demo',
    'description: "A quoted value"',
    "single: 'q'",
    'bare:',
    '  nested: skipped',
    'no-colon-line',
    '---',
    'First body line',
    '',
  ].join('\n');
  const { frontmatter, body, hasFrontmatter } = parseFrontmatter(text);
  assert.equal(hasFrontmatter, true);
  assert.deepEqual(frontmatter, {
    name: 'demo',
    description: 'A quoted value',
    single: 'q',
    bare: '',
  });
  assert.equal(body, 'First body line\n');
});

test('parseFrontmatter: text without frontmatter is returned untouched', () => {
  const text = '# Title\n\nname: not frontmatter\n';
  assert.deepEqual(parseFrontmatter(text), { frontmatter: {}, body: text, hasFrontmatter: false });
  const indented = ' ---\nname: x\n---\n'; // must start at byte 0
  assert.deepEqual(parseFrontmatter(indented),
    { frontmatter: {}, body: indented, hasFrontmatter: false });
});

test('parseFrontmatter: unterminated block is treated as no frontmatter', () => {
  const text = '---\nname: x\nbody keeps going with no closing fence\n';
  assert.deepEqual(parseFrontmatter(text), { frontmatter: {}, body: text, hasFrontmatter: false });
});

test('parseFrontmatter: empty block parses to an empty map', () => {
  const { frontmatter, body, hasFrontmatter } = parseFrontmatter('---\n---\nbody\n');
  assert.equal(hasFrontmatter, true);
  assert.deepEqual(frontmatter, {});
  assert.equal(body, 'body\n');
});

// ── stripFences ─────────────────────────────────────────────────────────────

test('stripFences: blanks fence lines and fenced content, preserving line count', () => {
  const input = ['# real heading', '```js', '# fake heading', 'code();', '```', 'after'].join('\n');
  const expected = ['# real heading', '', '', '', '', 'after'].join('\n');
  const out = stripFences(input);
  assert.equal(out, expected);
  assert.equal(out.split('\n').length, input.split('\n').length);
});

test('stripFences: tilde fences work and an unclosed fence blanks to EOF', () => {
  const input = ['before', '~~~', 'hidden', 'still hidden'].join('\n');
  assert.equal(stripFences(input), ['before', '', '', ''].join('\n'));
});

test('stripFences: fences may be indented up to three spaces, not four', () => {
  const input = [
    '    ```', // 4 spaces: indented code, NOT a fence — kept verbatim
    'kept',
    '   ```',  // 3 spaces: opens a fence
    'hidden',
    '   ```',  // closes it
    'tail',
  ].join('\n');
  assert.equal(stripFences(input), ['    ```', 'kept', '', '', '', 'tail'].join('\n'));
});

test('stripFences: text without fences is unchanged', () => {
  const text = '# Title\n\nplain paragraph\n- list item\n';
  assert.equal(stripFences(text), text);
});
