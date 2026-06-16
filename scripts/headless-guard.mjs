#!/usr/bin/env node
// headless-guard — run/skip decision for scheduled orchestrator pipelines (F4).
// Thin CLI over lib/orchestration/{parse-tasks,headless-guard}.mjs so the CI
// templates need no inline module imports (they invoke this via npx at pin).
//
// Usage: node scripts/headless-guard.mjs [--root <dir>] [--open-branches <json-file>]
// Stdout: one `key=value` line each for run, reason, task (task empty when none).
//   GitHub: `... >> "$GITHUB_OUTPUT"` · ADO: parse lines into task.setvariable.
// Exit: 0 = decision made (either way) · 1 = tasks.md invalid/missing · 2 = usage

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTasksMd } from './lib/orchestration/parse-tasks.mjs';
import { decideHeadlessRun } from './lib/orchestration/headless-guard.mjs';
import { flagValue } from './lib/cli-args.mjs';

export function headlessGuard({ root, openBranches = [] }) {
  const { doc, errors } = parseTasksMd(readFileSync(join(resolve(root), 'tasks.md'), 'utf8'));
  if (errors.length) return { errors };
  return { decision: decideHeadlessRun({ tasksDoc: doc, openBranches }) };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const opt = { root: process.cwd(), openBranchesFile: null };
  const bad = (m) => { console.error(`headless-guard: ${m}`); process.exit(2); };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') opt.root = flagValue(args, i++, '--root', bad);
    else if (args[i] === '--open-branches') opt.openBranchesFile = flagValue(args, i++, '--open-branches', bad);
    else bad(`unknown flag ${args[i]}`);
  }

  let openBranches = [];
  if (opt.openBranchesFile) {
    try {
      openBranches = JSON.parse(readFileSync(opt.openBranchesFile, 'utf8'));
    } catch (e) {
      console.error(`headless-guard: cannot read open-branches file: ${e.message}`);
      process.exit(2);
    }
  }

  let result;
  try {
    result = headlessGuard({ root: opt.root, openBranches });
  } catch (e) {
    console.error(`headless-guard: ${e.message}`);
    process.exit(1);
  }
  if (result.errors) {
    console.error(result.errors.join('\n'));
    process.exit(1);
  }
  const d = result.decision;
  console.error(`guard: run=${d.run} reason=${d.reason} task=${d.taskId ?? '-'}`);
  process.stdout.write(`run=${d.run}\nreason=${d.reason}\ntask=${d.taskId ?? ''}\n`);
}
