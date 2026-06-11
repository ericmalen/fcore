#!/usr/bin/env node
// audit-nudge — optional end-of-session conscience for set-up projects (CC/VS Code
// Stop hook). Mirrors the docs-nudge pattern: no network, never blocks, exits 0
// ALWAYS. One line if the repo has drifted off the agent-base target state; silent
// when clean or when no Agent Base checkout is reachable.
//
// Opt-in wiring (.claude/settings.json — read by Claude Code AND VS Code):
//   "hooks": { "Stop": [ { "hooks": [ { "type": "command",
//     "command": "node .claude/skills/base-check/scripts/audit-nudge.mjs" } ] } ] }
//
// Agent Base lookup order (no clone — speed + offline): $AGENT_BASE_HOME (or legacy
// $AI_KIT_HOME), .claude/agent-base-setup (during setup), ~/tools/agent-base,
// then the repo itself (Agent Base is self-set-up). Absent clone → silent.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

function findAudit() {
  const home = process.env.AGENT_BASE_HOME || process.env.AI_KIT_HOME;
  const candidates = [
    home && join(home, 'scripts', 'audit.mjs'),
    resolve('.claude/agent-base-setup/scripts/audit.mjs'),
    join(homedir(), 'tools', 'agent-base', 'scripts', 'audit.mjs'),
    resolve('scripts/audit.mjs'),
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}

try {
  const auditPath = findAudit();
  if (!auditPath) process.exit(0); // Agent Base absent — nothing to nudge against

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
      `[agent-base] AI-config audit found ${parts.join(' and ')}. `
      + `Run the base-check skill to review and fix (rule IDs in spec/rules.md).\n`);
  }
  process.exit(0);
} catch {
  process.exit(0); // a nudge must never break a session
}
