#!/usr/bin/env node
// audit — target-state conformance, findings keyed by rule ID (spec/rules.md).
// Closed world only: checks Agent Base-defined target state, never classifies inputs.
//
// Usage: node scripts/audit.mjs [--root <dir>] [--json] [--strict]
// Exit:  0 = pass · 1 = findings above threshold (errors; with --strict, any)

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMarker } from './lib/audit/util.mjs';
import {
  checkRootInstructions, checkShim, checkPathScoping, checkSkills,
  checkAgents, checkReferences, checkClaudeSettings, checkVscodeSettings,
  checkHygiene,
} from './lib/audit/checks.mjs';

// --strict escalation (spec: "normal → strict" arrows)
const STRICT_ESCALATION = {
  'R-04': 'warning',
  'R-11': 'error',
  'R-15': 'error',
  'R-22': 'warning',
  'R-27': 'warning',
  'R-43': 'warning',
  'R-44': 'error',
  'R-47': 'warning',
  'R-48': 'warning',
};

export function audit({ root, strict = false }) {
  root = resolve(root);
  const ctx = { root, marker: readMarker(root), compatMode: false };

  const findings = [
    ...checkRootInstructions(ctx),
    ...checkShim(ctx),
    ...checkPathScoping(ctx), // sets ctx.compatMode — must run before vscode check
    ...checkSkills(ctx),
    ...checkAgents(ctx),
    ...checkReferences(ctx),
    ...checkClaudeSettings(ctx),
    ...checkVscodeSettings(ctx),
    ...checkHygiene(ctx),
  ];

  if (strict) {
    for (const f of findings) {
      if (STRICT_ESCALATION[f.rule]) f.severity = STRICT_ESCALATION[f.rule];
    }
  }

  const summary = { error: 0, warning: 0, info: 0 };
  for (const f of findings) summary[f.severity] = (summary[f.severity] ?? 0) + 1;

  return {
    schemaVersion: 1,
    scannedAt: new Date().toISOString(),
    root,
    strict,
    summary,
    findings,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const opt = { root: process.cwd(), json: false, strict: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') opt.root = args[++i];
    else if (args[i] === '--json') opt.json = true;
    else if (args[i] === '--strict') opt.strict = true;
    else { console.error(`audit: unknown flag ${args[i]}`); process.exit(2); }
  }

  const report = audit(opt);

  if (opt.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.findings.length === 0) {
    console.log('audit: clean — no findings.');
  } else {
    const byFile = new Map();
    for (const f of report.findings) {
      if (!byFile.has(f.file)) byFile.set(f.file, []);
      byFile.get(f.file).push(f);
    }
    for (const [file, fs] of byFile) {
      console.log(file);
      for (const f of fs) {
        const loc = f.line != null ? `:${f.line}` : '';
        console.log(`  [${f.severity}] ${f.rule}${loc}  ${f.message}`);
      }
    }
    const s = report.summary;
    console.log(`\n${s.error} error(s), ${s.warning} warning(s), ${s.info} info — see spec/rules.md for rule details.`);
  }

  const failed = opt.strict
    ? report.findings.length > 0
    : report.summary.error > 0;
  process.exit(failed ? 1 : 0);
}
