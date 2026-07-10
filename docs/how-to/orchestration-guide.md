# Orchestration in a repository

How to generate and run a repo-specific multi-agent team — discovery,
generation, and execution — from an open fcore checkout (clone or
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
- A **fcore checkout** (staged release or open clone — same pattern
  as `/fcore-onboard`)

Orchestration discovery and generation meta-assets stay **FleetCore-side** — they
run from the fcore checkout against a target path, not from inside the target.

### Pre-flight checklist

Verify each before starting (these mirror the `/fcore-fleet-config` hard
preconditions — failing one stops the run):

| Check | Verify with |
|---|---|
| Target is a git repo, not the fcore checkout | `git -C /path/to/project rev-parse` succeeds; path ≠ fcore checkout |
| Clean working tree | `git -C /path/to/project status --porcelain` prints nothing |
| Baseline setup present | `.claude/fcore.json` and `.claude/skills/fcore-check/` exist in the target |
| Node ≥ 20 | `node --version` |
| Checkout fresh | Clones: `git -C ~/tools/fcore pull --ff-only`. staged releases are immutable at their tag — pick a newer tag instead |
| Target has ≥ 1 code layer with a test signal | `node <fcore>/scripts/orchestrate-preflight.mjs --root /path/to/project` exits 0 |

## Quick start

From the project:

```sh
npx github:ericmalen/fcore#v1.2.1 orchestrate
```

which launches Claude Code with the flow started (without the `claude`
CLI: type `/fcore-bootstrap` in your AI session, or paste the
printed prompt). Or, from a clone
(one-time: `git clone <url> ~/tools/fcore`), open the **fcore
clone** in Claude Code (or Copilot agent mode) and run:

```text
/fcore-fleet-config /path/to/project
```

The skill orchestrates discovery and generation in fresh contexts and stops at
human gates. Details below.

**Repeat users:** freshen the checkout (clones: `git pull --ff-only`; npx:
re-run at the newer tag), then `/fcore-fleet-config /path/to/repo` again — see
[Re-orchestrating as the repo grows](#re-orchestrating-as-the-repo-grows) for
what changes on a repeat run.

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

Time budgets below are measured on the FleetCore fixtures; a large real repo can
take 2–3× longer per session. A silent wait inside one budget is normal —
past 2× the budget with no artifact, see the
[troubleshooting guide](./orchestration-troubleshooting.md).

### Session 1 — Profile (`repo-analyst`)

From the fcore checkout, dispatch the `repo-analyst` agent with the target path.
It runs `structure-detector`, `dependency-mapper`, and `convention-detector`
skills and writes a schema-valid `repo-profile.json`.

**Expected output** (~5–15 min; compare
[`maxi-repo.profile.json`](../../test/fixtures/orchestration/maxi-repo.profile.json)):

- One `layers[]` entry per package/app you'd name yourself; each has a real
  `path`, `stack`, `manifestPath` (the file evidencing the stack — e.g.
  `package.json`, `pyproject.toml`, `main.tf`), and `testCmd` (or `null` plus
  a matching `gaps[]` entry — never a guessed command)
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
seven fields populated; no field defaulted without you being asked.

**Gate 1 — approve when every answer is yes:**

- [ ] Each of the seven decisions fields reflects a choice you made, not a default
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

Re-run the scaffolder after FleetCore template updates; it refuses to overwrite
hand-edited generated files (conflict report instead — see troubleshooting).

### Session 5 — Execute (`feature-orchestrator`)

Open the **project**. Seed or extend `tasks.md` (see
[`tasks-format`](../../templates/orchestration/docs/tasks-format.md)).
Invoke `feature-orchestrator` on the next backlog item.

**Routing (R-56).** Generation also writes a routing block into the project's
`AGENTS.md` (inherited by `CLAUDE.md`), so the main loop knows to do the intake
itself: when a request matches the policy, it captures a `tasks.md` item and
hands off to `feature-orchestrator` instead of building inline. The
`orchestrationRouting` decision sets the policy — `always`, `threshold` (the
default, fires at the agent-team layer count below), or `manual` (no block;
you invoke by hand). Re-run the scaffolder to refresh the block after changing
the decision.

Dispatch tier depends on `scope:` layer count (see
[`dispatch-rules`](../../templates/orchestration/docs/dispatch-rules.md)):

| Layers in `scope:` | Tier |
|---|---|
| 1–2 | In-session subagents |
| 3+ or cross-repo | Agent team (Claude Code only) |

On Copilot, every scope count uses in-session subagents — see
[Copilot parity](../reference/orchestration-copilot-parity.md).

Nothing merges automatically: the orchestrator stops at PR / diff presentation.

## Re-orchestrating as the repo grows

Orchestration is evidence-driven: discovery profiles what exists, it never
interviews you about what you're planning to build. A repo with no code layer
that has a test command has nothing for it to generate from — the preflight
guard (see Pre-flight checklist above) stops `/fcore-fleet-config` before
Phase 1 rather than failing deep in discovery or synthesis. So the intended
lifecycle for a new project is:

1. `/fcore-onboard` — baseline AI config only, no orchestration.
2. Build the first layer, with tests. (Plain Claude/Copilot + the baseline
   skills is enough for this — you don't need orchestration to write the
   first layer that orchestration will later dispatch work to.)
3. `/fcore-fleet-config /path/to/project` — first run (`mode=fresh`). Generates
   a small team: one specialist for that layer, plus `code-reviewer` and
   `feature-orchestrator`.
4. A new layer ships (e.g. an API alongside the CLI).
5. `/fcore-fleet-config /path/to/project` again — the preflight guard now
   reports `mode=re-run` (it detects prior `decisions.json` or
   `generation-manifest.json`). The team grows to match:

   - **Re-derived, always:** the profile (Session 1 re-profiles fresh — new
     layer, new `internalEdges`, new `dispatch_order`), the blueprint
     (Session 3 re-synthesizes from the fresh profile), the generated files
     and manifest (Session 4 regenerates).
   - **Reused, never re-asked:** every decisions field from the prior run
     that's still valid for its enum — including the three fields normally
     "always asked." A re-run is not a policy reset; Gate 1 shows a
     kept-vs-asked table instead of the full seven questions.
   - **Removed:** a specialist or paired skill the new blueprint no longer
     needs (e.g. a layer was deleted) — the scaffolder deletes the orphaned
     file(s) and reports the count. A hand-edited orphan blocks first, as a
     USER-EDIT conflict, same as any other generated file.
   - **Untouched:** living state — `tasks.md`, `handoff-log.jsonl`,
     `docs/orchestration/runs/`, `checklists/`, the `AGENTS.md` routing
     region — is never manifest-tracked, so a re-run never touches it even
     when the agent that owned a checklist is dropped.

Before re-running, it's worth checking for drift first (`drift-checker` from
the fcore checkout) so any TEMPLATE-DRIFT or USER-EDIT surfaces before you
spend three sessions getting back to the scaffolder step, which would refuse
a USER-EDIT anyway.

## Lifecycle skills (installed at setup)

These optional lifecycle skills (R-55) are installed by `fcore-fleet-config` as a
generation prerequisite (or earlier via `fcore skills add`); they activate
once orchestration surfaces exist:

| Skill | Role |
|---|---|
| `checklist-intake` | Turn bugs/review findings into checklist items |
| `log-report` | Summarize `handoff-log.jsonl` (failure rates, duration) |
| `eval-runner` | Run golden evals for generated agents |
| `tracker-sync` | Sync `tasks.md` with ADO work items / GitHub Issues (intake in, status out); prunes synced `## Done` items |

See [Lifecycle maintenance](#lifecycle-maintenance) below.

## Copilot users

Allowlist FleetCore scripts when prompted (`node scripts/lib/orchestration/*`,
read-only git). Subagent orchestration from `/fcore-fleet-config` should be
attempted first; if phases run inline, follow the step-by-step
[inline fallback procedure](./orchestration-troubleshooting.md#copilot-inline-fallback)
in the troubleshooting guide.

## After generation

- **Drift:** run `drift-checker` from the fcore checkout when templates change.
- **Health gate:** invoke `evaluator` before distributing FleetCore updates.
- **Regenerate:** re-run `scaffolder` against the stored blueprint — never
  hand-edit generated agent files. To grow the team as the repo grows, re-run
  `/fcore-fleet-config` itself — see
  [Re-orchestrating as the repo grows](#re-orchestrating-as-the-repo-grows).
- **Update FleetCore:** re-run setup if the baseline skills need refreshing;
  orchestration assets are independent of the setup branch machinery.
- **Schedule it:** once execution works interactively, add the
  [headless pipeline](./headless-orchestration.md) to ship backlog items as
  scheduled PRs.

## Lifecycle maintenance

**Checklist intake (`checklist-intake`):** after a bug or substantive review finding, append a
checklist item to `docs/orchestration/checklists/review-checklist.md`. The
code-reviewer agent references this list on subsequent runs.

**Log report (`log-report`):** parse `handoff-log.jsonl` for per-agent
dispatch counts, failure rates, and duration. Flags agents with failure rate
> 20% or high turn utilization. Completion entries (a task's permanent
completion record, appended once `tasks.md` prunes its `## Done` line) are
counted separately, not folded into per-agent stats.

**Eval runner (`eval-runner`):** smoke tier (1×) after template edits; release
tier (5×, pass ≥ 4/5) before FleetCore distribution. Goldens live in
`docs/orchestration/evals/<agent>/`, plus `evals/routing/` — main-loop
routing-decision goldens (does a request get deferred to the fleet?),
required whenever `routing_policy` is `always` or `threshold`. FleetCore
maintainers qualifying a routing- or completion-protocol change end to end
(not per-target) use `validate-orchestration` instead — it builds a fixture,
runs these goldens as real sessions, and reports to `reports/`.

**Triage:** route recurring issues per
[`triage-rules`](../../templates/orchestration/docs/triage-rules.md) —
template defect → fix FleetCore template and re-scaffold; blueprint defect →
re-synthesize; skill gap → edit skill; one-off → checklist-intake checklist item.

## Further reading

- [Troubleshooting](./orchestration-troubleshooting.md) — per-session failure
  modes and recoveries
- [Orchestration concepts](../explanation/orchestration.md) — architecture and
  design choices
- [Agents and skills reference](../reference/agents-and-skills.md) — FleetCore-side
  vs shipped vs generated inventory
- [Copilot parity](../reference/orchestration-copilot-parity.md) — tool
  limitations
- [First run tutorial](../tutorials/orchestration-first-run.md) — walkthrough
  on FleetCore fixtures
- [Build plan (engineering)](../../notes/agent-orchestration-plan.md) — phase
  history and acceptance criteria (not a how-to)
