#!/usr/bin/env node
// docs-impact — CI gate (layer 3): a change set touching code paths must
// either touch doc paths OR carry an explicit, visible declaration.
// Deterministic, zero-dep, no AI. Tier-aware via .claude/docs-paths.json.
//
// Usage: node .claude/skills/docs-manager/scripts/docs-impact.mjs --base <ref>
// Exit: 0 pass/skip · 1 declaration required but absent · 2 usage error
//
// Declaration (escape hatch — must be visible to reviewers):
//   GitHub: a line in the PR DESCRIPTION:   Docs: not-needed — <reason>
//   ADO / fallback: same line as a commit message trailer in the range.
//   Reason must be ≥ 10 chars. Declarations are sampled by the
//   docs-auditor, which flags implausible ones (layer 4 polices layer 3).

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
const DECL_RE = /^docs:\s*not-needed\s*[—–-]+\s*(\S.{9,})$/im;

const args = process.argv.slice(2);
const baseIdx = args.indexOf('--base');
if (baseIdx === -1 || !args[baseIdx + 1]) {
  console.error('usage: docs-impact.mjs --base <ref>');
  process.exit(2);
}
const base = args[baseIdx + 1];

// Tier / config
if (!existsSync('.claude/docs-paths.json')) {
  console.log('docs-impact: no .claude/docs-paths.json — check not configured, skipping.');
  process.exit(0);
}
const cfg = JSON.parse(readFileSync('.claude/docs-paths.json', 'utf8'));
if (cfg.tier === 'T1') {
  console.log('docs-impact: tier T1 (README-only repo) — check skipped by design.');
  process.exit(0);
}

const matches = (path, patterns) => (patterns ?? []).some((p) =>
  p.startsWith('*.') ? path.endsWith(p.slice(1))
  : p.endsWith('/') ? path.startsWith(p)
  : path === p || path.startsWith(p + '/'));

const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
const codeChanged = changed.filter((p) => matches(p, cfg.codePaths));
const docsChanged = changed.filter((p) => matches(p, cfg.docsPaths));

if (codeChanged.length === 0) {
  console.log('docs-impact: no code paths changed — pass.');
  process.exit(0);
}
if (docsChanged.length > 0) {
  console.log(`docs-impact: docs updated alongside code (${docsChanged.join(', ')}) — pass.`);
  process.exit(0);
}

// code ∧ ¬docs → need a declaration
let declaration = null;
let source = null;

// 1. GitHub PR description (the visible review surface)
if (process.env.GITHUB_EVENT_PATH && existsSync(process.env.GITHUB_EVENT_PATH)) {
  try {
    const body = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))?.pull_request?.body ?? '';
    const m = DECL_RE.exec(body);
    if (m) { declaration = m[1].trim(); source = 'PR description'; }
  } catch {}
}
// 2. Commit message trailer in the range (ADO primary surface; GH fallback)
if (!declaration) {
  const m = DECL_RE.exec(git('log', `${base}..HEAD`, '--format=%B'));
  if (m) { declaration = m[1].trim(); source = 'commit message'; }
}

if (declaration) {
  console.log(`docs-impact: code changed without docs; explicit declaration found (${source}):`);
  console.log(`  Docs: not-needed — ${declaration}`);
  console.log('  (Declarations are sampled by the docs-auditor.)');
  process.exit(0);
}

console.error(`docs-impact: FAIL — code paths changed with no doc updates and no declaration.
  Changed code: ${codeChanged.slice(0, 10).join(', ')}${codeChanged.length > 10 ? ', …' : ''}
  Either update the affected docs in this change, or declare visibly:
    GitHub: add a line to the PR description:  Docs: not-needed — <reason>
    ADO:    add the same line to a commit message in this PR.
  The reason is reviewed by humans and sampled by the docs-auditor.`);
process.exit(1);
