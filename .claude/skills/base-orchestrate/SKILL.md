---
name: base-orchestrate
description: Generates repo-specific orchestration agents in a project (discovery → generation). Run from an open base checkout (clone or npx-staged release) with the set-up project's path. Use when asked to set up orchestration, generate a feature team, run repo-analyst/scaffolder, or enable tasks.md multi-agent dispatch. Not for plain agent-base setup (use base-setup) and not for executing tasks (use feature-orchestrator in the target after generation).
argument-hint: "[/path/to/project]"
---

# base-orchestrate (orchestration entry point)

You orchestrate discovery and generation from an open **base checkout**
(clone or staged release) against a **set-up project** path. The user
interacts only at policy gates and final merge review. Phases run in FRESH
contexts.

Agent Base-side only — `install-setup.mjs` never ships this skill.

## Preconditions (hard — stop with plain language if unmet)

1. Target path exists, is NOT this base checkout, and is a git repo.
2. Clean working tree in the target (`git status --porcelain` empty) — one
   exception: an untracked `.claude/skills/agent-base-bootstrap/` (the
   one-shot launcher the npx bin drops); delete it and re-check.
3. Target shows agent-base setup baseline (at minimum `.claude/agent-base.json` and
   `base-check` skill). If missing, tell the user to run `/base-setup`
   first.
4. `node --version` >= 20.
5. Checkout freshened — only if it is a clone (has `.git`): `git pull
   --ff-only` (warn and continue on failure). An staged release has no
   `.git` and is immutable at its tag — skip.

## Procedure

1. Obtain target path from the argument or ask.
2. **Claude Code:** dispatch each phase below as a subagent with a fresh
   context. Prompt template: "You are `<agent-name>`. Read
   `<agent-base>/.claude/agents/<agent-name>.md` and execute its procedures for
   target `<path>`." Relay summaries to the user.
   **Copilot:** attempt the same; if subagent dispatch fails, hand the user
   the session table from `docs/how-to/orchestration-guide.md` and execute
   only the current phase inline.
3. Run phases in order:

   | Phase | Agent | Output artifact |
   |---|---|---|
   | 1 | `repo-analyst` | `docs/orchestration/repo-profile.json` |
   | 2 | `requirements-interviewer` | `docs/orchestration/decisions.json` |
   | 3 | `plan-synthesizer` | `docs/orchestration/blueprint.json` |
   | 4 | `scaffolder` | `.claude/agents/*`, `.claude/skills/*`, `docs/orchestration/generation-manifest.json` |

4. **Gate 1 (after phase 2):** present `decisions.md` (rendered companion).
   STOP until the user explicitly approves policy answers.
5. **Gate 2 (after phase 3):** present the specialist roster and dispatch
   rules from `blueprint.json`. STOP until the user explicitly approves.
6. After phase 4: remind the user to review the diff, commit if not already
   committed by the scaffolder session, and merge. Point them to
   `docs/how-to/orchestration-guide.md` § Session 5 for execution (`tasks.md` +
   `feature-orchestrator`). Never merge for them.

## Commits

Each phase session should commit its artifacts to the target with a
conventional message (e.g. `chore(orchestration): add repo profile`). Use
`--no-verify` only when a format-on-commit hook would rewrite generated JSON.

## Never

- Never run discovery/generation with the base checkout as the target.
- Never skip Gate 1 or Gate 2.
- Never hand-edit generated agents in the target — fix the blueprint or Agent Base
  template and re-run `scaffolder`.
- Never instantiate templates yourself when `scaffolder` is the assigned phase
  — delegate to that agent's procedure.

## Documents

docs/how-to/orchestration-guide.md
.claude/agents/repo-analyst.md
.claude/agents/requirements-interviewer.md
.claude/agents/plan-synthesizer.md
.claude/agents/scaffolder.md
