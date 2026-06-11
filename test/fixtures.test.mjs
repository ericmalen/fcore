// Fixture harness: runs inventory-extract over every fixture and asserts the
// Phase-0 guarantee — nothing escapes the inventory. Every planted sentinel
// must surface as extracted node bytes or as a sweep candidate; every
// extracted file must tile byte-exactly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { fixtures, buildFixture } from './fixtures/defs.mjs';
import { runInventory } from '../scripts/inventory-extract.mjs';

function runOn(name) {
  const repo = buildFixture(name);
  const inv = runInventory({ root: repo, outDir: '.setup', allowDirty: false });
  return { repo, inv };
}

function nodeText(repo, id) {
  return readFileSync(join(repo, '.setup', 'nodes', id), 'utf8');
}

function allNodeText(repo, inv) {
  return Object.keys(inv.nodes).map((id) => nodeText(repo, id)).join('\n<<>>\n');
}

function sentinelCovered(repo, inv, sentinel) {
  if (allNodeText(repo, inv).includes(sentinel)) return 'nodes';
  for (const c of inv.sweepCandidates) {
    const text = readFileSync(join(repo, c.file), 'utf8');
    if (text.includes(sentinel)) return `sweep:${c.file}`;
  }
  return null;
}

for (const name of Object.keys(fixtures)) {
  test(`fixture ${name}: tiling + sentinel coverage`, () => {
    const { repo, inv } = runOn(name);
    try {
      // tiling: every surface file reassembles byte-identically
      for (const f of inv.files) {
        const orig = readFileSync(join(repo, f.path), 'utf8');
        const joined = f.nodes.map((id) => nodeText(repo, id)).join('');
        assert.equal(joined, orig, `tiling failed: ${f.path}`);
      }
      // sentinel coverage: nothing escapes the inventory
      for (const s of fixtures[name].sentinels) {
        const where = sentinelCovered(repo, inv, s);
        assert.ok(where, `sentinel ${s} not covered by nodes or sweep`);
      }
      // nothing skipped silently in fixtures (all fixture files are text)
      assert.deepEqual(inv.skipped, [], JSON.stringify(inv.skipped));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
}

test('starter fixtures produce empty inventories', () => {
  for (const name of ['starter-empty', 'starter-with-code']) {
    const { repo, inv } = runOn(name);
    try {
      assert.equal(inv.files.length, 0, `${name}: expected no AI surfaces`);
      assert.equal(inv.sweepCandidates.length, 0, `${name}: expected no sweep candidates`);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test('mixed-messy: sweep surfaces buried guidance; duplicate block extracted from both files', () => {
  const { repo, inv } = runOn('mixed-messy');
  try {
    const candidateFiles = inv.sweepCandidates.map((c) => c.file);
    for (const f of fixtures['mixed-messy'].expect.sweepMustInclude) {
      assert.ok(candidateFiles.includes(f), `sweep missed ${f}; got ${candidateFiles.join(', ')}`);
    }
    // the duplicate Deployment block: present in CLAUDE.md nodes AND in the
    // sweep-candidate file — both source instances are visible to the planner
    const dupe = 'SENTINEL-011-dupe-block-gannet';
    assert.ok(allNodeText(repo, inv).includes(dupe));
    assert.ok(readFileSync(join(repo, 'docs/ai-notes.md'), 'utf8').includes(dupe));
    // nested CLAUDE.md is an enumerated surface
    assert.ok(inv.files.some((f) => f.path === 'packages/web/CLAUDE.md'));
    // other-tool files captured
    assert.ok(inv.files.some((f) => f.path === '.cursorrules'));
    assert.ok(inv.files.some((f) => f.path === 'GEMINI.md'));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('adversarial: git universe excludes ignored node_modules; CRLF preserved; fence does not split', () => {
  const { repo, inv } = runOn('adversarial');
  try {
    // exclusion via .gitignore + git ls-files universe
    const everywhere = [
      ...inv.files.map((f) => f.path),
      ...inv.sweepCandidates.map((c) => c.file),
      ...inv.skipped.map((s) => s.file),
    ];
    for (const ex of fixtures.adversarial.expect.excluded) {
      assert.ok(!everywhere.includes(ex), `${ex} must be excluded from the universe`);
    }
    // CRLF AGENTS.md: bytes preserved (tiling already asserted), metadata recorded
    const agents = inv.files.find((f) => f.path === 'AGENTS.md');
    assert.equal(agents.lineEnding, 'crlf');
    // fence guard: CLAUDE.md sections must be exactly: preamble, setext h1,
    // setext h2 (fence inside), Real Section — the fence comment must not split
    const claude = inv.files.find((f) => f.path === 'CLAUDE.md');
    const kinds = claude.nodes.map((id) => inv.nodes[id]).map((n) => n.heading ?? n.kind);
    assert.deepEqual(kinds, ['preamble', 'Setext Title', 'Setext Section', 'Real Section']);
    // mixed settings file: key inventory contains both AI and non-AI keys
    const vs = inv.files.find((f) => f.path === '.vscode/settings.json');
    assert.ok(vs.jsonKeys.includes('chat.useAgentsMdFile'));
    assert.ok(vs.jsonKeys.includes('editor.fontSize'));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('injection: steering content is extracted verbatim like any other node', () => {
  const { repo, inv } = runOn('injection');
  try {
    const all = allNodeText(repo, inv);
    assert.ok(all.includes(fixtures.injection.expect.mustExtractVerbatim));
    // the injection section is its own node, dispositionable like any other
    const node = Object.values(inv.nodes).find((n) => n.heading?.includes('IMPORTANT NOTE'));
    assert.ok(node, 'injection section should be a distinct node');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('large: section count and giant single-section node survive', () => {
  const { repo, inv } = runOn('large');
  try {
    assert.ok(inv.stats.nodes >= fixtures.large.expect.minNodes, `nodes: ${inv.stats.nodes}`);
    assert.ok(inv.sweepCandidates.some((c) => c.file === 'docs/big-guide.md'));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
