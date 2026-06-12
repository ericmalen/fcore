// staging.mjs — copy-once-immutable release staging for the bootstrap commands.
// npx delivers the package into a prunable cache (~/.npm/_npx); the AI-tool
// sessions that base-setup/base-orchestrate dispatch need the checkout at a
// stable path across sessions. So the CLI copies the whole package to
// ~/.agent-base/versions/<tag>/ exactly once per tag (staged into a temp
// sibling, sentinel included, then renamed into place atomically; a partial
// stage without the sentinel is wiped and re-copied). Staged releases are
// immutable — never `git pull`ed (npm strips .git anyway).
//
// Dev escape hatch: running from a clone (pkgRoot/.git present) skips staging
// and points the prompt at the clone itself.
//
// CLI-only module: lives under bin/lib/, NOT scripts/lib/ (which ships
// wholesale into projects via the installer allowlist).

import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { compareSemver, tagToSemver } from '../../scripts/lib/release.mjs';

export const SENTINEL = '.agent-base-staged';

export function pkgRootFromHere() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

// AGENT_BASE_HOME relocates the release store root (tests, sandboxed CI).
function defaultHome() {
  return process.env.AGENT_BASE_HOME || homedir();
}

export function versionsDir(home = defaultHome()) {
  return join(home, '.agent-base', 'versions');
}

/**
 * Ensure the package at pkgRoot is available at a stable, immutable path.
 * Returns { path, tag, dev, copied }:
 *   dev    — running from a git clone; nothing staged, path = the clone
 *   copied — true when this call performed the copy (false: already staged)
 */
export function stageRelease({ pkgRoot = pkgRootFromHere(), home = defaultHome() } = {}) {
  if (existsSync(join(pkgRoot, '.git'))) {
    return { path: pkgRoot, tag: null, dev: true, copied: false };
  }
  const version = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).version ?? '0.0.0';
  const tag = `v${version}`;
  const dest = join(versionsDir(home), tag);
  const sentinel = join(dest, SENTINEL);

  if (existsSync(sentinel)) return { path: dest, tag, dev: false, copied: false };
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true }); // partial stage — redo

  // Copy into a pid-suffixed temp sibling and rename into place: a concurrent
  // invocation can never observe — or sentinel-pin — a half-written stage.
  // (A temp dir orphaned by a crash is ignored: it never parses as a semver
  // tag, so listStaged/pruneStaged skip it.)
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.partial-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  cpSync(pkgRoot, tmp, { recursive: true });
  writeFileSync(join(tmp, SENTINEL), `${new Date().toISOString()}\n`);
  try {
    renameSync(tmp, dest);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    // dest appeared between our rm and rename — another invocation won; use theirs
    if (existsSync(sentinel)) return { path: dest, tag, dev: false, copied: false };
    throw err;
  }
  return { path: dest, tag, dev: false, copied: true };
}

/** Staged tags, newest first. Entries without a sentinel are flagged partial. */
export function listStaged(home = defaultHome()) {
  const dir = versionsDir(home);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((tag) => ({ tag, semver: tagToSemver(tag), path: join(dir, tag) }))
    .filter((e) => e.semver)
    .sort((a, b) => compareSemver(b.semver, a.semver))
    .map(({ tag, path }) => ({ tag, path, partial: !existsSync(join(path, SENTINEL)) }));
}

// Temp dirs from a crashed stage are swept by prune only after this grace
// period, so a concurrent in-flight stage is never yanked mid-copy.
const PARTIAL_STALE_MS = 60 * 60 * 1000;

/** Remove all but the newest `keep` staged releases. Returns removed tags. */
export function pruneStaged({ keep = 2, home = defaultHome(), now = Date.now() } = {}) {
  const removed = [];
  for (const e of listStaged(home).slice(Math.max(0, keep))) {
    rmSync(e.path, { recursive: true, force: true });
    removed.push(e.tag);
  }
  const dir = versionsDir(home);
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (!/\.partial-\d+$/.test(name)) continue;
      const p = join(dir, name);
      if (now - statSync(p).mtimeMs > PARTIAL_STALE_MS) {
        rmSync(p, { recursive: true, force: true });
        removed.push(name);
      }
    }
  }
  return removed;
}
