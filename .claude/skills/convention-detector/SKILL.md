---
name: convention-detector
description: Orchestration discovery step B3 — detects naming, branching, commit-style, and lint/format conventions in a target repo, with an explicit gap for every convention that has no evidence, filling the conventions fields of repo-profile.json. Use during orchestration discovery of a target repo. Not for auditing this kit's own rules.
---

# convention-detector

Detects the conventions half of a repo profile: `conventions.naming`,
`conventions.branching`, `conventions.commitStyle`, plus CI presence.
Conventions are CLAIMED only with evidence; anything unevidenced is `null`
plus a `gaps[]` entry.

## Procedure

1. **Naming.** Sample source file names across layers: dominant casing
   (kebab/camel/Pascal) and any per-type pattern (e.g. PascalCase React
   components, kebab-case everything else). State the observed rule;
   mixed-with-no-pattern is a gap.
2. **Branching.** Evidence in priority order: contributor docs
   (`CONTRIBUTING.md`, `README`), then `git branch -a` samples when a `.git`
   exists. Record the pattern (e.g. `feature/<ticket>-<slug>`); no evidence →
   `null` + gap.
3. **Commit style.** Contributor docs first, then `git log --oneline`
   samples: conventional commits, bare imperative, or no discernible style
   (→ `null` + gap).
4. **Lint/format config.** Presence of eslint/prettier/biome/editorconfig
   configs — these harden the naming/style claims and get named in the
   report. Absence of any linter is a `gaps[]` entry.
5. **CI.** CI config files (`.github/workflows/`, `azure-pipelines.yml`,
   etc.) → `ci` value (e.g. `github-actions`, `azure-devops`); none → `null`
   + gap.

## Output

Report `conventions.*` and `ci` values with one line of evidence each, plus
the `gaps[]` entries. Outputs MUST differ between repos whose conventions
differ — never normalize a target onto kit conventions.
