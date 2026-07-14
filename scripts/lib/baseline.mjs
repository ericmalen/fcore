// baseline.mjs — paths copied into every set-up project (shared by install-setup
// and sync-baseline). Setup-window tooling is install-only, never synced.

/**
 * Optional skill tier — opt-in, NOT installed by default. One tier, three
 * install triggers: orchestration-lifecycle skills (dormant until
 * orchestration is generated; fcore-fleet-config installs unconditionally),
 * UI-verification skills (useful immediately, no orchestration
 * prerequisite; fcore-fleet-config installs when the generated roster
 * includes the matching verifier agent), and stack skills
 * (framework-specific practice skills; fcore-fleet-config installs per
 * profile-layer `stack` match, see
 * scripts/lib/orchestration/stack-skills.mjs). All also selectable at setup
 * time (fcore-plan/fcore-apply) or post-install via `fcore skills add`.
 * Tracked per project in the marker's `optionalSkills`; sync-baseline
 * upgrades only the ones a project selected. Lifecycle sources stay
 * dual-role in `.claude/skills/` (still dogfooded here); UI-verification
 * and stack-skill sources live in `templates/optional-skills/` and
 * `templates/stack-skills/` respectively, since FleetCore itself has no
 * target stack for them to serve (see AGENTS.md "Do Not"). Either way they
 * ride into the setup window via SETUP_WINDOW_COPIES so fcore-apply can
 * copy selected ones, but never enter BASELINE_COPIES.
 * @type {{name: string, src: string, dst: string}[]}
 */
export const OPTIONAL_SKILLS = [
  { name: 'checklist-intake', src: '.claude/skills/checklist-intake', dst: '.claude/skills/checklist-intake' },
  { name: 'log-report', src: '.claude/skills/log-report', dst: '.claude/skills/log-report' },
  { name: 'eval-runner', src: '.claude/skills/eval-runner', dst: '.claude/skills/eval-runner' },
  { name: 'tracker-sync', src: '.claude/skills/tracker-sync', dst: '.claude/skills/tracker-sync' },
  { name: 'ui-verify-web', src: 'templates/optional-skills/ui-verify-web', dst: '.claude/skills/ui-verify-web' },
  { name: 'ui-verify-ios', src: 'templates/optional-skills/ui-verify-ios', dst: '.claude/skills/ui-verify-ios' },
  { name: 'react-patterns', src: 'templates/stack-skills/react-patterns', dst: '.claude/skills/react-patterns' },
];

export const OPTIONAL_NAMES = OPTIONAL_SKILLS.map((s) => s.name);

/** Staging dst for an optional skill inside the setup window (fcore-apply source). */
export const optionalStagingDst = (name) => `.claude/fcore-onboard/optional-skills/${name}`;

export const optionalByName = (name) => OPTIONAL_SKILLS.find((s) => s.name === name);

/**
 * Rebase a project-relative dst path to its FleetCore-root-relative src path,
 * for optional skills whose src differs from dst. Identity for everything
 * else (BASELINE_COPIES paths, and optional skills with src === dst).
 */
export const fcoreSrcForProjectPath = (rel) => {
  for (const s of OPTIONAL_SKILLS) {
    if (s.src === s.dst) continue;
    if (rel === s.dst || rel.startsWith(`${s.dst}/`)) return s.src + rel.slice(s.dst.length);
  }
  return rel;
};

/** Project-relative live dst paths for a selected optional set. */
export const optionalProjectPaths = (selected) =>
  OPTIONAL_SKILLS.filter((s) => selected.includes(s.name)).map((s) => s.dst);

/** @type {[srcRel, dstRel][]} FleetCore-root-relative → project-relative */
export const SETUP_WINDOW_COPIES = [
  ['scripts/inventory-extract.mjs', '.claude/fcore-onboard/scripts/inventory-extract.mjs'],
  ['scripts/apply.mjs', '.claude/fcore-onboard/scripts/apply.mjs'],
  ['scripts/check.mjs', '.claude/fcore-onboard/scripts/check.mjs'],
  ['scripts/report.mjs', '.claude/fcore-onboard/scripts/report.mjs'],
  ['scripts/audit.mjs', '.claude/fcore-onboard/scripts/audit.mjs'],
  ['scripts/lib', '.claude/fcore-onboard/scripts/lib'],
  ['templates', '.claude/fcore-onboard/templates'],
  ['.claude/skills/fcore-inventory', '.claude/skills/fcore-inventory'],
  ['.claude/skills/fcore-plan', '.claude/skills/fcore-plan'],
  ['.claude/skills/fcore-apply', '.claude/skills/fcore-apply'],
  ['.claude/skills/fcore-verify', '.claude/skills/fcore-verify'],
  ['.claude/agents/setup-verifier.md', '.claude/agents/setup-verifier.md'],
  // Optional skills staged into the setup window (not their live path) so
  // fcore-apply can copy the ones selected during planning. Removed post-merge.
  ...OPTIONAL_SKILLS.map((s) => [s.src, optionalStagingDst(s.name)]),
];

/** Permanent baseline — kept after setup merge; sync-baseline upgrades these. */
export const BASELINE_COPIES = [
  ['.claude/skills/fcore-check', '.claude/skills/fcore-check'],
  ['.claude/skills/docs-manager', '.claude/skills/docs-manager'],
  ['.claude/skills/git-conventions', '.claude/skills/git-conventions'],
  ['.claude/skills/skill-creator', '.claude/skills/skill-creator'],
  ['.claude/skills/agent-creator', '.claude/skills/agent-creator'],
  ['.claude/agents/docs-auditor.md', '.claude/agents/docs-auditor.md'],
];

export const ALL_INSTALL_COPIES = [...SETUP_WINDOW_COPIES, ...BASELINE_COPIES];

/** Project-relative paths touched by sync-baseline (for conflict reports). */
export const BASELINE_PROJECT_PATHS = BASELINE_COPIES.map(([, dst]) => dst);
