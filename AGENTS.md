# FleetCore (setup tool repo)

This is the **setup tool, not your application repo**: the repo that builds and
ships AI-config setups into other repositories. Nobody starts a project by
cloning this repo — setup runs *from a project* against a fcore
checkout (npx-staged release via the `fcore` bin, or a shared clone).

## Overview

FleetCore installs a conformant AI-coding setup — Claude Code + GitHub Copilot
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
| `templates/` | Payload copied into every project: `instructions/` (AGENTS.md/CLAUDE.md skeletons + slot bases), `settings/`, `readmes/`, `ci/`, `gitignore`, `optional-skills/` (source for the optional skills that are NOT dual-role in `.claude/` — see below). |
| `scripts/` + `test/` | The engine. Dev tooling here; setup copies ONLY the five setup scripts (inventory-extract, apply, check, report, audit) + `scripts/lib/` + `templates/` into projects as `.claude/fcore-onboard/` — `test/` never ships. |
| `.claude/` | This repo's live config AND the baseline shipped to every project. The allowlist in `scripts/lib/baseline.mjs` (consumed by `scripts/install-setup.mjs`) decides what ships, across three tiers: **setup-window** (`fcore-*` setup skills + `setup-verifier`, removed before merge), **baseline** (`fcore-check`, `docs-manager`, `git-conventions`, `skill-creator`, `agent-creator` skills + `docs-auditor` agent — installed into every project), and **optional** (`OPTIONAL_SKILLS`: two families, opt-in per project, R-55 — the `checklist-intake`, `log-report`, `eval-runner`, `tracker-sync` lifecycle skills, dual-role here since FleetCore dogfoods orchestration; and the `ui-verify-web`, `ui-verify-ios` UI-verification skills, sourced from `templates/optional-skills/` instead since FleetCore itself has no UI to verify. Both are staged into the setup window for selection, added via `fcore skills add`, or (lifecycle only) installed by `fcore-fleet-config`). Orchestration discovery/generation meta-assets (`repo-analyst`, `scaffolder`, `evaluator`, and their paired skills) stay FleetCore-side — run from a fcore checkout (clone or staged release) against a project path, same pattern as `fcore-onboard`. `fcore-onboard` is the setup entry point — run from a checkout against a project path; deliberately NOT installed into projects. |
| `docs/` | Consumer-facing guides. |
| `reports/` | Generated outputs (validation/audit reports). Gitignored. |

## Conventions

- Rule-ID indirection (R-51): docs and templates cite rules by R-ID only.
- All scripts zero-dependency Node ≥ 20; FleetCore's own test suite (`npm test`) needs Node ≥ 22.
- Self-audit: `node scripts/audit.mjs` (this repo is itself set up — marker in
  `.claude/fcore.json`).
- Generated reports go to `reports/`, never committed.
- v1/v2 are internal generations; released artifacts version from 1.0.
- FleetCore CI gates beyond tests: `docs-consistency` (doc link resolution),
  `rule-check-map` (spec-rule ⇄ audit-check coverage), self-audit `--strict`,
  and starter build + audit.

## Documentation

Conventions: `.claude/skills/docs-manager/SKILL.md` (standard, Diátaxis types, rules).
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
  FleetCore — everything there auto-loads here (v1's mistake; see dropped rules
  in spec). The installer allowlist (`scripts/lib/baseline.mjs`, consumed by
  `scripts/install-setup.mjs`) decides
  what ships to projects; `fcore-onboard` stays FleetCore-side only. Consumer-only
  optional skills with no FleetCore-side use (e.g. `ui-verify-web`,
  `ui-verify-ios` — this repo has no UI to verify) live in
  `templates/optional-skills/` instead, per-entry via `OPTIONAL_SKILLS`'
  `src`/`dst` split (`scripts/lib/baseline.mjs`).
- Do not move `.claude/skills/fcore-onboard/` or rename `scripts/`,
  `templates/`, or `bin/` — paths are load-bearing (one-prompt flow in
  `docs/how-to/setup-guide.md`, `apply.mjs`, `install-setup.mjs`, the
  `fcore` bin in `package.json`). `bin/` is the npx entry point and
  must never enter the installer allowlist — CLI-only helpers live in
  `bin/lib/`, not `scripts/lib/` (which ships wholesale into projects).
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
