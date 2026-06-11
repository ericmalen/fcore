// Seeded-defect harness: a gate's value is proven by FAILING bad runs.
// Extractor-, audit-, and check-gate defects run here as active unit tests
// against fixtures. Verifier-level sabotage cannot be unit-tested — that
// matrix lives with the validate-setup skill (see the todos at the end).

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
  const dir = mkdtempSync(join(tmpdir(), 'aikit-big-'));
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

import { writeFileSync as wf, mkdtempSync as mkdtemp, readFileSync } from 'node:fs';
import { runInventory as runInv } from '../scripts/inventory-extract.mjs';
import { apply } from '../scripts/apply.mjs';
import { check } from '../scripts/check.mjs';

const EMPTY_TPL = mkdtemp(join(tmpdir(), 'aikit-sd-tpl-'));

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

// Round-trip property tests (the constructive exit criterion) live in roundtrip.test.mjs.

// ── verifier defects (manual matrix, recorded per tool) ─────────────────────
// Sabotage runs: seed N known defects (unjustified drops, dilution rewrites in
// literals, bogus out-of-scope rulings) and record invocation-② catch rate.
// These cannot be unit tests; the validate-setup skill's sabotage matrix
// owns them (.claude/skills/validate-setup/references/sabotage.md). Listed
// here so the suite documents the full negative-test surface in one place.

test.todo('sabotage (validate-setup matrix): unjustified drop — verifier must flag');
test.todo('sabotage (validate-setup matrix): dilution rewrite in a merge literal — verifier must flag');
test.todo('sabotage (validate-setup matrix): bogus out-of-scope ruling on a sweep candidate — verifier must flag');
test.todo('sabotage (validate-setup matrix): injection fixture — agents must disposition the steering text, not obey it');
