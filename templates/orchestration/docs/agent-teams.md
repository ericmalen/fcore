# Agent teams (3+ layer tier)

How to run the agent-team tier that [dispatch-rules.md](./dispatch-rules.md)
selects when a task's `scope:` reaches `agent_team_min_scopes` (or the work is
cross-repo): one feature-orchestrator session plus per-layer specialist
teammates coordinating on a shared task list. Claude Code only — on other
tools every scope count uses in-session dispatch.

## Enabling

Agent teams are experimental and off by default. Enable per run with the
environment variable:

```bash
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```

or persistently in `.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
```

## Invocation

From the repo root (interactive or headless `-p`):

```bash
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude --agent feature-orchestrator \
  -p "Work task T-### from tasks.md per your procedures. The scope count
selects the agent-team tier: spawn one teammate per scoped layer using the
generated layer agents (e.g. shared-lib-engineer, data-engineer,
gateway-engineer),
break the task into per-layer team tasks honoring provider-first ordering,
then stop at the human gate." \
  --allowedTools "Read" "Write" "Edit" "Glob" "Grep" "Bash" "Agent" \
  "SendMessage" "TaskCreate" "TaskList" "TaskUpdate"
```

Teammates are spawned by instruction, not by a dedicated tool: the
orchestrator names the layer agents from `.claude/agents/` in plain language
and Claude Code creates the team. The shared task list and team config live
under `~/.claude/tasks/<team>/` and `~/.claude/teams/<team>/` — local state,
never committed.

## Rules that still hold

- **Single writer.** Teammates report through the team task list and their
  final messages; ONLY the orchestrator session writes `tasks.md` and
  `docs/orchestration/handoff-log.jsonl`. Git history on those two files must
  show orchestrator-session commits only.
- **One handoff-log entry per dispatch-and-return unit** — for teams, per
  teammate task completion the orchestrator verifies and logs.
- **Human gate.** The team run ends at PR/diff presentation, never a merge.

## Known limitations

- Headless runs use in-process teammates only (no split panes); the team
  cannot be resumed — a interrupted run is restarted, not resumed.
- Teammates occasionally fail to mark team tasks complete; the orchestrator
  should verify layer results itself rather than trust task status alone.
- One team per orchestrator session; teammates never spawn nested teams.
