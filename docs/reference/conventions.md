# Conventions

The do-and-don't sheet for fcore. One page, reference only — the practices
for working *with* these conventions live in
[`workflow-tips.md`](../how-to/workflow-tips.md); the rationale behind them in
[`why-this-way.md`](../explanation/why-this-way.md).

This repo is wired for both GitHub Copilot (VS Code) and Claude Code — see
[`cross-tool-setup.md`](../how-to/cross-tool-setup.md) for how one set of files serves
both. For the underlying Copilot features these conventions sit on top of, see
[`copilot-customization-reference.md`](./copilot-customization-reference.md).

## Link styles signal the loading model

- **Agent `## Documents` sections use plain-text paths** — not Markdown links
  (R-30). Agents read them on demand via the Read tool, never up-front.
- **Skill `SKILL.md` bodies link sibling files with Markdown links** (R-23) —
  the progressive-disclosure loading path. The router (SKILL.md) stays lean;
  detail loads only when referenced.
- The two styles are deliberately different: the link form signals which
  loading model is at play, and aids visual scanning. Rationale:
  [`why-this-way.md`](../explanation/why-this-way.md#why-lazy-load-by-default).

## Single source of truth

`docs/reference/copilot-customization-reference.md` is authoritative for Copilot features,
frontmatter fields, settings, and behavior. READMEs and meta-skills **link** to
its sections rather than restating them.

## One responsibility per file

- Agents have one role (R-36).
- Skills have one workflow.
- Rules files have one scope — one `.claude/rules/<scope>.md` per concern (R-52).
- Nested `AGENTS.md` files (compat variant) have one scope — the subtree they
  sit in (R-16).

No "do everything" assets.

## Always-on size caps

`AGENTS.md` stays under two pages (R-02). It loads on every interaction —
inflation degrades quality for every task, not just the ones that need the
content.

## Minimal tool lists

Agents get only the tools their role needs (R-29). Tool lists use Claude tool
names (Copilot maps them):

- Read-only: `Read, Grep, Glob`
- Editor: add `Edit, Write`
- Executor: add `Bash`
- Orchestrator: also allowed to delegate to subagents (`Task` in Claude Code;
  Copilot maps it to `agent/runSubagent`)

The copy shipped into targets lives in
[`agent-creator/references/tool-tiers.md`](../../.claude/skills/agent-creator/references/tool-tiers.md)
(FleetCore docs are not installed); the two tables are kept in sync.

## File-naming conventions

| Asset type | Pattern                          | Example                 |
| ---------- | -------------------------------- | ----------------------- |
| Agents     | `{name}.md` in `.claude/agents/` | `code-reviewer.md`      |
| Skills     | `{kebab-case-name}/SKILL.md`     | `tdd-workflow/SKILL.md` |
| Rules      | `{scope}.md` in `.claude/rules/` | `tests.md`              |

New skills and agents for fcore follow the conventions in
[`.claude/skills/README.md`](../../.claude/skills/README.md) and the "Adding
agents" section of [`.claude/agents/README.md`](../../.claude/agents/README.md).
What ships into set-up projects is decided by the installer allowlist in
`scripts/lib/baseline.mjs` (consumed by `scripts/install-setup.mjs`) — there
is no separate distribution step.
Every setup installs the baseline skills (`fcore-check`, `docs-manager`,
`git-conventions`, `skill-creator`, `agent-creator`) and the `docs-auditor`
agent. The orchestration lifecycle skills (`checklist-intake`, `log-report`,
`eval-runner`, `tracker-sync`) are optional (R-55, `OPTIONAL_SKILLS`) — opt-in
per project, dormant until orchestration generation creates their surfaces
(`docs/orchestration/`, generated agents); `fcore-fleet-config` installs them as
a prerequisite, or add them with `fcore skills add`. Orchestration
discovery/generation meta-assets stay FleetCore-side and run from a fcore checkout against
a target path — see [`spec/target-layout.md`](../../spec/target-layout.md).

Directory- or layer-scoped conventions go in a path-scoped rules file at
`.claude/rules/<scope>.md` with `paths:` glob frontmatter (R-52) — the default
mechanism. Repos that opted into the nested-AGENTS.md compat variant use a
nested `AGENTS.md` (plus a sibling `CLAUDE.md` shim) instead — one mechanism
per repo, never both (R-53). See
[`cross-tool-setup.md#path-scoped-instructions`](../how-to/cross-tool-setup.md#path-scoped-instructions).

## One README per asset folder, not per asset

`.claude/agents/`, `.claude/skills/`, and `.claude/rules/` (when present) each
have a single `README.md` that explains the pattern (R-48). Individual asset
files stay lean.

## Conformance tooling (and a name disambiguation)

Conformance to these conventions is audited by the `fcore-check` skill: it
runs `node <fcore>/scripts/audit.mjs --root .` and fixes findings by rule ID
(usage tips: [`workflow-tips.md`](../how-to/workflow-tips.md#keeping-the-config-conformant)).
Despite the similar names, `scripts/check.mjs` is unrelated — it enforces the
manifest gates during setup phase 3, while the `fcore-check` skill is the
recurring after setup audit.
