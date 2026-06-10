# Proportionality — tier ladder and inspection signals

Output scales to the repo. Inspect before inferring; confirm with the
human before acting ("This looks like a <tier> — <evidence>. Agree?").

## Inspection signals (gather these, don't ask for them)

- Size/shape: tracked file count, directory depth, number of services/
  packages (workspaces, docker-compose, multiple manifests)
- Language(s): manifests present (package.json, pyproject.toml, go.mod…)
- External consumers: `"private": true/false` in manifests, publish/release
  workflows, version tags, registry badges, install instructions addressed
  to outsiders, an existing CHANGELOG
- Team surface: CODEOWNERS, contributor count in git history

## Tiers

| Tier | Typical shape | Standard output | Explicitly omitted (say so) |
|---|---|---|---|
| T1 minimal | small utility/script, no outside consumers | good README (what-it-is, quickstart, the 2–3 things worth knowing) | docs/ tree, changelog, ADRs ("decisions fit in README/commits") |
| T2 library | published package, real API surface | T1 + CHANGELOG.md + reference docs for the public API | tutorials ("README quickstart suffices"), explanation unless design is non-obvious |
| T3 service/app | deployed system, internal consumers, operational surface | T2 (changelog only if external consumers) + how-to guides for operations + ADRs for architectural decisions | full tutorial track unless onboarding demands it |
| T4 platform | many consumers/teams, multiple services | full Diátaxis structure + ADRs + changelog per published surface | — (full structure warranted) |

Edge rule: when between tiers, pick the LOWER one and note what would
justify moving up — under-documentation is correctable on demand;
scaffolding rot is not.

## Hard rules at every tier

- No empty scaffolding, no placeholder pages, no "TODO: write this" files.
  Directories are created when their first real document is written.
- Every omission relative to the full standard is surfaced with one line
  of reasoning at setup/audit time.
