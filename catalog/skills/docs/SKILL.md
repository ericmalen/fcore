---
name: docs
description: Creates, updates, restructures, or reviews documentation to the team standard — READMEs, Diátaxis docs, ADRs, changelogs — and bootstraps the standard into a repo via "docs setup". Use when documentation must be written or changed. Not for merely reading or discussing existing docs, and not for code changes that don't alter behavior.
---

# docs

Documentation to the team standard. You write docs; you never fabricate.

## Decide the doc type first (Diátaxis — never mix types in one document)

| The content... | Type | Lives in |
|---|---|---|
| teaches a newcomer by doing | tutorial | docs/tutorials/ |
| solves one task for someone mid-work | how-to | docs/how-to/ |
| states facts (API, config, CLI) | reference | docs/reference/ |
| explains why/concepts/trade-offs | explanation | docs/explanation/ |
| records an architectural decision | ADR | docs/adr/ — see [adr](references/adr.md) |
| announces behavior changes to consumers | changelog | CHANGELOG.md — see [changelog](references/changelog.md) |
| orients a first-time visitor | README | repo root — entry point only; depth lives in docs |

Type boundaries and voice per type: [diataxis](references/diataxis.md).
Skeletons: [templates](references/templates.md) — load only when writing.

## Proportionality (overrides everything above)

Output scales to the repo — a small utility gets only a good README; full
structure is reserved for repos that warrant it. NEVER create empty
scaffolding or placeholder pages. When you omit something the standard
describes, say so and why. Tier ladder and repo-inspection signals:
[proportionality](references/proportionality.md).

## Rules (non-negotiable)

- Verify claims against the actual code before writing or preserving them.
  Stale content is fixed or flagged — never silently kept.
- Behavior-changing code edits update the affected docs (and CHANGELOG.md
  where one exists) in the same change.
- Never fabricate rationale. If the "why" of a decision is unrecoverable,
  state that, or ask the author.
- Ambiguous intent → ask the human. Never guess.

## docs setup (bootstrap — run at adoption)

Verify, don't just ask: inspect the repo first — size and file count,
language(s), package manifests and their private/public flags, publish
workflows, install instructions in README, signs of external consumers.
Infer the proportionality tier, then CONFIRM with the human:
"This looks like a <tier> (<evidence>). Agree?" Only then:

1. Add the docs section to AGENTS.md (tool-neutral — any agent must be able
   to follow it as a plain reference, no skill knowledge assumed):

   ```
   ## Documentation
   Conventions: .claude/skills/docs/SKILL.md (standard, types, rules).
   Docs live in <mapped locations for this repo>.
   Behavior-changing edits update the affected docs<,( and CHANGELOG.md,)>
   in the same change. Verify doc claims against code; fix or flag stale
   content, never preserve it silently.
   ```

   Scale it down for low tiers (a README-only utility gets two lines, no
   docs map, no changelog clause).
2. Create ONLY what the tier warrants and only with real content (e.g.
   improve the README now; create docs/ subdirs lazily when first content
   exists). State every omission with reasoning.
3. The heavy path — auditing/migrating existing docs — is NOT this skill:
   tell the user to invoke the docs-auditor agent.

Adopting this package: [adopting](references/adopting.md).
Packaging rationale: [ADR-0001](references/adr-0001-packaging.md).
