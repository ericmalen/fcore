// marker.mjs — Agent Base marker (.claude/agent-base.json) read/write/validate.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stripJsonComments } from './extract.mjs';
import { parseSemver, tagToSemver } from './release.mjs';

export const MARKER_PATH = '.claude/agent-base.json';

export const REQUIRED_MARKER_FIELDS = [
  'standard',
  'toolRepo',
  'setupAt',
  'githubCodeReview',
];

export const PIN_FIELDS = ['pin', 'lastSyncedAt'];

export const DEFAULT_TOOL_REPO = 'https://github.com/ericmalen/agent-base';

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
    if (marker[k] === undefined) errors.push(`missing required field "${k}"`);
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
  };
}
