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
| T1 minimal | small utility/script, no outside consumers | good README (what-it-is, quickstart, the 2–3 things worth knowing) | docs/ tree ("decisions fit in README/commits") |
| T2 library | published package, real API surface | T1 + reference docs for the public API | tutorials ("README quickstart suffices"), explanation unless design is non-obvious |
| T3 service/app | deployed system, internal consumers, operational surface | T2 + how-to guides for operations | full tutorial track unless onboarding demands it |
| T4 platform | many consumers/teams, multiple services | full Diátaxis structure | — (full structure warranted) |

Edge rule: when between tiers, pick the LOWER one and note what would
justify moving up — under-documentation is correctable on demand;
scaffolding rot is not.

## Opt-in surfaces (off by default at every tier)

`CHANGELOG.md` and `docs/decisions/` are never auto-created by tier. Each is
produced only when its path is added to `docsPaths` in `.claude/docs-paths.json`
by explicit human opt-in. Default: decisions live in commits/PRs; consumer-facing
changes live in release notes. The changelog existence test (external consumers)
still governs whether enabling it is even appropriate.

## Hard rules at every tier

- No empty scaffolding, no placeholder pages, no "TODO: write this" files.
  Directories are created when their first real document is written.
- Tier governs *which* quadrants exist, not flat vs nested. A warranted
  quadrant's docs live in `docs/<quadrant>/` even when it holds a single
  file — the lone-file case is still nested, never flattened to `docs/`
  root. Only `README` (and opt-in `CHANGELOG.md`) sit at the root.
- A T1 repo's "good README, no docs/ tree" is the *proactive* output — it
  bounds what you invent, not what the user requests. An explicitly
  requested (or pre-existing) reference/how-to/explanation doc is real
  warranted content: write it as `docs/<quadrant>/file.md`, nested as above,
  not buried in the README. Under-documentation is correctable; flattening a
  genuine doc into the README is the same drift the nesting rule prevents.
- Every omission relative to the full standard is surfaced with one line
  of reasoning at setup/audit time.
