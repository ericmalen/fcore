# Orchestration in a repository

How to generate and run a repo-specific multi-agent team — discovery,
generation, and execution — from an open base checkout (clone or
npx-staged release) against a project that has already completed
[setup](./setup-guide.md).

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
- A **base checkout** (staged release or open clone — same pattern
  as `/base-setup`)

Orchestration discovery and generation meta-assets stay **Agent Base-side** — they
run from the base checkout against a target path, not from inside the target.

### Pre-flight checklist

Verify each before starting (these mirror the `/base-orchestrate` hard
preconditions — failing one stops the run):

| Check | Verify with |
|---|---|
| Target is a git repo, not the base checkout | `git -C /path/to/project rev-parse` succeeds; path ≠ base checkout |
| Clean working tree | `git -C /path/to/project status --porcelain` prints nothing |
| Baseline setup present | `.claude/agent-base.json` and `.claude/skills/base-check/` exist in the target |
| Node ≥ 20 | `node --version` |
| Checkout fresh | Clones: `git -C ~/tools/agent-base pull --ff-only`. staged releases are immutable at their tag — pick a newer tag instead |

## Quick start

From the project:

```sh
npx github:ericmalen/agent-base#v1.2.1 orchestrate
```

which launches Claude Code with the flow started (without the `claude`
CLI: type `/agent-base-bootstrap` in your AI session, or paste the
printed prompt). Or, from a clone
(one-time: `git clone <url> ~/tools/agent-base`), open the **base
clone** in Claude Code (or Copilot agent mode) and run:

```text
/base-orchestrate /path/to/project
```

The skill orchestrates discovery and generation in fresh contexts and stops at
human gates. Details below.

**Repeat users:** freshen the checkout (clones: `git pull --ff-only`; npx:
re-run at the newer tag), then `/base-orchestrate /path/to/repo` again to
regenerate from an updated blueprint or Agent Base templates.

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

Time budgets below are measured on the Agent Base fixtures; a large real repo can
take 2–3× longer per session. A silent wait inside one budget is normal —
past 2× the budget with no artifact, see the
[troubleshooting guide](./orchestration-troubleshooting.md).

### Session 1 — Profile (`repo-analyst`)

From the base checkout, dispatch the `repo-analyst` agent with the target path.
It runs `structure-detector`, `dependency-mapper`, and `convention-detector`
skills and writes a schema-valid `repo-profile.json`.

**Expected output** (~5–15 min; compare
[`maxi-repo.profile.json`](../../test/fixtures/orchestration/maxi-repo.profile.json)):

- One `layers[]` entry per package/app you'd name yourself; each has a real
  `path`, `stack`, and `testCmd` (or `null` plus a matching `gaps[]` entry —
  never a guessed command)
- `internalEdges[]` lists consumer→provider pairs you recognize (`[]` is
  correct for single-package repos)
- Everything the analyst couldn't evidence is in `gaps[]`, not invented
- Missing a layer you expected? See troubleshooting before re-running.

### Session 2 — Decisions (`requirements-interviewer`)

With the profile in place, dispatch `requirements-interviewer`. It asks only
gap-driven questions (TDD, review gates, security, QA depth, definition of
done). Output is `decisions.json`; `decisions.md` is rendered from it — never
hand-edit the Markdown.

**Expected output** (~10–15 min including your answers; compare
[`maxi-repo.decisions.json`](../../test/fixtures/orchestration/maxi-repo.decisions.json)):
every question maps to one schema field with a finite enum — if you're asked
something open-ended, the interviewer has drifted (see troubleshooting). All
six fields populated; no field defaulted without you being asked.

**Gate 1 — approve when every answer is yes:**

- [ ] Each of the six decisions fields reflects a choice you made, not a default
- [ ] The enum values match how the team actually works (e.g. `every-merge`
      review only if that's real practice)
- [ ] `decisions.md` says exactly what `decisions.json` says (it's rendered —
      if you want a change, re-answer; don't edit either file by hand)

To change an answer: re-dispatch `requirements-interviewer` and redo the
affected question — never edit `decisions.md` directly.

### Session 3 — Blueprint (`plan-synthesizer`)

Dispatch `plan-synthesizer`. It applies `blueprint-generator` rules, computes
`dispatch_order` from internal dependency edges, and gates with
`handoff-validator` before writing `blueprint.json`.

**Expected output** (~5–10 min; compare
[`maxi-repo.synthesized.blueprint.json`](../../test/fixtures/orchestration/maxi-repo.synthesized.blueprint.json)):
one specialist per profile layer (or the generic specialist for shapes the six
named templates don't cover), plus reviewer/QA/security specialists when your
decisions call for them; `dispatch_rules.dispatch_order` puts providers before
consumers (e.g. `shared` before `ui`/`api`).

**Gate 2 — approve when every answer is yes:**

- [ ] Every profile layer is covered by a specialist (or a justified generic
      fallback)
- [ ] Reviewer/QA/security roster matches your Gate 1 decisions
- [ ] `subagent_max_scopes` / `agent_team_min_scopes` thresholds are sane for
      the repo (defaults: 2 / 3)
- [ ] `dispatch_order` is provider-first and you recognize the ordering
- [ ] Each specialist has eval requirements (`minGoldens`) set

### Session 4 — Generate (`scaffolder`)

Dispatch `scaffolder`. It materializes agents and skills via pure slot
substitution, copies referenced docs into `docs/orchestration/`, and records
every file in `generation-manifest.json`.

**Expected output** (~5 min): one file in `.claude/agents/` per blueprint
specialist + the orchestrator, paired skills in `.claude/skills/`, referenced
docs under `docs/orchestration/`, and a `generation-manifest.json` entry
(template id, version, SHA) for **every** generated file. Re-running
immediately must be a no-op — any diff on a clean re-run is a bug.

Re-run the scaffolder after Agent Base template updates; it refuses to overwrite
hand-edited generated files (conflict report instead — see troubleshooting).

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
| `tracker-sync` | Sync `tasks.md` with ADO work items / GitHub Issues (intake in, status out) |

See [Lifecycle maintenance](#lifecycle-maintenance) below.

## Copilot users

Allowlist Agent Base scripts when prompted (`node scripts/lib/orchestration/*`,
read-only git). Subagent orchestration from `/base-orchestrate` should be
attempted first; if phases run inline, follow the step-by-step
[inline fallback procedure](./orchestration-troubleshooting.md#copilot-inline-fallback)
in the troubleshooting guide.

## After generation

- **Drift:** run `drift-checker` from the base checkout when templates change.
- **Health gate:** invoke `evaluator` before distributing Agent Base updates.
- **Regenerate:** re-run `scaffolder` against the stored blueprint — never
  hand-edit generated agent files.
- **Update Agent Base:** re-run setup if the baseline skills need refreshing;
  orchestration assets are independent of the setup branch machinery.
- **Schedule it:** once execution works interactively, add the
  [headless pipeline](./headless-orchestration.md) to ship backlog items as
  scheduled PRs.

## Lifecycle maintenance

**Retro (`retro`):** after a bug or substantive review finding, append a
checklist item to `docs/orchestration/checklists/review-checklist.md`. The
code-reviewer agent references this list on subsequent runs.

**Log report (`log-report`):** parse `handoff-log.jsonl` for per-agent
dispatch counts, failure rates, and duration. Flags agents with failure rate
> 20% or high turn utilization.

**Eval runner (`eval-runner`):** smoke tier (1×) after template edits; release
tier (5×, pass ≥ 4/5) before Agent Base distribution. Goldens live in
`docs/orchestration/evals/<agent>/`.

**Triage:** route recurring issues per
[`triage-rules`](../../templates/orchestration/docs/triage-rules.md) —
template defect → fix Agent Base template and re-scaffold; blueprint defect →
re-synthesize; skill gap → edit skill; one-off → retro checklist item.

## Further reading

- [Troubleshooting](./orchestration-troubleshooting.md) — per-session failure
  modes and recoveries
- [Orchestration concepts](../explanation/orchestration.md) — architecture and
  design choices
- [Agents and skills reference](../reference/agents-and-skills.md) — Agent Base-side
  vs shipped vs generated inventory
- [Copilot parity](../reference/orchestration-copilot-parity.md) — tool
  limitations
- [First run tutorial](../tutorials/orchestration-first-run.md) — walkthrough
  on Agent Base fixtures
- [Build plan (engineering)](../../notes/agent-orchestration-plan.md) — phase
  history and acceptance criteria (not a how-to)
