# Manifest reference (.adoption/manifest.json)

Schema v1. Top level: `{ schemaVersion: 1, kitVersion, entries: [], jsonMerges: [], installs: [] }`

## Ops (dispositions — every node gets exactly one)

| Op | Shape | Use for |
|---|---|---|
| move | `{ node, op:"move", target, slot? }` | verbatim relocation (DEFAULT) |
| split | `{ node, op:"split", ranges:[{lines:[s,e], target, slot?} \| {lines:[s,e], op:"drop", reason}] }` | one node → several targets; ranges are 1-based over the NODE's lines and must tile it exactly |
| keep-file | `{ file, op:"keep-file" }` | file already correct; covers all its nodes |
| drop | `{ node, op:"drop", reason }` | content that should not survive; human reads full text |
| merge | `{ node, op:"merge", literal, target, slot?, note? }` | rewrite — node replaced by `.adoption/literals/<literal>`; several nodes may share one literal (emitted once); verifier judges side-by-side |
| supersede | `{ node, op:"supersede", catalogSkill, note? }` | bespoke content replaced by a catalog skill |
| out-of-scope | `{ file, op:"out-of-scope", reason }` | sweep candidate that is NOT AI instructions |

## jsonMerges

`{ file: ".vscode/settings.json", base: "vscode-settings.json" }` — key-level
merge: source-only keys preserved, kit template keys win. Bases live in
`.claude/ai-kit-adoption/templates/`.

## installs (static wiring)

`{ file, template }` (from templates dir, slot markers stripped) or
`{ file, literal }` (from `.adoption/literals/`). Standard set:

```json
{ "file": "AGENTS.md",  "template": "AGENTS.md" }            // greenfield only — brownfield assembles via slots
{ "file": "CLAUDE.md",  "template": "CLAUDE.md" }
{ "file": ".gitignore", "template": "gitignore" }            // greenfield only — brownfield: keep-file or merge
{ "file": ".claude/settings.json", "template": "claude-settings.json" }   // or jsonMerges when one exists
{ "file": ".claude/skills/README.md", "template": "skills-README.md" }
{ "file": ".claude/skills/ai-kit-check/SKILL.md", "template": "ai-kit-check/SKILL.md" }
{ "file": ".claude/skills/ai-kit-check/references/rubric.md", "template": "ai-kit-check/references/rubric.md" }
{ "file": ".claude/ai-kit.json", "literal": "literals/marker.json" }
```

Marker literal content:
`{ "kit": "<version>", "kitRepo": "<ado clone url>", "adoptedAt": "<date>", "githubCodeReview": <bool> }`

## AGENTS.md slots

Template skeleton slots: `intro`, `overview`, `architecture`, `conventions`,
`do-not`, `more-context`. Content attaches under the slot's heading in
MANIFEST ORDER — entry sequence is the ordering tool. AGENTS.md must end
≤ 120 non-blank lines / ≤ 6,000 chars (R-02): route depth to
`.claude/rules/<scope>.md` (≤ 50 non-blank lines each, `paths:` frontmatter)
or skill reference files, not into the root file.

## Worked example (brownfield CLAUDE.md, 4 sections)

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
