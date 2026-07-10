// sync-plan.mjs — conflict-aware baseline upgrade planning (pure, testable).

import { createHash } from 'node:crypto';
import { readFileSync, existsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BASELINE_COPIES, OPTIONAL_SKILLS } from './baseline.mjs';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function* walkFiles(absDir, base = absDir) {
  let entries;
  try { entries = readdirSync(absDir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    // Never follow symlinks (dir or file) — a link out of the baseline tree
    // would get recursed and hashed (mirrors the audit walk in audit/util.mjs).
    if (e.isSymbolicLink()) continue;
    const p = join(absDir, e.name);
    if (e.isDirectory()) yield* walkFiles(p, base);
    else if (e.isFile()) yield relative(base, p).split('\\').join('/');
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

/**
 * Expand baseline copy pairs into per-file hashes for an FleetCore/project root.
 * `optionalSkills` (the project's selected set) extends the baseline with the
 * matching optional-skill trees so sync upgrades only what the project opted
 * into — unselected optionals are absent from every root and never surface.
 */
export function baselineFileHashes(root, { optionalSkills = [] } = {}) {
  const out = new Map();
  for (const [, dst] of BASELINE_COPIES) {
    for (const [path, h] of hashTree(root, dst)) out.set(path, h);
  }
  for (const s of OPTIONAL_SKILLS) {
    if (!optionalSkills.includes(s.name)) continue;
    for (const [path, h] of hashTree(root, s.dst)) out.set(path, h);
  }
  return out;
}

/**
 * A candidate update is only writable when every component of its project
 * path is a plain directory (and the leaf, if present, a plain file).
 * Symlinks, a file where a directory is needed, or a directory where the
 * baseline ships a file would make apply write out-of-tree or crash mid-copy
 * — classify them as conflicts up front so the plan, not the apply, says no.
 */
function pathObstruction(projectRoot, rel) {
  const segs = rel.split('/');
  let cur = projectRoot;
  for (let i = 0; i < segs.length; i++) {
    cur = join(cur, segs[i]);
    let st = null;
    try { st = lstatSync(cur); } catch { return null; } // rest missing: clear to create
    if (st.isSymbolicLink()) return 'symlink in project path — sync never writes through links';
    const leaf = i === segs.length - 1;
    if (leaf && st.isDirectory()) return 'directory where the baseline ships a file';
    if (!leaf && !st.isDirectory()) return 'file where the baseline needs a directory';
  }
  return null;
}

/**
 * Plan a baseline sync. Returns { updates, conflicts, unchanged, removed, summary }.
 * - updates: files that match oldBase (or missing) and differ on newBase
 * - conflicts: files that differ from both oldBase and newBase (local edits),
 *   plus paths whose project state can't be written safely (see pathObstruction)
 * - unchanged: already match newBase
 * - removed: still in the project but no longer shipped by newBase (never auto-deleted)
 */
export function planBaselineSync(projectRoot, oldFcoreRoot, newFcoreRoot, { optionalSkills = [] } = {}) {
  const project = baselineFileHashes(projectRoot, { optionalSkills });
  const oldBase = baselineFileHashes(oldFcoreRoot, { optionalSkills });
  const newBase = baselineFileHashes(newFcoreRoot, { optionalSkills });

  const allPaths = new Set([...project.keys(), ...oldBase.keys(), ...newBase.keys()]);
  const updates = [];
  const conflicts = [];
  const unchanged = [];
  const removed = [];

  for (const path of [...allPaths].sort()) {
    const p = project.get(path) ?? null;
    const o = oldBase.get(path) ?? null;
    const n = newBase.get(path) ?? null;
    if (n == null) {
      // No longer shipped — surfaced for the human, never auto-deleted.
      if (p != null) removed.push(path);
      continue;
    }

    if (p === n) {
      unchanged.push(path);
      continue;
    }
    if (p === o || p == null) {
      const obstruction = pathObstruction(projectRoot, path);
      if (obstruction) conflicts.push({ path, reason: obstruction });
      else updates.push(path);
      continue;
    }
    conflicts.push({ path, reason: 'local edit differs from FleetCore baseline' });
  }

  return {
    updates,
    conflicts,
    unchanged,
    removed,
    summary: {
      updateCount: updates.length,
      conflictCount: conflicts.length,
      unchangedCount: unchanged.length,
      removedCount: removed.length,
    },
  };
}

export { hashPath, hashTree };
