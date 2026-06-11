#!/usr/bin/env node
// inventory-extract — enumerate + extract AI-config content from a repo.
// Pure mechanics, no classification beyond the enumerated surface
// list; everything else is sweep-candidate triage for the AI plan phase.
//
// Usage: node scripts/inventory-extract.mjs [--root <dir>] [--out <dir>]
//                                           [--allow-dirty] [--json]
// Exit codes: 0 ok · 1 precondition failed · 2 internal error

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFile, sweepFile, isBinary, classifySurface } from './lib/extract.mjs';

const MIN_NODE_MAJOR = 20;

function fail(msg) {
  console.error(`inventory-extract: ${msg}`);
  process.exit(1);
}

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) fail(`git ${args[0]} failed: ${r.stderr?.trim() ?? 'unknown error'}`);
  return r.stdout;
}

// `include`: repo-relative paths forced into the surface set (sweep candidates
// the AI ruled IN scope during the plan phase — re-extract with --include).
export function runInventory({ root, outDir, allowDirty = false, include = [] }) {
  const includeSet = new Set(include);
  root = resolve(root);

  // Preconditions (hard — no degraded fallback)
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) fail(`node >= ${MIN_NODE_MAJOR} required (found ${process.versions.node})`);
  const check = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8' });
  if (check.status !== 0 || check.stdout.trim() !== 'true') fail('not a git repository');
  if (!allowDirty) {
    const status = git(root, ['status', '--porcelain']);
    if (status.trim() !== '') fail('working tree not clean (commit or stash first; --allow-dirty for dev only)');
  }

  // Universe: tracked + untracked-but-not-ignored. Never a raw fs walk.
  // Adoption-time tooling is not repo content — never inventory it.
  const TOOLING = [
    /^\.setup\//,
    /^\.claude\/agent-base-setup\//,
    /^\.claude\/skills\/base-(inventory|plan|apply|verify)\//,
    /^\.claude\/agents\/setup-verifier\.md$/,
  ];
  const universe = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)
    .filter((p) => !TOOLING.some((re) => re.test(p)))
    .sort();

  const files = [];
  const nodes = {};
  const sweepCandidates = [];
  const skipped = [];
  let nodeSeq = 0;

  const outAbs = resolve(root, outDir);
  rmSync(outAbs, { recursive: true, force: true });
  mkdirSync(join(outAbs, 'nodes'), { recursive: true });

  for (const path of universe) {
    let buf;
    try {
      buf = readFileSync(join(root, path));
    } catch {
      skipped.push({ file: path, reason: 'unreadable' });
      continue;
    }
    if (isBinary(buf)) {
      if (classifySurface(path)) skipped.push({ file: path, reason: 'binary AI-surface file (flagged for manual review)' });
      continue;
    }
    const text = buf.toString('utf8');
    const surface = classifySurface(path) ?? (includeSet.has(path) ? 'forced-include' : null);

    if (surface) {
      const { fileMeta, blocks } = extractFile(path, text);
      if (includeSet.has(path)) fileMeta.surface = 'forced-include';
      const ids = [];
      for (const b of blocks) {
        const id = `n${String(++nodeSeq).padStart(4, '0')}`;
        ids.push(id);
        nodes[id] = {
          file: path,
          kind: b.kind,
          heading: b.heading,
          level: b.level,
          headingPath: b.headingPath,
          startLine: b.startLine,
          endLine: b.endLine,
          bytes: Buffer.byteLength(b.text, 'utf8'),
          sha256: fileMeta.sha256 && b.text === text ? fileMeta.sha256 : undefined,
        };
        writeFileSync(join(outAbs, 'nodes', id), b.text, 'utf8');
      }
      files.push({ ...fileMeta, nodes: ids });
    } else {
      const hit = sweepFile(path, text);
      if (hit) {
        if (hit.skipped) skipped.push({ file: path, reason: `sweep skipped: ${hit.skipped}` });
        else sweepCandidates.push(hit);
      }
    }
  }

  const inventory = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    root,
    stats: {
      universeFiles: universe.length,
      surfaceFiles: files.length,
      nodes: nodeSeq,
      sweepCandidates: sweepCandidates.length,
      skipped: skipped.length,
    },
    files,
    nodes,
    sweepCandidates,
    skipped,
  };

  writeFileSync(join(outAbs, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n', 'utf8');
  return inventory;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const opt = { root: process.cwd(), out: '.setup', allowDirty: false, json: false, include: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') opt.root = args[++i];
    else if (args[i] === '--out') opt.out = args[++i];
    else if (args[i] === '--allow-dirty') opt.allowDirty = true;
    else if (args[i] === '--json') opt.json = true;
    else if (args[i] === '--include') opt.include.push(...(args[++i] ?? '').split(',').filter(Boolean));
    else fail(`unknown flag: ${args[i]}`);
  }

  try {
    const inv = runInventory({ root: opt.root, outDir: opt.out, allowDirty: opt.allowDirty, include: opt.include });
    if (opt.json) {
      console.log(JSON.stringify(inv, null, 2));
    } else {
      const s = inv.stats;
      console.log(`inventory-extract: ${s.universeFiles} files in universe`);
      console.log(`  AI surfaces extracted : ${s.surfaceFiles} files → ${s.nodes} nodes`);
      console.log(`  sweep candidates      : ${s.sweepCandidates} (AI triage required in plan phase)`);
      if (s.skipped) console.log(`  skipped               : ${s.skipped} (see inventory.json)`);
      console.log(`  written               : ${opt.out}/inventory.json + ${opt.out}/nodes/`);
    }
  } catch (e) {
    console.error(`inventory-extract: internal error: ${e.message}`);
    if (process.env.DEBUG) console.error(e.stack);
    process.exit(2);
  }
}
