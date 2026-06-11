// manifest.mjs — schema, loading, and syntactic validation for
// .setup/manifest.json. Semantic invariants live in check.mjs.
//
// Op vocabulary (complete by construction — keep verbatim / remove with
// reason / replace with declared bytes):
//   { node, op: "move",      target, slot? }
//   { node, op: "split",     ranges: [ { lines:[s,e], target, slot? }
//                                    | { lines:[s,e], op:"drop", reason } ] }
//   { file, op: "keep-file" }                       — file untouched; all its nodes accounted
//   { node, op: "drop",      reason }
//   { node, op: "merge",     literal, target, slot?, note? }
//   { node, op: "supersede", catalogSkill, note? }
//   { file, op: "out-of-scope", reason }            — sweep candidate ruled non-instructional
// Plus:
//   jsonMerges: [ { file, base } ]                  — key-level merge against Agent Base template
//   installs:   [ { file, template } | { file, literal } ]
//     — static file instantiation (starter template install: shim, settings, marker,
//       READMEs). Template slot markers are stripped. Output-side only.
//       (base-check is NOT installed here — it ships via install-setup.)
//
// Future maintainers: dispositions only. NEVER add input-classification ops.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifySurface } from './extract.mjs';

const NODE_OPS = new Set(['move', 'split', 'drop', 'merge', 'supersede']);
const FILE_OPS = new Set(['keep-file', 'out-of-scope']);

// Targets the materializer may write (scope-constrained; check enforces).
const ALLOWED_TARGET_PATTERNS = [
  /^AGENTS\.md$/, /^CLAUDE\.md$/, /^\.gitignore$/,
  /(^|\/)AGENTS\.md$/, /(^|\/)CLAUDE\.md$/,         // nested compat
  /^\.claude\//,
  /^\.vscode\/settings\.json$/,
  /^\.github\/copilot-instructions\.md$/,
  /^\.github\/instructions\//,
  /^docs\/ai\//,
];

export function isAllowedTarget(path, inventoriedPaths = null) {
  // Any Agent Base-canonical target location, or any recognized AI-config surface
  // (the scope invariant is "no writes outside AI-config surfaces" — whether a
  // given surface SHOULD exist after setup is the audit's layer, not check's).
  // Inventoried source files are also valid targets: forced-include MIXED files
  // (an AI section inside a human doc) are reassembled in place with their AI
  // sections routed out — without this, their non-AI content would be deleted.
  if (ALLOWED_TARGET_PATTERNS.some((re) => re.test(path))) return true;
  if (classifySurface(path) !== null) return true;
  return inventoriedPaths != null && inventoriedPaths.has(path);
}

export function loadManifest(adoptionDir) {
  const raw = readFileSync(join(adoptionDir, 'manifest.json'), 'utf8');
  return JSON.parse(raw);
}

export function loadInventory(adoptionDir) {
  return JSON.parse(readFileSync(join(adoptionDir, 'inventory.json'), 'utf8'));
}

// Syntactic validation: shapes only. Returns array of error strings.
export function validateShape(manifest) {
  const errors = [];
  const e = (m) => errors.push(m);

  if (manifest.schemaVersion !== 1) e(`schemaVersion must be 1 (got ${manifest.schemaVersion})`);
  if (!Array.isArray(manifest.entries)) { e('entries must be an array'); return errors; }

  manifest.entries.forEach((entry, i) => {
    const where = `entries[${i}]`;
    const op = entry.op;
    if (NODE_OPS.has(op)) {
      if (!entry.node) e(`${where}: op "${op}" requires "node"`);
    } else if (FILE_OPS.has(op)) {
      if (!entry.file) e(`${where}: op "${op}" requires "file"`);
    } else {
      e(`${where}: unknown op "${op}"`);
      return;
    }
    switch (op) {
      case 'move':
        if (!entry.target) e(`${where}: move requires "target"`);
        break;
      case 'split':
        if (!Array.isArray(entry.ranges) || entry.ranges.length === 0) {
          e(`${where}: split requires non-empty "ranges"`);
          break;
        }
        entry.ranges.forEach((r, j) => {
          const w = `${where}.ranges[${j}]`;
          if (!Array.isArray(r.lines) || r.lines.length !== 2
              || !Number.isInteger(r.lines[0]) || !Number.isInteger(r.lines[1])
              || r.lines[0] < 1 || r.lines[1] < r.lines[0]) {
            e(`${w}: lines must be [start, end], 1-based, start <= end`);
          }
          if (r.op === 'drop') {
            if (!r.reason) e(`${w}: drop range requires "reason"`);
          } else if (!r.target) {
            e(`${w}: range requires "target" (or op:"drop" with reason)`);
          }
        });
        break;
      case 'drop':
        if (!entry.reason) e(`${where}: drop requires "reason"`);
        break;
      case 'merge':
        if (!entry.literal) e(`${where}: merge requires "literal"`);
        if (!entry.target) e(`${where}: merge requires "target"`);
        break;
      case 'supersede':
        if (!entry.catalogSkill) e(`${where}: supersede requires "catalogSkill"`);
        break;
      case 'out-of-scope':
        if (!entry.reason) e(`${where}: out-of-scope requires "reason"`);
        break;
    }
  });

  for (const [i, jm] of (manifest.jsonMerges ?? []).entries()) {
    if (!jm.file) errors.push(`jsonMerges[${i}]: requires "file"`);
    if (!jm.base) errors.push(`jsonMerges[${i}]: requires "base" (Agent Base template path)`);
  }

  for (const [i, ins] of (manifest.installs ?? []).entries()) {
    if (!ins.file) errors.push(`installs[${i}]: requires "file"`);
    if (!ins.template && !ins.literal) errors.push(`installs[${i}]: requires "template" or "literal"`);
    if (ins.template && ins.literal) errors.push(`installs[${i}]: "template" and "literal" are mutually exclusive`);
  }

  return errors;
}

// Index entries by referenced node id (split counted once). Throws nothing.
export function entriesByNode(manifest) {
  const map = new Map();
  for (const entry of manifest.entries) {
    if (!entry.node) continue;
    if (!map.has(entry.node)) map.set(entry.node, []);
    map.get(entry.node).push(entry);
  }
  return map;
}

export function keepFiles(manifest) {
  return new Set(manifest.entries.filter((x) => x.op === 'keep-file').map((x) => x.file));
}

export function outOfScopeFiles(manifest) {
  return new Set(manifest.entries.filter((x) => x.op === 'out-of-scope').map((x) => x.file));
}
