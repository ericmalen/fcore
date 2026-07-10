// release.mjs — semver helpers and remote tag discovery (zero-dep).

import { spawnSync } from 'node:child_process';
import { isAbsolute } from 'node:path';

// toolRepo allowlist: https / git+https / ssh / git+ssh URLs, scp-style
// git@host:path, file:// URLs, and absolute filesystem paths (tests/dev flows).
const TOOL_REPO_URL_FORMS = [
  /^(?:git\+)?https:\/\/\S+$/,
  /^(?:git\+)?ssh:\/\/\S+$/,
  /^[\w.-]+@[\w.-]+:\S+$/, // scp-style, e.g. git@github.com:owner/repo.git
  /^file:\/\/\S+$/,
];

/**
 * Validate a marker toolRepo before it reaches git. The value comes from the
 * target repo's user-editable .claude/fcore.json, so reject anything that
 * git could interpret as an option (leading '-') or a transport helper
 * (`ext::sh -c ...` and friends), plus control characters.
 */
export function validateToolRepo(url) {
  const fail = (why) => {
    throw new Error(`invalid "toolRepo" in .claude/fcore.json: ${why}`);
  };
  if (typeof url !== 'string' || !url.trim()) fail('must be a non-empty string URL');
  const repo = url.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(repo)) fail('contains control characters');
  if (repo.startsWith('-')) fail(`leading "-" would be parsed as a git option (${repo})`);
  if (/^[^/\s]*::/.test(repo)) fail(`transport-helper syntax is not allowed (${repo})`);
  if (TOOL_REPO_URL_FORMS.some((re) => re.test(repo))) return repo;
  if (isAbsolute(repo)) return repo;
  fail(`unsupported form (${repo}); use https://, ssh://, git@host:path, file://, or an absolute path`);
}

// 0|[1-9]\d*: the spec forbids leading zeros in the version core
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

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

// SemVer §11: dot-separated identifiers; numeric ones compare numerically and
// sort below alphanumeric ones; a longer identifier set wins over its prefix.
function comparePrerelease(a, b) {
  if (a === b) return 0;
  if (!a) return 1; // release > any prerelease
  if (!b) return -1;
  const as = a.split('.');
  const bs = b.split('.');
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const x = as[i];
    const y = bs[i];
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return as.length < bs.length ? -1 : 1;
}

export function compareSemver(a, b) {
  const pa = typeof a === 'string' ? parseSemver(a.replace(/^v/, '')) : a;
  const pb = typeof b === 'string' ? parseSemver(b.replace(/^v/, '')) : b;
  if (!pa || !pb) return null;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/** List vX.Y.Z tags from a remote, newest first. Stable releases only (no prerelease). */
export function listRemoteTags(toolRepo) {
  const repo = validateToolRepo(toolRepo);
  const r = spawnSync('git', ['ls-remote', '--tags', '--', repo], { encoding: 'utf8' });
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

/**
 * npm/npx package spec for a toolRepo at a pin tag.
 * github.com https URLs → `github:owner/repo#tag` (codeload fast path);
 * anything else (ADO, GitLab, ssh) → `git+<url>#tag`.
 */
export function npxSpecFromToolRepo(toolRepo, pin) {
  const url = String(toolRepo).trim().replace(/\/+$/, '');
  const ref = pin ? `#${pin}` : '';
  const gh = url.match(/^(?:git\+)?https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (gh) return `github:${gh[1]}/${gh[2]}${ref}`;
  if (url.startsWith('git+')) return `${url}${ref}`;
  if (url.startsWith('git@')) return `git+ssh://${url.replace(':', '/')}${ref}`;
  return `git+${url}${ref}`;
}

export function shallowCloneAt(toolRepo, ref, dest) {
  const repo = validateToolRepo(toolRepo);
  const r = spawnSync('git', ['clone', '--depth', '1', '--branch', ref, '--', repo, dest], {
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    throw new Error(`git clone --branch ${ref} failed: ${(r.stderr || r.stdout).trim()}`);
  }
}
