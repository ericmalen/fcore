---
name: fcore-verify
description: Phase 4 of fcore setup — independent verification and final human gate. Use after materialization converged, in a fresh session.
---

# fcore-verify

Independent judgment over the converged result, then the final human gate.
You orchestrate; the verification itself runs in the setup-verifier agent
with FRESH context each invocation — never verify in this session yourself.

Preconditions: `check.mjs` and `audit.mjs --strict` both exit 0 (re-run to
confirm — `--strict` matches the installed CI gate, which fails on ANY
finding); `.setup/report.md` is current.

## Procedure

1. **Invocation ① — conformance.** Invoke the `setup-verifier` agent:
   "Rubric pass: walk every judgment rule in
   .claude/skills/fcore-check/references/rubric.md against the generated
   files; emit the rule x asset PASS/FAIL matrix; review assembled-document
   coherence."
2. **Mechanical backstop (mandatory, after EVERY invocation):**
   `git status --porcelain` must be empty. If not: `git checkout -- .`,
   record the incident for the user, and re-run the invocation.
3. **Invocation ② — adversarial loss-hunt.** Fresh invocation:
   "Loss-hunt per the rubric's adversarial brief: judge every merge/supersede
   side-by-side in .setup/report.md, every drop reason, every out-of-scope
   ruling. Verdict per entry: KEEP / RESTORE / ESCALATE-TO-HUMAN."
4. Fix accepted findings via manifest/literal edits → re-apply →
   re-converge gates → re-verify (fresh invocations) until clean.
5. **Prepare the merge state:** remove setup-time tooling in a final
   commit — `git rm -r .setup`, remove `.claude/fcore-onboard/`,
   `.claude/skills/fcore-inventory/`, `.claude/skills/fcore-plan/`,
   `.claude/skills/fcore-apply/`, `.claude/skills/fcore-verify/`, and
   `.claude/agents/setup-verifier.md` (the authoritative list is
   `SETUP_WINDOW_COPIES` in `.claude/fcore-onboard/scripts/lib/baseline.mjs`).
   KEEP the permanent baseline — the `fcore-check`, `docs-manager`,
   `git-conventions`, `skill-creator`, `agent-creator`, and `tracker-sync`
   skills; the orchestration lifecycle skills `checklist-intake`, `log-report`, and
   `eval-runner`; the `docs-auditor` agent; and the FleetCore marker.
6. **USER GATE 2:** present `.setup/report.md` content (from the last
   pre-removal commit), the verifier matrices, and review instructions:
   `git diff main...fcore-onboard --color-moved=zebra --find-copies-harder`
   (per-iteration commits are individually reviewable). The USER merges and
   deletes the branch — never merge on their behalf.
   Also tell them: the baseline `docs-manager` skill is installed but its enforcement
   (tier, `.claude/docs-paths.json`, hooks) stays OFF until they run `docs
   setup` — point them there as the recommended next step (it needs human
   tier confirmation, so setup never runs it automatically).
   And point them at the lifecycle beyond that: run `fcore-check` routinely;
   orchestration is available later, once the repo has a code layer with
   tests, via the marker-derived `npx …#<pin> orchestrate` — it is
   deliberately not installed here. The in-project map is the installed
   fcore-check skill's `references/lifecycle.md`.

Abort at any point: `git checkout main && git branch -D fcore-onboard`.
