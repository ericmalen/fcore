#!/usr/bin/env node
// fcore — npx entry point. `npx github:<owner>/fcore#<tag> <command>`.
//
// Deterministic commands spawn the existing scripts/ entry points with argv
// passed through byte-for-byte (no flag re-parsing here); bootstrap commands
// stage the release to ~/.fcore/versions/<tag>/ then hand off via the
// launch chain: spawn `claude` in the target → drop a one-shot
// /fcore-bootstrap launcher skill → print the prompt to paste
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
import { listSkills, addSkill, removeSkill } from './lib/skills.mjs';
import { OPTIONAL_NAMES } from '../scripts/lib/baseline.mjs';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// command → scripts/ entry point (argv after the command passes through verbatim)
const DELEGATED = {
  install: 'install-setup.mjs',
  audit: 'audit.mjs',
  sync: 'sync-baseline.mjs',
  'tracker-sync': 'tracker-sync.mjs',
  init: 'build-starter.mjs',
  'headless-guard': 'headless-guard.mjs',
};

const LLM_ENTRIES = new Set(['onboard', 'fleet-config', 'update']);

const HELP = `fcore — install and maintain AI-coding setups (npx or clone)

Usage: fcore <command> [args]

Bootstrap (stages this release, then launches \`claude\` in the project;
without the Claude CLI it drops a one-shot /fcore-bootstrap launcher
skill into the project and prints the prompt to paste):
  onboard [path]          fcore onboarding of an EXISTING repository (fcore-onboard)
                          — for a brand-new empty repo, use init instead
  fleet-config [path]     generate repo-specific orchestration (fcore-fleet-config)
  update [path]           upgrade a project's baseline pin (fcore-update)
  flags: --no-launch      never spawn claude (drop launcher + print)
         --print          print the prompt only; never writes to the target

Deterministic (delegates to the matching scripts/ entry point):
  install <path>          copy setup tooling into a project (install-setup.mjs)
  audit [--root --json --strict]
  sync [--root --check|--report|--upgrade ...]   (sync-baseline.mjs)
  tracker-sync [--target --apply ...]
  init <dir> [--git]      emit a clean starter repo into an EMPTY dir — the
                          fresh-project path, no AI session needed (build-starter.mjs)
  headless-guard [--root --open-branches <json>]

Optional skills (opt-in lifecycle skills, tracked in the project marker):
  skills list [path]            show available optional skills + install state
  skills add <name> [path]      install one into the project (default: cwd)
  skills remove <name> [path]   uninstall one from the project

Release store (~/.fcore/versions/):
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
  if (r.error) console.error(`fcore ${command}: ${r.error.message}`);
  process.exit(r.status ?? 1);
}

if (LLM_ENTRIES.has(command)) {
  const flags = rest.filter((a) => a.startsWith('--'));
  const positional = rest.filter((a) => !a.startsWith('--'));
  for (const f of flags) {
    if (f !== '--no-launch' && f !== '--print') {
      console.error(`fcore ${command}: unknown flag ${f}`);
      process.exit(2);
    }
  }
  if (positional.length > 1) {
    console.error(`fcore ${command}: expected at most one path, got: ${positional.join(' ')}`);
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
    console.error(`fcore ${command}: target is not an existing directory: ${targetPath}`);
    process.exit(2);
  }
  // Pre-flight the hard preconditions here, at the terminal, instead of
  // failing deep inside the launched AI session (fcore-inventory re-checks).
  // --print is inspect-only (touches nothing), so it skips the repo gate.
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 20) {
    console.error(`fcore ${command}: needs Node >= 20 — you have ${process.versions.node}`);
    process.exit(2);
  }
  if (!flags.includes('--print')) {
    const git = (a) => spawnSync('git', ['-C', targetPath, ...a], { encoding: 'utf8' });
    const inside = git(['rev-parse', '--is-inside-work-tree']);
    if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
      console.error(`fcore ${command}: ${targetPath} is not a git repository — run \`git init\` and commit first (setup works on a branch).`);
      process.exit(2);
    }
    const porcelain = git(['status', '--porcelain']);
    if (porcelain.status !== 0) {
      console.error(`fcore ${command}: cannot read git status in ${targetPath}`);
      process.exit(2);
    }
    if (porcelain.stdout.trim() !== '') {
      console.error(`fcore ${command}: working tree has uncommitted changes — commit or stash first so setup stays reviewable.`);
      process.exit(2);
    }
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

if (command === 'skills') {
  const [sub, ...skillArgs] = rest;
  // fcoreRoot = this checkout (staged release or clone); copies come from here.
  const fcoreRoot = pkgRoot;
  if (sub === 'list' || sub === undefined) {
    const projectRoot = skillArgs[0] ? resolve(skillArgs[0]) : process.cwd();
    const { available, installed } = listSkills(projectRoot);
    console.log('Optional skills:');
    for (const s of available) {
      console.log(`  ${installed.includes(s.name) ? '[installed]' : '[available]'}  ${s.name}`);
    }
    process.exit(0);
  }
  if (sub === 'add' || sub === 'remove') {
    const name = skillArgs[0];
    if (!name) {
      console.error(`fcore skills ${sub}: expected a skill name (one of: ${OPTIONAL_NAMES.join(', ')})`);
      process.exit(2);
    }
    const projectRoot = skillArgs[1] ? resolve(skillArgs[1]) : process.cwd();
    try {
      const r = sub === 'add'
        ? addSkill({ name, projectRoot, fcoreRoot })
        : removeSkill({ name, projectRoot });
      const msg = {
        added: `installed optional skill: ${name}`,
        already: `optional skill already installed: ${name}`,
        removed: `removed optional skill: ${name}`,
        absent: `optional skill not installed: ${name}`,
      }[r.action];
      console.log(`fcore skills ${sub}: ${msg}`);
      process.exit(0);
    } catch (e) {
      console.error(`fcore skills ${sub}: ${e.message}`);
      process.exit(2);
    }
  }
  console.error(`fcore skills: unknown subcommand ${sub} (try: list, add, remove)`);
  process.exit(2);
}

if (command === 'cache') {
  const [sub, ...cacheArgs] = rest;
  if (sub === 'list' || sub === undefined) {
    if (cacheArgs.length) {
      console.error(`fcore cache list: unexpected args ${cacheArgs.join(' ')}`);
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
      else { console.error(`fcore cache prune: unknown flag ${cacheArgs[i]}`); process.exit(2); }
    }
    if (!Number.isInteger(keep) || keep < 0) { console.error('fcore cache prune: --keep must be a non-negative integer'); process.exit(2); }
    const removed = pruneStaged({ keep });
    console.log(removed.length ? `pruned: ${removed.join(', ')}` : 'cache: nothing to prune.');
    process.exit(0);
  }
  console.error(`fcore cache: unknown subcommand ${sub}`);
  process.exit(2);
}

console.error(`fcore: unknown command ${command} (try --help)`);
process.exit(2);
