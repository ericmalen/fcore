#!/usr/bin/env node
// orchestrate-preflight — readiness guard for base-orchestrate. Thin CLI over
// lib/orchestration/preflight.mjs: gathers filesystem evidence, the pure
// decision lives in the library so it stays unit-testable.
//
// Usage: node scripts/orchestrate-preflight.mjs --root <dir>
// Stdout: one `key=value` line each for ready, reason, mode, layers.
// Exit: 0 = ready (fresh or re-run) · 1 = not ready · 2 = usage

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decidePreflight, detectRunMode } from './lib/orchestration/preflight.mjs';
import { flagValue } from './lib/cli-args.mjs';

const OTHER_MANIFEST_NAMES = new Set(['pyproject.toml', 'setup.py', 'go.mod', 'Cargo.toml', 'pom.xml', 'Gemfile']);
const OTHER_MANIFEST_RE = /\.csproj$/;
const TEST_DIR_NAMES = new Set(['test', 'tests', '__tests__']);
const TEST_FILE_RE = /\.(test|spec)\.[a-z0-9]+$/i;
const SKIP_DIRS = new Set(['node_modules', '.git']);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// Simple trailing-star expansion only (`apps/*`, `packages/*`) — the shape
// every Agent Base fixture and the vast majority of real workspace configs
// use. Anything fancier (nested globs, negation) is outside this probe's
// remit; discovery's structure-detector does the real job later.
function expandWorkspaces(root, workspaces) {
  const manifests = [];
  for (const pattern of workspaces) {
    if (typeof pattern !== 'string' || !pattern.endsWith('/*')) continue;
    const dir = join(root, pattern.slice(0, -2));
    if (!existsSync(dir)) continue;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(dir, entry.name, 'package.json');
      if (existsSync(manifestPath)) {
        const m = readJson(manifestPath);
        if (m) manifests.push(m);
      }
    }
  }
  return manifests;
}

// Depth-limited walk (root = depth 0) looking for test files/dirs and other
// ecosystems' manifests. Cheap on purpose — this is a readiness probe, not
// discovery.
function scanShallow(root, maxDepth) {
  let testFileHits = false;
  const otherManifestHits = [];

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (TEST_DIR_NAMES.has(entry.name)) testFileHits = true;
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        if (TEST_FILE_RE.test(entry.name)) testFileHits = true;
        if (OTHER_MANIFEST_NAMES.has(entry.name) || OTHER_MANIFEST_RE.test(entry.name)) {
          otherManifestHits.push(entry.name);
        }
      }
    }
  }

  walk(root, 0);
  return { testFileHits, otherManifestHits };
}

export function gatherEvidence(root) {
  const rootManifestPath = join(root, 'package.json');
  const rootManifest = existsSync(rootManifestPath) ? readJson(rootManifestPath) : null;
  const workspaceManifests = rootManifest && Array.isArray(rootManifest.workspaces)
    ? expandWorkspaces(root, rootManifest.workspaces)
    : [];
  const { testFileHits, otherManifestHits } = scanShallow(root, 2);
  const hasDecisions = existsSync(join(root, 'docs', 'orchestration', 'decisions.json'));
  const hasGenerationManifest = existsSync(join(root, 'docs', 'orchestration', 'generation-manifest.json'));
  return {
    rootManifest, workspaceManifests, testFileHits, otherManifestHits, hasDecisions, hasGenerationManifest,
  };
}

export function orchestratePreflight(root) {
  const evidence = gatherEvidence(resolve(root));
  return { decision: decidePreflight(evidence), mode: detectRunMode(evidence) };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const opt = { root: process.cwd() };
  const bad = (m) => { console.error(`orchestrate-preflight: ${m}`); process.exit(2); };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') opt.root = flagValue(args, i++, '--root', bad);
    else bad(`unknown flag ${args[i]}`);
  }
  if (!existsSync(resolve(opt.root))) bad(`root does not exist: ${opt.root}`);

  const { decision, mode } = orchestratePreflight(opt.root);

  if (!decision.ready) {
    console.error(decision.message);
    process.stdout.write(`ready=false\nreason=${decision.reason}\nmode=${mode}\nlayers=0\n`);
    process.exit(1);
  }

  console.error(`orchestrate-preflight: ready (layers=${decision.layers}, ${decision.evidence}), mode=${mode}`);
  process.stdout.write(`ready=true\nreason=ready\nmode=${mode}\nlayers=${decision.layers}\n`);
}
