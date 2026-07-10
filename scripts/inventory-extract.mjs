#!/usr/bin/env node
// inventory-extract — enumerate + extract AI-config content from a repo.
// Pure mechanics, no classification beyond the enumerated surface
// list; everything else is sweep-candidate triage for the AI plan phase.
//
// Usage: node scripts/inventory-extract.mjs [--root <dir>] [--out <dir>]
//                                           [--allow-dirty] [--include <paths>] [--json]
// --out defaults to .setup (resolved against --root). apply/check/report
// hardcode <root>/.setup/, so pointing --out elsewhere is only useful for
// report-only runs (e.g. base-check's deep sweep) that must leave the repo
// clean. An out-of-root dir is only accepted if it's new, empty, or looks
// like a previous inventory-extract output — never an arbitrary populated
// directory (it gets wiped).
// Exit codes: 0 ok · 1 precondition failed · 2 internal error

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFile, extractImports, sweepFile, isBinary, classifySurface } from './lib/extract.mjs';
import { flagValue } from './lib/cli-args.mjs';

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

  const universeSet = new Set(universe);

  // Local per-developer files: enumerated surfaces, but conventionally
  // gitignored so they never enter the universe — surface the discrepancy
  // without inventorying their content.
  for (const local of ['CLAUDE.local.md', '.claude/settings.local.json']) {
    if (!universeSet.has(local) && existsSync(join(root, local))) {
      skipped.push({ file: local, reason: 'local per-developer file (gitignored) — not repo content, review manually' });
    }
  }

  // The out dir is wiped wholesale below. A strict subdirectory of root
  // (e.g. the default .setup) is always fine. root itself or an ancestor of
  // root would take the repo (and .git) with it — always refused. An
  // out-of-root dir (report-only runs, e.g. base-check's deep sweep) is
  // refused unless it's new, empty, or looks like a previous
  // inventory-extract output — so a rerun into the same scratch dir is
  // idempotent, but an arbitrary populated directory is never wiped.
  const outAbs = resolve(root, outDir);
  const isSubdirOfRoot = outAbs !== root && outAbs.startsWith(root + sep);
  const isRootOrAncestor = outAbs === root || root.startsWith(outAbs + sep);
  if (isRootOrAncestor) {
    throw new Error(`outDir must not be the repo root or an ancestor of it (got "${outDir}")`);
  }
  if (!isSubdirOfRoot && existsSync(outAbs)) {
    const entries = readdirSync(outAbs);
    const looksLikePriorOutput = entries.includes('inventory.json') && entries.every((e) => e === 'inventory.json' || e === 'nodes');
    if (entries.length > 0 && !looksLikePriorOutput) {
      throw new Error(`refusing to wipe non-empty outDir that is not a previous inventory-extract output: ${outAbs}`);
    }
  }
  rmSync(outAbs, { recursive: true, force: true });
  mkdirSync(join(outAbs, 'nodes'), { recursive: true });

  const importQueue = []; // { from, raw } — @-import edges to resolve after the pass

  const addSurfaceFile = (path, text, fileMeta, blocks) => {
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
    for (const raw of fileMeta.imports ?? []) importQueue.push({ from: path, raw });
  };

  for (const path of universe) {
    let buf;
    try {
      buf = readFileSync(join(root, path));
    } catch {
      skipped.push({ file: path, reason: 'unreadable' });
      continue;
    }
    if (isBinary(buf)) {
      if (classifySurface(path) || includeSet.has(path)) skipped.push({ file: path, reason: 'binary AI-surface file (flagged for manual review)' });
      continue;
    }
    const text = buf.toString('utf8');
    // Lossy decode (e.g. latin-1 bytes → U+FFFD) would silently corrupt node
    // bytes and break the byte-identical promise — surface it instead.
    if (!Buffer.from(text, 'utf8').equals(buf)) {
      skipped.push({ file: path, reason: 'non-UTF-8 encoding (lossy decode) — convert to UTF-8 or handle manually' });
      continue;
    }
    const surface = classifySurface(path) ?? (includeSet.has(path) ? 'forced-include' : null);

    if (surface) {
      const { fileMeta, blocks } = extractFile(path, text);
      if (includeSet.has(path)) fileMeta.surface = 'forced-include';
      addSurfaceFile(path, text, fileMeta, blocks);
    } else {
      const hit = sweepFile(path, text);
      if (hit) {
        if (hit.skipped) skipped.push({ file: path, reason: `sweep skipped: ${hit.skipped}` });
        else sweepCandidates.push(hit);
      }
    }
  }

  // @-import resolution: in-universe targets that aren't already surfaces get
  // force-included as 'imported' (same mechanism as includeSet); everything
  // else lands in skipped[] so the planner sees it. Chained imports follow.
  const surfaceSet = new Set(files.map((f) => f.path));
  const handled = new Set();
  while (importQueue.length) {
    const { from, raw } = importQueue.shift();
    if (raw.startsWith('~/') || raw.startsWith('/')) {
      skipped.push({ file: raw, reason: `out-of-repo import (@${raw} in ${from}) — review manually` });
      continue;
    }
    const target = posix.normalize(posix.join(posix.dirname(from), raw));
    if (surfaceSet.has(target) || handled.has(target)) continue;
    handled.add(target);
    if (!universeSet.has(target)) {
      skipped.push({ file: target, reason: `unresolved import (@${raw} in ${from})` });
      continue;
    }
    let buf;
    try {
      buf = readFileSync(join(root, target));
    } catch {
      skipped.push({ file: target, reason: 'unreadable' });
      continue;
    }
    if (isBinary(buf)) {
      skipped.push({ file: target, reason: 'binary AI-surface file (flagged for manual review)' });
      continue;
    }
    const text = buf.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(buf)) {
      skipped.push({ file: target, reason: 'non-UTF-8 encoding (lossy decode) — convert to UTF-8 or handle manually' });
      continue;
    }
    const { fileMeta, blocks } = extractFile(target, text);
    fileMeta.surface = 'imported';
    const imports = extractImports(text);
    if (imports.length) fileMeta.imports = imports;
    addSurfaceFile(target, text, fileMeta, blocks);
    surfaceSet.add(target);
    const sci = sweepCandidates.findIndex((c) => c.file === target);
    if (sci !== -1) sweepCandidates.splice(sci, 1); // promoted: no longer triage
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
    if (args[i] === '--root') opt.root = flagValue(args, i++, '--root', fail);
    else if (args[i] === '--out') opt.out = flagValue(args, i++, '--out', fail);
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
