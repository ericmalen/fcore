# Orchestration troubleshooting

Failure modes and recoveries for the
[five-session flow](./orchestration-guide.md#the-flow--five-sessions-two-gates),
plus the Copilot inline fallback. Symptoms are grouped by session; every
recovery names a command or file.

General rule: artifacts are validated before they're written, so a failed
session leaves either **no artifact** or a **schema-valid one** — never a
half-written file. Re-dispatching the same agent in a fresh context is always
safe.

## Session 1 — Profile

| Symptom | Likely cause | Recovery |
|---|---|---|
| Agent finishes but `docs/orchestration/repo-profile.json` is absent | Validator rejected the profile repeatedly; agent gave up | Re-dispatch in a fresh context; if it repeats, run the validator yourself on the agent's last attempt (paste it to a file): `node -e "import('<agent-base>/scripts/lib/orchestration/schemas.mjs').then(s=>console.log(s.validateRepoProfile(JSON.parse(require('fs').readFileSync('profile.json','utf8')))))"` — the error strings (e.g. `layers[0].testCmd must be a string or null (null = not detected)`) say exactly which field to question |
| Profile misses a layer you expected | Layer has no manifest/test signal the `structure-detector` skill recognizes (e.g. bare scripts dir) | Don't hand-add it. Re-dispatch and name the directory in the prompt ("treat `tools/etl/` as a layer"); the analyst must still evidence stack and test command or record a gap |
| `internalEdges` empty on a monorepo | Workspace packages don't declare each other in manifests | Check `package.json` workspace deps. If deps genuinely aren't declared, `[]` is correct — dispatch order then has no constraints, which is safe |
| Invented test/build commands | Analyst guessed instead of gapping | Reject the profile, re-dispatch; per the schema, undetected commands must be `null` with a `gaps[]` entry |

## Session 2 — Decisions

| Symptom | Likely cause | Recovery |
|---|---|---|
| Interviewer asks open-ended questions ("describe your workflow…") | Drift from the `interview-guide` question bank | Stop the session; every question must map to one `decisions.json` enum field. Re-dispatch fresh — the bank is finite, a clean run asks ≤ ~8 questions |
| `decisions.json` rejected | Answer recorded outside the enum | Validator output names the field and allowed values, e.g. `tddPolicy must be one of test-first \| test-with-change \| optional (got tdd)`. Re-answer that question |
| `decisions.md` doesn't match what you answered | Someone hand-edited the Markdown (it's rendered, never authored) | Delete `decisions.md`, re-render: `node -e "import('<agent-base>/scripts/lib/orchestration/render-decisions.mjs').then(m=>require('fs').writeFileSync('docs/orchestration/decisions.md',m.renderDecisionsMd(JSON.parse(require('fs').readFileSync('docs/orchestration/decisions.json','utf8')))))"`. `drift-checker` flags this state as USER-EDIT |
| Want to change an approved answer later | — | Re-dispatch `requirements-interviewer` for the affected field, then re-run Sessions 3–4 (blueprint and generated agents derive from decisions) |

## Session 3 — Blueprint

| Symptom | Likely cause | Recovery |
|---|---|---|
| `handoff-validator` rejects the blueprint | A specialist is missing slot values, dispatch rules, or eval requirements | The rejection lists the exact slot/field. Re-dispatch `plan-synthesizer` — never patch `blueprint.json` by hand (Discovery owns it; the scaffolder will fail on a half-filled specialist anyway) |
| Roster has no specialist for a layer | Synthesizer mapped the layer to nothing instead of the generic template | Reject at Gate 2 and re-dispatch; per `blueprint-generator` rules every layer maps to a named or generic specialist |
| `dispatch_order` looks wrong | It's derived from profile `internalEdges`, never authored | Fix the profile (Session 1) if edges are wrong; the order itself is `deriveDispatchOrder` output and not editable |

## Session 4 — Generate

| Symptom | Likely cause | Recovery |
|---|---|---|
| Scaffolder reports a conflict and stops | A previously generated file was hand-edited (manifest SHA ≠ disk SHA) | Decide per file: keep your edit → move the change into the Agent Base template or blueprint and regenerate; discard → `git checkout -- <file>` then re-run the scaffolder. It never overwrites on conflict |
| Re-run produces a diff on files you didn't touch | Agent Base templates moved between runs (TEMPLATE-DRIFT) | Expected after an Agent Base `git pull`. Run `drift-checker` from the Agent Base clone to classify, review the diff, commit the regeneration |
| Generated agents fail the target audit | Generation bug | `node <agent-base>/scripts/audit.mjs --strict` in the target names the R-IDs; file it against the Agent Base template (triage: template defect), don't hand-fix generated files |

## Session 5 — Execute

| Symptom | Likely cause | Recovery |
|---|---|---|
| Orchestrator can't parse `tasks.md` | Format drift — the parser is strict | Error names the line, e.g. `line 5: unrecognized line "…"` or `missing canonical sections — Backlog, In Progress, Done must all be present`. Fix against [`tasks-format`](../../templates/orchestration/docs/tasks-format.md) |
| Task bounced back to Backlog with `blocked:` | Specialist failed twice (one retry max — never silent loops) | Read the referenced `handoff-log.jsonl` entry (`failure_reason`); fix the cause, delete the `blocked:` line to re-queue |
| Imported task sits in Backlog untouched | `scope: triage` + `blocked:` line from `tracker-sync` — unscoped imports are never dispatched | A human sets the real `scope:` layers and removes the `blocked:` line |
| Orchestrator stopped without merging | Working as designed — the final step is always present PR/diff and stop | Review and merge yourself |

## Copilot inline fallback

When `/base-orchestrate` subagent dispatch fails on Copilot (phases start
running inside your chat instead of fresh contexts), stop and run each phase
manually — one **fresh chat** per phase, in the Agent Base clone workspace:

1. Allowlist on first prompt: `node <agent-base>/scripts/lib/orchestration/*` and
   read-only `git` in the target.
2. Fresh chat 1: "You are `repo-analyst`. Read
   `.claude/agents/repo-analyst.md` and execute its procedures for target
   `<path>`." Wait for `repo-profile.json` to land + commit.
3. Fresh chat 2: same pattern with `requirements-interviewer`. Answer the
   enum questions. **Gate 1** yourself per the
   [guide checklist](./orchestration-guide.md#session-2--decisions-requirements-interviewer).
4. Fresh chat 3: `plan-synthesizer`. **Gate 2** per the guide checklist.
5. Fresh chat 4: `scaffolder`. Review the diff; commit.

Parity notes: every scope count runs the subagent path on Copilot (the agent
team tier is Claude Code-only) — see
[Copilot parity](../reference/orchestration-copilot-parity.md).

## Still stuck

Route per [`triage-rules`](../../templates/orchestration/docs/triage-rules.md):
template defect → Agent Base fix + re-scaffold; blueprint defect → re-synthesize;
skill gap → Agent Base skill edit; one-off → `retro` checklist item. During a pilot,
also log it as friction in the [pilot report](./orchestration-pilot.md).
