# Agent Base

## What this is

Agent Base sets up repositories for AI-assisted coding, wired for **both GitHub
Copilot and Claude Code** from one set of files. It ships a rule catalog
([`spec/rules.md`](./spec/rules.md)), a four-phase setup pipeline
(inventory → plan → apply → verify) that brings any repo — starter or
existing project — to the standard layout, a set of baseline skills/agents
installed into every project, and an optional orchestration layer (multi-agent
dispatch) generated from an Agent Base clone when a team needs it.

No stack-specific or domain-specific content — you add those on top.

> **This repo is the setup tool, not your application repo.** Nobody starts a
> project by cloning Agent Base. Setup runs *from your project* against a
> shared clone of this repo, and installs only what belongs in your project
> (see [`spec/target-layout.md`](./spec/target-layout.md) for what you end up with).

## Who it's for

Developers setting up GitHub Copilot and/or Claude Code in a project —
first-time setup or bringing existing AI config up to the team standard.

## Quick start

### Set up a project (recommended)

One-time: clone Agent Base.

```sh
git clone <this-repo-url> ~/tools/agent-base
```

Then open the Agent Base clone in Claude Code (or Copilot agent mode) and run
`/base-setup /path/to/project`. It asks two questions (GitHub code review?
path-scoping mechanism?), runs the four phases in fresh contexts, and stops at
two human approval gates. Details:
[`docs/how-to/setup-guide.md`](./docs/how-to/setup-guide.md).

### Starter project

For a brand-new repo, emit the clean standard layout directly:

```sh
node ~/tools/agent-base/scripts/build-starter.mjs /path/to/new-repo --git
```

### Check for drift later

Set-up projects get a permanent `base-check` skill — run it any time to audit
against the conventions and fix findings by rule ID.

### Generate orchestration (optional)

For repos with multiple layers or packages that need a generated multi-agent
team and a `tasks.md` backlog:

Open the **Agent Base clone** in Claude Code (or Copilot agent mode) and run
`/base-orchestrate /path/to/project`. The project must already be set up and
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
                 projects as .claude/agent-base-setup/ (test/ never ships)
.claude/         this repo's own live config; the base-* setup skills, baseline
                 skills (base-check, docs, git-conventions, skill-creator,
                 agent-creator, retro, log-report, eval-runner) and agents are
                 dual-role (used here AND installed into projects — see
                 scripts/install-setup.mjs). Orchestration
                 discovery/generation meta-assets stay Agent Base-side only.
                 base-setup is the setup entry point: run from this
                 clone (or followed directly by the one-prompt flow), never
                 shipped (path is load-bearing:
                 <clone>/.claude/skills/base-setup/SKILL.md)
docs/            consumer-facing guides
reports/         generated outputs (gitignored)
```

Why `templates/` is *not* under `.claude/`: anything in `.claude/` auto-loads
while working on Agent Base itself. Payload is cargo, not config. Rationale:
[`docs/explanation/why-this-way.md`](./docs/explanation/why-this-way.md).

## Next steps

- [`docs/how-to/setup-guide.md`](./docs/how-to/setup-guide.md) — setting up a project.
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

## Developing Agent Base

Index READMEs for the live `.claude/` config:

- [`.claude/agents/README.md`](./.claude/agents/README.md) — baseline and orchestration meta-agents.
- [`.claude/skills/README.md`](./.claude/skills/README.md) — setup, baseline, and orchestration meta-skills.

Orchestration assets: `templates/orchestration/` (agent/skill/doc templates),
`scripts/lib/orchestration/` (validators and scaffold), kit-side entry skill
[`base-orchestrate`](./.claude/skills/base-orchestrate/SKILL.md). Build-plan
history: [`notes/agent-orchestration-plan.md`](./notes/agent-orchestration-plan.md).

## License

Licensed under the MIT License. See [LICENSE](./LICENSE).
