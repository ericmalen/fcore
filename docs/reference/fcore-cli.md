# fcore CLI reference

The `fcore` bin (`bin/fcore.mjs`) is the npx entry point for
consumers. It is additive: every command delegates to the same scripts the
clone workflow runs, and the bin itself never ships into projects (the
installer allowlist in `scripts/lib/baseline.mjs` decides what ships).

## Invocation

```sh
npx github:ericmalen/fcore#v2.1.1 <command> [args]
```

The `#<tag>` ref is the same release tag recorded as the project's pin in
`.claude/fcore.json` (`pin`, falling back to `v` + `standard`). Always
pin; never run from an unpinned ref in CI. From a local clone the same
surface is available as `node <clone>/bin/fcore.mjs <command>`.

Non-GitHub hosting (e.g. Azure DevOps) uses the `git+<https-url>#<tag>` spec
form; `npxSpecFromToolRepo` in `scripts/lib/release.mjs` is the canonical
mapping.

## Bootstrap commands (LLM phases)

These stage the running release to `~/.fcore/versions/<tag>/`
(copy-once, immutable — no `.git`, never pulled), then hand off down a
launch chain:

1. `claude` found on PATH (not Windows), stdin/stdout are a real terminal →
   spawn it interactively in the target with the bootstrap prompt as the
   initial message. Piped stdio (scripts, CI) skips this step — an
   interactive session would hang. If the spawn itself fails, the chain
   falls through to step 2 instead of dead-ending.
2. Otherwise → write a one-shot launcher skill into the target at
   `.claude/skills/fcore-bootstrap/SKILL.md` (untracked; it orders its
   own deletion as step 1, so the fcore-* clean-tree preconditions hold) and
   print "type `/fcore-bootstrap`" plus the paste-able prompt.
3. Unwritable target → print the prompt only.

The launcher skill is the only thing a bootstrap command ever writes into
the target, and it never enters a commit. Flags: `--no-launch` skips
step 1; `--print` forces step 3 (never modifies the target).

| Command | Starts |
|---|---|
| `onboard [path]` | `fcore-onboard` — full fcore setup of a repository |
| `fleet-config [path]` | `fcore-fleet-config` — repo-specific orchestration generation |
| `update [path]` | `fcore-update` — baseline pin upgrade |

`path` defaults to the current directory and must be an existing directory
(usage error 2 otherwise — nothing is staged or written). When run from a
clone (a checkout
with `.git`), staging is skipped and the prompt points at the clone itself.
Windows always uses the launcher-skill path: `claude` installs as a `.cmd`
shim there, which cannot safely receive a multi-line prompt argument.

## Deterministic commands

Arguments after the command pass through to the underlying script verbatim;
exit codes propagate.

| Command | Delegates to | Typical use |
|---|---|---|
| `install <path>` | `scripts/install-setup.mjs` | copy setup tooling into a project |
| `audit [--root --json --strict]` | `scripts/audit.mjs` | conformance audit (CI: `audit --root . --strict`) |
| `sync [--check\|--report\|--upgrade ...]` | `scripts/sync-baseline.mjs` | baseline pin check/upgrade |
| `tracker-sync [--target --apply ...]` | `scripts/tracker-sync.mjs` | tasks.md ⇄ tracker bridge |
| `init <dir> [--git]` | `scripts/build-starter.mjs` | emit a clean starter repo — refuses a non-empty `<dir>`; prints next steps |
| `headless-guard [--root --open-branches <json>]` | `scripts/headless-guard.mjs` | run/skip decision for scheduled orchestrator pipelines; prints `run=`/`reason=`/`task=` lines |

## Optional skills (`skills`)

Manage the opt-in skills (R-55) — lifecycle (`checklist-intake`, `log-report`,
`eval-runner`, `tracker-sync`) and UI-verification (`ui-verify-web`,
`ui-verify-ios`). They are not in the default baseline; each project's
selection is tracked in the marker's `optionalSkills`. Runs against a set-up
project (path defaults to cwd) and copies from this checkout.

| Command | Effect |
|---|---|
| `skills list [path]` | list available optionals and whether each is installed |
| `skills add <name> [path]` | install one (copy + record in the marker); idempotent |
| `skills remove <name> [path]` | uninstall one (delete + drop from the marker) |

Selected optionals are upgraded with the baseline by `sync`; unselected ones
are never touched. `fcore-fleet-config` auto-installs all four as a generation
prerequisite.

## Release store (`cache`)

| Command | Effect |
|---|---|
| `cache list` | staged releases under `~/.fcore/versions/`, newest first |
| `cache prune [--keep N]` | remove all but the newest N (default 2); also sweeps temp dirs orphaned by a crashed stage (older than an hour) |

Deleting `~/.fcore/versions/<tag>` by hand is always safe — it is
re-staged on the next bootstrap command at that tag. `FCORE_HOME`
relocates the store root (`$FCORE_HOME/.fcore/versions/`) for
tests and sandboxed CI.

## Requirements

Node ≥ 20. Private FleetCore repos resolve through your ambient git
credentials (npm shells out to git for `github:`/`git+` specs); in CI use an
`insteadOf` rewrite with a token — see the comments in the
`templates/ci/` workflows.
