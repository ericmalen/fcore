// sync-plan.mjs — conflict-aware baseline upgrade planning (pure, testable).

import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BASELINE_COPIES } from './baseline.mjs';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function* walkFiles(absDir, base = absDir) {
  if (!existsSync(absDir)) return;
  for (const name of readdirSync(absDir)) {
    const p = join(absDir, name);
    if (statSync(p).isDirectory()) yield* walkFiles(p, base);
    else yield relative(base, p).split('\\').join('/');
  }
}

function hashPath(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return null;
  if (statSync(abs).isDirectory()) return null;
  return sha(readFileSync(abs));
}

function hashTree(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return new Map();
  if (statSync(abs).isFile()) {
    return new Map([[rel, sha(readFileSync(abs))]]);
  }
  const out = new Map();
  for (const f of walkFiles(abs)) {
    out.set(join(rel, f).split('\\').join('/'), sha(readFileSync(join(abs, f))));
  }
  return out;
}

/** Expand baseline copy pairs into per-file hashes for an Agent Base/project root. */
export function baselineFileHashes(root) {
  const out = new Map();
  for (const [, dst] of BASELINE_COPIES) {
    for (const [path, h] of hashTree(root, dst)) out.set(path, h);
  }
  return out;
}

/**
 * Plan a baseline sync. Returns { updates, conflicts, unchanged, summary }.
 * - updates: files that match oldBase (or missing) and differ on newBase
 * - conflicts: files that differ from both oldBase and newBase (local edits)
 * - unchanged: already match newBase
 */
export function planBaselineSync(projectRoot, oldBaseRoot, newBaseRoot) {
  const project = baselineFileHashes(projectRoot);
  const oldBase = baselineFileHashes(oldBaseRoot);
  const newBase = baselineFileHashes(newBaseRoot);

  const allPaths = new Set([...project.keys(), ...oldBase.keys(), ...newBase.keys()]);
  const updates = [];
  const conflicts = [];
  const unchanged = [];

  for (const path of [...allPaths].sort()) {
    const p = project.get(path) ?? null;
    const o = oldBase.get(path) ?? null;
    const n = newBase.get(path) ?? null;
    if (n == null) continue; // removed from Agent Base — out of scope for auto-sync

    if (p === n) {
      unchanged.push(path);
      continue;
    }
    if (p === o || p == null) {
      updates.push(path);
      continue;
    }
    conflicts.push({ path, reason: 'local edit differs from Agent Base baseline' });
  }

  return {
    updates,
    conflicts,
    unchanged,
    summary: {
      updateCount: updates.length,
      conflictCount: conflicts.length,
      unchangedCount: unchanged.length,
    },
  };
}

export { hashPath, hashTree };
