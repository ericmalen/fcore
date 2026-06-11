// release.mjs — semver helpers and remote tag discovery (zero-dep).

import { spawnSync } from 'node:child_process';

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

export function parseSemver(s) {
  if (typeof s !== 'string') return null;
  const m = s.trim().replace(/^v/, '').match(SEMVER_RE);
  if (!m) return null;
  return {
    major: +m[1],
    minor: +m[2],
    patch: +m[3],
    prerelease: m[4] ?? '',
    build: m[5] ?? '',
    raw: `${m[1]}.${m[2]}.${m[3]}${m[4] ? `-${m[4]}` : ''}`,
  };
}

export function tagToSemver(tag) {
  return parseSemver(String(tag).replace(/^v/, ''));
}

export function compareSemver(a, b) {
  const pa = typeof a === 'string' ? parseSemver(a.replace(/^v/, '')) : a;
  const pb = typeof b === 'string' ? parseSemver(b.replace(/^v/, '')) : b;
  if (!pa || !pb) return null;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  if (pa.prerelease === pb.prerelease) return 0;
  if (!pa.prerelease) return 1;
  if (!pb.prerelease) return -1;
  return pa.prerelease < pb.prerelease ? -1 : pa.prerelease > pb.prerelease ? 1 : 0;
}

/** List vX.Y.Z tags from a remote, newest first. Stable releases only (no prerelease). */
export function listRemoteTags(toolRepo) {
  const r = spawnSync('git', ['ls-remote', '--tags', toolRepo], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ls-remote failed: ${(r.stderr || r.stdout).trim()}`);
  }
  const tags = new Set();
  for (const line of (r.stdout || '').split('\n')) {
    const m = line.match(/refs\/tags\/(v?\d+\.\d+\.\d+)(?:\^\{\})?$/);
    if (m) tags.add(m[1].startsWith('v') ? m[1] : `v${m[1]}`);
  }
  return [...tags]
    .map((tag) => ({ tag, semver: tagToSemver(tag) }))
    .filter((t) => t.semver && !t.semver.prerelease)
    .sort((a, b) => compareSemver(b.semver, a.semver));
}

export function latestCompatibleTag(tags, currentPin, { allowMajor = false } = {}) {
  if (!tags.length) return null;
  const cur = currentPin ? tagToSemver(currentPin) : null;
  if (!cur || allowMajor) return tags[0].tag;
  const sameMajor = tags.filter((t) => t.semver.major === cur.major);
  return (sameMajor[0] ?? tags.find((t) => t.semver.major === cur.major))?.tag ?? null;
}

export function shallowCloneAt(toolRepo, ref, dest) {
  const r = spawnSync('git', ['clone', '--depth', '1', '--branch', ref, toolRepo, dest], {
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    throw new Error(`git clone --branch ${ref} failed: ${(r.stderr || r.stdout).trim()}`);
  }
}
