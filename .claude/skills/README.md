# Skills

## Purpose

On-demand knowledge packages. A skill bundles a workflow and (optionally)
detailed references, examples, and scripts. A tool activates a skill when its
description matches the current task, or when the user types `/skill-name`.

Skills live in `.claude/skills/`. **Both Claude Code and Copilot read this
folder natively** — it is in each tool's default skill search path, so one copy
serves both. See [cross-tool setup](../../docs/how-to/cross-tool-setup.md).

## Progressive loading

Skills load in three stages — this is the whole point.

1. **Discovery** — the tool reads only the `name` and `description` from each
   skill's frontmatter. Cost: nearly zero. You can keep many skills installed
   without bloating context.
2. **Activation** — when the skill is relevant (or triggered), the tool loads
   the `SKILL.md` body.
3. **Resource access** — the tool follows Markdown links in the body to sibling
   files (`references/`, `examples/`, `scripts/`) only when it references them.

## Single-file vs. multi-file

- **Single-file** when the workflow fits in ~200 lines (R-20): one `SKILL.md`,
  no sibling files.
- **Multi-file** when the skill has detailed references, worked examples, or
  executable scripts: `SKILL.md` is the lean router; `references/`,
  `examples/`, and `scripts/` hold the detail.

If your `SKILL.md` body runs past ~200 lines (R-20), it probably needs
decomposition.

## What lives in this folder

Two groups, both loaded here because both are wanted while developing FleetCore:

**FleetCore tooling** — the setup engine and self-checks. The four `fcore-*`
setup phase skills and `fcore-check` are installed into every project per the
allowlist in `scripts/lib/baseline.mjs` (consumed by
`scripts/install-setup.mjs`); FOUR skills are deliberately FleetCore-side only
and never installed (installer allowlist): `fcore-onboard`, `fcore-update`,
`fcore-fleet-config`, and `validate-setup`.

- [`fcore-onboard`](./fcore-onboard/SKILL.md) — the setup entry point and
  orchestrator. Run from this fcore checkout against a project path. FleetCore-side
  only.
- [`fcore-update`](./fcore-update/SKILL.md) — baseline upgrade loop for
  set-up projects (sync-baseline report → upgrade → audit). Run from this
  fcore checkout against a project path. FleetCore-side only.
- [`fcore-fleet-config`](./fcore-fleet-config/SKILL.md) — orchestration entry
  point (discovery → generation). Run from this fcore checkout against a set-up
  project path. FleetCore-side only.
- `fcore-inventory`, `fcore-plan`, `fcore-apply`, `fcore-verify` — the
  four-phase setup pipeline. Installed for the setup window; removed
  again before merge.
- `validate-setup` — runs the full setup validation end-to-end. FleetCore-side
  only.
- `fcore-check` — audits a repo's AI configuration against fcore conventions
  (the mandatory check; source of truth is this folder — shipped verbatim by
  install-setup).

**Baseline assets** — shipped path-for-path into every target alongside the
tooling, and held to FleetCore's own conventions because they load here too:

- [`docs-manager`](./docs-manager/SKILL.md) — the documentation standard (Diátaxis content
  model, decision-record + changelog workflows, proportional setup). Pairs with the
  [`docs-auditor`](../agents/docs-auditor.md) agent for heavy audit/migration.
- [`git-conventions`](./git-conventions/SKILL.md) — Conventional Commits plus
  team-derived PR and branch conventions.
- [`agent-creator`](./agent-creator/SKILL.md) — meta-skill: scaffold a new
  custom agent to FleetCore conventions.
- [`skill-creator`](./skill-creator/SKILL.md) — Anthropic's official
  skill-authoring meta-skill, vendored **verbatim** from
  [anthropics/skills](https://github.com/anthropics/skills) (Apache 2.0; pinned
  commit in [`UPSTREAM`](./skill-creator/UPSTREAM)). Shipped so Copilot users
  and consumers without a user-level copy get it; delete freely if you already
  have it. Do not edit — re-sync from upstream instead. Exempt from house-style
  audit rules: it follows upstream's conventions, not FleetCore's.

**Orchestration meta-skills** — discovery, generation, and quality. FleetCore-side
only except the lifecycle skills (`checklist-intake`, `log-report`, `eval-runner`,
`tracker-sync`), which install into every adopted repo. Entry point:
[`fcore-fleet-config`](./fcore-fleet-config/SKILL.md). How-to:
[`docs/how-to/orchestration-guide.md`](../../docs/how-to/orchestration-guide.md).

Discovery (driven by meta-agents in fresh contexts):

- `structure-detector`, `dependency-mapper`, `convention-detector` — repo
  profile fields.
- `interview-guide` — gap-driven policy questions.
- `blueprint-generator`, `handoff-validator` — blueprint synthesis and gate.

Generation (driven by `scaffolder`):

- `agent-instantiator`, `skill-instantiator` — pure slot substitution into the
  target's `.claude/`.

Quality / lifecycle:

- `eval-runner`, `drift-checker` — regression and template drift (fcore checkout).
- `checklist-intake`, `log-report` — flywheel intake and handoff analytics (project;
  installed at setup).
- `tracker-sync` — tasks.md ⇄ tracker bridge, ADO work items or GitHub Issues
  (project; installed at setup; DD-14 directional sync).

## A worked example: `git-conventions`

[`git-conventions`](./git-conventions/SKILL.md) is the reference for what a
finished multi-file skill looks like: a lean router with sibling references and
examples, frontmatter carrying both _what_ and _when_ in the description, and a
quick-reference block so common cases don't require following any links. It
bundles the
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) spec
(commit messages only) with team extensions for PR titles, descriptions, and
branch names — a useful pattern when codifying a cluster of related conventions
under one skill.

## Frontmatter fields

Skills follow the [Agent Skills](https://agentskills.io) open standard. Stick to
the fields **both tools understand** so one `SKILL.md` serves both:

- `name` — skill identifier, kebab-case, no namespace prefixes.
- `description` — must include both **what it does** and **when to use it**;
  this string drives auto-activation. (The Agent Skills spec caps description length — enforced as R-19.)
- `argument-hint` — placeholder text shown when invoked as a slash command.
- `user-invocable` — when `false`, hides the skill from the `/` menu.
- `disable-model-invocation` — when `true`, requires manual `/` invocation.

Claude Code adds optional fields (`allowed-tools`, `model`, `effort`, `hooks`,
`paths`, `context`). Copilot **silently ignores** unknown fields, so they are
safe to use — just know they only take effect in Claude Code.

## Filename convention

`{kebab-case-name}/SKILL.md` — the skill's folder name is its identifier. A
consumer's installed skills land flat at `.claude/skills/{id}/SKILL.md`, one
level only, because native discovery doesn't recurse into category folders.
