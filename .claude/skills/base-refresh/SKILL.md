---
name: base-refresh
description: Upgrades a set-up project's Agent Base baseline to the latest compatible release (sync-baseline report → review → upgrade → audit). Run from an open Agent Base clone with the project's path. Use when asked to update, refresh, or sync a project's Agent Base baseline or pin.
argument-hint: "[/path/to/project]"
---

# base-refresh (baseline upgrade loop)

Run from this Agent Base clone against a set-up project. Kit-side only: the
installer never ships it into targets (like `base-setup`). All file changes
go through [`sync-baseline`](../../../scripts/sync-baseline.mjs) — never copy
baseline files by hand.

## Procedure

1. Obtain the project path (argument, or ask). Preconditions (hard — stop
   with a plain-language message if unmet):
   - target exists, is NOT this Agent Base clone, and is a git repo
   - set up: `.claude/agent-base.json` marker present
   - clean working tree: `git status --porcelain` is empty
   - `node --version` >= 20
2. Freshen this clone: `git pull --ff-only` (on failure, warn and continue).
3. Check the pin:

   ```sh
   node <clone>/scripts/sync-baseline.mjs --root <project> --check --json
   ```

   Exit 0 (current) → report "already at latest compatible release" and stop.
4. Plan the upgrade:

   ```sh
   node <clone>/scripts/sync-baseline.mjs --root <project> --report --json
   ```

   If `conflicts` is non-empty: list each conflicting path and stop — the
   user resolves local edits (keep theirs or revert to baseline), then
   re-invokes this skill. Never resolve conflicts for them.
5. Apply on a branch in the project:

   ```sh
   git -C <project> checkout -b chore/agent-base-baseline-<targetPin>
   node <clone>/scripts/sync-baseline.mjs --root <project> --upgrade
   git -C <project> add -A && git -C <project> commit -m "chore(agent-base): baseline <pin> -> <targetPin>"
   ```

6. Verify: run the project's `base-check` audit loop (audit at the NEW pin —
   the freshened clone is already at it). Fix findings per rule ID; commit
   fixes on the same branch.
7. Hand off: summarize files updated + new pin; the user reviews the branch
   diff and merges. Never merge for them.

## Never

- Never run against this Agent Base clone itself.
- Never proceed on a dirty tree; never apply with unresolved conflicts.
- Never use `--allow-major` unless the user explicitly asks for a
  major-version upgrade and acknowledges breaking changes.
- Never hand-edit synced baseline files to "fix" a conflict — that recreates
  drift; resolution is the user's call.
