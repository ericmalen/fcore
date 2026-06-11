#!/usr/bin/env node
// docs-nudge — deterministic end-of-session conscience (layer 2).
// No AI calls, no network, target <50ms, and NEVER breaks a session: any
// internal error exits 0 silently. One nudge per session, maximum.
//
// Wiring (.claude/settings.json, read by Claude Code AND VS Code):
//   SessionStart → `node .claude/skills/docs/scripts/docs-nudge.mjs session-start`
//   Stop         → `node .claude/skills/docs/scripts/docs-nudge.mjs stop`
//
// Spec: baseline = HEAD recorded at SessionStart (.git/agent-base-
// docs-baseline). At Stop, changed = commits baseline..HEAD plus uncommitted
// working-tree paths, matched against .claude/docs-paths.json
// { tier, codePaths, docsPaths } (prefix or "*.ext" patterns). Fires iff
// code touched AND docs untouched AND tier != T1. Known weakness, accepted:
// one faint end-of-session signal — CI (layer 3) is the coverage.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = (s) => process.stdout.write(s + '\n');
// NOTE: raw() must NOT trim — porcelain lines are "XY path" where X may be
// a space; trimming beheads the first line's path (caught in demo testing).
const raw = (...a) => execFileSync('git', a, { encoding: 'utf8' });
const git = (...a) => raw(...a).trim();

export function matches(path, patterns) {
  return patterns.some((p) =>
    p.startsWith('*.') ? path.endsWith(p.slice(1))
    : p.endsWith('/') ? path.startsWith(p)
    : path === p || path.startsWith(p + '/'));
}

// CLI body — entrypoint-guarded so importing matches() (tests) never runs the hook.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) try {
  const mode = process.argv[2];
  const gitDir = git('rev-parse', '--git-dir');
  const baselineFile = `${gitDir}/agent-base-docs-baseline`;
  const nudgedFile = `${gitDir}/agent-base-docs-nudged`;

  if (mode === 'session-start') {
    let head = 'EMPTY';
    try { head = git('rev-parse', 'HEAD'); } catch {}
    writeFileSync(baselineFile, head);
    try { writeFileSync(nudgedFile, ''); } catch {}
    process.exit(0);
  }

  if (mode !== 'stop') process.exit(0);
  if (!existsSync('.claude/docs-paths.json')) process.exit(0);
  const cfg = JSON.parse(readFileSync('.claude/docs-paths.json', 'utf8'));
  if (cfg.tier === 'T1') process.exit(0);
  if (existsSync(nudgedFile) && readFileSync(nudgedFile, 'utf8') === 'fired') process.exit(0);

  const changed = new Set();
  if (existsSync(baselineFile)) {
    const base = readFileSync(baselineFile, 'utf8').trim();
    if (base && base !== 'EMPTY') {
      try { git('diff', '--name-only', `${base}..HEAD`).split('\n').filter(Boolean).forEach((p) => changed.add(p)); } catch {}
    }
  }
  raw('status', '--porcelain').split('\n').filter((l) => l.length > 3)
    .forEach((l) => changed.add(l.slice(3).split(' -> ').pop()));

  const paths = [...changed];
  const codeTouched = paths.some((p) => matches(p, cfg.codePaths ?? []));
  const docsTouched = paths.some((p) => matches(p, cfg.docsPaths ?? []));

  if (codeTouched && !docsTouched) {
    writeFileSync(nudgedFile, 'fired');
    out('[docs-nudge] Code changed this session but no docs were touched. '
      + 'If behavior changed, update the affected docs'
      + ((cfg.docsPaths ?? []).includes('CHANGELOG.md') ? ' and CHANGELOG.md' : '')
      + ' (see AGENTS.md > Documentation) — or note why no update is needed.');
  }
  process.exit(0);
} catch {
  process.exit(0); // a nudge must never break a session
}
