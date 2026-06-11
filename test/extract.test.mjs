import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import {
  splitLinesKeepEnds, detectLineEnding, hasFinalNewline, isBinary,
  parseMarkdownBlocks, stripJsonComments, topLevelJsonKeys,
  classifySurface, sweepFile, extractFile,
} from '../scripts/lib/extract.mjs';
import { runInventory } from '../scripts/inventory-extract.mjs';

const tile = (text) => parseMarkdownBlocks(text).map((b) => b.text).join('');

// ── splitting & metadata ────────────────────────────────────────────────────

test('splitLinesKeepEnds round-trips exactly', () => {
  for (const t of ['', 'a', 'a\n', 'a\nb', 'a\r\nb\r\n', 'a\n\n\nb', '\n', 'x\r\n\r\n']) {
    assert.equal(splitLinesKeepEnds(t).join(''), t);
  }
});

test('line ending detection', () => {
  assert.equal(detectLineEnding('a\nb\n'), 'lf');
  assert.equal(detectLineEnding('a\r\nb\r\n'), 'crlf');
  assert.equal(detectLineEnding('a\nb\r\n'), 'mixed');
  assert.equal(detectLineEnding('abc'), 'none');
  assert.equal(hasFinalNewline('a\n'), true);
  assert.equal(hasFinalNewline('a'), false);
});

test('binary detection', () => {
  assert.equal(isBinary(Buffer.from([0x68, 0x00, 0x69])), true);
  assert.equal(isBinary(Buffer.from('plain text')), false);
});

// ── markdown block model: TILING is the foundational invariant ──────────────

test('tiling: blocks reassemble byte-identically', () => {
  const docs = [
    '# A\nbody\n## B\nmore\n',
    'preamble only, no headings\n',
    '---\nname: x\n---\n# H\nbody\n',
    'no final newline # not a heading',
    '# A\r\ncrlf body\r\n## B\r\nmixed\nendings\r\n',
    '# A\n```\n# not a heading\n```\n## B\nafter fence\n',
    'Title\n=====\nintro\nSection\n-------\nbody\n',
    '',
    '\n\n\n',
    '# only heading\n',
  ];
  for (const d of docs) assert.equal(tile(d), d, JSON.stringify(d.slice(0, 30)));
});

test('fence-aware: # inside code fence is not a heading', () => {
  const doc = '# Real\nintro\n```bash\n# comment not heading\n## also not\n```\n## Next\nend\n';
  const blocks = parseMarkdownBlocks(doc);
  const headings = blocks.filter((b) => b.kind === 'section').map((b) => b.heading);
  assert.deepEqual(headings, ['Real', 'Next']);
  assert.equal(tile(doc), doc);
});

test('tilde fences and unclosed fences', () => {
  const doc = '# A\n~~~\n# hidden\n~~~\n# B\n```\n# trailing unclosed\n';
  const headings = parseMarkdownBlocks(doc).filter((b) => b.kind === 'section').map((b) => b.heading);
  assert.deepEqual(headings, ['A', 'B']);
  assert.equal(tile(doc), doc);
});

test('preamble pseudo-block captured before first heading', () => {
  const doc = 'intro line one\nintro line two\n\n# First\nbody\n';
  const blocks = parseMarkdownBlocks(doc);
  assert.equal(blocks[0].kind, 'preamble');
  assert.equal(blocks[0].text, 'intro line one\nintro line two\n\n');
  assert.equal(blocks[1].heading, 'First');
});

test('frontmatter is its own node', () => {
  const doc = '---\nname: test\ndescription: x\n---\npreamble\n# H1\nbody\n';
  const blocks = parseMarkdownBlocks(doc);
  assert.equal(blocks[0].kind, 'frontmatter');
  assert.equal(blocks[0].text, '---\nname: test\ndescription: x\n---\n');
  assert.equal(blocks[1].kind, 'preamble');
  assert.equal(blocks[2].kind, 'section');
  assert.equal(tile(doc), doc);
});

test('setext headings: = is h1, - is h2; thematic break is not setext', () => {
  const doc = 'Title\n=====\nintro\nSub\n---\nbody\n\n---\n\nafter break\n';
  const blocks = parseMarkdownBlocks(doc);
  const sections = blocks.filter((b) => b.kind === 'section');
  assert.equal(sections[0].heading, 'Title');
  assert.equal(sections[0].level, 1);
  assert.equal(sections[1].heading, 'Sub');
  assert.equal(sections[1].level, 2);
  // the lone --- after a blank line must NOT create a heading
  assert.equal(sections.length, 2);
  assert.equal(tile(doc), doc);
});

test('headingPath records ancestors; h4+ stays inside its block', () => {
  const doc = '# Top\n## Mid\ntext\n#### deep stays here\nmore\n## Mid2\nx\n';
  const blocks = parseMarkdownBlocks(doc).filter((b) => b.kind === 'section');
  assert.deepEqual(blocks.map((b) => b.heading), ['Top', 'Mid', 'Mid2']);
  assert.deepEqual(blocks[1].headingPath, ['Top']);
  assert.ok(blocks[1].text.includes('#### deep stays here'));
});

test('atx heading text strips markers', () => {
  const doc = '##  Spaced Heading  ##\nbody\n';
  const blocks = parseMarkdownBlocks(doc).filter((b) => b.kind === 'section');
  assert.equal(blocks[0].heading, 'Spaced Heading');
});

// ── JSON / JSONC ────────────────────────────────────────────────────────────

test('stripJsonComments handles strings containing slashes', () => {
  const src = '{\n  // comment\n  "url": "https://x/y", /* mid */ "a": 1\n}';
  const parsed = JSON.parse(stripJsonComments(src));
  assert.equal(parsed.url, 'https://x/y');
  assert.equal(parsed.a, 1);
});

test('topLevelJsonKeys on JSONC vscode settings', () => {
  const src = '{\n  // flag\n  "chat.useAgentsMdFile": true,\n  "editor.fontSize": 12\n}';
  assert.deepEqual(topLevelJsonKeys(src), { keys: ['chat.useAgentsMdFile', 'editor.fontSize'], parseError: false });
  assert.equal(topLevelJsonKeys('{ broken').parseError, true);
});

test('json file extracts as single whole-file node with key inventory', () => {
  const { fileMeta, blocks } = extractFile('.vscode/settings.json', '{\n "a": 1,\n "b": 2\n}\n');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'file');
  assert.deepEqual(fileMeta.jsonKeys, ['a', 'b']);
});

// ── surfaces & sweep ────────────────────────────────────────────────────────

test('surface classification', () => {
  assert.equal(classifySurface('AGENTS.md'), 'instructions');
  assert.equal(classifySurface('src/api/CLAUDE.md'), 'instructions');
  assert.equal(classifySurface('.github/copilot-instructions.md'), 'copilot-instructions');
  assert.equal(classifySurface('.github/chatmodes/dev.chatmode.md'), 'github-chatmodes');
  assert.equal(classifySurface('.claude/skills/x/SKILL.md'), 'claude-assets');
  assert.equal(classifySurface('.claude/settings.json'), 'claude-settings');
  assert.equal(classifySurface('.vscode/settings.json'), 'vscode-settings');
  assert.equal(classifySurface('.cursorrules'), 'other-tool');
  assert.equal(classifySurface('.cursor/rules/style.mdc'), 'other-tool');
  assert.equal(classifySurface('GEMINI.md'), 'other-tool');
  assert.equal(classifySurface('src/index.js'), null);
  assert.equal(classifySurface('README.md'), null);
});

test('sweep finds AI-instruction markers with line numbers', () => {
  const hit = sweepFile('README.md', 'Intro.\nWhen using Claude, never commit secrets.\nplain line\n');
  assert.ok(hit);
  assert.equal(hit.hits[0].line, 2);
  assert.equal(hit.hits[0].marker, 'claude');
  assert.equal(sweepFile('README.md', 'nothing relevant here\n'), null);
});

test('sweep catches "you are a" prompt-style instructions', () => {
  const hit = sweepFile('docs/notes.md', 'You are a senior engineer reviewing PRs.\n');
  assert.ok(hit);
});

// ── integration: full run against a temp git repo ───────────────────────────

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'aikit-extract-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  const g = (args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  };
  g(['init', '-q']);
  g(['add', '-A']);
  g(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
  return dir;
}

test('integration: inventory over a small existing project repo', () => {
  const repo = makeRepo({
    'CLAUDE.md': '# Project\nUse strict mode.\n\n## Testing\nRun npm test before commit.\n',
    'README.md': '# App\nNormal readme.\nClaude should always use tabs here.\n',
    'src/index.js': 'console.log(1)\n',
    '.vscode/settings.json': '{\n  // ai\n  "chat.useAgentsMdFile": true,\n  "editor.tabSize": 2\n}\n',
    'node_modules_like.bin': 'text file no markers\n',
    '.cursorrules': 'Always write tests first.\n',
  });

  try {
    const inv = runInventory({ root: repo, outDir: '.setup', allowDirty: false });

    // surfaces
    const paths = inv.files.map((f) => f.path).sort();
    assert.deepEqual(paths, ['.cursorrules', '.vscode/settings.json', 'CLAUDE.md']);

    // CLAUDE.md split into blocks; node files tile the source
    const claude = inv.files.find((f) => f.path === 'CLAUDE.md');
    const reassembled = claude.nodes.map((id) => readFileSync(join(repo, '.setup', 'nodes', id), 'utf8')).join('');
    assert.equal(reassembled, readFileSync(join(repo, 'CLAUDE.md'), 'utf8'));

    // vscode settings: whole-file node + key inventory
    const vs = inv.files.find((f) => f.path === '.vscode/settings.json');
    assert.deepEqual(vs.jsonKeys, ['chat.useAgentsMdFile', 'editor.tabSize']);
    assert.equal(vs.nodes.length, 1);

    // sweep: README flagged (marker), src/index.js not
    assert.deepEqual(inv.sweepCandidates.map((c) => c.file), ['README.md']);

    // inventory.json written and parseable
    const onDisk = JSON.parse(readFileSync(join(repo, '.setup', 'inventory.json'), 'utf8'));
    assert.equal(onDisk.stats.nodes, inv.stats.nodes);

    // node IDs deterministic: re-run produces identical inventory (minus timestamp)
    const inv2 = runInventory({ root: repo, outDir: '.setup', allowDirty: true });
    assert.deepEqual(inv2.nodes, inv.nodes);
    assert.deepEqual(inv2.files, inv.files);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('integration: dirty tree fails precondition, --allow-dirty bypasses', () => {
  const repo = makeRepo({ 'AGENTS.md': '# X\nrules\n' });
  try {
    writeFileSync(join(repo, 'dirty.txt'), 'uncommitted\n');
    // runInventory calls process.exit via fail(); run via subprocess to capture
    const r = spawnSync(process.execPath, [
      join(process.cwd(), 'scripts', 'inventory-extract.mjs'), '--root', repo,
    ], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not clean/);

    const r2 = spawnSync(process.execPath, [
      join(process.cwd(), 'scripts', 'inventory-extract.mjs'), '--root', repo, '--allow-dirty',
    ], { encoding: 'utf8' });
    assert.equal(r2.status, 0, r2.stderr);
    assert.ok(existsSync(join(repo, '.setup', 'inventory.json')));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('integration: crlf file bytes preserved exactly in nodes', () => {
  const crlfDoc = '# Win\r\nline one\r\n## Sub\r\nline two\r\n';
  const repo = makeRepo({ 'AGENTS.md': crlfDoc });
  try {
    const inv = runInventory({ root: repo, outDir: '.setup', allowDirty: false });
    const f = inv.files.find((x) => x.path === 'AGENTS.md');
    assert.equal(f.lineEnding, 'crlf');
    const joined = f.nodes.map((id) => readFileSync(join(repo, '.setup', 'nodes', id), 'utf8')).join('');
    assert.equal(joined, crlfDoc);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
