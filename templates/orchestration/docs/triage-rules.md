# Triage rules

Where a finding goes once the orchestration loop surfaces it. Every bug,
review finding, eval failure, or handoff-log flag routes to exactly ONE asset
class — fixing the wrong asset papers over the defect (a template defect
patched in a generated file just regenerates on the next re-scaffold).

## Taxonomy

| Finding class | Symptom | Route | Propagation |
| --- | --- | --- | --- |
| Template defect | the same flaw appears in — or would be regenerated into — every agent or skill produced from one Agent Base template | fix the Agent Base template (version bump + registry re-pin), then re-scaffold | re-scaffold carries the fix into every repo generated from that template |
| Blueprint defect | wrong specialist set, slots, tiers, turn limits, or dispatch thresholds for THIS repo; the templates are fine | update the discovery inputs (`docs/orchestration/decisions.json` via the interview, or re-profile), re-run the synthesizer, re-scaffold | this repo only |
| Skill gap | a specialist repeatedly lacks a procedure that no template or blueprint change supplies | new or edited skill — an Agent Base skill template when the gap is general, a repo-local skill when it is not | the specialists paired with that skill |
| One-off | a single shipped bug or review finding with no structural cause | checklist item via the retro skill → `docs/orchestration/checklists/review-checklist.md` | the generated code-reviewer applies it on every future review |

Decision order: test template defect first (would regeneration reproduce
it?), then blueprint, then skill gap. One-off is the residual class, never
the default for convenience — a checklist item must not stand in for a fix
upstream.

## Periodic review

Cadence: after every ~10 completed tasks in `tasks.md`, or before each Agent Base
release — whichever comes first. The review is the evaluator agent's review
mode: handoff-log analytics plus eval pass-rate history in, proposed fixes
out, each routed per the table above.

Proposals are human-gated: a person accepts or rejects every fix before
anything changes. Nothing is auto-applied.
