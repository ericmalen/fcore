#!/usr/bin/env node
// install-setup — copy the setup tooling from an Agent Base clone into a project.
// Run FROM the Agent Base clone:
//   node <clone>/scripts/install-setup.mjs /path/to/project

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { ALL_INSTALL_COPIES } from './lib/baseline.mjs';
import { buildMarker, writeMarker } from './lib/marker.mjs';

const kitRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ? resolve(process.argv[2]) : null;

if (!target) {
  console.error('usage: node scripts/install-setup.mjs /path/to/project');
  process.exit(1);
}
if (!existsSync(target)) {
  console.error(`install-setup: target does not exist: ${target}`);
  process.exit(1);
}
const inTree = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: target, encoding: 'utf8' });
if (inTree.status !== 0 || inTree.stdout.trim() !== 'true') {
  console.error('install-setup: target is not a git repository.');
  process.exit(1);
}
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`install-setup: node >= 20 required (found ${process.versions.node}).`);
  process.exit(1);
}

const kitVersion = JSON.parse(readFileSync(join(kitRoot, 'package.json'), 'utf8')).version ?? '1.0.0';

for (const [src, dst] of ALL_INSTALL_COPIES) {
  const from = join(kitRoot, src);
  const to = join(target, dst);
  if (!existsSync(from)) {
    console.error(`install-setup: missing in kit: ${src} (incomplete clone?)`);
    process.exit(1);
  }
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`  installed: ${dst}`);
}

// Seed marker when absent (setup phases may rewrite via manifest literal).
const markerPath = join(target, '.claude/agent-base.json');
if (!existsSync(markerPath)) {
  writeMarker(target, buildMarker({
    standard: kitVersion,
    setupAt: new Date().toISOString().slice(0, 10),
    githubCodeReview: false,
  }));
  console.log('  installed: .claude/agent-base.json (marker seed)');
}

console.log(`
Done. Next, in the project:
  1. Commit the tooling:  git add -A && git commit --no-verify -m "chore: agent-base setup tooling"
  2. Open your AI tool and invoke the base-inventory skill.
Setup is fully reversible until you merge the agent-base-setup branch.`);
