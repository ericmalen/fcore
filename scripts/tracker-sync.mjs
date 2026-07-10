#!/usr/bin/env node
// tracker-sync — tasks.md ⇄ work tracker bridge (F3, DD-14).
//
// Tracker is intake, tasks.md is canonical execution state: new tracker
// items import as Backlog tasks (scope: triage, blocked until scoped);
// task status pushes out as tracker state + comment. Conflicts are reported
// and left for a human. DRY-RUN IS THE DEFAULT — nothing is written without
// --apply.
//
// Usage (from a fcore clone or installed scripts/):
//   node tracker-sync.mjs --target /path/to/project            # dry-run plan
//   node tracker-sync.mjs --target /path/to/project --apply    # write + push
//
// Options:
//   --target <dir>       project root (default cwd)
//   --platform ado|gh|auto  tracker platform (default auto: existing refs,
//                        then config, then git remote origin)
//   --state-map basic|agile  ADO process template states (default basic,
//                        overridable in docs/orchestration/tracker-sync.json)
//   --items-file <json>  read NORMALIZED tracker items from a file instead of
//                        the tracker — offline mode: no remote reads OR pushes
//                        (test hook / air-gapped dry-runs)
//   --apply              write tasks.md and push tracker updates
//   --json               machine-readable stdout
//
// Env (ADO online mode): ADO_ORG, ADO_PROJECT, AZURE_DEVOPS_PAT.
// GitHub online mode uses the gh CLI's own auth.
//
// Exit: 0 synced/clean · 1 conflicts present · 2 usage/env/parse error

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { parseTasksMd, renderTasksMd } from './lib/orchestration/parse-tasks.mjs';
import {
  validateSyncPlan, validateTaskBacklog, validateTrackerSyncConfig,
} from './lib/orchestration/schemas.mjs';
import { applyImports, applyPrunes, computeSyncPlan, renderSyncReport } from './lib/orchestration/tracker-sync.mjs';
import * as ado from './lib/orchestration/tracker-ado.mjs';
import * as gh from './lib/orchestration/tracker-gh.mjs';

function parseArgs(argv) {
  const opt = {
    target: process.cwd(),
    platform: 'auto',
    stateMap: null,
    itemsFile: null,
    apply: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') opt.target = resolve(argv[++i]);
    else if (a === '--platform') opt.platform = argv[++i];
    else if (a === '--state-map') opt.stateMap = argv[++i];
    else if (a === '--items-file') opt.itemsFile = resolve(argv[++i]);
    else if (a === '--apply') opt.apply = true;
    else if (a === '--json') opt.json = true;
    else { console.error(`unknown option ${a}`); process.exit(2); }
  }
  if (!['ado', 'gh', 'auto'].includes(opt.platform)) {
    console.error(`--platform must be ado | gh | auto (got ${opt.platform})`);
    process.exit(2);
  }
  return opt;
}

function fail(msg) {
  console.error(`tracker-sync: ${msg}`);
  process.exit(2);
}

function detectPlatform(doc, config, target) {
  const refs = [...doc.backlog, ...doc.inProgress, ...doc.done]
    .map((t) => t.ref).filter(Boolean);
  if (refs.some((r) => r.startsWith('AB#'))) return 'ado';
  if (refs.length) return 'gh';
  if (config?.platform) return config.platform;
  const res = spawnSync('git', ['-C', target, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
  const url = res.status === 0 ? res.stdout.trim() : '';
  if (/dev\.azure\.com|visualstudio\.com/.test(url)) return 'ado';
  if (/github\.com/.test(url)) return 'gh';
  return null;
}

const opt = parseArgs(process.argv.slice(2));

const tasksPath = join(opt.target, 'tasks.md');
if (!existsSync(tasksPath)) fail(`no tasks.md at ${tasksPath}`);
const { doc, errors: parseErrors } = parseTasksMd(readFileSync(tasksPath, 'utf8'));
if (parseErrors.length) fail(`tasks.md does not parse:\n  ${parseErrors.join('\n  ')}`);

let config = null;
const configPath = join(opt.target, 'docs', 'orchestration', 'tracker-sync.json');
if (existsSync(configPath)) {
  config = JSON.parse(readFileSync(configPath, 'utf8'));
  const configErrors = validateTrackerSyncConfig(config);
  if (configErrors.length) fail(`invalid ${configPath}:\n  ${configErrors.join('\n  ')}`);
}

const platform = opt.platform === 'auto' ? detectPlatform(doc, config, opt.target) : opt.platform;
if (!platform) fail('cannot detect platform — pass --platform ado|gh or add docs/orchestration/tracker-sync.json');

const stateMap = opt.stateMap ?? config?.ado?.stateMap ?? 'basic';
const offline = opt.itemsFile !== null;

// ── list tracker items ──────────────────────────────────────────────────────

let items;
let adoCtx = null;
if (offline) {
  items = JSON.parse(readFileSync(opt.itemsFile, 'utf8'));
} else if (platform === 'ado') {
  const org = process.env.ADO_ORG ?? config?.ado?.org;
  const project = process.env.ADO_PROJECT ?? config?.ado?.project;
  const pat = process.env.AZURE_DEVOPS_PAT;
  if (!org || !project) fail('ADO needs ADO_ORG + ADO_PROJECT env vars (or ado.org/project in tracker-sync.json)');
  if (!pat) fail('ADO needs the AZURE_DEVOPS_PAT env var (secrets are env-only, never config)');
  adoCtx = { org, project, pat, stateMap };
  items = await ado.listItems(adoCtx);
} else {
  items = gh.listItems({ cwd: opt.target });
}

const unknown = items.filter((it) => it.state === null);
for (const it of unknown) {
  console.error(`warning: ${it.externalId} has unmapped tracker state "${it.rawState}" — skipped (check --state-map)`);
}

// ── compute, report, apply ──────────────────────────────────────────────────

const plan = computeSyncPlan(doc, items, platform);
const planErrors = validateSyncPlan(plan);
if (planErrors.length) fail(`internal error — computed plan invalid:\n  ${planErrors.join('\n  ')}`);

if (!opt.apply) {
  process.stdout.write(opt.json ? JSON.stringify({ ...plan, applied: false }, null, 2) + '\n' : renderSyncReport(plan));
  process.exit(plan.conflicts.length ? 1 : 0);
}

// Push first, so a Done task needing a push to reach `done` is only pruned
// once that push actually succeeds — plan.prunes alone (pre-push) covers just
// the already-synced case, safe under offline mode too since no push was
// needed there.
let pushed = 0;
const confirmedPrunes = [...plan.prunes];
if (!offline) {
  for (const update of plan.statusUpdates) {
    if (platform === 'ado') await ado.pushUpdate(adoCtx, update);
    else gh.pushUpdate({ cwd: opt.target }, update);
    pushed += 1;
    if (update.to === 'done') confirmedPrunes.push(update.taskId);
  }
}

// Writes: imports + confirmed prunes into tasks.md (parse → mutate → render
// → validate → write). Done is a transient holding area for ref'd tasks
// awaiting sync; the handoff log's completion entry is the permanent record.
if (plan.imports.length || confirmedPrunes.length) {
  let next = doc;
  if (plan.imports.length) next = applyImports(next, plan.imports);
  if (confirmedPrunes.length) next = applyPrunes(next, confirmedPrunes);
  const backlogErrors = validateTaskBacklog(next);
  if (backlogErrors.length) fail(`refusing to write tasks.md — result invalid:\n  ${backlogErrors.join('\n  ')}`);
  writeFileSync(tasksPath, renderTasksMd(next));
}

if (opt.json) {
  process.stdout.write(JSON.stringify({ ...plan, prunes: confirmedPrunes, applied: true, pushed, offline }, null, 2) + '\n');
} else {
  process.stdout.write(renderSyncReport({ ...plan, prunes: confirmedPrunes }));
  process.stdout.write(`applied: ${plan.imports.length} import(s), ${confirmedPrunes.length} prune(s) written to tasks.md, ${pushed} update(s) pushed${offline ? ' (offline — pushes skipped)' : ''}\n`);
}
process.exit(plan.conflicts.length ? 1 : 0);
