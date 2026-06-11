---
name: base-verify
description: Phase 4 of agent-base setup — independent verification and final human gate. Use after materialization converged, in a fresh session.
---

# base-verify

Independent judgment over the converged result, then the final human gate.
You orchestrate; the verification itself runs in the setup-verifier agent
with FRESH context each invocation — never verify in this session yourself.

Preconditions: `check.mjs` and `audit.mjs` both exit 0 (re-run to confirm);
`.setup/report.md` is current.

## Procedure

1. **Invocation ① — conformance.** Invoke the `setup-verifier` agent:
   "Rubric pass: walk every judgment rule in
   .claude/skills/base-check/references/rubric.md against the generated
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
   commit — `git rm -r .setup`, remove `.claude/agent-base-setup/`,
   `.claude/skills/base-*`, and `.claude/agents/setup-verifier.md`.
   KEEP the permanent baseline — the `base-check`, `docs`,
   `git-conventions`, `skill-creator`, and `agent-creator` skills; the
   orchestration lifecycle skills `retro`, `log-report`, and `eval-runner`;
   the `docs-auditor` agent; and the Agent Base marker.
6. **USER GATE 2:** present `.setup/report.md` content (from the last
   pre-removal commit), the verifier matrices, and review instructions:
   `git diff main...agent-base-setup --color-moved=zebra --find-copies-harder`
   (per-iteration commits are individually reviewable). The USER merges and
   deletes the branch — never merge on their behalf.
   Also tell them: the baseline `docs` skill is installed but its enforcement
   (tier, `.claude/docs-paths.json`, hooks) stays OFF until they run `docs
   setup` — point them there as the recommended next step (it needs human
   tier confirmation, so setup never runs it automatically).

Abort at any point: `git checkout main && git branch -D agent-base-setup`.
