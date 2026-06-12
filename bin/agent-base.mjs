#!/usr/bin/env node
// agent-base — npx entry point. `npx github:<owner>/agent-base#<tag> <command>`.
//
// Deterministic commands spawn the existing scripts/ entry points with argv
// passed through byte-for-byte (no flag re-parsing here); bootstrap commands
// stage the release to ~/.agent-base/versions/<tag>/ then hand off via the
// launch chain: spawn `claude` in the target → drop a one-shot
// /agent-base-bootstrap launcher skill → print the prompt to paste
// (--no-launch skips the spawn, --print touches nothing).
// The clone workflow is unchanged — this
// bin is additive and never ships into projects (see scripts/lib/baseline.mjs
// allowlist; AGENTS.md "Do Not").
//
// Exit: passthrough for delegated scripts · 0 ok · 2 usage error

import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
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
         --print          print the prompt only; touch nothing

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

if (DELEGATED[command]) {
  const r = spawnSync(process.execPath, [join(pkgRoot, 'scripts', DELEGATED[command]), ...rest], {
    stdio: 'inherit',
  });
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
  const targetPath = positional[0] ? resolve(positional[0]) : process.cwd();
  const { path, dev, copied } = stageRelease({ pkgRoot });
  console.log(stagedNotice({ checkoutPath: path, dev, copied }));

  // Launch chain: spawn claude → drop launcher skill → print the prompt.
  if (!flags.length) {
    const claude = findClaude();
    if (claude) {
      console.log(launchNotice({ targetPath }));
      const prompt = bootstrapPrompt({ command, checkoutPath: path, targetPath, dev });
      process.exit(launchClaude({ cmd: claude, prompt, cwd: targetPath }));
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
