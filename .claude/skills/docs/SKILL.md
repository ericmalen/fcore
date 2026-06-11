---
name: docs
description: Creates, updates, restructures, or reviews documentation to the team standard — READMEs, Diátaxis docs, decision records, changelogs — and bootstraps the standard into a repo via "docs setup". Use when documentation must be written or changed. Not for merely reading or discussing existing docs, and not for code changes that don't alter behavior.
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
| records a significant decision | decision record | docs/decisions/ (opt-in) — see [decisions](references/decisions.md) |
| announces behavior changes to consumers | changelog | CHANGELOG.md (opt-in) — see [changelog](references/changelog.md) |
| orients a first-time visitor | README | repo root — entry point only; depth lives in docs |

Type boundaries and voice per type: [diataxis](references/diataxis.md).
Skeletons: [templates](references/templates.md) — load only when writing.

**CHANGELOG.md and docs/decisions/ are opt-in — OFF by default at every
tier.** Produce them only when their path is listed in `docsPaths`
(`.claude/docs-paths.json`). Otherwise decisions live in commits/PRs and
consumer-facing changes in release notes.

## Proportionality (governs WHICH quadrants exist — not flat vs nested)

Output scales to the repo — a small utility gets only a good README; full
structure is reserved for repos that warrant it. NEVER create empty
scaffolding or placeholder pages. When you omit something the standard
describes, say so and why. Tier ladder and repo-inspection signals:
[proportionality](references/proportionality.md).

Proportionality decides *which* types/quadrants a repo warrants — it does
NOT make documents sit loose at `docs/` root. Whenever a quadrant holds a
real doc, that doc lives in its subfolder per the table above, even a lone
file (`docs/reference/config.md`, not `docs/config.md`). Subfolders are
created lazily — when their first real doc exists, never as empty
scaffolding. Only `README` (and opt-in `CHANGELOG.md`) live at the root.

A doc the user explicitly asks for (or one that already exists) is real,
warranted content — it lives in `docs/<quadrant>/`, not folded into the
README, even in an otherwise README-only repo. "Small repo → just a README"
bounds what you *proactively invent*; it never flattens a genuine, requested
doc into the README.

## Rules (non-negotiable)

- Verify claims against the actual code before writing or preserving them.
  Stale content is fixed or flagged — never silently kept.
- Behavior-changing code edits update the affected docs (and CHANGELOG.md
  where one exists) in the same change.
- Never fabricate rationale. If the "why" of a decision is unrecoverable,
  state that, or ask the author.
- Ambiguous intent → ask the human. Never guess.

## docs setup (bootstrap — run at setup)

Verify, don't just ask: inspect the repo first — size and file count,
language(s), package manifests and their private/public flags, publish
workflows, install instructions in README, signs of external consumers.
Infer the proportionality tier, then CONFIRM with the human:
"This looks like a <tier> (<evidence>). Agree?" Only then:

1. Write `.claude/docs-paths.json` — `{ "tier": "<T1..T4>", "codePaths":
   [...], "docsPaths": [...] }` with the path lists inferred from the repo
   (confirm them alongside the tier). Leave `CHANGELOG.md` and
   `docs/decisions/` OUT of `docsPaths` by default — add either only when
   the human explicitly opts in. This file drives the enforcement
   layers.
2. Add the docs section to AGENTS.md (tool-neutral — any agent must be able
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
3. Create ONLY what the tier warrants and only with real content (e.g.
   improve the README now; create docs/ subdirs lazily when first content
   exists). State every omission with reasoning.
4. Tier T2+ only — wire enforcement (skip both at T1 by design):
   - Merge into `.claude/settings.json` hooks (read by both tools):
     SessionStart → `node .claude/skills/docs/scripts/docs-nudge.mjs session-start`
     Stop → `node .claude/skills/docs/scripts/docs-nudge.mjs stop`
   - If the repo has CI, offer the docs-impact gate: copy the matching
     template (Agent Base `templates/ci/docs-impact.github.yml` →
     `.github/workflows/`, or `docs-impact.ado.yml` → `.azuredevops/` for
     Azure DevOps).
5. Surveying an unfamiliar or large doc corpus — classifying what exists,
   finding gaps/stale content, proposing a plan — is the docs-auditor agent,
   not this skill. This skill EXECUTES restructures (including an approved
   auditor plan); see "docs restructure" below.

## docs restructure (sort existing docs into quadrants)

When asked to refactor/reorganize existing docs to the standard:

1. Classify each existing file by Diátaxis type (table above). One document,
   one quadrant — if a file mixes types, split it before moving, but only when
   it cleanly cleaves into independently-useful docs. Otherwise classify by
   dominant framing and note the mix — never fragment one coherent document
   across folders.
2. Decompose an overgrown README: if the README carries depth beyond
   what-it-is + quickstart + links (inline how-to, reference tables, concept
   explanations), extract each over-deep section into the matching
   `docs/<quadrant>/` file (per [diataxis](references/diataxis.md)), leaving a
   one-line pointer in the README. Treat each extracted section as a file to
   classify per step 1. (The README is itself a doc, not just a link source.)
3. Move each into `docs/<quadrant>/` (lazily-created subfolders; no empty
   ones). Files that are process artifacts — engineering plans, phase notes,
   sandbox/validation results, meeting notes, status/state reports (dated
   health snapshots, dashboards) — are NOT reader docs: relocate them OUT of
   `docs/`, defaulting to a `notes/` folder (visible, greppable, history
   preserved via `git mv`; `.dev/` or git history are alternatives) — don't
   file them in a quadrant.
4. Rewrite every link that the moves break: inbound links from `README`,
   `AGENTS.md`/`CLAUDE.md`, `.claude/**`, and `spec/`; and intra-`docs/`
   links (same-quadrant stay `./sibling.md`, cross-quadrant become
   `../<otherquad>/sibling.md`). Anchors (`#section`) are unaffected.
5. Update the docs index (the README listing, or `docs/README.md` if one
   exists) to the new paths.
6. Verify links resolve — run `node .claude/skills/docs/scripts/check-links.mjs`
   (ships with this skill; resolves every relative Markdown link under the repo
   and exits non-zero on a break). Fix any break before finishing.

## docs catch-up (human changed code without AI)

When asked to catch docs up to existing commits ("update docs for my last
N commits / since <ref>"): read the diff, identify behavior changes,
update the affected docs and changelog per the rules above, and list any
changes you judged non-behavioral so the human can veto. This is the
standard repair path for the CI docs-impact gate.

Integrating this package: [integration](references/integration.md).
