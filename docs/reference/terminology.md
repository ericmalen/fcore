# Terminology

Canonical vocabulary for FleetCore docs, skills, and scripts. Use these terms
consistently; do not rotate synonyms.

| Term | Meaning |
| --- | --- |
| **FleetCore** | The product (this repo). Display name in prose. |
| **fcore** | Slug: repo name, paths, package name. |
| **fcore checkout** | Local copy of this repo used to run setup or orchestration against a project: a git clone, or an npx-staged release. |
| **fcore clone** | A checkout that is a git clone (has `.git`; freshened with `git pull --ff-only`). Canonical for FleetCore development. |
| **staged release** | Immutable copy of a tagged release at `~/.fcore/versions/<tag>/`, created by the bootstrap commands. Never pulled; replaced by staging a newer tag. ("npx-staged release" only at first mention in a doc.) |
| **stage** (verb) | Copy-once placement of a release into the release store (sentinel-guarded, idempotent). |
| **release store** | `~/.fcore/versions/`; managed by `fcore cache list\|prune`. |
| **bootstrap commands** | `fcore setup`/`orchestrate`/`refresh` — stage the release, then hand off down the launch chain: spawn `claude` in the target → drop the one-shot `/fcore-bootstrap` launcher skill → print the bootstrap prompt. |
| **bootstrap prompt** | The printed paste-able prompt for an AI session opened in the project. |
| **delegated commands** | `fcore install`/`audit`/`sync`/`tracker-sync`/`starter`/`headless-guard` — passthroughs to `scripts/*.mjs`. |
| **npx spec** | `github:owner/repo#tag` or `git+<url>#tag`, computed from the marker (`npxSpecFromToolRepo`). |
| **pin** | Git tag in the marker (`pin`, falling back to `v`+`standard`); what npx and CI resolve. |
| **refresh / sync / upgrade** | `refresh` = guided baseline-upgrade skill loop · `sync` = the deterministic engine (`sync-baseline.mjs`) · `--upgrade` = the sync mode that applies changes. |
| **project** | Any repo receiving the standard layout. |
| **starter** | New project emitted via `build-starter.mjs` (skips inventory; ships the full permanent baseline). |
| **existing project** | Project with prior AI config; inventory-first setup path. |
| **setup** | Four-phase pipeline: inventory → plan → apply → verify. |
| **setup window** | Temporary skills and tooling removed before merge (`fcore-inventory` … `fcore-verify`). |
| **standard layout** | Post-setup tree defined in [`spec/target-layout.md`](../../spec/target-layout.md). |
| **baseline skills** | Permanent skills copied into every project (`fcore-check`, `docs-manager`, …). |
| **optional skills** | Opt-in lifecycle skills (`checklist-intake`, `log-report`, `eval-runner`, `tracker-sync`, R-55) — not in the default baseline; selected at setup, added via `fcore skills add`, or installed by `fcore-fleet-config`. Tracked in the marker's `optionalSkills`. |
| **orchestration** | Optional generated multi-agent layer (`fcore-fleet-config` entry). |
| **`.setup/`** | Working directory during setup (`manifest.json`, `nodes/`, `literals/`, `merge-sources.json`). |
| **`.claude/fcore-onboard/`** | Temporary tooling copied into a project during setup. |
| **`.claude/fcore.json`** | Marker: `standard`, `toolRepo`, `pin`, `lastSyncedAt`, `setupAt`, `githubCodeReview`. |
| **marker** | The `.claude/fcore.json` file (above): records that a repo is set up and at which `pin`. Its presence is how tooling recognizes a set-up project. |
| **payload** | Files under `templates/` copied into projects (instructions, settings, readmes, ci, gitignore). Cargo, not config — kept out of `.claude/` so it does not auto-load while developing FleetCore. |
| **slot** | Named insertion point in an instruction template (`<!-- fcore:slot:<name> -->`), filled during `apply` by path-routed content. |
| **drift** | Divergence of a set-up project from the current baseline/standard; surfaced by `fcore-check`/`audit`, repaired by `sync`. |

## Skill prefix convention

- **`fcore-*`** — setup and maintenance entry skills (`fcore-onboard`, `fcore-check`, `fcore-fleet-config`, phase skills).
- **Plain kebab-case** — universal baseline and orchestration tooling (`docs-manager`, `drift-checker`, `repo-analyst`, …).

## Retired terms (do not use)

kit (any bare use: “the kit”, kit clone, kit-side, kit template, orchestration
kit — say “FleetCore …”), greenfield, brownfield, adopt/adoption (as pipeline
nouns), target repo, factory/house metaphor.
