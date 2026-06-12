#!/usr/bin/env node
// rule-check-map — R-51 integrity gate for the Agent Base repo's own CI.
//
// spec/rules.md is the single source of truth. Every MECHANICAL rule whose
// enforcement column names `audit` must have a matching check that emits its
// R-ID in scripts/lib/audit/checks.mjs, and no check may emit an R-ID that the
// catalog does not define. This catches a rule going orphaned (added to the
// spec, never wired) or a check drifting onto a stale/retired ID.
//
// Rules enforced elsewhere (enforcement column = "Agent Base CI", e.g. R-51 itself)
// are exempt from the "must have an audit check" requirement.
//
// Also gates --strict escalation fidelity: every "normal → strict" arrow in the
// spec must have a matching entry in audit.mjs STRICT_ESCALATION (same target
// severity), and the map may not carry entries the spec shows no arrow for.
//
// Usage: node scripts/rule-check-map.mjs [--root <dir>] [--json]
// Exit 0 = clean, 1 = findings.

import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Bold rule definition: **R-NN · title** · <type> · <enforcement+severity>
// Title may itself contain emphasis (e.g. *(compat)*), so match lazily to the
// closing ** rather than excluding asterisks.
const RULE_DEF_RE = /^\*\*(R-\d+)\b[\s\S]*?\*\*\s*·\s*([^·\n]+?)\s*·\s*([^\n]+)$/gm;
// Emission in checks: F('R-NN', ...) or F("R-NN", ...)
const EMIT_RE = /\bF\(\s*['"](R-\d+)['"]/g;

export function parseRules(rulesText) {
  const defined = new Set();
  const mechanicalAudit = new Set();
  const strictArrows = new Map(); // id → strict-mode severity (the arrow target)
  let m;
  RULE_DEF_RE.lastIndex = 0;
  while ((m = RULE_DEF_RE.exec(rulesText)) !== null) {
    const [, id, type, enforcement] = m;
    defined.add(id);
    const isMechanical = /mechanical/i.test(type);
    const isAudit = /\baudit\b/i.test(enforcement);
    if (isMechanical && isAudit) {
      mechanicalAudit.add(id);
      const arrow = enforcement.match(/audit,\s*\w+\s*→\s*(\w+)/);
      if (arrow) strictArrows.set(id, arrow[1]);
    }
  }
  return { defined, mechanicalAudit, strictArrows };
}

// STRICT_ESCALATION map in audit.mjs, parsed as text (same approach as the
// emissions — keeps --root usable against any checkout).
export function parseEscalation(auditText) {
  const block = auditText.match(/STRICT_ESCALATION\s*=\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const map = new Map();
  for (const m of block.matchAll(/['"](R-\d+)['"]\s*:\s*['"](\w+)['"]/g)) map.set(m[1], m[2]);
  return map;
}

export function parseEmitted(checksText) {
  const emitted = new Set();
  let m;
  EMIT_RE.lastIndex = 0;
  while ((m = EMIT_RE.exec(checksText)) !== null) emitted.add(m[1]);
  return emitted;
}

export function run(root = baseRoot) {
  const rulesText = readFileSync(join(root, 'spec', 'rules.md'), 'utf8');
  const checksText = readFileSync(join(root, 'scripts', 'lib', 'audit', 'checks.mjs'), 'utf8');
  let auditText = '';
  try { auditText = readFileSync(join(root, 'scripts', 'audit.mjs'), 'utf8'); } catch { /* no escalation map to gate */ }
  const { defined, mechanicalAudit, strictArrows } = parseRules(rulesText);
  const emitted = parseEmitted(checksText);
  const escalation = parseEscalation(auditText);

  const findings = [];
  // (a) a mechanical/audit rule with no emitting check → orphaned rule
  for (const id of mechanicalAudit) {
    if (!emitted.has(id)) {
      findings.push({ rule: id, kind: 'orphan-rule',
        message: `mechanical rule ${id} is enforced by "audit" in spec/rules.md but no check emits it (R-51).` });
    }
  }
  // (b) a check emitting an R-ID the catalog does not define → stale/unknown
  for (const id of emitted) {
    if (!defined.has(id)) {
      findings.push({ rule: id, kind: 'unknown-emission',
        message: `checks.mjs emits ${id} but spec/rules.md defines no such rule (retired or typo) (R-51).` });
    }
  }
  // (c) a spec → arrow with no matching STRICT_ESCALATION entry → strict drift
  for (const [id, target] of strictArrows) {
    if (escalation.get(id) !== target) {
      findings.push({ rule: id, kind: 'missing-escalation',
        message: `spec escalates ${id} to "${target}" under --strict but audit.mjs STRICT_ESCALATION ${escalation.has(id) ? `maps it to "${escalation.get(id)}"` : 'has no entry for it'} (R-51).` });
    }
  }
  // (d) a STRICT_ESCALATION entry the spec shows no arrow for → stale escalation
  for (const [id, target] of escalation) {
    if (!strictArrows.has(id)) {
      findings.push({ rule: id, kind: 'stale-escalation',
        message: `audit.mjs STRICT_ESCALATION escalates ${id} to "${target}" but spec/rules.md shows no → arrow for it (R-51).` });
    }
  }
  return findings.sort((a, b) => a.rule.localeCompare(b.rule));
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  let root = baseRoot;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') root = resolve(args[++i]);
    else if (args[i] === '--json') json = true;
    else { console.error(`rule-check-map: unknown flag ${args[i]}`); process.exit(2); }
  }
  const findings = run(root);
  if (json) {
    console.log(JSON.stringify({ root, findings }, null, 2));
  } else if (findings.length === 0) {
    console.log('rule-check-map: clean — every mechanical rule maps to a check, no stale emissions, strict escalation in sync.');
  } else {
    for (const f of findings) console.error(`  [${f.kind}] ${f.rule}  ${f.message}`);
    console.error(`\n${findings.length} integrity finding(s) — see spec/rules.md and scripts/lib/audit/checks.mjs.`);
  }
  process.exit(findings.length ? 1 : 0);
}
