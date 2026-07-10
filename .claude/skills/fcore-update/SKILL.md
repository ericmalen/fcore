---
name: fcore-update
description: Upgrades a set-up project's FleetCore baseline to the latest compatible release (sync-baseline report → review → upgrade → audit). Run from an open fcore checkout (clone or npx-staged release) with the project's path. Use when asked to update, refresh, or sync a project's FleetCore baseline or pin.
argument-hint: "[/path/to/project]"
---

# fcore-update (baseline upgrade loop)

Run from this fcore checkout (clone or staged release) against a
set-up project. FleetCore-side only: the installer never ships it into
targets (like `fcore-onboard`). All file changes go through
[`sync-baseline`](../../../scripts/sync-baseline.mjs) — never copy baseline
files by hand.

## Procedure

1. Obtain the project path (argument, or ask). Preconditions (hard — stop
   with a plain-language message if unmet):
   - target exists, is NOT this fcore checkout, and is a git repo
   - set up: `.claude/fcore.json` marker present
   - clean working tree: `git status --porcelain` is empty — one exception:
     an untracked `.claude/skills/fcore-bootstrap/` (the one-shot
     launcher the npx bin drops); delete it and re-check
   - `node --version` >= 20
2. Freshen this checkout — only if it is a clone (has `.git`):
   `git pull --ff-only` (on failure, warn and continue). An npx-staged
   release has no `.git` and is immutable at its tag — skip; sync-baseline
   fetches the new pin itself.
3. Check the pin:

   ```sh
   node <checkout>/scripts/sync-baseline.mjs --root <project> --check --json
   ```

   Exit 0 means the pin is current — do NOT stop; the baseline can still be
   incomplete (deleted skills, partial install). Continue to the report.
4. Plan the sync:

   ```sh
   node <checkout>/scripts/sync-baseline.mjs --root <project> --report --json
   ```

   - If pin behind and `conflicts` is non-empty: list each conflicting path
     and stop — the user resolves local edits (keep theirs or revert to
     baseline), then re-invokes this skill. Never resolve conflicts for them.
   - If pin current: `conflicts` are drift (locally edited baseline files) —
     repair never touches or blocks on them; list them for the user.
   - If pin current AND `updates` is empty: report "already at latest
     compatible release, baseline complete" (noting any drift) and stop.
   - If pin current with `updates` non-empty: these are missing baseline
     files; proceed as a repair.
   - Optional skills (R-55) the project selected (`marker.optionalSkills`) are
     upgraded and repaired alongside the baseline; optionals the project never
     opted into are not synced and never reported as `removed`.
   - If `removed` is non-empty: list them as no-longer-shipped files left on
     disk — deleting is the user's call, never yours.
5. Apply on a branch in the project:

   ```sh
   git -C <project> checkout -b chore/fcore-baseline-<targetPin>
   node <checkout>/scripts/sync-baseline.mjs --root <project> --upgrade
   git -C <project> add -A && git -C <project> commit -m "chore(fcore): baseline <pin> -> <targetPin>"
   ```

   Repair case (pin already current): branch
   `chore/fcore-baseline-repair`, commit message
   `chore(fcore): restore missing baseline files (<pin>)`.

6. Verify: run the project's `fcore-check` audit loop at the NEW pin (a
   freshened clone is already at it; from a staged release, audit via the
   sync-baseline checkout or `npx` at the new tag). Fix findings per rule ID;
   commit fixes on the same branch.
7. Hand off: summarize files updated + new pin; the user reviews the branch
   diff and merges. Never merge for them.

## Never

- Never run against this fcore checkout itself.
- Never proceed on a dirty tree; never apply an upgrade with unresolved
  conflicts (repair leaves drifted files untouched — report, don't resolve).
- Never use `--allow-major` unless the user explicitly asks for a
  major-version upgrade and acknowledges breaking changes.
- Never hand-edit synced baseline files to "fix" a conflict — that recreates
  drift; resolution is the user's call.
