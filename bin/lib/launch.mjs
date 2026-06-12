// launch.mjs — auto-launch the Claude Code CLI with the bootstrap prompt.
// Best case for the bootstrap commands: spawn `claude` interactively in the
// TARGET with the prompt as the initial message, so the user runs one npx
// command and the flow simply starts. Detection is a PATH probe (the TTY
// gate lives in agent-base.mjs); anything else (no CLI, Copilot-only,
// Windows, piped stdio, --no-launch) falls back to the bootstrap-skill
// drop + printed prompt in agent-base.mjs.
//
// Windows is excluded deliberately: `claude` installs as a .cmd shim there,
// which Node refuses to spawn without shell:true, and shell:true cannot
// safely carry a multi-line prompt argument. The fallback chain covers it.
//
// CLI-only module: lives under bin/lib/, never ships into projects.

import { spawnSync } from 'node:child_process';

export function findClaude({ cmd = 'claude', platform = process.platform } = {}) {
  if (platform === 'win32') return null;
  const r = spawnSync(cmd, ['--version'], { stdio: 'ignore', timeout: 5000 });
  return r.status === 0 ? cmd : null;
}

/**
 * Spawn the CLI interactively in the target; returns its exit code, or
 * null when the spawn itself failed (caller falls back to the skill drop).
 */
export function launchClaude({ cmd = 'claude', prompt, cwd }) {
  const r = spawnSync(cmd, [prompt], { stdio: 'inherit', cwd });
  if (r.error) {
    console.error(`agent-base: failed to launch ${cmd}: ${r.error.message}`);
    return null;
  }
  return r.status ?? 1;
}
