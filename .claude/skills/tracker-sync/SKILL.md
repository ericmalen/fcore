---
name: tracker-sync
description: Syncs a project's orchestration tasks.md with its work tracker — Azure DevOps work items or GitHub Issues — importing intake items to Backlog and pushing task status out (DD-14 directional sync, never a mirror). Use when asked to sync, import, or report orchestration tasks to or from ADO or GitHub Issues. Only for repos with an orchestration tasks.md; not for generic issue triage, not for PR management, never merges or closes pull requests.
---

# tracker-sync

Directional bridge between a target's `tasks.md` (canonical execution state)
and its tracker (intake): new tracker items import as `scope: triage` Backlog
tasks blocked until a human scopes them; task status pushes out as tracker
state + comment. Conflicts are reported, never auto-resolved.

## Preconditions (DD-11 — one writer at a time)

1. Target has an orchestration `tasks.md` that parses clean.
2. Clean working tree in the target.
3. **No orchestrator session is active on the target** — ask the user to
   confirm; sync and execution never write `tasks.md` concurrently.

## Environment

| Platform | Needs |
|---|---|
| ADO | `ADO_ORG`, `ADO_PROJECT` env vars (or `ado.org`/`ado.project` in `docs/orchestration/tracker-sync.json`); `AZURE_DEVOPS_PAT` env var — the PAT is env-only, never config |
| GitHub | `gh` CLI authenticated for the target repo |

Non-Basic ADO process template? Set `ado.stateMap` (`basic` | `agile`) in
`docs/orchestration/tracker-sync.json` (shape gated by
`validateTrackerSyncConfig`).

## Run

Locate an Agent Base root first (same resolution as base-check): an Agent Base clone
if you are in one; else the target's `.claude/agent-base-setup/` while setup
tooling is present; else shallow-clone the Agent Base repo (URL in
`.claude/agent-base.json` → `toolRepo`). Then **always dry-run first**:

```
node <agent-base>/scripts/tracker-sync.mjs --target /path/to/project
```

Present the plan (imports / status updates / conflicts) to the user. Only
after they confirm:

```
node <agent-base>/scripts/tracker-sync.mjs --target /path/to/project --apply
```

Then commit the `tasks.md` change in the target with a conventional message
(e.g. `chore(tasks): tracker sync`). Exit 1 means conflicts — report each
`[kind] detail` line for human resolution; the rest of the plan still
applied.

## Never

- Never run `--apply` without showing the dry-run plan first.
- Never resolve a conflict yourself (reopen/close tracker items, reorder
  refs) — report and stop.
- Never put credentials in `tracker-sync.json` or anywhere in the repo.
- Never edit `handoff-log.jsonl` — it is orchestrator-only.

## Documents

templates/orchestration/docs/tasks-format.md
