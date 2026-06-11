// baseline.mjs — paths copied into every set-up project (shared by install-setup
// and sync-baseline). Setup-window tooling is install-only, never synced.

/** @type {[srcRel, dstRel][]} Agent Base-root-relative → project-relative */
export const SETUP_WINDOW_COPIES = [
  ['scripts/inventory-extract.mjs', '.claude/agent-base-setup/scripts/inventory-extract.mjs'],
  ['scripts/apply.mjs', '.claude/agent-base-setup/scripts/apply.mjs'],
  ['scripts/check.mjs', '.claude/agent-base-setup/scripts/check.mjs'],
  ['scripts/report.mjs', '.claude/agent-base-setup/scripts/report.mjs'],
  ['scripts/audit.mjs', '.claude/agent-base-setup/scripts/audit.mjs'],
  ['scripts/lib', '.claude/agent-base-setup/scripts/lib'],
  ['templates', '.claude/agent-base-setup/templates'],
  ['.claude/skills/base-inventory', '.claude/skills/base-inventory'],
  ['.claude/skills/base-plan', '.claude/skills/base-plan'],
  ['.claude/skills/base-apply', '.claude/skills/base-apply'],
  ['.claude/skills/base-verify', '.claude/skills/base-verify'],
  ['.claude/agents/setup-verifier.md', '.claude/agents/setup-verifier.md'],
];

/** Permanent baseline — kept after setup merge; sync-baseline upgrades these. */
export const BASELINE_COPIES = [
  ['.claude/skills/base-check', '.claude/skills/base-check'],
  ['.claude/skills/docs', '.claude/skills/docs'],
  ['.claude/skills/git-conventions', '.claude/skills/git-conventions'],
  ['.claude/skills/skill-creator', '.claude/skills/skill-creator'],
  ['.claude/skills/agent-creator', '.claude/skills/agent-creator'],
  ['.claude/agents/docs-auditor.md', '.claude/agents/docs-auditor.md'],
  ['.claude/skills/retro', '.claude/skills/retro'],
  ['.claude/skills/log-report', '.claude/skills/log-report'],
  ['.claude/skills/eval-runner', '.claude/skills/eval-runner'],
  ['.claude/skills/tracker-sync', '.claude/skills/tracker-sync'],
];

export const ALL_INSTALL_COPIES = [...SETUP_WINDOW_COPIES, ...BASELINE_COPIES];

/** Project-relative paths touched by sync-baseline (for conflict reports). */
export const BASELINE_PROJECT_PATHS = BASELINE_COPIES.map(([, dst]) => dst);
