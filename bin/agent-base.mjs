#!/usr/bin/env node
// agent-base — npx entry point. `npx github:<owner>/agent-base#<tag> <command>`.
//
// Deterministic commands spawn the existing scripts/ entry points with argv
// passed through byte-for-byte (no flag re-parsing here); bootstrap commands
// stage the release to ~/.agent-base/versions/<tag>/ then hand off via the
// launch chain: spawn `claude` in the target → drop a one-shot
// /agent-base-bootstrap launcher skill → print the prompt to paste
// (--no-launch skips the spawn, --print never writes to the target; both
// still stage). Auto-launch needs a real terminal — piped stdio (scripts,
// CI) skips straight to the fallback instead of hanging an interactive
// session.
// The clone workflow is unchanged — this
// bin is additive and never ships into projects (see scripts/lib/baseline.mjs
// allowlist; AGENTS.md "Do Not").
//
// Exit: passthrough for delegated scripts and the launched claude session ·
// 0 ok · 2 usage error

import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stageRelease, listStaged, pruneStaged } from './lib/staging.mjs';
import { bootstrapPrompt, stagedNotice, launchNotice, fallbackInstructions } from './lib/prompts.mjs';
import { findClaude, launchClaude } from './lib/launch.mjs';
import { writeBootstrapSkill } from './lib/bootstrap-skill.mjs';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// command → scripts/ entry point (argv after the command passes through verbatim)
const DELEGATED = {
  install: 'install-setup.mjs',
  audit: 'audit.mjs',
  sync: 'sync-baseline.mjs',
  'tracker-sync': 'tracker-sync.mjs',
  starter: 'build-starter.mjs',
  'headless-guard': 'headless-guard.mjs',
};

const LLM_ENTRIES = new Set(['setup', 'orchestrate', 'refresh']);

const HELP = `agent-base — install and maintain AI-coding setups (npx or clone)

Usage: agent-base <command> [args]

Bootstrap (stages this release, then launches \`claude\` in the project;
without the Claude CLI it drops a one-shot /agent-base-bootstrap launcher
skill into the project and prints the prompt to paste):
  setup [path]            agent-base setup of a repository (base-setup)
  orchestrate [path]      generate repo-specific orchestration (base-orchestrate)
  refresh [path]          upgrade a project's baseline pin (base-refresh)
  flags: --no-launch      never spawn claude (drop launcher + print)
         --print          print the prompt only; never writes to the target

Deterministic (delegates to the matching scripts/ entry point):
  install <path>          copy setup tooling into a project (install-setup.mjs)
  audit [--root --json --strict]
  sync [--root --check|--report|--upgrade ...]   (sync-baseline.mjs)
  tracker-sync [--target --apply ...]
  starter <dir> [--git]   emit a clean starter repo (build-starter.mjs)
  headless-guard [--root --open-branches <json>]

Release store (~/.agent-base/versions/):
  cache list              staged releases, newest first
  cache prune [--keep N]  remove all but the newest N (default 2)

  --version | --help
`;

const [command, ...rest] = process.argv.slice(2);

if (!command || command === '--help' || command === 'help') {
  process.stdout.write(HELP);
  process.exit(command ? 0 : 2);
}

if (command === '--version' || command === 'version') {
  const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
  console.log(pkg.version ?? '0.0.0');
  process.exit(0);
}

if (Object.hasOwn(DELEGATED, command)) {
  const r = spawnSync(process.execPath, [join(pkgRoot, 'scripts', DELEGATED[command]), ...rest], {
    stdio: 'inherit',
  });
  if (r.error) console.error(`agent-base ${command}: ${r.error.message}`);
  process.exit(r.status ?? 1);
}

if (LLM_ENTRIES.has(command)) {
  const flags = rest.filter((a) => a.startsWith('--'));
  const positional = rest.filter((a) => !a.startsWith('--'));
  for (const f of flags) {
    if (f !== '--no-launch' && f !== '--print') {
      console.error(`agent-base ${command}: unknown flag ${f}`);
      process.exit(2);
    }
  }
  if (positional.length > 1) {
    console.error(`agent-base ${command}: expected at most one path, got: ${positional.join(' ')}`);
    process.exit(2);
  }
  const targetPath = positional[0] ? resolve(positional[0]) : process.cwd();
  let targetStat;
  try {
    targetStat = statSync(targetPath);
  } catch {
    // fall through — reported below
  }
  if (!targetStat?.isDirectory()) {
    console.error(`agent-base ${command}: target is not an existing directory: ${targetPath}`);
    process.exit(2);
  }
  const { path, dev, copied } = stageRelease({ pkgRoot });
  console.log(stagedNotice({ checkoutPath: path, dev, copied }));

  // Launch chain: spawn claude → drop launcher skill → print the prompt.
  // TTY-gated: under piped stdio an interactive claude session would hang.
  if (!flags.length && process.stdin.isTTY && process.stdout.isTTY) {
    const claude = findClaude();
    if (claude) {
      console.log(launchNotice({ targetPath }));
      const prompt = bootstrapPrompt({ command, checkoutPath: path, targetPath, dev });
      const code = launchClaude({ cmd: claude, prompt, cwd: targetPath });
      if (code !== null) process.exit(code);
      // spawn itself failed (claude vanished since the probe) — fall through
    }
  }
  let skillDropped = false;
  if (!flags.includes('--print')) {
    try {
      writeBootstrapSkill({ command, checkoutPath: path, targetPath, dev });
      skillDropped = true;
    } catch {
      // unwritable target — fall through to print-only
    }
  }
  console.log(fallbackInstructions({ command, checkoutPath: path, targetPath, dev, skillDropped }));
  process.exit(0);
}

if (command === 'cache') {
  const [sub, ...cacheArgs] = rest;
  if (sub === 'list' || sub === undefined) {
    if (cacheArgs.length) {
      console.error(`agent-base cache list: unexpected args ${cacheArgs.join(' ')}`);
      process.exit(2);
    }
    const entries = listStaged();
    if (!entries.length) console.log('cache: no staged releases.');
    for (const e of entries) console.log(`${e.tag}  ${e.path}${e.partial ? '  (partial — re-staged on next use)' : ''}`);
    process.exit(0);
  }
  if (sub === 'prune') {
    let keep = 2;
    for (let i = 0; i < cacheArgs.length; i++) {
      if (cacheArgs[i] === '--keep') keep = Number(cacheArgs[++i]);
      else { console.error(`agent-base cache prune: unknown flag ${cacheArgs[i]}`); process.exit(2); }
    }
    if (!Number.isInteger(keep) || keep < 0) { console.error('agent-base cache prune: --keep must be a non-negative integer'); process.exit(2); }
    const removed = pruneStaged({ keep });
    console.log(removed.length ? `pruned: ${removed.join(', ')}` : 'cache: nothing to prune.');
    process.exit(0);
  }
  console.error(`agent-base cache: unknown subcommand ${sub}`);
  process.exit(2);
}

console.error(`agent-base: unknown command ${command} (try --help)`);
process.exit(2);
