# Orchestration — Copilot parity

Where GitHub Copilot (VS Code agent mode) matches Claude Code for orchestration
and where it does not. No silent divergence — gaps are explicit.

## What matches

| Surface | Both tools |
| --- | --- |
| Generated agents and skills | `.claude/agents/`, `.claude/skills/` |
| Orchestration state | `docs/orchestration/*`, `tasks.md` |
| Subagent dispatch | Orchestrator delegates specialists in-session |
| Lifecycle skills | `checklist-intake`, `log-report`, `eval-runner` |
| FleetCore scripts | Node validators and scaffold (allowlist when prompted) |

Discovery and generation (`/fcore-fleet-config`) should **attempt** subagent
dispatch in Copilot the same as Claude Code. If subagent dispatch fails, run
each phase inline in a fresh chat following the session table in the
[orchestration guide](../how-to/orchestration-guide.md).

## Documented gaps

### Agent teams (3+ layer tier)

Claude Code supports an experimental **agent team** tier when a task's
`scope:` touches `agent_team_min_scopes` layers (default 3) or work is
cross-repo. Copilot **always uses in-session subagents** regardless of scope
count.

Implications on Copilot:

- Multi-layer tasks still run — the orchestrator dispatches specialists
  sequentially in one session.
- No shared team task list; no `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`.
- Single-writer rules for `tasks.md` and `handoff-log.jsonl` still apply.

See generated `docs/orchestration/agent-teams.md` in targets for Claude Code
setup.

### Headless pipeline tier

The headless tier ships as cron-driven CI pipelines (`claude -p` via
`templates/ci/orchestrator-run.{github,ado}.yml`, gated by
`headless-guard`) — see
[headless-orchestration](../how-to/headless-orchestration.md).
`dispatch_rules.pipeline_when` (`scheduled`, `multi_day`) is
schema-validated but not yet consumed by the guard; runs are selected by
the cron schedule, not per-task routing.

### Claude-only agent frontmatter

Generated agents may include Claude-specific frontmatter (`model`, etc.).
Copilot ignores unknown fields — safe to include, no effect in VS Code.

### Permissions and hooks

`.claude/settings.json` `permissions` is Claude Code-only. Copilot sandbox and
approval behavior use VS Code settings. Setup wires the shared subset; see
[cross-tool setup](../how-to/cross-tool-setup.md).

## Practical guidance for Copilot users

1. Set up the project first (`/fcore-onboard`).
2. Run `/fcore-fleet-config` from the fcore checkout; allowlist `node` on FleetCore
   scripts when prompted.
3. After generation, open the **target** and invoke `feature-orchestrator` on
   `tasks.md` items — expect in-session dispatch even for wide scopes.
4. Use `log-report` and `eval-runner` the same as on Claude Code.
