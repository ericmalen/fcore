# Project lifecycle with Agent Base

How a set-up (or starter) project uses Agent Base over time. Any command
below that invokes Agent Base itself derives from the marker
`.claude/agent-base.json`: given `toolRepo:
https://github.com/<owner>/agent-base` and `pin: <tag>`, the invocation is

```sh
npx github:<owner>/agent-base#<tag> <command>
```

(Non-GitHub hosting uses the `git+<https-url>#<tag>` form instead — see
`docs/reference/agent-base-cli.md` in Agent Base for the full mapping.) A
shared clone works the same way: `node <clone>/bin/agent-base.mjs <command>`,
or the matching `/base-*` skill from inside that clone.

## 1. Right after setup or starter

- Fill in `AGENTS.md` (keep it under two pages) — the skeleton ships empty
  on purpose; there is nothing to strip out.
- Run this skill (`base-check`) once to confirm a clean starting point.
- Run the installed `docs` skill's `docs setup` once — enforcement (tier,
  hooks) stays off until a human confirms it; setup never runs this for you.

## 2. Routine: base-check

Run whenever AI-config files changed, or any time you suspect drift. It
audits the configured surface only (closed-world — see the routine-audit
section above) and fixes findings by rule ID.

## 3. Occasionally: deep sweep

Hunts for AI instructions that exist but sit outside the configured
surface entirely (a stray README section, a buried "act as..." note). The
routine audit's staleness nudge tells you when one is overdue. It is
report-only — real findings route through a plan delta, never an ad-hoc move.

## 4. Optional, advanced: orchestration

Most projects never need this — skip it unless you actually want a
generated multi-agent team and a `tasks.md` work backlog. Once the repo has
at least one code layer with a test command:

```sh
npx github:<owner>/agent-base#<tag> orchestrate
```

(or `/base-orchestrate /path/to/project` from a clone). It runs Agent
Base-side and is deliberately **not** installed into this project — that's
why you won't find a `base-orchestrate` skill here. Discovery and generation
run in fresh contexts with two human policy gates; nothing merges without
you. Re-run the same command as new layers ship — it re-profiles the repo,
keeps prior policy answers, and only asks about what's new.

## 5. Staying current: baseline refresh

When `pin` in the marker falls behind the latest compatible release:

```sh
npx github:<owner>/agent-base#<new-tag> refresh
```

(or `sync-baseline --check` / `--report` / `--upgrade` directly). Re-run
`base-check` after upgrading.

## 6. Optional lifecycle skills (R-55)

`retro`, `log-report`, `eval-runner`, `tracker-sync` back the orchestration
layer above and are absent until you opt in:

```sh
npx github:<owner>/agent-base#<tag> skills list
npx github:<owner>/agent-base#<tag> skills add <name>
```

`base-orchestrate` installs all four automatically when it generates
orchestration, so you only need this if you want one without the rest.
