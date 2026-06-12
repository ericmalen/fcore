// bootstrap-skill.mjs — one-shot launcher skill dropped into the target.
// When the bin cannot launch `claude` itself, it writes this skill into the
// TARGET's .claude/skills/ so the user types /agent-base-bootstrap instead
// of carrying a pasted prompt across tools. The skill is untracked, orders
// its own deletion first (restoring the clean tree the base-* preconditions
// require), and re-checks the staged path so a pruned release fails with
// "re-run npx", not a dead Read.
//
// CLI-only module: lives under bin/lib/, never enters the installer
// allowlist — it reaches targets only via this drop, never via install.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bootstrapPrompt } from './prompts.mjs';

export const BOOTSTRAP_SKILL_DIR = join('.claude', 'skills', 'agent-base-bootstrap');

/** Write the launcher skill into targetPath; returns the SKILL.md path. */
export function writeBootstrapSkill({ command, checkoutPath, targetPath, dev = false }) {
  const dir = join(targetPath, BOOTSTRAP_SKILL_DIR);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'SKILL.md');
  writeFileSync(file, skillContent({ command, checkoutPath, targetPath, dev }));
  return file;
}

function skillContent({ command, checkoutPath, targetPath, dev }) {
  return `---
name: agent-base-bootstrap
description: One-shot launcher dropped by \`npx agent-base ${command}\`. Use when the user types /agent-base-bootstrap or asks to start the staged agent-base ${command} flow. Deletes itself first.
---

# agent-base-bootstrap (one-shot launcher)

Dropped by \`npx agent-base ${command}\`. Execute top to bottom:

1. Delete this skill's directory NOW — it is single-use and must not
   survive into the working tree the flow checks: remove
   \`${BOOTSTRAP_SKILL_DIR}/\` (recursively) in \`${targetPath}\`.
2. Verify the base checkout still exists at \`${checkoutPath}\`. If it is
   missing (e.g. removed by \`agent-base cache prune\`), STOP and tell the
   user to re-run their \`npx … ${command}\` command to re-stage it.
3. ${bootstrapPrompt({ command, checkoutPath, targetPath, dev }).split('\n').join('\n   ')}
`;
}
