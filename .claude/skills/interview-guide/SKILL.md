---
name: interview-guide
description: Orchestration discovery step B5 — the question bank for turning repo-profile gaps into decisions.json values. Every question maps to exactly one decisions-doc field and its finite enum; no open-ended questions. Use when interviewing a team about orchestration policy after a repo profile exists (typically driven by the requirements-interviewer agent). Not a general requirements workshop.
---

# interview-guide

Question bank for the decisions interview. Two rules: every question targets
exactly one `decisions.json` field (enums in `DECISION_ENUMS`,
[schemas.mjs](../../../scripts/lib/orchestration/schemas.mjs)), and a
question is asked ONLY when
the profile and repo docs do not already evidence an answer — evidenced
fields are confirmed ("the repo suggests X — keep it?"), not re-asked. On a
re-run (an existing `decisions.json` in the target) a third source of "already
answered" applies — see Re-run reuse below — and takes priority over this
section's "Ask when" column, including the three fields marked "always
asked": a re-run is not a policy reset.

## Re-run reuse

When `<target>/docs/orchestration/decisions.json` already exists, compute
`partitionDecisionReuse(existing)` (`schemas.mjs`) before consulting the
table below. A field in `kept` is reported to the human as carried forward
and NOT asked, even if its row says "always asked" — that column governs
fresh interviews only. Only fields in `ask` (missing, or invalid for their
enum — schema evolution or corruption) go through the question bank below.
`decisions.md` is always re-rendered from the merged (kept + newly answered)
doc, even when nothing changed.

## Question bank

| Field | Ask when | Question | Answer → value |
| --- | --- | --- | --- |
| `tddPolicy` | no documented TDD/testing policy in profile or contributor docs | "When agents write code, must the failing test come first, land in the same change, or are tests optional?" | test-first / `test-first` · same change / `test-with-change` · optional / `optional` |
| `reviewGates` | review expectations not evidenced (no PR/review rules in docs or CI) | "Should generated code be reviewed per task, only before merge, or only when flagged risky?" | per task / `every-task` · per merge / `every-merge` · risky only / `risk-based` |
| `securityRequirements` | no security gate in CI and no security docs | "Does a security pass run on every change, only on sensitive surfaces (auth, data, dependencies), or not as a dedicated step?" | every change / `review-all-changes` · sensitive only / `review-sensitive-paths` · none / `none` |
| `qaDepth` | test layout shows only one tier, or no tests | "How deep should verification go: unit only, unit + integration, or the full pyramid including end-to-end?" | unit / `unit-only` · +integration / `unit-and-integration` · full / `full-pyramid` |
| `definitionOfDone` | always asked (policy, never inferable from code) | "When is a task Done: tests pass, tests + approved review, or tests + review + docs updated?" | tests / `tests-pass` · +review / `tests-and-review` · +docs / `tests-review-docs` |
| `humanGatePlacement` | always asked (policy) | "Where do humans gate the loop: approve before merge only, or also approve each dispatch?" | merge only / `pre-merge` · both / `pre-dispatch-and-pre-merge` |
| `orchestrationRouting` | always asked (policy, R-56) | "When a request fits the orchestrator, should the main loop route it automatically every time, only when scope hits the agent-team threshold, or never (invoke by hand)?" | always / `always` · at threshold / `threshold` · manual / `manual` |

## Consistency checks (apply after answers)

- `reviewGates` ≠ `risk-based` when `definitionOfDone` includes review —
  flag the tension and re-ask rather than silently pick.
- `securityRequirements: review-all-changes` with no security-reviewer
  budget is worth confirming ("this adds a reviewer to every task").

## Output

Answers map directly onto a `decisions.json` candidate (`schemaVersion: 1`
plus the seven fields). The caller validates with `validateDecisionsDoc`
before writing; the Markdown companion is always rendered with
`renderDecisionsMd`, never authored. `orchestrationRouting` defaults to
`threshold` when the team has no preference.
