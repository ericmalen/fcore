import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { planGeneration, manifestFor, renderOrchestrationRouting, ROUTING_REGION_START, ROUTING_REGION_END } from '../scripts/lib/orchestration/scaffold.mjs';
import { parseTasksMd } from '../scripts/lib/orchestration/parse-tasks.mjs';
import { validateTaskBacklog } from '../scripts/lib/orchestration/schemas.mjs';
import { audit } from '../scripts/audit.mjs';

const ROOT = join(import.meta.dirname, '..');
const CLI = join(ROOT, 'scripts', 'build-orchestrated-fixture.mjs');
const FIXTURES = join(ROOT, 'test', 'fixtures');
const BP_PATH = join(FIXTURES, 'orchestration', 'maxi-repo.synthesized.blueprint.json');
const sha256 = (t) => createHash('sha256').update(t, 'utf8').digest('hex');

function build(args) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-fixture-'));
  rmSync(dir, { recursive: true, force: true }); // must not exist yet — script creates it
  const res = spawnSync(process.execPath, [CLI, dir, ...args], { encoding: 'utf8' });
  return { dir, res };
}

function readRoutingBody(agentsText) {
  const start = agentsText.indexOf(ROUTING_REGION_START);
  const end = agentsText.indexOf(ROUTING_REGION_END);
  if (start === -1 || end === -1) return null;
  return agentsText.slice(start + ROUTING_REGION_START.length, end).trim();
}

test('build: generation-manifest byte-equals a fresh planGeneration recompute, every sha256 matches disk', () => {
  const { dir, res } = build([]);
  try {
    assert.equal(res.status, 0, res.stderr);
    const bp = JSON.parse(readFileSync(join(dir, 'docs', 'orchestration', 'blueprint.json'), 'utf8'));
    const registry = JSON.parse(readFileSync(join(ROOT, 'templates', 'orchestration', 'template-registry.json'), 'utf8'));
    const templateDirs = {
      agent: (id) => join(ROOT, 'templates', 'orchestration', 'agents', `${id}.template.md`),
      skill: (id) => join(ROOT, 'templates', 'orchestration', 'skills', `${id}.template.md`),
      doc: (id) => join(ROOT, 'templates', 'orchestration', 'docs', `${id}.md`),
    };
    const readTemplate = (kind, id) => (existsSync(templateDirs[kind](id)) ? readFileSync(templateDirs[kind](id), 'utf8') : null);
    const { files, errors } = planGeneration(bp, registry, readTemplate);
    assert.deepEqual(errors, []);
    const expectedManifest = manifestFor(files);
    const onDiskManifest = JSON.parse(readFileSync(join(dir, 'docs', 'orchestration', 'generation-manifest.json'), 'utf8'));
    assert.deepEqual(onDiskManifest, expectedManifest);
    for (const entry of onDiskManifest.generated) {
      const onDisk = readFileSync(join(dir, entry.path), 'utf8');
      assert.equal(sha256(onDisk), entry.sha256, `${entry.path}: disk bytes don't match manifest sha256`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build: audit is clean of errors and of R-56/R-57 findings', () => {
  const { dir, res } = build([]);
  try {
    assert.equal(res.status, 0, res.stderr);
    const report = audit({ root: dir, strict: true });
    const errors = report.findings.filter((f) => f.severity === 'error');
    const routingOrRuns = report.findings.filter((f) => f.rule === 'R-56' || f.rule === 'R-57');
    assert.deepEqual(errors, []);
    assert.deepEqual(routingOrRuns, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build: routing region body matches the renderer exactly', () => {
  const { dir, res } = build([]);
  try {
    assert.equal(res.status, 0, res.stderr);
    const bp = JSON.parse(readFileSync(join(dir, 'docs', 'orchestration', 'blueprint.json'), 'utf8'));
    const agentsText = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    const body = readRoutingBody(agentsText);
    assert.equal(body, renderOrchestrationRouting(bp).trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build: tasks.md parses and validates clean, seeded items present only when requested', () => {
  const plain = build([]);
  const seeded = build(['--seed-ref', '--seed-blocked']);
  try {
    assert.equal(plain.res.status, 0, plain.res.stderr);
    assert.equal(seeded.res.status, 0, seeded.res.stderr);

    const plainDoc = parseTasksMd(readFileSync(join(plain.dir, 'tasks.md'), 'utf8'));
    assert.deepEqual(plainDoc.errors, []);
    assert.deepEqual(validateTaskBacklog(plainDoc.doc), []);
    assert.deepEqual(plainDoc.doc.backlog.map((t) => t.id), ['T-101', 'T-102', 'T-103']);

    const seededDoc = parseTasksMd(readFileSync(join(seeded.dir, 'tasks.md'), 'utf8'));
    assert.deepEqual(seededDoc.errors, []);
    assert.deepEqual(validateTaskBacklog(seededDoc.doc), []);
    const t104 = seededDoc.doc.backlog.find((t) => t.id === 'T-104');
    const t199 = seededDoc.doc.backlog.find((t) => t.id === 'T-199');
    assert.equal(t104.ref, '#17');
    assert.ok(t199);
    assert.equal(t199.ref, null);
  } finally {
    rmSync(plain.dir, { recursive: true, force: true });
    rmSync(seeded.dir, { recursive: true, force: true });
  }
});

test('build: refuses a non-empty target directory (exit 2)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-fixture-'));
  writeFileSync(join(dir, 'occupied.txt'), 'x');
  try {
    const res = spawnSync(process.execPath, [CLI, dir], { encoding: 'utf8' });
    assert.equal(res.status, 2);
    assert.match(res.stderr, /non-empty directory/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build: --blueprint override with a manual-policy blueprint emits no routing region', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-fixture-'));
  rmSync(dir, { recursive: true, force: true });
  try {
    const res = spawnSync(process.execPath, [
      CLI, dir, '--blueprint', join(FIXTURES, 'orchestration', 'mini-repo.synthesized.blueprint.json'),
    ], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    const agentsText = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    assert.doesNotMatch(agentsText, /orchestration-routing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build: --json emits a machine-readable summary; git repo is committed and clean', () => {
  const { dir, res } = build(['--json']);
  try {
    assert.equal(res.status, 0, res.stderr);
    const summary = JSON.parse(res.stdout);
    assert.equal(summary.dir, dir);
    assert.match(summary.baseSha, /^[0-9a-f]{40}$/);
    assert.ok(summary.filesGenerated > 0);
    assert.equal(summary.seedRef, false);
    assert.equal(summary.installed, false);

    const status = spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
    assert.equal(status.stdout.trim(), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build: deterministic — two independent builds produce byte-identical generated trees', () => {
  const a = build([]);
  const b = build([]);
  try {
    assert.equal(a.res.status, 0, a.res.stderr);
    assert.equal(b.res.status, 0, b.res.stderr);
    const manifestA = JSON.parse(readFileSync(join(a.dir, 'docs', 'orchestration', 'generation-manifest.json'), 'utf8'));
    const manifestB = JSON.parse(readFileSync(join(b.dir, 'docs', 'orchestration', 'generation-manifest.json'), 'utf8'));
    assert.deepEqual(manifestA, manifestB);
    for (const entry of manifestA.generated) {
      assert.equal(readFileSync(join(a.dir, entry.path), 'utf8'), readFileSync(join(b.dir, entry.path), 'utf8'));
    }
    assert.equal(readFileSync(join(a.dir, 'AGENTS.md'), 'utf8'), readFileSync(join(b.dir, 'AGENTS.md'), 'utf8'));
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});
