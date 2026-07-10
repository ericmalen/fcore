// marker.mjs — FleetCore marker (.claude/fcore.json) read/write/validate.

import { readFileSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { stripJsonComments } from './extract.mjs';
import { parseSemver, tagToSemver } from './release.mjs';
import { OPTIONAL_NAMES } from './baseline.mjs';

export const MARKER_PATH = '.claude/fcore.json';

export const REQUIRED_MARKER_FIELDS = [
  'standard',
  'toolRepo',
  'setupAt',
  'githubCodeReview',
];

export const PIN_FIELDS = ['pin', 'lastSyncedAt'];

export const DEFAULT_TOOL_REPO = 'https://github.com/ericmalen/fcore';

export function readMarker(root) {
  const abs = join(root, MARKER_PATH);
  if (!existsSync(abs)) return { present: false };
  try {
    const parsed = JSON.parse(stripJsonComments(readFileSync(abs, 'utf8')));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { present: true, invalid: true };
    }
    return { present: true, ...parsed };
  } catch {
    return { present: true, invalid: true };
  }
}

export function writeMarker(root, fields) {
  const abs = join(root, MARKER_PATH);
  // never write THROUGH a committed symlink — it would clobber out-of-tree files
  let st = null;
  try { st = lstatSync(abs); } catch { /* ENOENT: fresh marker */ }
  if (st?.isSymbolicLink()) throw new Error(`refusing to write marker through symlink: ${abs}`);
  writeFileSync(abs, `${JSON.stringify(fields, null, 2)}\n`, 'utf8');
}

export function validateMarker(marker) {
  const errors = [];
  if (!marker?.present) {
    errors.push('marker missing');
    return errors;
  }
  if (marker.invalid) {
    errors.push('marker is not valid JSON');
    return errors;
  }
  for (const k of REQUIRED_MARKER_FIELDS) {
    // == null: an explicit null is as missing as an absent key — letting it
    // through yields a "vnull" pin and skips the cross-major guard downstream
    if (marker[k] == null) errors.push(`missing required field "${k}"`);
  }
  if (marker.standard != null && parseSemver(String(marker.standard)) == null) {
    errors.push('standard must be semver (e.g. 1.4.0)');
  }
  if (marker.pin != null) {
    const v = tagToSemver(String(marker.pin));
    if (v == null) errors.push('pin must be a semver tag (e.g. v1.4.0)');
  }
  if (marker.toolRepo != null && typeof marker.toolRepo !== 'string') {
    errors.push('toolRepo must be a string URL');
  }
  if (marker.optionalSkills != null) {
    if (!Array.isArray(marker.optionalSkills) || marker.optionalSkills.some((s) => typeof s !== 'string')) {
      errors.push('optionalSkills must be an array of strings');
    } else {
      const unknown = marker.optionalSkills.filter((s) => !OPTIONAL_NAMES.includes(s));
      if (unknown.length) errors.push(`optionalSkills has unknown skill(s): ${unknown.join(', ')}`);
    }
  }
  return errors;
}

/** Build a fresh marker for starter emit / post-setup merge. */
export function buildMarker({
  standard,
  toolRepo = DEFAULT_TOOL_REPO,
  pin,
  setupAt,
  lastSyncedAt,
  githubCodeReview = false,
  optionalSkills = [],
}) {
  const today = new Date().toISOString().slice(0, 10);
  const semver = parseSemver(String(standard).replace(/^v/, ''));
  const pinTag = pin ?? (semver ? `v${semver.raw}` : undefined);
  return {
    standard: semver?.raw ?? String(standard),
    toolRepo,
    ...(pinTag ? { pin: pinTag } : {}),
    lastSyncedAt: lastSyncedAt ?? setupAt ?? today,
    setupAt: setupAt ?? today,
    githubCodeReview,
    // Emit only when non-empty so markers without optionals stay byte-stable.
    ...(optionalSkills.length ? { optionalSkills: [...optionalSkills].sort() } : {}),
  };
}
