# Orchestration — concepts and trade-offs

Why fcore offers optional multi-agent orchestration, how the pieces fit
together, and when plain setup is enough.

## The problem it solves

Baseline setup gives every repo a consistent AI setup — instructions,
maintenance skills, and room for hand-authored agents. That works well when
one agent (or a few custom agents) can own most tasks.

Orchestration targets repos where work routinely spans **multiple layers or
packages** — UI, API, database, shared libraries — and you want a **generated
team** that dispatches layer specialists from a versioned `tasks.md` backlog,
with shared dispatch rules and a handoff log.

## Three layers

| Layer | Where it runs | Semantic? | Output |
| --- | --- | --- | --- |
| Discovery | fcore checkout → target `docs/orchestration/` | Yes — profiling, interview, synthesis | `repo-profile.json`, `decisions.json`, `blueprint.json` |
| Generation | fcore checkout → target `.claude/` + docs | No — pure template slot fill | Generated agents, paired skills, payload docs, `generation-manifest.json` |
| Execution | Project | Yes — orchestrator dispatches specialists | Commits, handoff log entries, PR at human gate |

Discovery and generation meta-assets stay **FleetCore-side** (same pattern as
`fcore-onboard`). Only the generated agents and orchestration docs land in the
target. See [`target-layout.md`](../../spec/target-layout.md#orchestration-layer-conditional).

## Flat orchestration

The generated `feature-orchestrator` calls every specialist **directly** — no
nested subagents. This matches how both Claude Code and Copilot handle
delegation at the subagent tier and keeps debugging tractable.

For tasks touching three or more layers, Claude Code can use an **agent team**
tier (experimental). Copilot always uses in-session subagents — a documented
cap, not silent divergence. See
[`orchestration-copilot-parity.md`](../reference/orchestration-copilot-parity.md).

## When to orchestrate

**Use orchestration** when:

- The repo has multiple CODE layers with distinct stacks and test commands.
- Work is tracked as discrete backlog items that may span layers.
- You want dispatch rules, handoff logging, and eval goldens baked in from
  generation.

**Skip orchestration** when:

- Baseline setup plus hand-authored agents (`agent-creator`) is enough.
- The repo is a single package with one primary stack.
- You do not want generated agents in `.claude/` — they are meant to be
  regenerated from the blueprint, not edited by hand.

That is the *setup-time* decision (generate the fleet or not). The
*runtime* decision — when the main conversation loop should hand a request to
the fleet rather than build it inline — is governed by R-56: generation writes
a routing block into the project's always-loaded instructions (`AGENTS.md`,
inherited by `CLAUDE.md`). It tells the main loop to capture qualifying work as
a `tasks.md` backlog item and invoke `feature-orchestrator`. The
`orchestrationRouting` decision tunes it: `always` (route every feature-shaped
request), `threshold` (route at the agent-team layer count — the default), or
`manual` (no block; invoke by hand). Without this block the generated fleet is
unreachable from an ad-hoc request — the trigger nothing fires.

There is also a *timing* dimension: orchestration is evidence-driven, so a
repo with no code layer that has a test command has nothing for discovery to
profile — a preflight guard stops `/fcore-fleet-config` before it burns a
discovery phase on an empty repo, rather than asking you to describe the
project you're planning to build. The team grows with the repo instead: set
up baseline config, build the first layer with tests, generate a small team,
then re-run `/fcore-fleet-config` each time a new layer ships. Re-runs are
cheap — the profile and blueprint always re-derive from current evidence, but
policy decisions from the prior run carry forward unchanged (a re-run is not
a policy reset), and generation stays deterministic, so growing the team
costs one more gate approval, not a fresh interview. See
[Re-orchestrating as the repo grows](../how-to/orchestration-guide.md#re-orchestrating-as-the-repo-grows).

## Quality flywheel

The optional lifecycle skills `checklist-intake`, `log-report`, and `eval-runner` (R-55)
activate once orchestration surfaces exist. They are opt-in — not in the
default baseline — and `fcore-fleet-config` installs them as a generation
prerequisite (or add them earlier with `fcore skills add`). Bugs and
review findings become checklist items; handoff logs surface failing agents;
golden evals gate template changes.

## Further reading

- [Orchestration how-to](../how-to/orchestration-guide.md) — five-session flow
  and gates.
- [Agents and skills reference](../reference/agents-and-skills.md) — FleetCore-side
  vs shipped vs generated inventory.
- [First-run tutorial](../tutorials/orchestration-first-run.md) — walkthrough
  on FleetCore fixtures.
