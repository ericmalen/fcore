# Terminology

Canonical vocabulary for Agent Base docs, skills, and scripts. Use these terms
consistently; do not rotate synonyms.

| Term | Meaning |
| --- | --- |
| **Agent Base** | The product (this repo). Display name in prose. |
| **agent-base** | Slug: repo name, paths, package name. |
| **Agent Base clone** | Local clone of this repo used to run setup or orchestration against a project. |
| **project** | Any repo receiving the standard layout. |
| **starter** | New project emitted via `build-starter.mjs` (skips inventory). |
| **existing project** | Project with prior AI config; inventory-first setup path. |
| **setup** | Four-phase pipeline: inventory → plan → apply → verify. |
| **setup window** | Temporary skills and tooling removed before merge (`base-inventory` … `base-verify`). |
| **standard layout** | Post-setup tree defined in [`spec/target-layout.md`](../../spec/target-layout.md). |
| **baseline skills** | Permanent skills copied into every project (`base-check`, `docs`, …). |
| **orchestration** | Optional generated multi-agent layer (`base-orchestrate` entry). |
| **`.setup/`** | Working directory during setup (`manifest.json`, `nodes/`, `literals/`). |
| **`.claude/agent-base-setup/`** | Temporary tooling copied into a project during setup. |
| **`.claude/agent-base.json`** | Marker: `standard`, `toolRepo`, `pin`, `lastSyncedAt`, `setupAt`, `githubCodeReview`. |

## Skill prefix convention

- **`base-*`** — setup and maintenance entry skills (`base-setup`, `base-check`, `base-orchestrate`, phase skills).
- **Plain kebab-case** — universal baseline and orchestration tooling (`docs`, `drift-checker`, `repo-analyst`, …).

## Retired terms (do not use)

`ai-kit`, greenfield, brownfield, adopt/adoption (as pipeline nouns), target repo,
kit clone (without “Agent Base”), factory/house metaphor.
