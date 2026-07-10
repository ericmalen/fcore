#!/usr/bin/env node
// validate-orchestration-assert — mechanical post-run judge for a live
// feature-orchestrator session against a fixture built by
// build-orchestrated-fixture.mjs. Checks only what's file-shaped (tasks.md,
// handoff-log.jsonl, the routing region, the audit, docs/orchestration/runs/,
// git history) — everything transcript-soft (single-writer discipline,
// "stopped at PR/diff") stays a human/LLM judgment call, per
// .claude/skills/eval-runner/SKILL.md and .claude/skills/validate-orchestration/SKILL.md.
//
// Usage:
//   node scripts/validate-orchestration-assert.mjs --dir <target> --task <T-###>
//     --expect <pruned|done-with-ref|blocked> [--base <sha>] [--json]
//
// Exit: 0 all checks pass · 1 one or more checks failed · 2 usage error

import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { flagValue } from './lib/cli-args.mjs';
import { audit } from './audit.mjs';
import { parseTasksMd } from './lib/orchestration/parse-tasks.mjs';
import { validateTaskBacklog, validateHandoffLog } from './lib/orchestration/schemas.mjs';
import { renderOrchestrationRouting, ROUTING_REGION_START, ROUTING_REGION_END, RUNS_DIR } from './lib/orchestration/scaffold.mjs';

const EXPECTATIONS = new Set(['pruned', 'done-with-ref', 'blocked']);

function usageFail(msg) {
  console.error(`validate-orchestration-assert: ${msg}`);
  process.exit(2);
}

function parseArgs(argv) {
  const opt = { dir: null, task: null, expect: null, base: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') opt.dir = flagValue(argv, i++, '--dir', usageFail);
    else if (a === '--task') opt.task = flagValue(argv, i++, '--task', usageFail);
    else if (a === '--expect') opt.expect = flagValue(argv, i++, '--expect', usageFail);
    else if (a === '--base') opt.base = flagValue(argv, i++, '--base', usageFail);
    else if (a === '--json') opt.json = true;
    else usageFail(`unknown option ${a}`);
  }
  if (!opt.dir || !opt.task || !opt.expect) {
    usageFail('usage: node scripts/validate-orchestration-assert.mjs --dir <target> --task <T-###> --expect <pruned|done-with-ref|blocked> [--base <sha>] [--json]');
  }
  if (!EXPECTATIONS.has(opt.expect)) {
    usageFail(`--expect must be one of ${[...EXPECTATIONS].join(' | ')} (got ${opt.expect})`);
  }
  return opt;
}

const opt = parseArgs(process.argv.slice(2));
const dir = opt.dir;
if (!existsSync(dir)) usageFail(`no such directory: ${dir}`);

const checks = [];
const check = (name, pass, detail = '') => checks.push({ name, pass, detail });

function git(args) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
}

// ── tasks.md ─────────────────────────────────────────────────────────────

const tasksText = existsSync(join(dir, 'tasks.md')) ? readFileSync(join(dir, 'tasks.md'), 'utf8') : null;
let taskRow = null;
let taskSection = null;
if (tasksText == null) {
  check('tasks.md exists', false, 'missing');
} else {
  const { doc, errors } = parseTasksMd(tasksText);
  check('tasks.md parses', errors.length === 0, errors.join('; '));
  if (doc) {
    const backlogErrors = validateTaskBacklog(doc);
    check('tasks.md validates', backlogErrors.length === 0, backlogErrors.join('; '));
    for (const [section, tasks] of Object.entries(doc)) {
      const found = tasks.find((t) => t.id === opt.task);
      if (found) { taskRow = found; taskSection = section; }
    }
  }
}

// ── handoff-log.jsonl ────────────────────────────────────────────────────

const logPath = join(dir, 'docs', 'orchestration', 'handoff-log.jsonl');
const logLines = existsSync(logPath)
  ? readFileSync(logPath, 'utf8').split('\n').filter((l) => l.trim())
  : [];
const logEntries = [];
let logMalformed = 0;
for (const line of logLines) {
  let entry;
  try { entry = JSON.parse(line); } catch { logMalformed += 1; continue; }
  const errors = validateHandoffLog(entry);
  if (errors.length) logMalformed += 1; else logEntries.push(entry);
}
check('every handoff-log line is valid JSON matching the schema', logMalformed === 0, `${logMalformed} malformed line(s)`);

const taskCompletions = logEntries.filter((e) => e.event === 'completion' && e.task_id === opt.task);
const taskDispatches = logEntries.filter((e) => e.event !== 'completion' && e.task_id === opt.task);

// ── routing region (unaffected by a single task run, but cheap to reconfirm) ─

const agentsPath = join(dir, 'AGENTS.md');
const blueprintPath = join(dir, 'docs', 'orchestration', 'blueprint.json');
if (existsSync(agentsPath) && existsSync(blueprintPath)) {
  const bp = JSON.parse(readFileSync(blueprintPath, 'utf8'));
  const agentsText = readFileSync(agentsPath, 'utf8');
  const start = agentsText.indexOf(ROUTING_REGION_START);
  const end = agentsText.indexOf(ROUTING_REGION_END);
  const body = start !== -1 && end !== -1 ? agentsText.slice(start + ROUTING_REGION_START.length, end).trim() : null;
  const rendered = renderOrchestrationRouting(bp);
  const regionOk = body === (rendered == null ? null : rendered.trim());
  check('routing region still matches the renderer', regionOk, regionOk ? '' : 'region drifted or was removed during the run');
}

// ── audit: no errors, no R-56/R-57 findings ─────────────────────────────

const report = audit({ root: dir, strict: true });
const auditErrors = report.findings.filter((f) => f.severity === 'error');
const auditRouting = report.findings.filter((f) => f.rule === 'R-56' || f.rule === 'R-57');
check('audit has no error-severity findings', auditErrors.length === 0, auditErrors.map((f) => `${f.rule}: ${f.message}`).join('; '));
check('audit has no R-56/R-57 findings', auditRouting.length === 0, auditRouting.map((f) => `${f.rule}: ${f.message}`).join('; '));

// ── docs/orchestration/runs/ hygiene ─────────────────────────────────────

const runDir = join(dir, RUNS_DIR, opt.task);
const runDirCleanedUp = opt.expect === 'blocked' ? true : !existsSync(runDir);
check(
  opt.expect === 'blocked' ? 'runs/<task>/ check skipped (task not completed)' : `${RUNS_DIR}/${opt.task}/ was deleted`,
  runDirCleanedUp,
  existsSync(runDir) ? `${runDir} still present` : '',
);

if (opt.base) {
  const log = git(['log', '--name-only', '--pretty=format:', `${opt.base}..HEAD`]);
  const touchedRuns = log.status === 0 && log.stdout.split('\n').some((p) => p.trim().startsWith(RUNS_DIR));
  check(`no commit since ${opt.base} touches ${RUNS_DIR}`, !touchedRuns, touchedRuns ? 'a commit includes a runs/ path' : '');
}

// ── per-expectation checks ───────────────────────────────────────────────

function commitResolves(rev) {
  if (!rev) return false;
  const cat = spawnSync('git', ['cat-file', '-e', `${rev}^{commit}`], { cwd: dir, encoding: 'utf8' });
  return cat.status === 0;
}
function commitIsAncestor(rev) {
  if (!rev) return false;
  const r = spawnSync('git', ['merge-base', '--is-ancestor', rev, 'HEAD'], { cwd: dir, encoding: 'utf8' });
  return r.status === 0;
}

if (opt.expect === 'pruned') {
  check(`${opt.task} is absent from tasks.md`, taskRow === null, taskRow ? `found in ${taskSection}` : '');
  check(`exactly one completion entry for ${opt.task}`, taskCompletions.length === 1, `found ${taskCompletions.length}`);
  const commit = taskCompletions[0]?.commit;
  check('completion entry commit resolves in git', commitResolves(commit), commit ? '' : 'no commit field');
  const isAncestor = commitIsAncestor(commit);
  check('completion entry commit is an ancestor of HEAD', isAncestor, isAncestor ? '' : `${commit ?? '(none)'} is not an ancestor of HEAD`);
} else if (opt.expect === 'done-with-ref') {
  check(`${opt.task} is in Done`, taskSection === 'done', taskSection ? `found in ${taskSection}` : 'not found');
  check(`${opt.task} still carries its ref: line`, !!taskRow?.ref, taskRow ? '' : 'task not found');
  check(`exactly one completion entry for ${opt.task}`, taskCompletions.length === 1, `found ${taskCompletions.length}`);
  const commit = taskRow?.commit ?? taskCompletions[0]?.commit;
  check('Done commit resolves in git', commitResolves(commit), commit ? '' : 'no commit recorded');
  if (taskCompletions[0]?.commit && taskRow?.commit) {
    check('tasks.md commit matches the completion-entry commit', taskRow.commit === taskCompletions[0].commit,
      `${taskRow.commit} vs ${taskCompletions[0].commit}`);
  }
} else if (opt.expect === 'blocked') {
  check(`${opt.task} is in Backlog`, taskSection === 'backlog', taskSection ? `found in ${taskSection}` : 'not found');
  check(`${opt.task} carries a blocked: line`, !!taskRow?.blocked, taskRow ? '' : 'task not found');
  check(`no completion entry for ${opt.task}`, taskCompletions.length === 0, `found ${taskCompletions.length}`);
  const overRetried = taskDispatches.some((e) => e.retry_count > 1);
  check(`${opt.task}'s dispatches never exceed one retry`, !overRetried, overRetried ? 'a handoff entry has retry_count > 1' : '');
}

// ── report ────────────────────────────────────────────────────────────────

const failed = checks.filter((c) => !c.pass);
if (opt.json) {
  console.log(JSON.stringify({ dir, task: opt.task, expect: opt.expect, checks }, null, 2));
} else {
  for (const c of checks) {
    console.log(`[${c.pass ? 'pass' : 'FAIL'}] ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  }
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
}
process.exit(failed.length ? 1 : 0);
