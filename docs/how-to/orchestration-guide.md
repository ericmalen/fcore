# Orchestration in a repository

How to generate and run a repo-specific multi-agent team — discovery,
generation, and execution — from an open Agent Base clone against a project that
has already completed [setup](./setup-guide.md).

## What you get

After discovery and generation, the project gains:

- `feature-orchestrator` plus layer specialists in `.claude/agents/`
- Paired skills in `.claude/skills/`
- `tasks.md` at the repo root (work backlog)
- `docs/orchestration/` (profile, decisions, blueprint, manifest, handoff log,
  checklists, evals)

See [`spec/target-layout.md`](../../spec/target-layout.md#orchestration-layer-conditional)
for the full tree. Plain setup creates none of this — orchestration is
optional.

## What you need

- Project **already set up** (baseline skills installed; see
  [setup guide](./setup-guide.md))
- Target in **git** with a **clean working tree**
- **Node ≥ 20** on the machine (the AI runs scripts — you never will)
- Claude Code or Copilot in **agent mode**
- An open **Agent Base clone** (same pattern as `/base-setup`)

Orchestration discovery and generation meta-assets stay **kit-side** — they
run from the Agent Base clone against a target path, not from inside the target.

## Quick start

One-time: keep a Agent Base clone (`git clone <url> ~/tools/agent-base`).

Open the **Agent Base clone** in Claude Code (or Copilot agent mode) and run:

```text
/base-orchestrate /path/to/project
```

The skill orchestrates discovery and generation in fresh contexts and stops at
human gates. Details below.

**Repeat users:** freshen the Agent Base clone (`git pull --ff-only`), then
`/base-orchestrate /path/to/repo` again to regenerate from an updated
blueprint or kit templates.

## When to use orchestration

Use orchestration when a repo has **multiple layers or packages** and you want
a generated team to dispatch work across them from a `tasks.md` backlog.

Skip it when baseline setup is enough: one `docs-auditor`, maintenance
skills, and hand-authored agents via `agent-creator` cover many repos.

See [When to orchestrate](../explanation/orchestration.md) for the full
decision framing.

## The flow — five sessions, two gates

Run each step in a **fresh context** (new chat or subagent). Artifacts commit
to the target as they land.

| Session | Invoke | What happens | You decide |
|---|---|---|---|
| 1 | `repo-analyst` agent | Profiles the target → `docs/orchestration/repo-profile.json` | — |
| 2 | `requirements-interviewer` agent | Gap-driven policy Q&A → `decisions.json` (+ rendered `decisions.md`) | **Gate 1:** approve decisions |
| 3 | `plan-synthesizer` agent | Profile + decisions → `blueprint.json` (handoff-validated) | **Gate 2:** approve blueprint roster |
| 4 | `scaffolder` agent | Blueprint → generated agents, skills, docs; `generation-manifest.json` | Review diff, merge |
| 5 | `feature-orchestrator` agent (in target) | Picks `tasks.md` items, dispatches specialists, logs handoffs | Review PR / diff (human gate) |

Sessions can be days apart. Each step reads the previous step's committed
artifacts.

### Session 1 — Profile (`repo-analyst`)

From the Agent Base clone, dispatch the `repo-analyst` agent with the target path.
It runs `structure-detector`, `dependency-mapper`, and `convention-detector`
skills and writes a schema-valid `repo-profile.json`.

### Session 2 — Decisions (`requirements-interviewer`)

With the profile in place, dispatch `requirements-interviewer`. It asks only
gap-driven questions (TDD, review gates, security, QA depth, definition of
done). Output is `decisions.json`; `decisions.md` is rendered from it — never
hand-edit the Markdown.

**Gate 1:** read `decisions.md` and confirm policy before synthesis.

### Session 3 — Blueprint (`plan-synthesizer`)

Dispatch `plan-synthesizer`. It applies `blueprint-generator` rules, computes
`dispatch_order` from internal dependency edges, and gates with
`handoff-validator` before writing `blueprint.json`.

**Gate 2:** confirm the specialist roster (layer engineers, reviewers, QA,
security) and dispatch thresholds.

### Session 4 — Generate (`scaffolder`)

Dispatch `scaffolder`. It materializes agents and skills via pure slot
substitution, copies referenced docs into `docs/orchestration/`, and records
every file in `generation-manifest.json`.

Re-run the scaffolder after kit template updates; it refuses to overwrite
hand-edited generated files (conflict report instead).

### Session 5 — Execute (`feature-orchestrator`)

Open the **project**. Seed or extend `tasks.md` (see
[`tasks-format`](../../templates/orchestration/docs/tasks-format.md)).
Invoke `feature-orchestrator` on the next backlog item.

Dispatch tier depends on `scope:` layer count (see
[`dispatch-rules`](../../templates/orchestration/docs/dispatch-rules.md)):

| Layers in `scope:` | Tier |
|---|---|
| 1–2 | In-session subagents |
| 3+ or cross-repo | Agent team (Claude Code only) |

On Copilot, every scope count uses in-session subagents — see
[Copilot parity](../reference/orchestration-copilot-parity.md).

Nothing merges automatically: the orchestrator stops at PR / diff presentation.

## Lifecycle skills (installed at setup)

Every set-up project already has these; they activate once orchestration surfaces
exist:

| Skill | Role |
|---|---|
| `retro` | Turn bugs/review findings into checklist items |
| `log-report` | Summarize `handoff-log.jsonl` (failure rates, duration) |
| `eval-runner` | Run golden evals for generated agents |

See [Lifecycle maintenance](#lifecycle-maintenance) below.

## Copilot users

Allowlist kit scripts when prompted (`node scripts/lib/orchestration/*`,
read-only git). Subagent orchestration from `/base-orchestrate` should be
attempted first; if phases run inline, follow the per-session table manually
in fresh chats.

## After generation

- **Drift:** run `drift-checker` from the Agent Base clone when templates change.
- **Health gate:** invoke `evaluator` before distributing kit updates.
- **Regenerate:** re-run `scaffolder` against the stored blueprint — never
  hand-edit generated agent files.
- **Update kit:** re-run setup if the baseline skills need refreshing;
  orchestration assets are independent of the setup branch machinery.

## Lifecycle maintenance

**Retro (`retro`):** after a bug or substantive review finding, append a
checklist item to `docs/orchestration/checklists/review-checklist.md`. The
code-reviewer agent references this list on subsequent runs.

**Log report (`log-report`):** parse `handoff-log.jsonl` for per-agent
dispatch counts, failure rates, and duration. Flags agents with failure rate
> 20% or high turn utilization.

**Eval runner (`eval-runner`):** smoke tier (1×) after template edits; release
tier (5×, pass ≥ 4/5) before kit distribution. Goldens live in
`docs/orchestration/evals/<agent>/`.

**Triage:** route recurring issues per
[`triage-rules`](../../templates/orchestration/docs/triage-rules.md) —
template defect → fix kit template and re-scaffold; blueprint defect →
re-synthesize; skill gap → edit skill; one-off → retro checklist item.

## Further reading

- [Orchestration concepts](../explanation/orchestration.md) — architecture and
  design choices
- [Agents and skills reference](../reference/agents-and-skills.md) — kit-side
  vs shipped vs generated inventory
- [Copilot parity](../reference/orchestration-copilot-parity.md) — tool
  limitations
- [First run tutorial](../tutorials/orchestration-first-run.md) — walkthrough
  on kit fixtures
- [Build plan (engineering)](../../notes/agent-orchestration-plan.md) — phase
  history and acceptance criteria (not a how-to)
