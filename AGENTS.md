# Agent Base (setup tool repo)

This is the **setup tool, not your application repo**: the repo that builds and
ships AI-config setups into other repositories. Nobody starts a project by
cloning this repo — setup runs *from a project* against a shared Agent Base
clone.

## Overview

Agent Base installs a conformant AI-coding setup — Claude Code + GitHub Copilot
(VS Code), one set of files — into projects via a four-phase setup pipeline
(inventory → plan → apply → verify). Zero-dependency Node ≥ 20 (.mjs),
unit-tested, shell-agnostic.

## Architecture

- [`spec/rules.md`](./spec/rules.md) — single source of truth (R-IDs). Never
  restate a rule; reference its ID.
- [`spec/target-layout.md`](./spec/target-layout.md) — what a set-up project
  looks like.

## Repo zones

| Zone | Role |
|---|---|
| `templates/` | Payload copied into every project: `instructions/` (AGENTS.md/CLAUDE.md skeletons + slot bases), `settings/`, `readmes/`, `ci/`, `gitignore`. |
| `scripts/` + `test/` | The engine. Dev tooling here; setup copies ONLY the five setup scripts (inventory-extract, apply, check, report, audit) + `scripts/lib/` + `templates/` into projects as `.claude/agent-base-setup/` — `test/` never ships. |
| `.claude/` | This repo's live config AND the baseline shipped to every project. The `base-*` setup skills, `setup-verifier` agent, and the baseline `base-check`, `docs`, `git-conventions`, `skill-creator`, `agent-creator`, `retro`, `log-report`, `eval-runner` skills + `docs-auditor` agent are dual-role: loaded here AND installed path-for-path into projects (see `scripts/install-setup.mjs`, the allowlist that decides what ships). Orchestration discovery/generation meta-assets (`repo-analyst`, `scaffolder`, `evaluator`, and their paired skills) stay Agent Base-side — run from an Agent Base clone against a project path, same pattern as `base-setup`. `base-setup` is the setup entry point — run from this clone against a project path; deliberately NOT installed into projects. |
| `docs/` | Consumer-facing guides. |
| `reports/` | Generated outputs (validation/audit reports). Gitignored. |

## Conventions

- Rule-ID indirection (R-51): docs and templates cite rules by R-ID only.
- All scripts zero-dependency Node ≥ 20; Agent Base's own test suite (`npm test`) needs Node ≥ 22.
- Self-audit: `node scripts/audit.mjs` (this repo is itself set up — marker in
  `.claude/agent-base.json`).
- Generated reports go to `reports/`, never committed.
- v1/v2 are internal generations; released artifacts version from 1.0.
- Agent Base CI gates beyond tests: `docs-consistency` (banned v1 vocabulary + doc
  link resolution) and `rule-check-map` (spec-rule ⇄ audit-check coverage).

## Documentation

Conventions: `.claude/skills/docs/SKILL.md` (standard, Diátaxis types, rules).
Tier T3 (`.claude/docs-paths.json`). Docs live in `docs/` (consumer-facing
how-to/reference/explanation), `spec/` (source-of-truth rules + target layout),
`README.md` (entry point), and `AGENTS.md`/`CLAUDE.md` (agent
instructions). Behavior-changing edits to `scripts/`, `templates/`, or `test/`
update the affected docs in the same change. Verify doc claims against code;
fix or flag stale content, never preserve it silently. No CHANGELOG.md or
`docs/decisions/` — decisions live in commits/PRs, consumer changes in release
notes.

## Do Not

- Do not add payload to `.claude/` unless it is also wanted while developing
  Agent Base — everything there auto-loads here (v1's mistake; see dropped rules
  in spec). The installer allowlist (`scripts/install-setup.mjs`) decides
  what ships to projects; `base-setup` stays Agent Base-side only.
- Do not move `.claude/skills/base-setup/` or rename `scripts/`,
  `templates/` — paths are load-bearing (one-prompt flow in
  `docs/how-to/setup-guide.md`, `apply.mjs`, `install-setup.mjs`).
  Within `templates/`: `instructions/` is resolved by project path during
  slot assembly (`apply.mjs`), and `gitignore` is dotless so it is
  never live — neither here nor when copied into projects.
- Do not edit installed-asset copies in a project repo by hand during setup —
  manifest + literals only (reproducibility gate).
- No secrets in code; no new dependencies without discussion.

## More Context

For on-demand workflows see `.claude/skills/` (setup pipeline + validation).
For specialized roles see `.claude/agents/`.

> **Cross-tool note:** `AGENTS.md` is canonical; `CLAUDE.md` imports it
> (`@AGENTS.md`). Shared agents/skills in `.claude/` load in both Claude Code
> and Copilot. See [`docs/how-to/cross-tool-setup.md`](./docs/how-to/cross-tool-setup.md).
