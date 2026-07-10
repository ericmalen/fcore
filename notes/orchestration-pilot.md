# Running an orchestration pilot

How to run the teammate pilot that gates Phase F: one colleague takes a
**real** repo through Discovery → Generation using **only the docs**, while
FleetCore author observes and counts interventions. Pass bar: **≤ 2
interventions**.

## Roles and inputs

- **Pilot:** a colleague with no prior exposure to FleetCore orchestration.
- **Observer:** the FleetCore author. Silent by default; answers questions only by
  pointing at an existing doc section.
- **Inputs the pilot gets, and nothing else:** a fcore checkout at a tagged
  release, a real repo of their choice (already through `/fcore-onboard`), and
  the docs — starting at the
  [orchestration guide](../docs/how-to/orchestration-guide.md).

Scope: Sessions 1–4 plus both gates are **mandatory**; Session 5 (execute one
small task end-to-end) is an optional stretch goal — record which was run.

## Intervention counting

An **intervention** (counts against the ≤ 2 bar) is any of:

- Observer edits or writes any artifact in the pilot's repo or fcore checkout
- Observer runs any command on the pilot's behalf
- Observer answers a question that is **not** answerable by pointing at an
  existing doc section

A **friction note** (does not count, must be logged) is any of:

- Observer answers by naming a doc section the pilot hadn't found
- Pilot recovers alone but reports confusion, a wrong first attempt, or a
  doc passage they had to read more than twice
- Any session exceeding 2× its
  [time budget](../docs/how-to/orchestration-guide.md#the-flow--five-sessions-two-gates)

Judgment calls: if the observer is unsure whether an answer was "in the
docs", it's an intervention. Count honestly — the pilot exists to find doc
gaps, not to pass.

## After the run

File the completed report as `reports/orchestration-pilot-<repo>-<date>.md`
(`reports/` is gitignored FleetCore output). Then route **every** friction row per
[`triage-rules`](../templates/orchestration/docs/triage-rules.md):

| Friction kind | Route |
|---|---|
| Doc gap / unclear passage | Patch the guide or [troubleshooting doc](../docs/how-to/orchestration-troubleshooting.md) before the next pilot |
| Template defect | Fix FleetCore template, re-scaffold affected targets |
| Skill gap | Edit the meta-skill |
| One-off in the generated repo | `checklist-intake` checklist item in that repo |

Phase F exits when **two** pilots have passed and one scheduled
[headless run](../docs/how-to/headless-orchestration.md) has shipped a PR.

## Report template

```markdown
# Orchestration pilot — <repo> — <date>

- Pilot: <name>  ·  Observer: <name>
- FleetCore release: <tag>  ·  Repo shape: <layers/packages summary>
- Scope run: Sessions 1–4 [+ Session 5: yes/no]

## Result

- Interventions: <n> → PASS (≤2) / FAIL
- Gate 1 outcome: approved / re-answered fields: <list>
- Gate 2 outcome: approved / rejected because: <reason>
- Generated agents pass `audit --strict`: yes/no

## Sessions

| Session | Duration | Budget | Artifact valid first try? | Notes |
|---|---|---|---|---|
| 1 Profile | | 5–15 min | | |
| 2 Decisions | | 10–15 min | | |
| 3 Blueprint | | 5–10 min | | |
| 4 Generate | | ~5 min | | |
| 5 Execute (optional) | | — | | |

## Interventions

| # | When | What the observer did | Why the docs weren't enough |
|---|---|---|---|

## Friction log

| # | Session | What happened | Doc section involved | Route (triage) |
|---|---|---|---|---|
```
