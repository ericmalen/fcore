---
name: db-migration
description: Procedure for changing database schema safely in the <!-- agent-base:slot:stack --> layer at <!-- agent-base:slot:layer-path -->. Use when a task requires altering tables, columns, indexes, or other schema objects in that layer. Not for data backfills decided ad hoc, query tuning, or layers outside <!-- agent-base:slot:layer-path -->.
---

How the layer specialist changes schema in
`<!-- agent-base:slot:layer-path -->` (<!-- agent-base:slot:stack -->).

## Procedure

1. Locate the migration directory and tooling under
   `<!-- agent-base:slot:layer-path -->`. Read the most recent migration
   end-to-end: its naming scheme, up/down structure, and how it is
   registered. That is your pattern. The layer manifest
   (`<!-- agent-base:slot:manifest-path -->`) names the migration tooling
   and its version.
2. Every schema edit ships with a new migration. Never edit a migration
   that has been applied anywhere — not to fix a typo, not to squash. If a
   prior migration is wrong, write a new one that corrects it.
3. Author the migration following the layer conventions:
   <!-- agent-base:slot:conventions -->. Keep it to one logical schema change;
   split unrelated changes into separate migrations.
4. Verify the migration and write rollback notes:
   - Apply it against a local or test database and confirm the resulting
     schema matches intent.
   - Provide the down path: a working down migration where the tooling
     supports it, otherwise explicit rollback notes in your report stating
     how to revert and what data, if any, is lost.
   - Flag destructive steps (drops, narrowing types, NOT NULL on populated
     columns) explicitly — these need orchestrator sign-off before merge.
5. Update any schema-derived artifacts the layer maintains (models, typed
   clients, generated definitions) in the same change.
6. Run `<!-- agent-base:slot:test-cmd -->`. Fix failures before reporting.
7. Quote the test command output verbatim in your report — pass/fail counts
   at minimum — plus the applied migration's identifier and the rollback
   notes.

## Rules

- No schema change without a new migration file; no edits to applied ones.
- A migration without a verified down path or rollback notes is incomplete.
- Destructive operations are reported, never silently merged.
