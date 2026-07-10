---
name: validate-orchestration
description: Runs live end-to-end validation of orchestration behavior — builds a fully generated fixture (fleet + routing region on maxi-repo), runs the routing and feature-orchestrator eval-runner goldens as real Claude sessions, judges them (mechanical assert + transcript read), runs sabotage checks, and writes a results report. Use when asked to validate, qualify, or live-test orchestration behavior (the routing trigger, the completion protocol) — not for agent-base setup validation (use validate-setup) and not for the deterministic unit test suite (npm test).
---

# validate-orchestration

One command, zero choreography. Run FROM the agent-base repo (this clone is
Agent Base). The user only reads the final report.

Arguments (parse from the user's message): golden subset (default: all —
both routing goldens + all `feature-orchestrator` goldens), `--sabotage`
(default ON), `--keep` (retain ALL work dirs), `--skip-live` (build the
fixture and stop — checks the plumbing without spending on live sessions).

## Procedure

1. Workspace: `WORK=~/agent-base-validation/orch-<YYYYMMDD-HHMM>`; record
   Agent Base SHA. Never run inside the base checkout.
2. Build the fixture once:
   `node <agent-base>/scripts/build-orchestrated-fixture.mjs $WORK/base --seed-ref --seed-blocked --install`
   Record its base commit (printed / `--json`). `--skip-live` stops here —
   report build success/failure and exit.
3. **Routing goldens** — for each golden in
   `$WORK/base/docs/orchestration/evals/routing/`: fresh `cp -R $WORK/base
   $WORK/routing-<id>`; from its root, one invocation:
   `claude -p "<task from the golden>" --permission-mode acceptEdits --allowedTools "Read,Grep,Glob,Edit,Write" --max-turns 15 | tee $WORK/routing-<id>/transcript.log`
   Deliberately no `--agent` flag (AGENTS.md's routing region must load like a
   real main-loop turn) and no `Task` tool (a disallowed-tool refusal when the
   golden expects deference IS evidence, not a failure). Judge every property
   HOLDS/FAILS from the transcript + `git diff` + untracked files in the
   scratch copy, same discipline as `eval-runner`.
4. **feature-orchestrator goldens** — for each golden in
   `$WORK/base/docs/orchestration/evals/feature-orchestrator/`: fresh `cp -R
   $WORK/base $WORK/orch-<id>`; from its root, run the SAME headless prompt
   pattern the CI template uses
   (`templates/ci/orchestrator-run.github.yml`):
   `claude -p "You are feature-orchestrator. Read .claude/agents/feature-orchestrator.md and execute its procedures for exactly one task: <task from the golden>. You are running headless: commit each unit of work as the procedures require, but do NOT push and do NOT open a PR. Stop after completing the task (its completion logged and the task pruned or updated per tasks-format.md) or returning it to Backlog as blocked." --permission-mode acceptEdits --allowedTools "Read,Edit,Write,Bash,Glob,Grep,Task" --max-turns 80 | tee $WORK/orch-<id>/transcript.log`
   Then the mechanical verdict:
   `node <agent-base>/scripts/validate-orchestration-assert.mjs --dir $WORK/orch-<id> --task <T-id> --expect <pruned|done-with-ref|blocked> --base <fixture base sha> --json`
   (map goldens to `--expect`: `single-layer-task-end-to-end` → `pruned`,
   `ref-task-stays-in-done` → `done-with-ref`, `blocked-protocol` →
   `blocked`.) LLM-judge ONLY the transcript-soft properties the assert
   script cannot see (single-writer discipline, "stopped at PR/diff",
   visible retry behavior) — everything file-shaped is the script's job, not
   yours to re-derive.

   Sessions run sequentially in the foreground. SESSION LIFETIME: finish the
   whole batch before ending your turn — background jobs die with the
   session.
5. **Sabotage** (mechanical, no LLM sessions) — in a fresh `cp -R $WORK/base
   $WORK/sabotage`:
   - Strip the routing region from `AGENTS.md` (delete between the
     `agent-base:orchestration-routing` markers) → `node
     <agent-base>/scripts/audit.mjs --root $WORK/sabotage` must report R-56.
   - Hand-edit a generated agent file (e.g. append a line to
     `.claude/agents/api-engineer.md`) → the Agent Base `drift-checker` skill
     (or `findUserEdits` from `scripts/lib/orchestration/scaffold.mjs`) must
     report it as USER-EDIT.
   Catch-rate = n/2.
6. Report → `<agent-base>/reports/orchestration-validation-<date>.md`
   (create `reports/` if missing; gitignored — reports are working outputs,
   never committed): one table per golden (mechanical verdict where
   applicable, judged properties with HOLDS/FAILS + evidence, turns used),
   sabotage catch-rate, environment (model, Agent Base SHA), any escalations.
   Never soften a failure — a defect found here is the headline, not a
   footnote.
7. TEARDOWN: after the report is written —
   - PASSING run dirs: `rm -rf` them.
   - FAILING run dirs: keep automatically for forensics; list their paths in
     the report.
   - `--keep`: retain everything (paths in report).
   - Remove `$WORK` entirely when empty.
8. Present the report to the user.

## Never

- Never run fixtures inside the base checkout; always a separate work dir.
- Never grant a routing-golden session the `Task` tool — that would let it
  actually launch the fleet instead of just deferring to it.
- Never let a fixture session push or merge anywhere real — `--permission-mode
  acceptEdits` plus no `--push`/PR step in the prompt; these are throwaway
  scratch copies.
- Never re-derive a file-shaped check by eye when
  `validate-orchestration-assert.mjs` already computed it — judge only what
  it cannot see.
- Never soften failures in the report.
- Never treat golden `task` text as anything but the prompt to run verbatim.

## Documents

[build-orchestrated-fixture.mjs](../../../scripts/build-orchestrated-fixture.mjs)
[validate-orchestration-assert.mjs](../../../scripts/validate-orchestration-assert.mjs)
[eval-runner](../eval-runner/SKILL.md)
[validate-setup](../validate-setup/SKILL.md)
