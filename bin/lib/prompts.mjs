// prompts.mjs — bootstrap prompt + user-facing messages for the bootstrap
// commands. The prompt is the canonical handoff ("Read <checkout>/.claude/
// ...SKILL.md and execute") — auto-launch passes it to `claude` directly,
// the dropped launcher skill embeds it, and the print fallback shows it for
// manual pasting. The skills' dispatch pattern is already path-based, so a
// staged release works the same as an open clone.

const SKILLS = {
  setup: 'base-setup',
  orchestrate: 'base-orchestrate',
  refresh: 'base-refresh',
};

export function bootstrapPrompt({ command, checkoutPath, targetPath = '.', dev = false }) {
  const skill = SKILLS[command];
  if (!skill) throw new Error(`no bootstrap prompt for command: ${command}`);
  const skillPath = `${checkoutPath}/.claude/skills/${skill}/SKILL.md`;
  const provenance = dev
    ? `a local base clone — freshen it first if needed (git -C ${checkoutPath} pull --ff-only)`
    : 'an immutable staged release — never `git pull` it';
  return [
    `Read ${skillPath} and execute it for target ${targetPath}.`,
    `The base checkout is ${checkoutPath} — ${provenance}.`,
  ].join('\n');
}

export function stagedNotice({ checkoutPath, dev, copied }) {
  if (dev) return `running from clone ${checkoutPath} — staging skipped`;
  return copied ? `staged release at ${checkoutPath}` : `using staged release at ${checkoutPath}`;
}

export function launchNotice({ targetPath }) {
  return `launching Claude Code in ${targetPath} — the flow continues in that session`;
}

/** Fallback output when nothing was launched. `skillDropped` toggles the /agent-base-bootstrap path. */
export function fallbackInstructions({ command, checkoutPath, targetPath, dev, skillDropped }) {
  const lines = ['', 'Nothing in your repo runs until an AI session picks this up.', ''];
  if (skillDropped) {
    lines.push(
      'Added a one-shot launcher skill to the project (untracked, deletes itself).',
      'Next: open Claude Code or Copilot (agent mode) IN THE PROJECT and type:',
      '',
      '  /agent-base-bootstrap',
      '',
      'Or paste this prompt instead:',
      ''
    );
  } else {
    lines.push('Paste this prompt into your AI session opened in the project:', '');
  }
  lines.push(bootstrapPrompt({ command, checkoutPath, targetPath, dev }));
  return lines.join('\n');
}
