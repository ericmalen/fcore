import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import {
  splitLinesKeepEnds, detectLineEnding, hasFinalNewline, isBinary,
  parseMarkdownBlocks, stripJsonComments, topLevelJsonKeys,
  classifySurface, sweepFile, extractFile, extractImports,
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

test('closing fence must be at least as long as the opener (CommonMark)', () => {
  const doc = '# Real\n````md\n```\n# inside outer fence, not a heading\n```\n## still inside\n````\n# After\nend\n';
  const blocks = parseMarkdownBlocks(doc);
  const headings = blocks.filter((b) => b.kind === 'section').map((b) => b.heading);
  assert.deepEqual(headings, ['Real', 'After']);
  assert.equal(tile(doc), doc);
  // longer closer than opener still closes
  const doc2 = '```\n# hidden\n`````\n# Visible\nx\n';
  const headings2 = parseMarkdownBlocks(doc2).filter((b) => b.kind === 'section').map((b) => b.heading);
  assert.deepEqual(headings2, ['Visible']);
  assert.equal(tile(doc2), doc2);
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
  assert.equal(classifySurface('.mcp.json'), 'claude-mcp');
  assert.equal(classifySurface('.vscode/mcp.json'), 'vscode-mcp');
  assert.equal(classifySurface('sub/dir/.mcp.json'), null); // root-only surface
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

test('sweep catches mcpServers config and "mcp server" prose', () => {
  const hit = sweepFile('config/servers.json', '{\n  "mcpServers": { "fetch": { "command": "uvx" } }\n}\n');
  assert.ok(hit);
  assert.equal(hit.hits[0].marker, 'mcpservers');
  assert.ok(sweepFile('docs/infra.md', 'Run the MCP server locally first.\n'));
});

test('sweep flags truncation at the per-file hit cap', () => {
  const over = 'claude line\n'.repeat(12);
  const hit = sweepFile('x.md', over);
  assert.equal(hit.hits.length, 10);
  assert.equal(hit.truncated, true);
  const exact = sweepFile('x.md', 'claude line\n'.repeat(10));
  assert.equal(exact.hits.length, 10);
  assert.equal(exact.truncated, undefined);
});

// ── @-imports ───────────────────────────────────────────────────────────────

test('extractImports: recognized token forms', () => {
  const doc = '@AGENTS.md\nsee @./local.md and @docs/style.md\n@~/private.md then @/abs/path.md\n@../up/one.md\n';
  assert.deepEqual(extractImports(doc), [
    'AGENTS.md', './local.md', 'docs/style.md', '~/private.md', '/abs/path.md', '../up/one.md',
  ]);
});

test('extractImports: emails and npm scopes are not imports', () => {
  const doc = 'Use @anthropic-ai/sdk for calls.\nContact dev@example.com or a@b.md please.\nPing @username about it.\n';
  assert.deepEqual(extractImports(doc), []);
});

test('extractImports: tokens inside code fences are ignored', () => {
  const doc = 'real: @docs/real.md\n```\n@docs/fenced.md\n```\nafter\n';
  assert.deepEqual(extractImports(doc), ['docs/real.md']);
});

test('extractFile records imports only on instruction surfaces', () => {
  const { fileMeta } = extractFile('CLAUDE.md', '@AGENTS.md\n');
  assert.deepEqual(fileMeta.imports, ['AGENTS.md']);
  const none = extractFile('CLAUDE.md', '# plain\nno imports\n');
  assert.equal(none.fileMeta.imports, undefined);
  const readme = extractFile('.github/prompts/x.prompt.md', '@docs/style.md\n');
  assert.equal(readme.fileMeta.imports, undefined);
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

test('runInventory: outDir equal to or an ancestor of root is always refused', () => {
  const repo = makeRepo({ 'AGENTS.md': '# X\nrules\n' });
  try {
    for (const outDir of ['.', '..', 'a/../..']) {
      assert.throws(
        () => runInventory({ root: repo, outDir, allowDirty: true }),
        /outDir must not be the repo root or an ancestor/);
    }
    assert.ok(runInventory({ root: repo, outDir: '.setup', allowDirty: true }));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('runInventory: out-of-root outDir is allowed when new/empty, refused when populated', () => {
  const repo = makeRepo({ 'AGENTS.md': '# X\nrules\n' });
  const scratchParent = mkdtempSync(join(tmpdir(), 'aikit-extract-out-'));
  const freshOut = join(scratchParent, 'sweep-report');
  try {
    // new (nonexistent) out-of-root dir: succeeds, leaves no <root>/.setup
    const inv = runInventory({ root: repo, outDir: freshOut, allowDirty: true });
    assert.ok(inv.stats);
    assert.equal(existsSync(join(repo, '.setup')), false);
    assert.ok(existsSync(join(freshOut, 'inventory.json')));

    // rerun into the same (now prior-output-shaped) dir: idempotent, not refused
    assert.ok(runInventory({ root: repo, outDir: freshOut, allowDirty: true }));

    // a populated dir that isn't a prior inventory-extract output: refused, never wiped
    const populated = join(scratchParent, 'populated');
    mkdirSync(populated, { recursive: true });
    writeFileSync(join(populated, 'unrelated.txt'), 'do not delete me\n');
    assert.throws(
      () => runInventory({ root: repo, outDir: populated, allowDirty: true }),
      /refusing to wipe non-empty outDir/);
    assert.ok(existsSync(join(populated, 'unrelated.txt')), 'populated dir must survive the refused run');
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(scratchParent, { recursive: true, force: true });
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

test('cli: --out writes report-only outside the repo, leaving no <root>/.setup', () => {
  const repo = makeRepo({ 'AGENTS.md': '# X\nrules\n' });
  const scratch = mkdtempSync(join(tmpdir(), 'aikit-extract-cli-out-'));
  const reportDir = join(scratch, 'report');
  try {
    const r = spawnSync(process.execPath, [
      join(process.cwd(), 'scripts', 'inventory-extract.mjs'),
      '--root', repo, '--out', reportDir, '--allow-dirty',
    ], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(reportDir, 'inventory.json')));
    assert.equal(existsSync(join(repo, '.setup')), false);

    const missingValue = spawnSync(process.execPath, [
      join(process.cwd(), 'scripts', 'inventory-extract.mjs'), '--root', repo, '--out',
    ], { encoding: 'utf8' });
    assert.equal(missingValue.status, 1);
    assert.match(missingValue.stderr, /--out requires a value/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('integration: non-UTF-8 surface file is skipped, not corrupted', () => {
  const latin1 = Buffer.from('# Caf\xe9\nr\xe8gles ici\n', 'latin1'); // 0xE9/0xE8: invalid UTF-8
  const repo = makeRepo({
    'AGENTS.md': latin1,
    'CLAUDE.md': '# Ok\nutf-8 fine\n',
  });
  try {
    const inv = runInventory({ root: repo, outDir: '.setup', allowDirty: false });

    // skipped with the encoding reason; no surface entry, no node bytes anywhere
    const skip = inv.skipped.find((s) => s.file === 'AGENTS.md');
    assert.ok(skip, JSON.stringify(inv.skipped));
    assert.match(skip.reason, /non-UTF-8/);
    assert.equal(inv.files.find((f) => f.path === 'AGENTS.md'), undefined);
    for (const id of Object.keys(inv.nodes)) {
      assert.notEqual(inv.nodes[id].file, 'AGENTS.md');
      const bytes = readFileSync(join(repo, '.setup', 'nodes', id));
      assert.equal(bytes.includes(Buffer.from([0xef, 0xbf, 0xbd])), false, `U+FFFD in node ${id}`);
    }

    // source file untouched, byte for byte
    assert.deepEqual(readFileSync(join(repo, 'AGENTS.md')), latin1);
    // the clean file still extracts normally
    assert.ok(inv.files.find((f) => f.path === 'CLAUDE.md'));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('integration: forced-include of a binary file lands in skipped, not dropped', () => {
  const repo = makeRepo({
    'AGENTS.md': '# X\nrules\n',
    'assets/logo.bin': Buffer.from([0x89, 0x00, 0x01, 0x02]),
  });
  try {
    // without --include: binary non-surface file vanishes silently (by design)
    const inv0 = runInventory({ root: repo, outDir: '.setup', allowDirty: false });
    assert.equal(inv0.skipped.find((s) => s.file === 'assets/logo.bin'), undefined);

    // with --include: the skip must be surfaced
    const inv = runInventory({ root: repo, outDir: '.setup', allowDirty: true, include: ['assets/logo.bin'] });
    const skip = inv.skipped.find((s) => s.file === 'assets/logo.bin');
    assert.ok(skip, JSON.stringify(inv.skipped));
    assert.match(skip.reason, /binary/);
    assert.equal(inv.files.find((f) => f.path === 'assets/logo.bin'), undefined);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('integration: nested fences — headings inside 4-backtick fence are not split points', () => {
  const doc = 'intro\n````md\n```\n# not a split\n```\n## also not\n````\n# After Fence\nbody\n';
  const repo = makeRepo({ 'CLAUDE.md': doc });
  try {
    const inv = runInventory({ root: repo, outDir: '.setup', allowDirty: false });
    const f = inv.files.find((x) => x.path === 'CLAUDE.md');
    const headings = f.nodes.map((id) => inv.nodes[id]).filter((n) => n.kind === 'section').map((n) => n.heading);
    assert.deepEqual(headings, ['After Fence']);
    const joined = f.nodes.map((id) => readFileSync(join(repo, '.setup', 'nodes', id), 'utf8')).join('');
    assert.equal(joined, doc);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('integration: .mcp.json and .vscode/mcp.json are surfaces with nodes', () => {
  const repo = makeRepo({
    '.mcp.json': '{\n  "mcpServers": {\n    "fetch": { "command": "uvx" }\n  }\n}\n',
    '.vscode/mcp.json': '{\n  "servers": {\n    "fetch": { "command": "uvx" }\n  }\n}\n',
  });
  try {
    const inv = runInventory({ root: repo, outDir: '.setup', allowDirty: false });
    const claude = inv.files.find((f) => f.path === '.mcp.json');
    const vscode = inv.files.find((f) => f.path === '.vscode/mcp.json');
    assert.ok(claude, 'root .mcp.json missing from surfaces');
    assert.ok(vscode, '.vscode/mcp.json missing from surfaces');
    assert.equal(claude.surface, 'claude-mcp');
    assert.equal(vscode.surface, 'vscode-mcp');
    assert.deepEqual(claude.jsonKeys, ['mcpServers']);
    for (const f of [claude, vscode]) {
      assert.equal(f.nodes.length, 1);
      const bytes = readFileSync(join(repo, '.setup', 'nodes', f.nodes[0]), 'utf8');
      assert.equal(bytes, readFileSync(join(repo, f.path), 'utf8'));
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('integration: @-import target becomes an imported surface with nodes', () => {
  const repo = makeRepo({
    'CLAUDE.md': '# Project\nStyle rules: @docs/style.md\n',
  });
  try {
    // untracked but not ignored → in the universe
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, 'docs', 'style.md'), '# Style\nUse tabs.\n');
    const inv = runInventory({ root: repo, outDir: '.setup', allowDirty: true });

    const claude = inv.files.find((f) => f.path === 'CLAUDE.md');
    assert.deepEqual(claude.imports, ['docs/style.md']);
    const imp = inv.files.find((f) => f.path === 'docs/style.md');
    assert.ok(imp, JSON.stringify(inv.files.map((f) => f.path)));
    assert.equal(imp.surface, 'imported');
    assert.ok(imp.nodes.length >= 1);
    const joined = imp.nodes.map((id) => readFileSync(join(repo, '.setup', 'nodes', id), 'utf8')).join('');
    assert.equal(joined, '# Style\nUse tabs.\n');
    // promoted, so not left in sweep triage
    assert.equal(inv.sweepCandidates.find((c) => c.file === 'docs/style.md'), undefined);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('integration: unresolved and out-of-repo imports land in skipped[]', () => {
  const repo = makeRepo({
    'CLAUDE.md': '# P\n@docs/missing.md\n@~/private.md\n',
  });
  try {
    const inv = runInventory({ root: repo, outDir: '.setup', allowDirty: false });
    const claude = inv.files.find((f) => f.path === 'CLAUDE.md');
    assert.deepEqual(claude.imports, ['docs/missing.md', '~/private.md']);
    const missing = inv.skipped.find((s) => s.file === 'docs/missing.md');
    assert.ok(missing, JSON.stringify(inv.skipped));
    assert.match(missing.reason, /unresolved import/);
    const home = inv.skipped.find((s) => s.file === '~/private.md');
    assert.ok(home, JSON.stringify(inv.skipped));
    assert.match(home.reason, /out-of-repo import/);
    assert.equal(inv.files.find((f) => f.path === 'docs/missing.md'), undefined);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('integration: gitignored CLAUDE.local.md is surfaced in skipped[], not inventoried', () => {
  const repo = makeRepo({
    'AGENTS.md': '# X\nrules\n',
    '.gitignore': 'CLAUDE.local.md\n',
  });
  try {
    writeFileSync(join(repo, 'CLAUDE.local.md'), '# Local\nmy private rules\n');
    const inv = runInventory({ root: repo, outDir: '.setup', allowDirty: false }); // ignored → tree still clean
    const skip = inv.skipped.find((s) => s.file === 'CLAUDE.local.md');
    assert.ok(skip, JSON.stringify(inv.skipped));
    assert.match(skip.reason, /local per-developer file/);
    assert.equal(inv.files.find((f) => f.path === 'CLAUDE.local.md'), undefined);
    for (const id of Object.keys(inv.nodes)) assert.notEqual(inv.nodes[id].file, 'CLAUDE.local.md');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('integration: mcpServers in a non-surface json is a sweep candidate', () => {
  const repo = makeRepo({
    'AGENTS.md': '# X\nrules\n',
    'config/servers.json': '{\n  "mcpServers": { "fetch": { "command": "uvx" } }\n}\n',
  });
  try {
    const inv = runInventory({ root: repo, outDir: '.setup', allowDirty: false });
    const cand = inv.sweepCandidates.find((c) => c.file === 'config/servers.json');
    assert.ok(cand, JSON.stringify(inv.sweepCandidates));
    assert.equal(cand.hits[0].marker, 'mcpservers');
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
