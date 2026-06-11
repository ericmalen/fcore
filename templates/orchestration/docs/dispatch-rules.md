# Dispatch rules

How the feature-orchestrator decides the execution tier for a task. The
thresholds are data, not judgment — they live in
`docs/orchestration/blueprint.json` under `dispatch_rules`:

```json
{
  "subagent_max_scopes": 2,
  "agent_team_min_scopes": 3,
  "agent_team_on_cross_repo": true,
  "pipeline_when": ["scheduled", "multi_day"],
  "dispatch_order": ["shared-lib", "frontend", "gateway", "data"]
}
```

`dispatch_order` is derived by discovery from the repo's internal dependency
edges (providers first); it is data, not judgment — never reorder it by hand.
An empty array means the repo has no internal ordering constraints.

The orchestrator counts the layers in a task's `scope:` line (see
`tasks-format.md`) and applies the first matching rule:

| Condition | Tier |
| --- | --- |
| scopes ≤ `subagent_max_scopes` | In-session subagents — the orchestrator dispatches each specialist inside its own session |
| scopes ≥ `agent_team_min_scopes`, or cross-repo work | Agent team — one orchestrator session plus per-layer specialist sessions on a shared task list |
| scheduled or multi-day work (`pipeline_when`) | Headless pipeline run |

## Examples (four-layer monorepo)

Layer names in your repo come from discovery — these examples use neutral
names only:

- `scope: gateway` — one layer → subagent path; dispatch the gateway
  specialist in-session.
- `scope: frontend, shared-lib` — two layers → still subagents; dispatch
  both specialists in-session, in `dispatch_order` (shared-lib before
  frontend — the provider changes first).
- `scope: gateway, data, shared-lib` — three layers → agent team;
  per-layer sessions coordinate on the shared task list, and only the
  orchestrator session writes `tasks.md` and the handoff log.

## Runtime caveat

The agent-team tier runs on Claude Code only. On Copilot, every scope count
takes the subagent path — a documented limitation, not a silent divergence.
The headless tier is a later phase; until it ships, scheduled work also runs
the subagent path.
