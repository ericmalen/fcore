# FleetCore

**Set up any repo for AI-assisted coding with Claude Code and GitHub Copilot —
one shared set of config files, kept to a common standard.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2020-3c873a.svg)](https://nodejs.org)
[![AI tools](https://img.shields.io/badge/AI-Claude%20Code%20%2B%20Copilot-7c5cff.svg)](#what-this-is)

## What this is

FleetCore brings any repo — brand-new or existing — to a consistent AI-coding
layout and keeps it there:

- **One config, both tools.** Claude Code and Copilot read the same `AGENTS.md`,
  skills, and agents — no duplicated setup.
- **A four-phase setup pipeline** (inventory → plan → apply → verify) routes your
  existing AI config into the [standard layout](./spec/target-layout.md) against a
  shared [rule catalog](./spec/rules.md), with two human approval gates.
- **A permanent baseline** of skills plus a docs agent installed into every
  project — including `fcore-check`, a drift auditor you can run any time.
- **No stack- or domain-specific content** — you add that on top.

> **This repo is the setup tool, not your application repo.** Nobody starts a
> project by cloning FleetCore. Setup runs *from your project* against a base
> checkout — resolved via `npx`, or a shared clone — and installs only what
> belongs in your project (see
> [`spec/target-layout.md`](./spec/target-layout.md) for what you end up with).
>
> **New here?** Walk through [your first setup](./docs/tutorials/first-setup.md);
> unfamiliar terms are defined in [terminology](./docs/reference/terminology.md).

Need a multi-agent team and a task backlog on top? That's the optional
[orchestration layer](./docs/how-to/orchestration-guide.md) — generated per
project when you want it, ignored when you don't.

## Who it's for

Developers setting up GitHub Copilot and/or Claude Code in a project —
first-time setup or bringing existing AI config up to the team standard.

## Quick start

### Set up a project (recommended)

**For an existing repository** — anything with files or history to route.
From your project, no clone needed:

```sh
npx github:ericmalen/fcore#v2.1.1 onboard
```

This stages the release, then launches Claude Code in your project with
setup already started (without the `claude` CLI it drops a one-shot
`/fcore-bootstrap` launcher skill and prints the prompt to paste —
Copilot agent mode works through that path). Setup asks two questions
(GitHub code review? path-scoping mechanism?), runs the four phases in fresh
contexts, and stops at two human approval gates. Details:
[`docs/how-to/setup-guide.md`](./docs/how-to/setup-guide.md);
command surface: [`docs/reference/fcore-cli.md`](./docs/reference/fcore-cli.md).

**Working from a clone (FleetCore development, or fallback):** clone once
(`git clone <this-repo-url> ~/tools/fcore`), open the clone in your AI
tool, and run `/fcore-onboard /path/to/project`.

### Starter project

**For a brand-new, empty repo** — nothing to route, so skip setup's AI
session entirely and emit the clean standard layout directly:

```sh
npx github:ericmalen/fcore#v2.1.1 init /path/to/new-repo --git
# or from a clone: node ~/tools/fcore/scripts/build-starter.mjs /path/to/new-repo --git
```

The starter includes the same permanent baseline (skills + docs-auditor agent)
as a full setup. Either path ends the same way: run the installed
`fcore-check` skill any time for drift checks and the full lifecycle map.

### Check for drift later

Set-up projects get a permanent `fcore-check` skill — run it any time to audit
against the conventions and fix findings by rule ID. To pull a newer baseline
release, run `npx github:ericmalen/fcore#<new-tag> update` (or
`fcore-update` from a clone, or `sync-baseline` directly) — see
[`docs/how-to/baseline-sync.md`](./docs/how-to/baseline-sync.md).

### Generate orchestration (optional)

For repos with multiple layers or packages that need a generated multi-agent
team and a `tasks.md` backlog:

```sh
npx github:ericmalen/fcore#v2.1.1 fleet-config
```

which launches Claude Code with the flow started — without the `claude`
CLI, type `/fcore-bootstrap` in your AI session. (Clone path: open the
fcore checkout in Claude Code or Copilot agent mode and run
`/fcore-fleet-config /path/to/project`.) The project must already be set up and
have a clean git working tree. Discovery and generation run in fresh contexts
with two human policy gates; execution (`feature-orchestrator`) happens in the
project after merge.

Details: [`docs/how-to/orchestration-guide.md`](./docs/how-to/orchestration-guide.md).

## Repo layout (this repo)

```
spec/            the standard: rules.md (R-IDs, source of truth) + target-layout.md
templates/       payload copied into every project: instructions/
                 (AGENTS.md/CLAUDE.md skeletons + slot bases), settings/,
                 readmes/ (R-48 stubs), ci/, gitignore
scripts/ test/   the engine (zero-dep Node ≥ 20). Setup copies only the
                 five setup scripts + scripts/lib/ + templates/ into
                 projects as .claude/fcore-onboard/ (test/ never ships)
bin/             the fcore npx entry point (never ships into projects;
                 see docs/reference/fcore-cli.md)
.claude/         this repo's own live config; the fcore-* setup skills, baseline
                 skills (fcore-check, docs-manager, git-conventions, skill-creator,
                 agent-creator) and docs-auditor agent are dual-role (used here
                 AND installed into every project). The lifecycle skills (checklist-intake,
                 log-report, eval-runner, tracker-sync) are optional (R-55):
                 opt-in via `fcore skills add` or fcore-fleet-config. See the
                 allowlist in scripts/lib/baseline.mjs, consumed by
                 scripts/install-setup.mjs. Orchestration
                 discovery/generation meta-assets stay FleetCore-side only.
                 fcore-onboard is the setup entry point: run from a
                 checkout (clone or npx-staged release, or followed directly
                 by the one-prompt flow), never shipped (path is load-bearing:
                 <checkout>/.claude/skills/fcore-onboard/SKILL.md)
docs/            consumer-facing guides
reports/         generated outputs (gitignored)
```

Why `templates/` is *not* under `.claude/`: anything in `.claude/` auto-loads
while working on FleetCore itself. Payload is cargo, not config. Rationale:
[`docs/explanation/why-this-way.md`](./docs/explanation/why-this-way.md).

## Next steps

- [`docs/how-to/setup-guide.md`](./docs/how-to/setup-guide.md) — setting up a project.
- [`docs/reference/fcore-cli.md`](./docs/reference/fcore-cli.md) — the npx command surface.
- [`docs/how-to/baseline-sync.md`](./docs/how-to/baseline-sync.md) — release pins and baseline upgrades.
- [`docs/how-to/release-baseline.md`](./docs/how-to/release-baseline.md) — cutting a tagged release (maintainers).
- [`docs/how-to/orchestration-guide.md`](./docs/how-to/orchestration-guide.md) — optional multi-agent team generation.
- [`docs/reference/terminology.md`](./docs/reference/terminology.md) — canonical vocabulary.
- [`docs/how-to/cross-tool-setup.md`](./docs/how-to/cross-tool-setup.md) — how one set of
  files serves both tools.
- [`docs/reference/conventions.md`](./docs/reference/conventions.md) — the do's and don'ts.
- [`docs/reference/copilot-customization-reference.md`](./docs/reference/copilot-customization-reference.md)
  — authoritative reference for Copilot concepts.
- [`docs/reference/built-in-reference.md`](./docs/reference/built-in-reference.md) — what ships out
  of the box with VS Code + Copilot.
- [`docs/how-to/workflow-tips.md`](./docs/how-to/workflow-tips.md) — practical tips.
- [`docs/explanation/why-this-way.md`](./docs/explanation/why-this-way.md) — design rationale.
- [`spec/target-layout.md`](./spec/target-layout.md#orchestration-layer-conditional) — optional orchestration layer (generated per project).

## Developing FleetCore

Index READMEs for the live `.claude/` config:

- [`.claude/agents/README.md`](./.claude/agents/README.md) — baseline and orchestration meta-agents.
- [`.claude/skills/README.md`](./.claude/skills/README.md) — setup, baseline, and orchestration meta-skills.

Orchestration assets: `templates/orchestration/` (agent/skill/doc templates),
`scripts/lib/orchestration/` (validators and scaffold), FleetCore-side entry skill
[`fcore-fleet-config`](./.claude/skills/fcore-fleet-config/SKILL.md).

## License

Licensed under the MIT License. See [LICENSE](./LICENSE).
