# Skills

## Purpose

On-demand knowledge packages. A skill bundles a workflow and (optionally)
detailed references, examples, and scripts. A tool activates a skill when its
description matches the current task, or when the user types `/skill-name`.

Skills live in `.claude/skills/`. **Both Claude Code and Copilot read this
folder natively** — it is in each tool's default skill search path, so one copy
serves both. See [`docs/cross-tool-setup.md`](../../docs/cross-tool-setup.md).

## Progressive loading

Skills load in three stages — this is the whole point.

1. **Discovery** — the tool reads only the `name` and `description` from each
   skill's frontmatter. Cost: nearly zero. You can install many skills without
   bloating context.
2. **Activation** — when the skill is relevant (or triggered), the tool loads
   the `SKILL.md` body.
3. **Resource access** — the tool follows Markdown links in the body to sibling
   files (`references/`, `examples/`, `scripts/`) only when it references them.

## Single-file vs. multi-file

- **Single-file** when the workflow fits in ~200 lines: one `SKILL.md`, no
  sibling files.
- **Multi-file** when the skill has detailed references, worked examples, or
  executable scripts: `SKILL.md` is the lean router; `references/`,
  `examples/`, and `scripts/` hold the detail.

If your `SKILL.md` body runs past ~200 lines, it probably needs decomposition.

## The meta-skills (start here)

Three meta-skills live in this folder. They are **the primary onboarding tool**
for ai-kit — they encode the conventions operationally so you don't have
to memorize them.

- [`skill-creator`](./skill-creator/SKILL.md) — create, modify, and benchmark
  skills (Anthropic's official skill-authoring meta-skill).
- [`new-agent`](./new-agent/SKILL.md) — create a new agent.
- [`layer-agents`](./layer-agents/SKILL.md) — create
  a nested `AGENTS.md` to scope conventions to a subdirectory.

Type `/skill-creator` in chat to walk through creating your first skill.

## Maintenance skills

Two skills handle the ongoing lifecycle of installed assets:

- [`migrate`](./migrate/SKILL.md) — finish a brownfield migration after
  `ai-kit init` runs on a repo that already had AI config. Resolves
  `.ai-kit` sidecars and `pendingIntegration` entries.
- [`optimize`](./optimize/SKILL.md) — audit installed assets for convention
  violations and fix them in one batch. Run `/optimize` any time assets have
  drifted, grown too long, or need restructuring.

> There is no `new-prompt` meta-skill. Copilot prompt files have no Claude
> equivalent, so the cross-tool way to make a `/command` is a `user-invocable`
> skill — which is what `skill-creator` produces. `.github/prompts/` remains as
> an optional Copilot-only extra.

### Note on slash-command names

VS Code ships built-in `/create-skill`, `/create-agent`, `/create-prompt`,
`/create-instruction`, and `/create-hook` commands. ai-kit's meta-skills
(`/skill-creator`, `/new-agent`) don't collide with those — `/skill-creator`
is Anthropic's official authoring tool and `/new-agent` is ai-kit's
convention-enforcing agent generator.

## A worked example: `git-conventions`

Alongside the meta-skills, ai-kit ships one real skill as a reference
for what a finished skill looks like. Read
[`git/git-conventions/SKILL.md`](./git/git-conventions/SKILL.md) to see the multi-file
pattern in practice — a lean router with sibling references and examples,
frontmatter with both _what_ and _when_ in the description, and a
quick-reference block so common cases don't require following any links. The
skill bundles the
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) spec
(commit messages only) with team-derived extensions for PR titles, PR
descriptions, and branch names — a useful pattern when codifying a cluster of
related conventions under one skill.

## Folder layout

In the **scaffold source repo**, opt-in skills may be grouped by category
(`terraform/`, `kubernetes/`, `git/`, `frontend/`, ...) for organization,
registered via the `path` field in `ai-kit.config.json`. In a **consumer
repo**, every installed skill lands flat at `.claude/skills/{id}/SKILL.md`
— one level only — because Claude Code's native discovery doesn't recurse
into category folders. The CLI flattens on install/migrate; the manifest's
`installedAs` records the flat consumer path. Base skills (`base.skills`)
are flat in both places.

## Adding skills

New skills live in this same folder. The steps are:

1. **Author** — run `/skill-creator` in chat. The meta-skill walks you through
   naming, single- vs multi-file layout, frontmatter, and the progressive-
   disclosure pattern.

2. **Register** — a skill sitting in `.claude/skills/` but not registered in
   `ai-kit.config.json` is **not shipped** by the CLI. Add it to one of two
   surfaces:

   | Surface | Where in `ai-kit.config.json` | When it ships |
   |---|---|---|
   | Always-installed | `base.skills` string array | Every `init` and `update` |
   | Opt-in | `skills` map — `{ path, description }` | `init --skills <name-or-category>` (or interactive prompt) |

   The `git-conventions` entry in the `skills` map is the canonical template
   for an opt-in skill. `path` points to the skill folder;
   `description` is the one-liner shown in the interactive selector.

3. **Consume** — on `ai-kit update` in consumer repos, registered skills are
   hash-tracked in the consumer's `.claude/ai-kit.json`. The CLI overwrites
   them when upstream changes and the consumer hasn't edited them. If both
   sides changed, it offers `sidecar` / `keep` / `take-upstream` — see
   [`docs/migration.md`](../../docs/migration.md) for the full conflict-
   resolution flow.

## Frontmatter fields

Skills follow the [Agent Skills](https://agentskills.io) open standard. Stick to
the fields **both tools understand** so one `SKILL.md` serves both:

- `name` — skill identifier, kebab-case, no namespace prefixes.
- `description` — must include both **what it does** and **when to use it**;
  this string drives auto-activation. (Copilot caps it at 1024 chars.)
- `argument-hint` — placeholder text shown when invoked as a slash command.
- `user-invocable` — when `false`, hides the skill from the `/` menu.
- `disable-model-invocation` — when `true`, requires manual `/` invocation.

Claude Code adds optional fields (`allowed-tools`, `model`, `effort`, `hooks`,
`paths`, `context`). Copilot **silently ignores** unknown fields, so they are
safe to use — just know they only take effect in Claude Code.

## Filename convention

`{kebab-case-name}/SKILL.md` — the skill's folder name is its identifier.
