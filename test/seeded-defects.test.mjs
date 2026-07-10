// Seeded-defect harness: a gate's value is proven by FAILING bad runs.
// Extractor-, audit-, and check-gate defects run here as active unit tests
// against fixtures. Verifier-level sabotage cannot be unit-tested — that
// matrix lives with the validate-setup skill (see the note at the end).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { buildFixture } from './fixtures/defs.mjs';
import { runInventory } from '../scripts/inventory-extract.mjs';
import { audit } from '../scripts/audit.mjs';

// ── extractor-level defects (active) ────────────────────────────────────────

test('defect: binary AI-surface file is skipped VISIBLY, never silently', () => {
  const repo = buildFixture('starter-with-code');
  try {
    mkdirSync(join(repo, '.claude'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'notes.md'), Buffer.from([0x23, 0x20, 0x00, 0xff, 0x00]));
    spawnSync('git', ['add', '-A'], { cwd: repo });
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x'], { cwd: repo });
    const inv = runInventory({ root: repo, outDir: '.setup', allowDirty: false });
    const skip = inv.skipped.find((s) => s.file === '.claude/notes.md');
    assert.ok(skip, 'binary surface file must appear in skipped[]');
    assert.match(skip.reason, /binary/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('defect: oversized sweep file is skipped VISIBLY', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fcore-big-'));
  try {
    writeFileSync(join(dir, 'huge.md'), 'claude guidance line\n'.repeat(60000)); // >1MB, has marker
    const g = (a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    g(['init', '-q']); g(['add', '-A']);
    g(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x']);
    const inv = runInventory({ root: dir, outDir: '.setup', allowDirty: false });
    const skip = inv.skipped.find((s) => s.file === 'huge.md');
    assert.ok(skip, 'oversized candidate must appear in skipped[], not vanish');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── audit-level defects (active; complements audit.test.mjs) ────────────────

test('defect: dilution of the env-deny rule is caught (R-44)', () => {
  const repo = buildFixture('starter-with-code');
  try {
    mkdirSync(join(repo, '.claude'), { recursive: true });
    // a "weakened" deny list — looks similar, protects nothing
    writeFileSync(join(repo, '.claude', 'settings.json'),
      '{ "permissions": { "deny": ["Read(./.environment)"] } }\n');
    const report = audit({ root: repo });
    assert.equal(report.findings.filter((f) => f.rule === 'R-44').length, 2);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ── check.mjs defects (Phase 1 gates — the gates must FAIL these) ───────────

import { writeFileSync as wf, mkdtempSync as mkdtemp, readFileSync, existsSync, symlinkSync, readdirSync } from 'node:fs';
import { runInventory as runInv } from '../scripts/inventory-extract.mjs';
import { apply } from '../scripts/apply.mjs';
import { check } from '../scripts/check.mjs';

const EMPTY_TPL = mkdtemp(join(tmpdir(), 'fcore-sd-tpl-'));
const KIT_TPL = join(process.cwd(), 'templates');

function setupContext(fixture = 'claude-only') {
  const repo = buildFixture(fixture);
  const inv = runInv({ root: repo, outDir: '.setup', allowDirty: false });
  const entries = [];
  for (const f of inv.files) for (const id of f.nodes) entries.push({ node: id, op: 'move', target: f.path });
  for (const c of inv.sweepCandidates) entries.push({ file: c.file, op: 'out-of-scope', reason: 'test' });
  return { repo, inv, entries };
}

function saveManifest(repo, entries, extra = {}) {
  wf(join(repo, '.setup', 'manifest.json'),
    JSON.stringify({ schemaVersion: 1, entries, jsonMerges: [], ...extra }, null, 2));
}

const gates = (r) => [...new Set(check({ root: r, templatesDir: EMPTY_TPL }).violations.map((v) => v.gate))];

test('defect: manifest omits a node → completeness fails', () => {
  const { repo, entries } = setupContext();
  try {
    saveManifest(repo, entries.slice(1)); // drop first disposition
    assert.ok(gates(repo).includes('completeness'));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('defect: duplicate disposition for one node → completeness fails', () => {
  const { repo, entries } = setupContext();
  try {
    saveManifest(repo, [...entries, entries[0]]);
    assert.ok(gates(repo).includes('completeness'));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('defect: sweep candidate without disposition → completeness fails', () => {
  const { repo, entries } = setupContext('mixed-messy'); // fixture WITH sweep candidates
  try {
    saveManifest(repo, entries.filter((e) => e.op !== 'out-of-scope'));
    assert.ok(gates(repo).includes('completeness'));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('defect: split ranges leave a gap → tiling fails', () => {
  const { repo, inv, entries } = setupContext();
  try {
    const f = inv.files.find((x) => x.path === 'CLAUDE.md');
    const id = f.nodes[f.nodes.length - 1];
    const filtered = entries.filter((e) => e.node !== id);
    filtered.push({ node: id, op: 'split', ranges: [{ lines: [1, 1], target: 'docs/ai/x.md' }] }); // gap after line 1
    saveManifest(repo, filtered);
    assert.ok(gates(repo).includes('tiling'));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('defect: hand-edited generated file → reproducibility fails', () => {
  const { repo, entries } = setupContext();
  try {
    saveManifest(repo, entries);
    apply({ root: repo, templatesDir: EMPTY_TPL });
    assert.deepEqual(gates(repo), []); // clean before sabotage
    const target = join(repo, 'CLAUDE.md');
    wf(target, readFileSync(target, 'utf8').replace('SENTINEL-001-amber-falcon', 'SENTINEL-001-amber-falcon (weakened)'));
    assert.ok(gates(repo).includes('reproducibility'), 'editing generated output around the system must be caught');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('defect: merge references a missing literal → check fails', () => {
  const { repo, inv, entries } = setupContext();
  try {
    const f = inv.files.find((x) => x.path === 'CLAUDE.md');
    const id = f.nodes[0];
    const filtered = entries.filter((e) => e.node !== id);
    filtered.push({ node: id, op: 'merge', literal: 'literals/ghost.md', target: 'docs/ai/x.md' });
    saveManifest(repo, filtered);
    assert.ok(gates(repo).includes('scope'));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('defect: target outside AI-config surfaces → scope fails', () => {
  const { repo, inv, entries } = setupContext();
  try {
    const f = inv.files.find((x) => x.path === 'CLAUDE.md');
    const id = f.nodes[0];
    const filtered = entries.filter((e) => e.node !== id);
    filtered.push({ node: id, op: 'move', target: 'src/index.js' });
    saveManifest(repo, filtered);
    assert.ok(gates(repo).includes('scope'));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

// keep-file manifest for every inventoried file (works under kit templates:
// nothing is assembled, so structured-target slot rules never engage).
function keepAllEntries(inv) {
  const entries = inv.files.map((f) => ({ file: f.path, op: 'keep-file' }));
  for (const c of inv.sweepCandidates) entries.push({ file: c.file, op: 'out-of-scope', reason: 'test' });
  return entries;
}

test('defect: hand-edited jsonMerged output → reproducibility fails (F1 sabotage)', () => {
  const repo = buildFixture('claude-only');
  try {
    const inv = runInv({ root: repo, outDir: '.setup', allowDirty: false });
    saveManifest(repo, keepAllEntries(inv), {
      jsonMerges: [{ file: '.vscode/settings.json', base: 'settings/vscode/settings.json' }],
    });
    apply({ root: repo, templatesDir: KIT_TPL });
    const g = () => [...new Set(check({ root: repo, templatesDir: KIT_TPL }).violations.map((x) => x.gate))];
    assert.deepEqual(g(), []); // clean before sabotage
    // sabotage: add a key the template does NOT own, byte-formatted exactly
    // like apply output — pre-snapshot, this fed back in as "source" and passed
    const target = join(repo, '.vscode', 'settings.json');
    const vs = JSON.parse(readFileSync(target, 'utf8'));
    vs['editor.fontSize'] = 99;
    wf(target, JSON.stringify(vs, null, 2) + '\n');
    assert.ok(g().includes('reproducibility'),
      'hand-edit to a jsonMerged output must fail the repro gate');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('defect: manifest flipped keep-file→drop without re-apply → reproducibility fails', () => {
  const repo = buildFixture('claude-only');
  try {
    const inv = runInv({ root: repo, outDir: '.setup', allowDirty: false });
    saveManifest(repo, keepAllEntries(inv));
    apply({ root: repo, templatesDir: EMPTY_TPL });
    assert.deepEqual(gates(repo), []); // clean before sabotage
    // edit the manifest only: CLAUDE.md's keep-file becomes per-node drops
    const claude = inv.files.find((f) => f.path === 'CLAUDE.md');
    const edited = keepAllEntries(inv).filter((e) => e.file !== 'CLAUDE.md');
    for (const id of claude.nodes) edited.push({ node: id, op: 'drop', reason: 'test: flipped after apply' });
    saveManifest(repo, edited);
    const { violations } = check({ root: repo, templatesDir: EMPTY_TPL });
    assert.ok(violations.some((x) => x.gate === 'reproducibility' && x.message.includes('CLAUDE.md')),
      'file the edited manifest would delete still exists — must be flagged');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('defect: unsafe inventory file path → apply refuses before deleting anything', () => {
  const repo = buildFixture('claude-only');
  try {
    const inv = runInv({ root: repo, outDir: '.setup', allowDirty: false });
    const entries = [];
    for (const f of inv.files) {
      // CLAUDE.md fully dropped → deletion candidate on apply
      if (f.path === 'CLAUDE.md') for (const id of f.nodes) entries.push({ node: id, op: 'drop', reason: 'test' });
      else entries.push({ file: f.path, op: 'keep-file' });
    }
    for (const c of inv.sweepCandidates) entries.push({ file: c.file, op: 'out-of-scope', reason: 'test' });
    saveManifest(repo, entries);
    const invJson = JSON.parse(readFileSync(join(repo, '.setup', 'inventory.json'), 'utf8'));
    invJson.files.push({ path: '../../escape.md', nodes: [] });
    wf(join(repo, '.setup', 'inventory.json'), JSON.stringify(invJson, null, 2));
    assert.throws(() => apply({ root: repo, templatesDir: EMPTY_TPL }), /unsafe file path/);
    assert.ok(existsSync(join(repo, 'CLAUDE.md')), 'apply must refuse before any deletion');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('defect: duplicate jsonMerges or collision with an install → apply throws', () => {
  const repo = buildFixture('claude-only');
  try {
    const inv = runInv({ root: repo, outDir: '.setup', allowDirty: false });
    const entries = keepAllEntries(inv);
    const jm = { file: '.vscode/settings.json', base: 'settings/vscode/settings.json' };
    saveManifest(repo, entries, { jsonMerges: [jm, jm] });
    assert.throws(() => apply({ root: repo, templatesDir: KIT_TPL }), /duplicate jsonMerges/);
    mkdirSync(join(repo, '.setup', 'literals'), { recursive: true });
    wf(join(repo, '.setup', 'literals', 'vs.json'), '{}\n');
    saveManifest(repo, entries, {
      jsonMerges: [jm],
      installs: [{ file: '.vscode/settings.json', literal: 'literals/vs.json' }],
    });
    assert.throws(() => apply({ root: repo, templatesDir: KIT_TPL }), /already written/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('defect: supersede pointing at a nonexistent catalog skill → completeness fails', () => {
  const { repo, inv, entries } = setupContext();
  try {
    const f = inv.files.find((x) => x.path === 'CLAUDE.md');
    const id = f.nodes[0];
    const filtered = entries.filter((e) => e.node !== id);
    filtered.push({ node: id, op: 'supersede', catalogSkill: 'ghost-skill' });
    saveManifest(repo, filtered);
    const { violations } = check({ root: repo, templatesDir: EMPTY_TPL });
    assert.ok(violations.some((x) => x.gate === 'completeness' && x.message.includes('ghost-skill')),
      'content must never be deleted against a fictional replacement');
    // control: an installed catalog skill satisfies the same check
    filtered[filtered.length - 1] = { node: id, op: 'supersede', catalogSkill: 'deploy-helper' };
    saveManifest(repo, filtered);
    const ok = check({ root: repo, templatesDir: EMPTY_TPL }).violations;
    assert.ok(!ok.some((x) => x.message.includes('deploy-helper')));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('defect: symlink at a generated target path → apply throws, link target untouched', () => {
  const { repo, inv, entries } = setupContext();
  try {
    const f = inv.files.find((x) => x.path === 'CLAUDE.md');
    const id = f.nodes[0];
    const filtered = entries.filter((e) => e.node !== id);
    filtered.push({ node: id, op: 'move', target: 'AGENTS.md' });
    saveManifest(repo, filtered);
    wf(join(repo, 'victim.txt'), 'out-of-band bytes\n');
    symlinkSync(join(repo, 'victim.txt'), join(repo, 'AGENTS.md'));
    assert.throws(() => apply({ root: repo, templatesDir: EMPTY_TPL }), /symlink/);
    assert.equal(readFileSync(join(repo, 'victim.txt'), 'utf8'), 'out-of-band bytes\n',
      'bytes behind the symlink must never be clobbered');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

// Byte-level snapshot of every file under dir (skipping .git) — proves a
// failed apply touched NOTHING: no writes, no deletes, no creations.
function treeSnapshot(dir) {
  const snap = new Map();
  for (const d of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!d.isFile()) continue;
    const abs = join(d.parentPath, d.name);
    const rel = abs.slice(dir.length + 1);
    if (rel === '.git' || rel.startsWith('.git/')) continue;
    snap.set(rel, readFileSync(abs));
  }
  return snap;
}

// Manifest that assembles a real target (CLAUDE.md nodes → docs/ai/claude.md)
// so a later compute failure would, pre-fix, leave that target written and
// CLAUDE.md queued for deletion.
function assemblingEntries(inv) {
  const entries = [];
  const claude = inv.files.find((f) => f.path === 'CLAUDE.md');
  for (const id of claude.nodes) entries.push({ node: id, op: 'move', target: 'docs/ai/claude.md' });
  for (const f of inv.files) {
    if (f.path !== 'CLAUDE.md') entries.push({ file: f.path, op: 'keep-file' });
  }
  for (const c of inv.sweepCandidates) entries.push({ file: c.file, op: 'out-of-scope', reason: 'test' });
  return entries;
}

test('defect: invalid JSON in a jsonMerge source → apply throws path-qualified, tree untouched', () => {
  const repo = buildFixture('claude-only');
  try {
    const inv = runInv({ root: repo, outDir: '.setup', allowDirty: false });
    saveManifest(repo, assemblingEntries(inv), {
      jsonMerges: [{ file: '.vscode/settings.json', base: 'settings/vscode/settings.json' }],
    });
    // hand-broken existing settings file (not inventoried, read live at merge time)
    mkdirSync(join(repo, '.vscode'), { recursive: true });
    wf(join(repo, '.vscode', 'settings.json'), '{ "editor.fontSize": 13, broken\n');
    const before = treeSnapshot(repo);
    assert.throws(() => apply({ root: repo, templatesDir: KIT_TPL }),
      /existing \.vscode\/settings\.json is not valid JSON\(C\):.*fix the file or route it through the manifest/s,
      'error must carry the offending path and a remediation hint');
    assert.deepEqual(treeSnapshot(repo), before,
      'failed apply must leave the working tree byte-identical (no writes, no deletes)');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('defect: missing literal in a late install entry → apply throws, tree untouched', () => {
  const repo = buildFixture('claude-only');
  try {
    const inv = runInv({ root: repo, outDir: '.setup', allowDirty: false });
    saveManifest(repo, assemblingEntries(inv), {
      installs: [{ file: '.claude/fcore.json', literal: 'literals/ghost.json' }],
    });
    const before = treeSnapshot(repo);
    assert.throws(() => apply({ root: repo, templatesDir: KIT_TPL }), /install literal missing: literals\/ghost\.json/);
    assert.deepEqual(treeSnapshot(repo), before,
      'compute-phase failure after targets were assembled must not write them');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('defect: split range past node end → apply throws instead of silently truncating', () => {
  const { repo, inv, entries } = setupContext();
  try {
    const f = inv.files.find((x) => x.path === 'CLAUDE.md');
    const id = f.nodes[0];
    const filtered = entries.filter((e) => e.node !== id);
    filtered.push({ node: id, op: 'split', ranges: [{ lines: [1, 9999], target: 'docs/ai/x.md' }] });
    saveManifest(repo, filtered);
    assert.throws(() => apply({ root: repo, templatesDir: EMPTY_TPL }), /exceeds node length/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

// Round-trip property tests (the constructive exit criterion) live in roundtrip.test.mjs.

// ── verifier defects (manual matrix, recorded per tool) ─────────────────────
// Sabotage runs: seed known defects (unjustified drop, dilution rewrite in a
// merge literal, bogus out-of-scope ruling, prompt-injection disposition) and
// record the verifier's invocation-② catch rate. These need a live verifier
// agent, so they cannot be node:test units — the validate-setup skill's
// sabotage matrix owns all four
// (.claude/skills/validate-setup/references/sabotage.md, catch-rate n/4). The
// mechanical half of the injection case (verbatim extraction of steering text)
// IS unit-tested — see the injection fixture in fixtures.test.mjs. Listed here
// so the suite documents the full negative-test surface in one place.
