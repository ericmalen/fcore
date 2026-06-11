# Manifest reference (.setup/manifest.json)

Schema v1. Top level: `{ schemaVersion: 1, entries: [], jsonMerges: [], installs: [] }`

## Ops (dispositions — every node gets exactly one)

| Op | Shape | Use for |
|---|---|---|
| move | `{ node, op:"move", target, slot? }` | verbatim relocation (DEFAULT) |
| split | `{ node, op:"split", ranges:[{lines:[s,e], target, slot?} \| {lines:[s,e], op:"drop", reason}] }` | one node → several targets; ranges are 1-based over the NODE's lines and must tile it exactly |
| keep-file | `{ file, op:"keep-file" }` | file already correct; covers all its nodes |
| drop | `{ node, op:"drop", reason }` | content that should not survive; human reads full text. NOT for contradictions — conflicting rules from two sources are both routed and flagged at USER GATE 1, never resolved by dropping a side |
| merge | `{ node, op:"merge", literal, target, slot?, note? }` | rewrite — node replaced by `.setup/literals/<literal>`; several nodes may share one literal (emitted once); verifier judges side-by-side |
| supersede | `{ node, op:"supersede", catalogSkill, note? }` | bespoke content replaced by a catalog skill |
| out-of-scope | `{ file, op:"out-of-scope", reason }` | sweep candidate that is NOT AI instructions |

## Allowed targets (scope gate)

All `move`/`split`/`merge` targets, `jsonMerges.file`, and `installs.file` must
stay on AI-config surfaces: root `AGENTS.md` / `CLAUDE.md` / `.gitignore`,
nested `AGENTS.md`/`CLAUDE.md` (compat), anything under `.claude/`,
`.vscode/settings.json`, `.github/copilot-instructions.md`,
`.github/instructions/`, or `docs/ai/` (extracted AI reference docs).
Recognized AI surfaces and inventoried source files (in-place reassembly of
forced-include mixed files) are also valid. `check.mjs` enforces this as the
scope gate.

## jsonMerges

`{ file: ".vscode/settings.json", base: "settings/vscode/settings.json" }` — key-level
merge: source-only keys preserved, Agent Base template keys win. Bases live in
`.claude/agent-base-setup/templates/`.

## installs (static wiring)

`{ file, template }` (from templates dir, slot markers stripped) or
`{ file, literal }` (from `.setup/literals/`). Standard set:

```json
{ "file": "AGENTS.md",  "template": "instructions/AGENTS.md" }            // starter only — existing project assembles via slots
{ "file": "CLAUDE.md",  "template": "instructions/CLAUDE.md" }
{ "file": ".gitignore", "template": "gitignore" }            // starter only — existing project: keep-file or merge
{ "file": ".claude/settings.json", "template": "settings/claude/settings.json" }   // or jsonMerges when one exists
{ "file": ".claude/skills/README.md", "template": "readmes/skills/README.md" }
{ "file": ".claude/agent-base.json", "literal": "literals/marker.json" }
{ "file": ".claude/agents/README.md", "template": "readmes/agents/README.md" }   // whenever anything installs into .claude/agents (R-48)
{ "file": ".claude/rules/README.md",  "template": "readmes/rules/README.md" }    // whenever any rules file is created (R-48)
```

Note: `base-check`, `docs`, `git-conventions`, `skill-creator`,
`agent-creator`, `retro`, `log-report`, `eval-runner`, and `docs-auditor` are
NOT manifest installs — they are permanent baseline assets copied verbatim by
`install-setup.mjs`.

## CI gate templates (optional file copies, not manifest installs)

When the project has CI, offer the drift gate alongside the docs-impact
gate — copy the matching Agent Base template, do not route it through the manifest:

- `templates/ci/audit-strict.github.yml` → `.github/workflows/` (or
  `audit-strict.ado.yml` → `.azuredevops/` for Azure DevOps) — runs
  `audit.mjs --root . --strict` by shallow-cloning Agent Base at `pin` from
  `toolRepo` in the marker. Keeps a set-up project on the standard layout (R-IDs).
- `templates/ci/baseline-pin-check.github.yml` → `.github/workflows/` — fails when
  `pin` is behind the latest compatible release (`sync-baseline --check`).
- `templates/ci/docs-impact.{github,ado}.yml` — the docs-impact gate
  (offered by the `docs` skill); GitHub → `.github/workflows/`, ADO →
  `.azuredevops/`.
- `templates/ci/orchestrator-run.{github,ado}.yml` — scheduled headless
  feature-orchestrator runs (DD-15); GitHub → `.github/workflows/`, ADO →
  `.azuredevops/`. Offer ONLY when
  `docs/orchestration/generation-manifest.json` exists; needs the
  `ANTHROPIC_API_KEY` secret. See `docs/how-to/headless-orchestration.md`.

Marker literal content:
`{ "standard": "1.4.0", "toolRepo": "https://github.com/…/agent-base", "pin": "v1.4.0", "lastSyncedAt": "2026-06-11", "setupAt": "2026-03-01", "githubCodeReview": false }`
`pin` tracks the release tag; `sync-baseline --upgrade` bumps it after review.

## AGENTS.md slots

Template skeleton slots: `intro`, `overview`, `architecture`, `conventions`,
`do-not`, `more-context`. Content attaches under the slot's heading in
MANIFEST ORDER — entry sequence is the ordering tool. AGENTS.md must end
≤ 120 non-blank lines / ≤ 6,000 chars (R-02): route depth to
`.claude/rules/<scope>.md` (≤ 50 non-blank lines each, `paths:` frontmatter)
or skill reference files, not into the root file.

## Worked example (existing project CLAUDE.md, 4 sections)

```json
{ "node": "n0001", "op": "move",  "target": "AGENTS.md", "slot": "intro" }
{ "node": "n0002", "op": "move",  "target": "AGENTS.md", "slot": "conventions" }
{ "node": "n0003", "op": "split", "ranges": [
    { "lines": [1, 12],  "target": "AGENTS.md", "slot": "conventions" },
    { "lines": [13, 80], "target": ".claude/skills/testing-guide/references/details.md" } ] }
{ "node": "n0004", "op": "drop",  "reason": "duplicate of n0002 (verified identical)" }
```

CLAUDE.md itself is then regenerated as the shim via `installs`.

## Slot targeting: strip source headings (validation finding)

A moved block carries its ORIGINAL heading bytes. When routing into a template
slot whose skeleton heading replaces or re-homes it, split off the heading:

```json
{ "node": "n0002", "op": "split", "ranges": [
  { "lines": [1, 2], "op": "drop", "reason": "<accurate reason — see below>" },
  { "lines": [3, 4], "target": "AGENTS.md", "slot": "intro" } ] }
```

Drop reasons must be FACTUALLY ACCURATE per entry — the verifier checks them.
"Subsumed by skeleton heading" is only true when the skeleton has an
equivalent heading; if the body is being re-homed under a DIFFERENT section,
say that: "heading discarded; body re-homed under Conventions (self-contained
single rule)". Never reuse a boilerplate reason across entries.

Mid-line edits (e.g. removing an inline parenthetical) cannot be expressed as
a split — that is a justified `merge` with the change named in the note.
