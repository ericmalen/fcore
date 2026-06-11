# Handoff logging

Every dispatch and return in the orchestration loop is recorded in
`docs/orchestration/handoff-log.jsonl` — one JSON object per line, appended
by the **feature-orchestrator only**. Specialists never write this file;
they report in their final message and the orchestrator logs.

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

## Rules

- One entry per dispatch/return — including failures and retries. A failed
  task's `blocked:` line in `tasks.md` references its log entry by
  timestamp.
- Single writer: concurrent sessions never append; in agent-team runs only
  the orchestrator session touches the log.
- The log is an audit trail: never rewrite or delete entries; corrections
  are new entries.
