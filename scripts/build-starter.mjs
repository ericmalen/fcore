#!/usr/bin/env node
// build-starter — emit a clean starter repo (the target state,
// nothing else). Used by Agent Base CI to publish the "clone and go" starter, and
// runnable directly. Usage: node scripts/build-starter.mjs <dir> [--git]

import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { instantiate as instantiateTemplate } from './lib/template.mjs';
import { buildMarker } from './lib/marker.mjs';

const baseRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseVersion = JSON.parse(readFileSync(join(baseRoot, 'package.json'), 'utf8')).version ?? '1.0.0';

const [dir, ...flags] = process.argv.slice(2);
if (!dir) {
  console.error('usage: node scripts/build-starter.mjs <dir> [--git]');
  process.exit(1);
}
const target = resolve(dir);
if (existsSync(target) && readdirSync(target).length > 0) {
  console.error(`refusing to write into non-empty directory: ${target}`);
  process.exit(1);
}

const tpl = (rel) => readFileSync(join(baseRoot, 'templates', rel), 'utf8');
// starter: no slot is filled → optional sections drop out, mandatory slots
// instantiate empty (shared with apply so the two stay byte-identical).
const instantiate = (rel) => instantiateTemplate(tpl(rel));
// base-check is a permanent baseline skill — its source of truth is .claude/skills/,
// not templates/ (it ships verbatim, like docs/git-conventions).
const skill = (rel) => readFileSync(join(baseRoot, '.claude/skills', rel), 'utf8');

const files = {
  'AGENTS.md': instantiate('instructions/AGENTS.md'),
  'CLAUDE.md': tpl('instructions/CLAUDE.md'),
  '.gitignore': tpl('gitignore'),
  '.claude/settings.json': tpl('settings/claude/settings.json'),
  '.vscode/settings.json': tpl('settings/vscode/settings.json'),
  '.claude/skills/README.md': tpl('readmes/skills/README.md'),
  '.claude/skills/base-check/SKILL.md': skill('base-check/SKILL.md'),
  '.claude/skills/base-check/references/rubric.md': skill('base-check/references/rubric.md'),
  '.claude/skills/base-check/references/audit-hook.md': skill('base-check/references/audit-hook.md'),
  '.claude/skills/base-check/scripts/audit-nudge.mjs': skill('base-check/scripts/audit-nudge.mjs'),
  '.claude/agent-base.json': `${JSON.stringify(buildMarker({
    standard: baseVersion,
    setupAt: new Date().toISOString().slice(0, 10),
    githubCodeReview: false,
  }), null, 2)}\n`,
  'README.md': `# New Project

Started from the agent-base starter — this repo is pre-wired for AI-assisted
coding with Claude Code and GitHub Copilot (VS Code).

Next steps: fill in AGENTS.md (keep it under two pages), then delete this
section. If your team uses GitHub.com Copilot code review, set
\`githubCodeReview: true\` in \`.claude/agent-base.json\` and add a short
\`.github/copilot-instructions.md\` pointing at AGENTS.md.
Run the \`base-check\` skill any time to verify conventions.
`,
};

for (const [rel, content] of Object.entries(files)) {
  const abs = join(target, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

if (flags.includes('--git')) {
  const g = (args) => spawnSync('git', args, { cwd: target, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']);
  g(['add', '-A']);
  g(['-c', 'user.email=starter@agent-base', '-c', 'user.name=agent-base', 'commit', '-qm', `chore: agent-base starter (v${baseVersion})`]);
}
console.log(`starter → ${target} (v${baseVersion})`);
