import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { decidePreflight, detectRunMode, hasTestSignal } from '../scripts/lib/orchestration/preflight.mjs';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const CLI = join(import.meta.dirname, '..', 'scripts', 'orchestrate-preflight.mjs');
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const mktemp = () => mkdtempSync(join(tmpdir(), 'ab-preflight-'));

// ── hasTestSignal ────────────────────────────────────────────────────────────

test('hasTestSignal: rejects missing, empty, and the npm placeholder', () => {
  assert.equal(hasTestSignal({}), false);
  assert.equal(hasTestSignal({ scripts: {} }), false);
  assert.equal(hasTestSignal({ scripts: { test: '' } }), false);
  assert.equal(hasTestSignal({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }), false);
});

test('hasTestSignal: accepts a real test command', () => {
  assert.equal(hasTestSignal({ scripts: { test: 'node --test' } }), true);
});

// ── decidePreflight ──────────────────────────────────────────────────────────

test('decidePreflight: no manifest, no other-ecosystem hits → no-code-layer', () => {
  const d = decidePreflight({ rootManifest: null });
  assert.equal(d.ready, false);
  assert.equal(d.reason, 'no-code-layer');
  assert.match(d.message, /at least one code layer/);
});

test('decidePreflight: single package, placeholder test script, no test files → no-test-signal', () => {
  const d = decidePreflight({
    rootManifest: { scripts: { test: 'echo "Error: no test specified" && exit 1' } },
  });
  assert.equal(d.ready, false);
  assert.equal(d.reason, 'no-test-signal');
});

test('decidePreflight: single package, placeholder script but test files present → ready (ambiguity proceeds)', () => {
  const d = decidePreflight({
    rootManifest: { scripts: { test: 'echo "Error: no test specified" && exit 1' } },
    testFileHits: true,
  });
  assert.equal(d.ready, true);
  assert.equal(d.reason, 'ready');
  assert.equal(d.layers, 1);
});

test('decidePreflight: single package with a real test script → ready', () => {
  const d = decidePreflight({ rootManifest: { scripts: { test: 'node --test' } } });
  assert.equal(d.ready, true);
  assert.equal(d.layers, 1);
});

test('decidePreflight: workspaces, one workspace testable → ready', () => {
  const d = decidePreflight({
    rootManifest: { workspaces: ['apps/*'] },
    workspaceManifests: [
      { scripts: { test: 'node --test' } },
      { scripts: {} },
    ],
  });
  assert.equal(d.ready, true);
  assert.equal(d.layers, 1);
  assert.match(d.evidence, /workspace/);
});

test('decidePreflight: workspaces, none testable, no test files → no-test-signal', () => {
  const d = decidePreflight({
    rootManifest: { workspaces: ['apps/*'] },
    workspaceManifests: [{ scripts: {} }],
  });
  assert.equal(d.ready, false);
  assert.equal(d.reason, 'no-test-signal');
});

test('decidePreflight: no package.json but go.mod present → ready (outside probe competence)', () => {
  const d = decidePreflight({ rootManifest: null, otherManifestHits: ['go.mod'] });
  assert.equal(d.ready, true);
  assert.equal(d.layers, 1);
  assert.match(d.evidence, /go\.mod/);
});

// ── detectRunMode ────────────────────────────────────────────────────────────

test('detectRunMode: neither artifact → fresh', () => {
  assert.equal(detectRunMode({ hasDecisions: false, hasGenerationManifest: false }), 'fresh');
});

test('detectRunMode: decisions.json alone → re-run', () => {
  assert.equal(detectRunMode({ hasDecisions: true, hasGenerationManifest: false }), 're-run');
});

test('detectRunMode: generation-manifest.json alone → re-run', () => {
  assert.equal(detectRunMode({ hasDecisions: false, hasGenerationManifest: true }), 're-run');
});

// ── CLI ──────────────────────────────────────────────────────────────────────

test('orchestrate-preflight CLI: mini-repo → ready, mode=fresh', () => {
  const r = run(['--root', join(FIXTURES, 'mini-repo')]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'ready=true\nreason=ready\nmode=fresh\nlayers=1\n');
});

test('orchestrate-preflight CLI: maxi-repo → ready, mode=fresh', () => {
  const r = run(['--root', join(FIXTURES, 'maxi-repo')]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^ready=true\nreason=ready\nmode=fresh\nlayers=\d+\n$/);
});

test('orchestrate-preflight CLI: empty dir → exit 1 with actionable message', () => {
  const root = mktemp();
  const r = run(['--root', root]);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, 'ready=false\nreason=no-code-layer\nmode=fresh\nlayers=0\n');
  assert.match(r.stderr, /at least one code layer/);
});

test('orchestrate-preflight CLI: existing decisions.json → mode=re-run', () => {
  const root = mktemp();
  cpSync(join(FIXTURES, 'mini-repo'), root, { recursive: true });
  mkdirSync(join(root, 'docs', 'orchestration'), { recursive: true });
  writeFileSync(join(root, 'docs', 'orchestration', 'decisions.json'), '{}');
  const r = run(['--root', root]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'ready=true\nreason=ready\nmode=re-run\nlayers=1\n');
});

test('orchestrate-preflight CLI: unknown flag exits 2; missing root exits 2', () => {
  const usage = run(['--nope']);
  assert.equal(usage.status, 2);
  const missingRoot = run(['--root', join(tmpdir(), 'ab-preflight-does-not-exist')]);
  assert.equal(missingRoot.status, 2);
});
