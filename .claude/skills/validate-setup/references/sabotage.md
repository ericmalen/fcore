# Sabotage procedure (verifier catch-rate)

Run on the COMPLETED clean mixed-messy fixture. For each defect: apply, run a
FRESH verifier subagent (invocation-② brief from the rubric), record whether
it flags the defect, then `git checkout -- .setup && re-apply` to
restore before the next.

1. **Unjustified drop** — edit manifest: change the AGENTS.md-routed node
   carrying SENTINEL-009 from move to `drop` with reason "obsolete".
   Re-materialize, re-run report. Verifier must object to the drop.
2. **Dilution rewrite** — change one move to `merge` with a literal that
   weakens the content (replace "never" with "where convenient"; remove one
   caveat sentence). Verifier must flag weakening.
3. **Bogus out-of-scope** — change CONTRIBUTING.md's AI-guidance handling so
   the file is ruled `out-of-scope` with reason "prose about AI, not
   instructions" (it IS instructions). Verifier must dispute the ruling.

Verifier subagent prompt per run: read-only; read the rubric at
<fixture>/.claude/skills/base-check/references/rubric.md and the report at
<fixture>/.setup/report.md; adversarial loss-hunt; one verdict row per
drop/merge/out-of-scope entry. Do NOT tell it a defect was seeded.

Score: caught = the verdict row for the seeded entry is RESTORE or
ESCALATE-TO-HUMAN with a justification identifying the actual problem.
Record per-defect: caught/missed + the verifier's row, verbatim.
