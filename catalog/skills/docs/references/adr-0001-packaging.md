# ADR-0001: Package the docs standard as one skill plus one read-only auditor agent

Status: Accepted
Date: 2026-06-10

## Context

The documentation standard (Diátaxis content model, ADR and changelog
workflows, proportionality, verify-against-code rules) must be reusable
across repos of any language and size, in both Claude Code and VS Code
Copilot. Requirements in tension: routine doc work must trigger
automatically while a heavy audit must run only on request; always-on
context cost must stay minimal; the heavy path must not pollute the main
session; non-Claude agents must still be able to follow the conventions.

## Decision

We package the standard as: (1) a single `docs` skill — router SKILL.md
with all depth in on-demand references, covering writing, ADRs, changelog,
and the `docs setup` bootstrap; (2) a separate read-only `docs-auditor`
agent for audit/migration, never auto-invoked; (3) a few generated,
tool-neutral lines in the consuming repo's AGENTS.md that point to the
conventions by content path. Rejected: three separate skills (trigger
descriptions compete; shared content model duplicated), prompt/command
files and plugin packaging (single-tool surfaces), folding the audit into
the skill (context pollution), adoption-grade conservation gates for docs
migration (over-engineering for human-reviewed prose).

## Consequences

- Routine work loads ~60 lines plus at most one reference; always-on cost
  in consuming repos is a few AGENTS.md lines.
- Audit runs in a fresh subagent context by construction.
- Any AGENTS.md-reading agent can follow the standard as plain files;
  Claude-side auto-invocation is a bonus route, not a dependency.
- **Enforcement of docs-update-with-code is advisory only** — always-on
  instructions, no mechanical gate. Accepted trade-off: cross-tool hook
  support is preview-grade today. Revisit a PostToolUse hook (and a CI
  staleness check) when cross-tool hook support stabilizes; until then,
  drift is caught by the docs-auditor, not prevented.
- One skill means the trigger description must be precise alone: scoped to
  creating/updating/restructuring/reviewing docs, explicitly not to
  reading or discussing them.
