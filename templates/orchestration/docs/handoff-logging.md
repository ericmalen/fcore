# Handoff logging

Every dispatch-and-return unit in the orchestration loop is recorded in
`docs/orchestration/handoff-log.jsonl` — one JSON object per line, appended
by the **feature-orchestrator only**. Specialists never write this file;
they report in their final message and the orchestrator logs.

Direction is fixed: `from_agent` is the dispatching orchestrator, `to_agent`
is the dispatched agent — even though the entry is written after the return.
Analytics (log-report) group by `to_agent`; reversing the direction
misattributes the dispatch to the orchestrator.

## Entry shape

```json
{
  "timestamp": "2026-06-10T13:45:02Z",
  "from_agent": "feature-orchestrator",
  "to_agent": "api-engineer",
  "task_id": "T-001",
  "artifacts": ["apps/api/src/tag-routes.ts"],
  "decision_summary": "Dispatched api layer of T-001; endpoint and tests added, all green.",
  "duration_ms": 184000,
  "status": "success",
  "retry_count": 0
}
```

Field rules:

- `timestamp` — ISO 8601.
- `task_id` — the `T-###` id from `tasks.md`.
- `artifacts` — root-relative paths the dispatch produced or changed (may be
  empty on failure).
- `status` — `success` | `failed` | `blocked`.
- `failure_reason` — required (non-empty) when status is `failed` or
  `blocked`; absent or null on `success`.
- `retry_count` — 0 on first attempt; the failure protocol allows at most
  one retry, so values above 1 indicate a protocol violation.
- Optional when capturable: `model`, `turns_used`, `turn_limit`.

## Completion entries

A second entry shape, appended once per task — after the review gate and
commit, right before the orchestrator prunes (or moves to Done) the task's
line in `tasks.md` (`tasks-format.md`). This is the PERMANENT record of the
task's completion; `tasks.md` only holds a transient line, deleted or pruned
once this entry exists.

```json
{
  "timestamp": "2026-06-10T14:02:11Z",
  "event": "completion",
  "from_agent": "feature-orchestrator",
  "task_id": "T-001",
  "title": "Add asset-tagging endpoint",
  "scope": ["api", "db"],
  "commit": "abc1234"
}
```

`event: "completion"` is the discriminator — dispatch entries above omit it.
A completion entry never carries dispatch-only fields (`to_agent`,
`artifacts`, `decision_summary`, `duration_ms`, `status`, `retry_count`,
`failure_reason`); analytics (`log-report`) count these separately from
per-agent dispatch stats.

## Rules

- One entry per dispatch-and-return unit — including failures and retries;
  never a separate "dispatched" event. A failed task's `blocked:` line in
  `tasks.md` references its log entry by timestamp.
- Single writer: concurrent sessions never append; in agent-team runs only
  the orchestrator session touches the log.
- The log is an audit trail: never rewrite or delete entries; corrections
  are new entries.
