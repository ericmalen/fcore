#!/usr/bin/env node
// build-starter — emit a clean starter repo (the target state,
// nothing else). Used by FleetCore CI to publish the "clone and go" starter, and
// runnable directly. Usage: node scripts/build-starter.mjs <dir> [--git]

import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { instantiate as instantiateTemplate } from './lib/template.mjs';
import { buildMarker } from './lib/marker.mjs';
import { BASELINE_COPIES } from './lib/baseline.mjs';

const fcoreRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseVersion = JSON.parse(readFileSync(join(fcoreRoot, 'package.json'), 'utf8')).version ?? '1.0.0';

const [dir, ...flags] = process.argv.slice(2);
if (!dir) {
  console.error('usage: node scripts/build-starter.mjs <dir> [--git]');
  process.exit(2);
}
const target = resolve(dir);
if (existsSync(target)) {
  if (!statSync(target).isDirectory()) {
    console.error(`refusing to write: target exists and is not a directory: ${target}`);
    process.exit(2);
  }
  if (readdirSync(target).length > 0) {
    console.error(`refusing to write into non-empty directory: ${target}`);
    process.exit(2);
  }
}

// F5 guard: a dev clone may carry a package.json version with no matching git
// tag yet — the emitted marker pin would dangle until the release is tagged.
// Best-effort: staged releases have no .git (the staging path itself proves a
// published version), and a failed git spawn must never block the build.
if (existsSync(join(fcoreRoot, '.git'))) {
  const r = spawnSync('git', ['-C', fcoreRoot, 'tag', '--list', `v${baseVersion}`], { encoding: 'utf8' });
  if (!r.error && r.status === 0 && r.stdout.trim() === '') {
    console.warn(`warning: tag v${baseVersion} not found in fcore clone — marker pin will dangle until the release is tagged`);
  }
}

const tpl = (rel) => readFileSync(join(fcoreRoot, 'templates', rel), 'utf8');
// starter: no slot is filled → optional sections drop out, mandatory slots
// instantiate empty (shared with apply so the two stay byte-identical).
const instantiate = (rel) => instantiateTemplate(tpl(rel));

const files = {
  'AGENTS.md': instantiate('instructions/AGENTS.md'),
  'CLAUDE.md': tpl('instructions/CLAUDE.md'),
  '.gitignore': tpl('gitignore'),
  '.claude/settings.json': tpl('settings/claude/settings.json'),
  '.vscode/settings.json': tpl('settings/vscode/settings.json'),
  '.claude/skills/README.md': tpl('readmes/skills/README.md'),
  '.claude/agents/README.md': tpl('readmes/agents/README.md'),
  '.claude/fcore.json': `${JSON.stringify(buildMarker({
    standard: baseVersion,
    setupAt: new Date().toISOString().slice(0, 10),
    githubCodeReview: false,
  }), null, 2)}\n`,
  'README.md': `# New Project

Started from the fcore starter — this repo is pre-wired for AI-assisted
coding with Claude Code and GitHub Copilot (VS Code).

Next steps (delete this section when done):

1. Fill in \`AGENTS.md\` — keep it under two pages.
2. Open Claude Code or Copilot (agent mode) here and run the \`fcore-check\`
   skill: it audits the setup and maps the full lifecycle (deep sweeps,
   optional orchestration, baseline refresh).
3. If your team uses GitHub.com Copilot code review, set
   \`githubCodeReview: true\` in \`.claude/fcore.json\` and add a short
   \`.github/copilot-instructions.md\` pointing at AGENTS.md.
`,
};

for (const [rel, content] of Object.entries(files)) {
  const abs = join(target, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

// Permanent baseline ships verbatim from the same allowlist install-setup and
// sync-baseline use — the starter is born repair-complete.
for (const [src, dst] of BASELINE_COPIES) {
  const from = join(fcoreRoot, src);
  if (!existsSync(from)) {
    console.error(`build-starter: missing in FleetCore: ${src} (incomplete clone?)`);
    process.exit(1);
  }
  const to = join(target, dst);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

if (flags.includes('--git')) {
  const g = (args) => {
    const r = spawnSync('git', args, { cwd: target, encoding: 'utf8' });
    if (r.error || r.status !== 0) {
      if (r.stderr) process.stderr.write(r.stderr);
      console.error(`git step failed: git ${args.join(' ')}${r.error ? ` (${r.error.message})` : ''}`);
      process.exit(1);
    }
    return r;
  };
  g(['init', '-q', '-b', 'main']);
  g(['add', '-A']);
  g(['-c', 'user.email=starter@fcore', '-c', 'user.name=fcore', '-c', 'commit.gpgsign=false', 'commit', '-qm', `chore: fcore starter (v${baseVersion})`]);
}
console.log(`starter → ${target} (v${baseVersion})`);
console.log('');
console.log('Next steps:');
console.log('  1. Fill in AGENTS.md (keep it under two pages).');
console.log('  2. Open Claude Code or Copilot (agent mode) in the project and run the');
console.log('     fcore-check skill — it audits the setup and maps the full lifecycle');
console.log('     (deep sweep, optional orchestration, baseline refresh).');
