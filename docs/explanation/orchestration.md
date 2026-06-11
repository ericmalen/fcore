# Orchestration — concepts and trade-offs

Why agent-base offers optional multi-agent orchestration, how the pieces fit
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
| Discovery | Agent Base clone → target `docs/orchestration/` | Yes — profiling, interview, synthesis | `repo-profile.json`, `decisions.json`, `blueprint.json` |
| Generation | Agent Base clone → target `.claude/` + docs | No — pure template slot fill | Generated agents, paired skills, payload docs, `generation-manifest.json` |
| Execution | Project | Yes — orchestrator dispatches specialists | Commits, handoff log entries, PR at human gate |

Discovery and generation meta-assets stay **Agent Base-side** (same pattern as
`base-setup`). Only the generated agents and orchestration docs land in the
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

## Quality flywheel

Every set-up project gets `retro`, `log-report`, and `eval-runner` — lifecycle
skills that activate once orchestration surfaces exist. Bugs and review
findings become checklist items; handoff logs surface failing agents; golden
evals gate template changes.

## Further reading

- [Orchestration how-to](../how-to/orchestration-guide.md) — five-session flow
  and gates.
- [Agents and skills reference](../reference/agents-and-skills.md) — Agent Base-side
  vs shipped vs generated inventory.
- [First-run tutorial](../tutorials/orchestration-first-run.md) — walkthrough
  on Agent Base fixtures.
