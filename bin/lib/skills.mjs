// skills.mjs — optional-skill management for the `fcore skills` command.
// list / add / remove the opt-in lifecycle skills, copying from a fcore checkout
// and tracking the selection in the project marker's `optionalSkills`.
//
// CLI-only module: lives under bin/lib/, NOT scripts/lib/ (which ships wholesale
// into projects via the installer allowlist). Reads the registry + marker
// helpers from scripts/lib/ — that direction (bin → scripts/lib) is fine; only
// the reverse (CLI logic in scripts/lib) is forbidden.

import { cpSync, existsSync, lstatSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { OPTIONAL_SKILLS, OPTIONAL_NAMES, optionalByName } from '../../scripts/lib/baseline.mjs';
import { readMarker, writeMarker, validateMarker } from '../../scripts/lib/marker.mjs';

// Never write THROUGH a committed symlink — a symlinked path component would
// redirect the copy outside the project tree (same guard as sync-baseline).
function assertNoSymlinkComponents(projectRoot, rel) {
  let cur = projectRoot;
  for (const part of rel.split('/')) {
    cur = join(cur, part);
    let st = null;
    try { st = lstatSync(cur); } catch { break; } // ENOENT: rest created fresh
    if (st?.isSymbolicLink()) throw new Error(`refusing to write through symlink: ${rel}`);
  }
}

function selected(projectRoot) {
  const marker = readMarker(projectRoot);
  return { marker, list: marker.optionalSkills ?? [] };
}

/** { available: OPTIONAL_SKILLS, installed: string[] } for `skills list`. */
export function listSkills(projectRoot) {
  return { available: OPTIONAL_SKILLS, installed: selected(projectRoot).list };
}

/**
 * Install one optional skill: copy fcoreRoot/src → projectRoot/dst and record it
 * in the marker. Idempotent — a re-add with the dir already present and tracked
 * is a no-op. Returns { name, action: 'added' | 'already' }.
 */
export function addSkill({ name, projectRoot, fcoreRoot }) {
  const skill = optionalByName(name);
  if (!skill) throw new Error(`unknown optional skill: ${name} (valid: ${OPTIONAL_NAMES.join(', ')})`);

  const { marker, list } = selected(projectRoot);
  if (!marker.present) throw new Error('no fcore marker — set up the project before adding optional skills');
  const errors = validateMarker(marker);
  if (errors.length) throw new Error(`invalid marker: ${errors.join('; ')}`);
  const dstAbs = join(projectRoot, skill.dst);
  if (list.includes(name) && existsSync(dstAbs)) {
    return { name, action: 'already' };
  }

  const from = join(fcoreRoot, skill.src);
  if (!existsSync(from)) throw new Error(`missing in FleetCore checkout: ${skill.src}`);
  assertNoSymlinkComponents(projectRoot, skill.dst);
  mkdirSync(dirname(dstAbs), { recursive: true });
  cpSync(from, dstAbs, { recursive: true });

  const next = [...new Set([...list, name])].sort();
  const { present, invalid, ...rest } = marker;
  writeMarker(projectRoot, { ...rest, optionalSkills: next });
  return { name, action: 'added' };
}

/**
 * Remove one optional skill: delete projectRoot/dst and drop it from the marker.
 * Idempotent. Returns { name, action: 'removed' | 'absent' }.
 */
export function removeSkill({ name, projectRoot }) {
  const skill = optionalByName(name);
  if (!skill) throw new Error(`unknown optional skill: ${name} (valid: ${OPTIONAL_NAMES.join(', ')})`);

  const { marker, list } = selected(projectRoot);
  if (!marker.present) throw new Error('no fcore marker — nothing to manage in this project');
  const dstAbs = join(projectRoot, skill.dst);
  if (!list.includes(name) && !existsSync(dstAbs)) {
    return { name, action: 'absent' };
  }
  assertNoSymlinkComponents(projectRoot, skill.dst);
  rmSync(dstAbs, { recursive: true, force: true });

  const next = list.filter((n) => n !== name);
  const { present, invalid, ...rest } = marker;
  const fields = { ...rest };
  if (next.length) fields.optionalSkills = next;
  else delete fields.optionalSkills; // keep markers byte-stable when none remain
  writeMarker(projectRoot, fields);
  return { name, action: 'removed' };
}
