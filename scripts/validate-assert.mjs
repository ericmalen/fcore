#!/usr/bin/env node
// validate-assert — mechanical after setup assertions for one fixture run.
// The validation orchestrator calls this after the phases complete; it turns
// "did it work" into exit codes and JSON, not judgment.
//
// Usage: node scripts/validate-assert.mjs --fixture <name> --dir <repoDir> [--json]
// Exit: 0 = all assertions pass · 1 = failures (listed)

import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fixtures } from '../test/fixtures/defs.mjs';

const baseRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const opt = { fixture: null, dir: null, json: false };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--fixture') opt.fixture = args[++i];
  else if (args[i] === '--dir') opt.dir = args[++i];
  else if (args[i] === '--json') opt.json = true;
}
if (!opt.fixture || !opt.dir || !fixtures[opt.fixture]) {
  console.error(`usage: validate-assert --fixture <${Object.keys(fixtures).join('|')}> --dir <repo>`);
  process.exit(2);
}
const dir = resolve(opt.dir);
const def = fixtures[opt.fixture];
const failures = [];
const results = { fixture: opt.fixture, dir };

const run = (cmd, cmdArgs, cwd = dir) => spawnSync(cmd, cmdArgs, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const git = (...a) => { const r = run('git', a); if (r.status !== 0) throw new Error(r.stderr); return (r.stdout ?? '').trim(); };

// 1. Gates: check + audit exit 0 (skip for pure-starter with no .setup)
const hasSetup = existsSync(join(dir, '.setup'))
  && existsSync(join(dir, '.claude/agent-base-setup/scripts/check.mjs'));
if (hasSetup) {
  const check = run(process.execPath, [join(dir, '.claude/agent-base-setup/scripts/check.mjs'), '--root', dir,
    '--templates', join(dir, '.claude/agent-base-setup/templates')]);
  results.checkExit = check.status;
  if (check.status !== 0) failures.push(`check.mjs exit ${check.status}: ${check.stdout.trim().slice(0, 400)}`);
  const audit = run(process.execPath, [join(dir, '.claude/agent-base-setup/scripts/audit.mjs'), '--root', dir]);
  results.auditExit = audit.status;
  if (audit.status !== 0) failures.push(`audit.mjs exit ${audit.status}: ${audit.stdout.trim().slice(0, 400)}`);
} else {
  results.note = 'no .setup dir (starter path or already merged)';
  const audit = run(process.execPath, [join(baseRoot, 'scripts/audit.mjs'), '--root', dir]);
  results.auditExit = audit.status;
  if (audit.status !== 0) failures.push(`audit.mjs exit ${audit.status}`);
}

// 2. Sentinel accounting: each sentinel present in working tree OR covered in
//    the report's drop / out-of-scope sections. Silent loss = hard failure.
// F-2: base-verify removes .setup/ as merge prep — when absent, read the
// report from git history. REGRESSION GUARD: the lookup MUST use
// --diff-filter=AM. Plain `git log -1 -- <path>` returns the DELETION commit
// (the rm that removed .setup/); `git show <deletion>:<path>` then fails,
// the catch swallows it, reportText stays '', and every dropped-but-documented
// sentinel reads as SILENT-LOSS. --diff-filter=AM skips the delete and finds
// the report-generation commit. If the report is genuinely unreadable we record
// it as a distinct condition rather than letting an empty report masquerade as
// content loss (the original F-2 fix shipped without this guard or this signal).
let reportText = '';
let reportUnreadable = false;
if (existsSync(join(dir, '.setup/report.md'))) {
  reportText = readFileSync(join(dir, '.setup/report.md'), 'utf8');
} else {
  try {
    const lastRev = git('log', '-1', '--diff-filter=AM', '--format=%H', '--', '.setup/report.md');
    if (lastRev) reportText = git('show', `${lastRev}:.setup/report.md`);
  } catch { /* fall through to the unreadable signal below */ }
  if (!reportText) {
    reportUnreadable = true;
    failures.push('report.md unreadable: .setup/ absent and no Add/Modify commit found in git history '
      + '(sentinel accounting below cannot rely on the report — treat results as inconclusive, not as silent loss)');
  }
}
results.reportUnreadable = reportUnreadable;
// Portable tree scan (no external grep): read every file outside .git/.setup
// once, then substring-test sentinels against the cached contents.
const SCAN_SKIP = new Set(['.git', '.setup', 'node_modules']);
const treeFiles = [];
(function scan(d) {
  let entries;
  try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SCAN_SKIP.has(e.name)) continue;
    const p = join(d, e.name);
    if (e.isDirectory()) scan(p);
    else if (e.isFile()) treeFiles.push(p);
  }
})(dir);
const contentCache = new Map();
const inTreeCheck = (needle) => treeFiles.some((p) => {
  if (!contentCache.has(p)) {
    try { contentCache.set(p, readFileSync(p, 'utf8')); } catch { contentCache.set(p, ''); }
  }
  return contentCache.get(p).includes(needle);
});
results.sentinels = {};
for (const s of def.sentinels) {
  const inTree = inTreeCheck(s);
  const inReport = reportText.includes(s);
  results.sentinels[s] = inTree ? 'in-output' : inReport ? 'accounted-in-report' : 'SILENT-LOSS';
  if (!inTree && !inReport) failures.push(`SILENT LOSS: ${s} absent from output AND report`);
}

// 3. Merged-bytes % from report headline (tripwire metric)
const mb = reportText.match(/merged\/superseded[^|]*\|\s*\d+\s*\((\d+(?:\.\d+)?)% of source bytes(?: rewritten)?\)/);
results.mergedBytesPct = mb ? Number(mb[1]) : null;

// 4. Branch + scope sanity: only AI-config / .setup paths differ from main
const diff = run('git', ['diff', '--name-only', 'main...HEAD']);
if (diff.status === 0) {
  const offScope = (diff.stdout || '').split('\n').filter(Boolean).filter((p) =>
    !/^(AGENTS\.md|CLAUDE\.md|\.gitignore|\.claude\/|\.vscode\/|\.github\/|docs\/ai\/|\.setup\/|.*\/(AGENTS|CLAUDE)\.md$)/.test(p)
    && !(p in def.files && existsSync(join(dir, p)) === false) // deleted sources
    && !Object.keys(def.files).includes(p)); // reassembled mixed files
  results.offScopeDiff = offScope;
  if (offScope.length) failures.push(`diff outside AI surfaces: ${offScope.join(', ')}`);
}

results.pass = failures.length === 0;
results.failures = failures;

if (opt.json) console.log(JSON.stringify(results, null, 2));
else {
  console.log(`validate-assert [${opt.fixture}]: ${results.pass ? 'PASS' : 'FAIL'}`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log(`  sentinels: ${Object.values(results.sentinels).filter((v) => v !== 'SILENT-LOSS').length}/${def.sentinels.length} accounted` +
    (results.mergedBytesPct != null ? ` · merged-bytes ${results.mergedBytesPct}%` : ''));
}
process.exit(results.pass ? 0 : 1);
