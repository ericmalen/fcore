# docs/orchestration

State and reference docs for this repo's generated orchestration setup.
Generated agents live in `.claude/agents/`, paired skills in
`.claude/skills/`; work intake is `tasks.md` at the repo root.

Agent Base how-to (discovery, generation, execution):
`docs/how-to/orchestration-guide.md` in the Agent Base clone — not copied into
targets; link from your team's internal docs if needed.

## Files

| File | Owner | Role |
| --- | --- | --- |
| `repo-profile.json` | discovery | what the repo looks like |
| `decisions.json` + `decisions.md` | interview / renderer | team policy (the `.md` is rendered — never hand-edit) |
| `blueprint.json` | synthesis | which agents exist, with what slots and limits |
| `generation-manifest.json` | scaffolder | every generated file: template id, pinned version, content SHA |
| `handoff-log.jsonl` | orchestrator (single writer) | one entry per dispatch/return |
| `checklists/review-checklist.md` | retro flywheel | accumulated review checks |
| `evals/<agent>/` | eval goldens | expected-properties checks per agent |

## Updating generated assets

Generated files are never edited by hand. When Agent Base's templates improve:

1. Re-run the scaffolder against the stored `blueprint.json`. It
   re-instantiates from current templates and refreshes the manifest with
   the new pinned versions.
2. The manifest distinguishes a clean regeneration from a hand-edited file:
   any generated file whose bytes no longer match its manifest SHA is
   reported as a conflict and **nothing is overwritten** — resolve by hand
   (usually: move your change into the blueprint or the Agent Base template), then
   re-run.
3. A major template version bump signals an incompatible change — confirm
   it deliberately before regenerating.

Repo behavior changes (different specialists, different policies) go in
through discovery: update `decisions.json` via the interview or re-profile,
re-synthesize the blueprint, then re-scaffold. Never patch generated files
to get behavior the blueprint doesn't describe.

## Rollback

Generated files are plain committed files: roll back a regeneration with
`git revert` of the generating commit (manifest included). There is no
hidden state.
