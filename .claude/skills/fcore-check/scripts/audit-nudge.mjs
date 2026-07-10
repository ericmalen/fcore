#!/usr/bin/env node
// audit-nudge — optional end-of-session conscience for set-up projects (CC/VS Code
// Stop hook). Mirrors the docs-nudge pattern: no network, never blocks, exits 0
// ALWAYS. One line if the repo has drifted off the fcore target state; silent
// when clean or when no fcore checkout is reachable.
//
// Opt-in wiring (.claude/settings.json — read by Claude Code AND VS Code):
//   "hooks": { "Stop": [ { "hooks": [ { "type": "command",
//     "command": "node .claude/skills/fcore-check/scripts/audit-nudge.mjs" } ] } ] }
//
// FleetCore lookup order (no clone — speed + offline): $FCORE_HOME,
// .claude/fcore-onboard (during setup), the npx-staged
// release at this project's pin (~/.fcore/versions/<pin>),
// ~/tools/fcore, then the repo itself (FleetCore is self-set-up).
// Absent checkout → silent.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

function markerPin() {
  try {
    const m = JSON.parse(readFileSync(resolve('.claude/fcore.json'), 'utf8'));
    return m.pin ?? (m.standard ? `v${m.standard}` : null);
  } catch {
    return null;
  }
}

function findAudit() {
  const home = process.env.FCORE_HOME;
  const pin = markerPin();
  const candidates = [
    home && join(home, 'scripts', 'audit.mjs'),
    resolve('.claude/fcore-onboard/scripts/audit.mjs'),
    pin && join(homedir(), '.fcore', 'versions', pin, 'scripts', 'audit.mjs'),
    join(homedir(), 'tools', 'fcore', 'scripts', 'audit.mjs'),
    resolve('scripts/audit.mjs'),
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}

try {
  const auditPath = findAudit();
  if (!auditPath) process.exit(0); // FleetCore absent — nothing to nudge against

  const res = spawnSync(process.execPath, [auditPath, '--root', '.', '--json'],
    { encoding: 'utf8', timeout: 10000 });
  if (!res.stdout) process.exit(0);

  let report;
  try { report = JSON.parse(res.stdout); } catch { process.exit(0); }
  const s = report.summary ?? {};
  const errs = s.error ?? 0;
  const warns = s.warning ?? 0;
  if (errs + warns > 0) {
    const parts = [];
    if (errs) parts.push(`${errs} error${errs === 1 ? '' : 's'}`);
    if (warns) parts.push(`${warns} warning${warns === 1 ? '' : 's'}`);
    process.stdout.write(
      `[fcore] AI-config audit found ${parts.join(' and ')}. `
      + `Run the fcore-check skill to review and fix (rule IDs in spec/rules.md).\n`);
  }
  process.exit(0);
} catch {
  process.exit(0); // a nudge must never break a session
}
