---
name: fcore-fleet-config
description: Generates repo-specific orchestration agents in a project (discovery → generation). Run from an open fcore checkout (clone or npx-staged release) with the set-up project's path. Use when asked to set up orchestration, generate a feature team, run repo-analyst/scaffolder, or enable tasks.md multi-agent dispatch. Not for plain fcore setup (use fcore-onboard) and not for executing tasks (use feature-orchestrator in the target after generation).
argument-hint: "[/path/to/project]"
---

# fcore-fleet-config (orchestration entry point)

You orchestrate discovery and generation from an open **fcore checkout**
(clone or staged release) against a **set-up project** path. The user
interacts only at policy gates and final merge review. Phases run in FRESH
contexts.

FleetCore-side only — `install-setup.mjs` never ships this skill.

## Preconditions (hard — stop with plain language if unmet)

1. Target path exists, is NOT this fcore checkout, and is a git repo.
2. Clean working tree in the target (`git status --porcelain` empty) — one
   exception: an untracked `.claude/skills/fcore-bootstrap/` (the
   one-shot launcher the npx bin drops); delete it and re-check.
3. Target shows fcore setup baseline (at minimum `.claude/fcore.json` — or
   the pre-v2.0.0 `.claude/agent-base.json`, which sync-baseline reads
   automatically — and the `fcore-check` skill). If neither marker is
   present, tell the user to run `/fcore-onboard` first.
4. `node --version` >= 20.
5. Checkout freshened — only if it is a clone (has `.git`): `git pull
   --ff-only` (warn and continue on failure). An staged release has no
   `.git` and is immutable at its tag — skip.
6. Preflight guard: `node <fcore>/scripts/orchestrate-preflight.mjs
   --root <target>`. Exit 1 → STOP, relay the stderr message verbatim (the
   repo has no detectable code layer with a test command — orchestration has
   nothing to generate from yet). Capture `mode=` from stdout (`fresh` or
   `re-run`) — it selects the procedure branch below.

## Procedure

1. Obtain target path from the argument or ask.
2. **Claude Code:** dispatch each phase below as a subagent with a fresh
   context. Prompt template: "You are `<agent-name>`. Read
   `<fcore>/.claude/agents/<agent-name>.md` and execute its procedures for
   target `<path>`." Relay summaries to the user.
   **Copilot:** attempt the same; if subagent dispatch fails, hand the user
   the session table from `docs/how-to/orchestration-guide.md` and execute
   only the current phase inline.
3. **`mode=re-run` only:** before Phase 1, run the `drift-checker` skill
   against the target and report TEMPLATE-DRIFT/USER-EDIT findings. Resolve
   any USER-EDIT (port the edit upstream or revert it) before continuing —
   the scaffolder will refuse it in Phase 4 anyway; surfacing it now avoids
   three phases of wasted work on a run that was always going to fail.
4. Run phases in order:

   | Phase | Agent | Output artifact |
   |---|---|---|
   | 1 | `repo-analyst` | `docs/orchestration/repo-profile.json` |
   | 2 | `requirements-interviewer` | `docs/orchestration/decisions.json` |
   | 3 | `plan-synthesizer` | `docs/orchestration/blueprint.json` |
   | 4 | `scaffolder` | `.claude/agents/*`, `.claude/skills/*`, `docs/orchestration/generation-manifest.json` |

   Phase 1 always re-profiles fresh, even on `mode=re-run` — the profile is
   derived evidence, never reused.
5. **Gate 1 (after phase 2):** present `decisions.md` (rendered companion).
   STOP until the user explicitly approves policy answers.
   **On `mode=re-run`:** the interviewer reuses every previously answered
   field valid for its enum (`partitionDecisionReuse`, including the fields
   normally "always asked" — a re-run is not a policy reset) and only asks
   what's missing or invalid. Present it as a kept-vs-asked table alongside
   the re-rendered `decisions.md`. If nothing changed, say so explicitly —
   Gate 1 still requires an explicit approval; never skip it.
6. **Gate 2 (after phase 3):** present the specialist roster and dispatch
   rules from `blueprint.json`. STOP until the user explicitly approves.
7. **Install prerequisite skills (R-55):** the optional skills these generated
   agents depend on are absent from the plain-setup baseline, so generation
   needs them installed. From the fcore checkout, for each of
   `checklist-intake`, `log-report`, `eval-runner`, `tracker-sync` (always):
   `node <fcore>/bin/fcore.mjs skills add <name> <target>`
   (idempotent — skips any already present; records each in the target marker's
   `optionalSkills`). These back `/checklist-intake`, `/log-report`, `/eval-runner`,
   `/tracker-sync` on the generated surfaces. Then, conditionally on the
   generated roster: if it includes `ui-web-verifier`, also
   `fcore skills add ui-verify-web <target>`; if it includes
   `ui-mobile-verifier`, also `fcore skills add ui-verify-ios <target>`.
   Neither is installed when its verifier isn't in the roster. Remind the
   user afterward that the matching MCP server (Playwright / iOS Simulator)
   still needs `claude mcp add --scope project ...` in the target — see each
   skill's first-run section; generation doesn't write `.mcp.json`.

   Then, stack skills (same optional tier R-55, profile-match install
   trigger; framework-practice skills vendored under
   `templates/stack-skills/`): match the target's freshly written
   `repo-profile.json` against `templates/stack-skills/catalog.json` via
   `matchStackSkills` —

   ```
   node --input-type=module -e '
   import { readFileSync } from "node:fs";
   import { matchStackSkills } from "./scripts/lib/orchestration/stack-skills.mjs";
   const target = process.argv[1];
   const profile = JSON.parse(readFileSync(`${target}/docs/orchestration/repo-profile.json`, "utf8"));
   const catalog = JSON.parse(readFileSync("templates/stack-skills/catalog.json", "utf8"));
   console.log(matchStackSkills(profile, catalog).join("\n"));
   ' <target>
   ```

   `fcore skills add <name> <target>` for each matched name (same idempotent
   install; records each in `optionalSkills`). No matches is a normal
   outcome, not an error. Report the installed set (or "no stack-skill
   matches") in the phase summary.
8. After phase 4: remind the user to review the diff, commit if not already
   committed by the scaffolder session, and merge. Point them to
   `docs/how-to/orchestration-guide.md` § Session 5 for execution (`tasks.md` +
   `feature-orchestrator`). Never merge for them.
   **On `mode=re-run`:** the scaffolder also reports any orphaned files it
   removed (a specialist or paired skill the new blueprint dropped) — mention
   the count in the summary.

## Re-orchestrating as the repo grows

Orchestration is evidence-driven (see Preconditions): there is no path from
an intent interview straight to a full generated team. Instead, the team
grows with the repo — see `docs/how-to/orchestration-guide.md` §
"Re-orchestrating as the repo grows" for the full lifecycle
(`/fcore-onboard` → build a layer with tests → `/fcore-fleet-config` → new layer
ships → re-run `/fcore-fleet-config`). This skill detects which mode applies
automatically via the preflight guard's `mode=` output; no separate command.

## Commits

Each phase session should commit its artifacts to the target with a
conventional message (e.g. `chore(orchestration): add repo profile`). Use
`--no-verify` only when a format-on-commit hook would rewrite generated JSON.

## Never

- Never run discovery/generation with the fcore checkout as the target.
- Never bypass the preflight guard by hand-authoring a profile for a repo it
  blocked — the guard exists because discovery has nothing evidence-based to
  work from yet.
- Never skip Gate 1 or Gate 2, even on a re-run with zero changed decisions.
- Never hand-edit generated agents in the target — fix the blueprint or FleetCore
  template and re-run `scaffolder`.
- Never instantiate templates yourself when `scaffolder` is the assigned phase
  — delegate to that agent's procedure.

## Documents

docs/how-to/orchestration-guide.md
.claude/agents/repo-analyst.md
.claude/agents/requirements-interviewer.md
.claude/agents/plan-synthesizer.md
.claude/agents/scaffolder.md
.claude/skills/drift-checker/SKILL.md
[scripts/lib/orchestration/preflight.mjs](../../../scripts/lib/orchestration/preflight.mjs)
[scripts/lib/orchestration/stack-skills.mjs](../../../scripts/lib/orchestration/stack-skills.mjs)
[templates/stack-skills/catalog.json](../../../templates/stack-skills/catalog.json)
