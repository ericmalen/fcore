# agent-base CLI reference

The `agent-base` bin (`bin/agent-base.mjs`) is the npx entry point for
consumers. It is additive: every command delegates to the same scripts the
clone workflow runs, and the bin itself never ships into projects (the
installer allowlist in `scripts/lib/baseline.mjs` decides what ships).

## Invocation

```sh
npx github:ericmalen/agent-base#v1.2.0 <command> [args]
```

The `#<tag>` ref is the same release tag recorded as the project's pin in
`.claude/agent-base.json` (`pin`, falling back to `v` + `standard`). Always
pin; never run from an unpinned ref in CI. From a local clone the same
surface is available as `node <clone>/bin/agent-base.mjs <command>`.

Non-GitHub hosting (e.g. Azure DevOps) uses the `git+<https-url>#<tag>` spec
form; `npxSpecFromToolRepo` in `scripts/lib/release.mjs` is the canonical
mapping.

## Bootstrap commands (LLM phases)

These stage the running release to `~/.agent-base/versions/<tag>/`
(copy-once, immutable — no `.git`, never pulled), then hand off down a
launch chain:

1. `claude` found on PATH (not Windows), stdin/stdout are a real terminal →
   spawn it interactively in the target with the bootstrap prompt as the
   initial message. Piped stdio (scripts, CI) skips this step — an
   interactive session would hang. If the spawn itself fails, the chain
   falls through to step 2 instead of dead-ending.
2. Otherwise → write a one-shot launcher skill into the target at
   `.claude/skills/agent-base-bootstrap/SKILL.md` (untracked; it orders its
   own deletion as step 1, so the base-* clean-tree preconditions hold) and
   print "type `/agent-base-bootstrap`" plus the paste-able prompt.
3. Unwritable target → print the prompt only.

The launcher skill is the only thing a bootstrap command ever writes into
the target, and it never enters a commit. Flags: `--no-launch` skips
step 1; `--print` forces step 3 (never modifies the target).

| Command | Starts |
|---|---|
| `setup [path]` | `base-setup` — full agent-base setup of a repository |
| `orchestrate [path]` | `base-orchestrate` — repo-specific orchestration generation |
| `refresh [path]` | `base-refresh` — baseline pin upgrade |

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
| `starter <dir> [--git]` | `scripts/build-starter.mjs` | emit a clean starter repo |
| `headless-guard [--root --open-branches <json>]` | `scripts/headless-guard.mjs` | run/skip decision for scheduled orchestrator pipelines; prints `run=`/`reason=`/`task=` lines |

## Release store (`cache`)

| Command | Effect |
|---|---|
| `cache list` | staged releases under `~/.agent-base/versions/`, newest first |
| `cache prune [--keep N]` | remove all but the newest N (default 2); also sweeps temp dirs orphaned by a crashed stage (older than an hour) |

Deleting `~/.agent-base/versions/<tag>` by hand is always safe — it is
re-staged on the next bootstrap command at that tag. `AGENT_BASE_HOME`
relocates the store root (`$AGENT_BASE_HOME/.agent-base/versions/`) for
tests and sandboxed CI.

## Requirements

Node ≥ 20. Private Agent Base repos resolve through your ambient git
credentials (npm shells out to git for `github:`/`git+` specs); in CI use an
`insteadOf` rewrite with a token — see the comments in the
`templates/ci/` workflows.
