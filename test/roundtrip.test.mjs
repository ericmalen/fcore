// Round-trip tests: applier, check gates, report generator.
// Exit criterion: re-materializing from manifest + nodes reproduces the
// working tree byte-for-byte (the round-trip property).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, mkdtempSync, cpSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildFixture } from './fixtures/defs.mjs';
import { runInventory } from '../scripts/inventory-extract.mjs';
import { apply } from '../scripts/apply.mjs';
import { check } from '../scripts/check.mjs';
import { generateReport } from '../scripts/report.mjs';

const KIT_TEMPLATES = join(process.cwd(), 'templates');
const EMPTY_TEMPLATES = mkdtempSync(join(tmpdir(), 'aikit-notmpl-'));

function setup(fixture) {
  const repo = buildFixture(fixture);
  const inv = runInventory({ root: repo, outDir: '.setup', allowDirty: false });
  return { repo, inv };
}

function writeManifest(repo, manifest) {
  writeFileSync(join(repo, '.setup', 'manifest.json'),
    JSON.stringify({ schemaVersion: 1, baseVersion: '1.0.0', jsonMerges: [], ...manifest }, null, 2));
}

// Identity manifest: every node moves back to its own source file, in order;
// every sweep candidate ruled out-of-scope (test bookkeeping).
function identityManifest(inv) {
  const entries = [];
  for (const f of inv.files) {
    for (const id of f.nodes) entries.push({ node: id, op: 'move', target: f.path });
  }
  for (const c of inv.sweepCandidates) {
    entries.push({ file: c.file, op: 'out-of-scope', reason: 'test: identity round-trip' });
  }
  return { entries };
}

// ── THE round-trip property (Phase 1 exit criterion) ────────────────────────

for (const fixture of ['claude-only', 'copilot-only', 'mixed-messy', 'adversarial', 'large']) {
  test(`round-trip property [${fixture}]: extract → identity manifest → apply ⇒ byte-identical`, () => {
    const { repo, inv } = setup(fixture);
    try {
      const before = new Map(inv.files.map((f) => [f.path, readFileSync(join(repo, f.path), 'utf8')]));
      writeManifest(repo, identityManifest(inv));
      apply({ root: repo, templatesDir: EMPTY_TEMPLATES });
      for (const [path, orig] of before) {
        assert.equal(readFileSync(join(repo, path), 'utf8'), orig, `round-trip mutated ${path}`);
      }
      const { violations } = check({ root: repo, templatesDir: EMPTY_TEMPLATES });
      assert.deepEqual(violations, []);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
}

test('round-trip variant: all keep-file ⇒ tree untouched, gates pass', () => {
  const { repo, inv } = setup('claude-only');
  try {
    const entries = inv.files.map((f) => ({ file: f.path, op: 'keep-file' }));
    for (const c of inv.sweepCandidates) entries.push({ file: c.file, op: 'out-of-scope', reason: 'test' });
    writeManifest(repo, { entries });
    const before = new Map(inv.files.map((f) => [f.path, readFileSync(join(repo, f.path), 'utf8')]));
    const res = apply({ root: repo, templatesDir: EMPTY_TEMPLATES });
    assert.deepEqual(res.generated, {});
    assert.deepEqual(res.deleted, []);
    for (const [path, orig] of before) {
      assert.equal(readFileSync(join(repo, path), 'utf8'), orig);
    }
    assert.deepEqual(check({ root: repo, templatesDir: EMPTY_TEMPLATES }).violations, []);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('R-47: apply ensures .gitignore covers settings.local.json, idempotently', () => {
  const { repo, inv } = setup('claude-only');
  try {
    const entries = inv.files.map((f) => ({ file: f.path, op: 'keep-file' }));
    for (const c of inv.sweepCandidates) entries.push({ file: c.file, op: 'out-of-scope', reason: 'test' });
    writeManifest(repo, { entries });
    const LOCAL = '.claude/settings.local.json';

    // existing project: existing .gitignore lacking the line → line appended, existing kept
    writeFileSync(join(repo, '.gitignore'), 'node_modules/\n');
    const res = apply({ root: repo, templatesDir: EMPTY_TEMPLATES });
    let gi = readFileSync(join(repo, '.gitignore'), 'utf8');
    assert.ok(gi.includes('node_modules/'), 'existing entries preserved');
    assert.ok(gi.split('\n').filter((l) => l.trim() === LOCAL).length === 1, 'line added once');
    assert.ok(!(LOCAL in res.generated), '.gitignore is not sha-tracked (partial ownership)');

    // idempotent: a second apply does not duplicate the line
    apply({ root: repo, templatesDir: EMPTY_TEMPLATES });
    gi = readFileSync(join(repo, '.gitignore'), 'utf8');
    assert.equal(gi.split('\n').filter((l) => l.trim() === LOCAL).length, 1, 'no duplicate on re-apply');

    // starter: no .gitignore → created with the line
    rmSync(join(repo, '.gitignore'));
    apply({ root: repo, templatesDir: EMPTY_TEMPLATES });
    assert.equal(readFileSync(join(repo, '.gitignore'), 'utf8'), LOCAL + '\n', 'starter .gitignore created');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ── applier behaviors ──────────────────────────────────────────────────

test('slot assembly: nodes land under template headings, markers vanish, source deleted', () => {
  const { repo, inv } = setup('claude-only');
  try {
    const claude = inv.files.find((f) => f.path === 'CLAUDE.md');
    const byHeading = Object.fromEntries(claude.nodes.map((id) => [inv.nodes[id].heading ?? inv.nodes[id].kind, id]));
    const entries = [
      { node: byHeading['Orders Service'], op: 'move', target: 'AGENTS.md', slot: 'intro' },
      { node: byHeading['Architecture'], op: 'move', target: 'AGENTS.md', slot: 'architecture' },
      { node: byHeading['Testing'], op: 'move', target: 'AGENTS.md', slot: 'conventions' },
      { node: byHeading['Style'], op: 'move', target: 'AGENTS.md', slot: 'conventions' },
    ];
    // disposition everything else
    for (const f of inv.files) {
      if (f.path === 'CLAUDE.md') continue;
      entries.push({ file: f.path, op: 'keep-file' });
    }
    for (const c of inv.sweepCandidates) entries.push({ file: c.file, op: 'out-of-scope', reason: 'test' });
    writeManifest(repo, {
      entries,
      jsonMerges: [{ file: '.vscode/settings.json', base: 'settings/vscode/settings.json' }],
    });

    apply({ root: repo, templatesDir: KIT_TEMPLATES });

    const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8');
    assert.ok(!agents.includes('agent-base:slot'), 'slot markers must be gone');
    // both Conventions-slot nodes present, in manifest order, under the heading
    const conv = agents.indexOf('## Conventions');
    const t1 = agents.indexOf('SENTINEL-002-cobalt-otter'); // Testing section
    const doNot = agents.indexOf('## Do Not');
    assert.ok(conv < t1 && t1 < doNot, 'Testing content must sit inside Conventions section');
    assert.ok(agents.includes('## Architecture'));
    assert.ok(agents.includes('SENTINEL-001-amber-falcon'), 'h1 section moved to intro slot');
    // source CLAUDE.md deleted (fully dispositioned, not a target)
    assert.ok(!existsSync(join(repo, 'CLAUDE.md')));
    // json key-merge: template keys won, no comments, valid JSON
    const vs = JSON.parse(readFileSync(join(repo, '.vscode/settings.json'), 'utf8'));
    assert.equal(vs['chat.useAgentsMdFile'], true);
    assert.equal(vs['explorer.fileNesting.patterns']['AGENTS.md'], 'CLAUDE.md');

    const { violations } = check({ root: repo, templatesDir: KIT_TEMPLATES });
    assert.deepEqual(violations, []);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('json key-merge preserves source-only keys, template keys win', () => {
  const { repo, inv } = setup('adversarial'); // has mixed AI/non-AI vscode settings
  try {
    const entries = inv.files.map((f) => ({ file: f.path, op: 'keep-file' }))
      .filter((e) => e.file !== '.vscode/settings.json');
    const vsFile = inv.files.find((f) => f.path === '.vscode/settings.json');
    for (const id of vsFile.nodes) entries.push({ node: id, op: 'drop', reason: 'replaced by key-merge' });
    for (const c of inv.sweepCandidates) entries.push({ file: c.file, op: 'out-of-scope', reason: 'test' });
    writeManifest(repo, {
      entries,
      jsonMerges: [{ file: '.vscode/settings.json', base: 'settings/vscode/settings.json' }],
    });
    apply({ root: repo, templatesDir: KIT_TEMPLATES });
    const vs = JSON.parse(readFileSync(join(repo, '.vscode/settings.json'), 'utf8'));
    assert.equal(vs['editor.fontSize'], 13, 'source-only key preserved');
    assert.equal(vs['workbench.colorTheme'], 'Default Dark');
    assert.equal(vs['chat.useClaudeMdFile'], false, 'template key enforced');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('split: ranges route to different targets; explicit drop-range allowed', () => {
  const { repo, inv } = setup('claude-only');
  try {
    const claude = inv.files.find((f) => f.path === 'CLAUDE.md');
    const testing = claude.nodes.find((id) => inv.nodes[id].heading === 'Testing');
    const nodeLineCount = readFileSync(join(repo, '.setup', 'nodes', testing), 'utf8').split('\n').length - 1; // ends with \n
    const entries = [
      { node: testing, op: 'split', ranges: [
        { lines: [1, 1], target: 'docs/ai/testing.md' },             // heading line
        { lines: [2, 2], op: 'drop', reason: 'blank separator' },
        { lines: [3, nodeLineCount], target: 'docs/ai/testing.md' },
      ] },
    ];
    for (const id of claude.nodes) {
      if (id !== testing) entries.push({ node: id, op: 'drop', reason: 'test focus' });
    }
    for (const f of inv.files) if (f.path !== 'CLAUDE.md') entries.push({ file: f.path, op: 'keep-file' });
    for (const c of inv.sweepCandidates) entries.push({ file: c.file, op: 'out-of-scope', reason: 'test' });
    writeManifest(repo, { entries });
    apply({ root: repo, templatesDir: EMPTY_TEMPLATES });
    const out = readFileSync(join(repo, 'docs/ai/testing.md'), 'utf8');
    assert.ok(out.startsWith('## Testing'));
    assert.ok(out.includes('SENTINEL-002-cobalt-otter'));
    assert.deepEqual(check({ root: repo, templatesDir: EMPTY_TEMPLATES }).violations, []);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ── starter: installs produce an audit-clean repo ────────────────────────

test('starter end-to-end: installs + jsonMerges ⇒ gates pass AND audit clean', async () => {
  const { audit } = await import('../scripts/audit.mjs');
  const { repo } = setup('starter-empty');
  try {
    mkdirSync(join(repo, '.setup', 'literals'), { recursive: true });
    writeFileSync(join(repo, '.setup', 'literals', 'marker.json'),
      '{ "standard": "1.0.0", "toolRepo": "https://github.com/ericmalen/agent-base", "pin": "v1.0.0", "lastSyncedAt": "2026-06-10", "setupAt": "2026-06-10", "githubCodeReview": false }\n');
    writeManifest(repo, {
      entries: [],
      installs: [
        { file: 'AGENTS.md', template: 'instructions/AGENTS.md' },
        { file: 'CLAUDE.md', template: 'instructions/CLAUDE.md' },
        { file: '.gitignore', template: 'gitignore' },
        { file: '.claude/settings.json', template: 'settings/claude/settings.json' },
        { file: '.claude/skills/README.md', template: 'readmes/skills/README.md' },
        { file: '.claude/agent-base.json', literal: 'literals/marker.json' },
      ],
      jsonMerges: [{ file: '.vscode/settings.json', base: 'settings/vscode/settings.json' }],
    });
    apply({ root: repo, templatesDir: KIT_TEMPLATES });

    // base-check is a permanent baseline skill shipped verbatim from
    // .claude/skills/ (by install-setup / build-starter), not the manifest.
    // Mirror that here so the R-50 presence check stays satisfied.
    cpSync(join(process.cwd(), '.claude/skills/base-check'),
      join(repo, '.claude/skills/base-check'), { recursive: true });

    const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8');
    assert.ok(!agents.includes('agent-base:slot'), 'install strips slot markers');
    assert.ok(agents.includes('## Do Not'));

    assert.deepEqual(check({ root: repo, templatesDir: KIT_TEMPLATES }).violations, []);

    const report = audit({ root: repo });
    assert.deepEqual(report.findings, [], JSON.stringify(report.findings, null, 2));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ── report generator ────────────────────────────────────────────────────────

test('report: risk-ordered, drops carry full text, merge side-by-side, merged-bytes %', () => {
  const { repo, inv } = setup('mixed-messy');
  try {
    const claude = inv.files.find((f) => f.path === 'CLAUDE.md');
    const deploy = claude.nodes.find((id) => inv.nodes[id].heading === 'Deployment');
    mkdirSync(join(repo, '.setup', 'literals'), { recursive: true });
    writeFileSync(join(repo, '.setup', 'literals', 'deploy.md'),
      '## Deployment\n\nCondensed: blue/green script only.\n');
    const entries = [
      { node: deploy, op: 'merge', literal: 'literals/deploy.md', target: 'docs/ai/deploy.md', note: 'condensed' },
    ];
    for (const f of inv.files) {
      for (const id of f.nodes) {
        if (id !== deploy) entries.push({ node: id, op: 'drop', reason: `test drop ${id}` });
      }
    }
    for (const c of inv.sweepCandidates) entries.push({ file: c.file, op: 'out-of-scope', reason: 'prose about AI, not instructions' });
    writeManifest(repo, { entries });

    const md = generateReport({ root: repo });
    // order: drops section before out-of-scope before merges
    const iDrop = md.indexOf('## 1. Dropped');
    const iOos = md.indexOf('## 2. Out-of-scope');
    const iMerge = md.indexOf('## 3. Merged');
    assert.ok(iDrop > -1 && iDrop < iOos && iOos < iMerge);
    // dropped content carries FULL source text
    assert.ok(md.includes('SENTINEL-010-navy-plover'), 'dropped node text must be in the report');
    // merge side-by-side: source AND replacement
    assert.ok(md.includes('SENTINEL-011-dupe-block-gannet'), 'merge source text present');
    assert.ok(md.includes('Condensed: blue/green script only.'), 'literal text present');
    // out-of-scope full matched lines
    assert.ok(md.includes('CONTRIBUTING.md'));
    // merged-bytes % present and nonzero
    assert.match(md, /merged\/superseded[^|]*\| 1 \((\d+\.\d)% of source bytes rewritten\)/);
    assert.ok(md.includes('verbatim-via-literal'), 'F-3 split metric present');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
