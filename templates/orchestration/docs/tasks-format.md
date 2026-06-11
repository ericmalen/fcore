# tasks.md format

`tasks.md` at the repo root is the orchestration work-intake file: the
backlog the feature-orchestrator reads, executes, and updates. It is
versioned with the code and needs no external tracker.

## Canonical example

```markdown
# Tasks

## Backlog

- [ ] T-001 | scope: api, db | Add asset-tagging endpoint
  - AC: POST /assets/:id/tags validates via shared Zod schema
  - AC: Prisma migration included; integration test passes

## In Progress

- [~] T-002 | scope: ui | Bilingual toggle on catalogue page (owner: feature-orchestrator)

## Done

- [x] T-000 | scope: shared | Extract tag schema to types.ts (commit: abc1234)
```

## Grammar

- Three sections, always present, in this order: `## Backlog`,
  `## In Progress`, `## Done`. Section membership IS the task status; the
  checkbox mirrors it (`[ ]` / `[~]` / `[x]`).
- One task per line: `- [<box>] T-### | scope: <layers> | <title>`.
  - `T-###` ids are unique across the whole file and never reused.
  - `scope:` lists the layers the task touches, comma-separated — this drives
    dispatch (see `dispatch-rules.md`).
  - Optional trailing annotations on the title: `(owner: <agent>)` while in
    progress, `(commit: <sha>)` appended on completion.
- Indented detail lines, two spaces, one per line, in this order:
  - `- ref: <tracker id>` — tracker provenance, max one per task:
    `AB#123` (Azure DevOps work item) or `#45` / `owner/repo#45`
    (GitHub issue). Written by `tracker-sync`; comes before any `AC:` line.
  - `- AC: <criterion>` — acceptance criteria.
  - `- blocked: <reference>` — only in Backlog; points at the handoff-log
    entry explaining the failure (or, on imports, at the tracker item
    awaiting scoping — see below).

## Tracker imports

`tracker-sync` imports new tracker items as Backlog tasks with the sentinel
scope `triage` plus a `blocked:` line:

```markdown
- [ ] T-003 | scope: triage | Title copied from the tracker item
  - ref: AB#123
  - blocked: needs human scoping (imported from AB#123)
```

The orchestrator never dispatches `blocked:` items, so an unscoped import
cannot run. To activate one: replace `triage` with the real layer list and
delete the `blocked:` line. The `ref:` line stays — status changes push back
to the tracker on the next sync.

## Rules

- **One writer at a time:** the orchestrator modifies this file during
  execution; `tracker-sync` modifies it at intake/report boundaries (never
  while an orchestrator session is active). Specialists never touch it —
  they report results in their final message; the orchestrator applies all
  status changes.
- The orchestrator moves a task's line between sections as work proceeds and
  appends the commit SHA when it lands in Done.
- A task that fails twice returns to Backlog with a `blocked:` line
  referencing the handoff-log entry — never silent retries.
- Keep the file canonical (this exact layout): the orchestrator edits it via
  Agent Base's parser/renderer, which accepts only this shape.

## Bootstrapping tasks.md

After orchestration generation, create `tasks.md` at the repo root if it does
not exist yet. Start from this skeleton and replace layer names with those from
your `repo-profile.json`:

```markdown
# Tasks

## Backlog

- [ ] T-001 | scope: <layer> | <first feature title>
  - AC: <measurable criterion>

## In Progress

## Done
```

Rules for the first item:

- Use layer names exactly as in `scope:` — they must match blueprint
  specialists (e.g. `shared`, `api`, not path globs).
- Assign `T-001` and increment; ids are never reused.
- Keep all three sections present even when empty.
- Only `feature-orchestrator` edits this file after bootstrap — specialists
  report in their final message.

Canonical examples also live in `test/fixtures/orchestration/tasks-canonical.md`
in the Agent Base repo.
