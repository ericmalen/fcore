# Cross-Tool Setup: Claude Code + GitHub Copilot (VS Code)

How to wire a repository so **one set of instructions, agents, and skills
loads in both Claude Code and GitHub Copilot (VS Code)** — and how to verify
it works. Setup produces this wiring automatically
([`setup-guide.md`](./setup-guide.md)); follow these steps when building
or repairing the setup by hand.

Which tool reads which surface: see the
[cross-tool surface map](../reference/copilot-customization-reference.md#cross-tool-surface-map).
Why the layout is shaped this way: [`why-this-way.md`](../explanation/why-this-way.md).

## Lay out the shared files

Put shared assets in `.claude/` — both tools read it natively. Do not use
`.github/` as a shared home: Claude Code reads nothing under it.

```
AGENTS.md                  canonical instructions
CLAUDE.md                  `@AGENTS.md` import + optional Claude-only notes
.claude/
  settings.json            permissions + hooks (committed)
  settings.local.json      personal overrides (gitignored)
  rules/                   path-scoped rules (default mechanism, R-52)
  agents/                  custom agents — Claude subagent format
  skills/                  skills + meta-skills
.vscode/settings.json      Copilot editor feature flags
```

## Wire the instructions

1. Keep `AGENTS.md` at the repo root as the single source of truth, and edit
   only it. (`AGENTS.md` is the open standard read by Copilot, Cursor, Codex,
   Aider, Gemini CLI, and others.)
2. Ship a `CLAUDE.md` whose first line is `@AGENTS.md` (Claude's import
   syntax). Claude Code reads only `CLAUDE.md`; the import pulls in
   `AGENTS.md`. Add Claude-only guidance below the import if you ever need
   it; most teams won't. Otherwise leave `CLAUDE.md` alone.

## Add skills

Create `.claude/skills/<name>/SKILL.md` (or run `/skill-creator`). Skills
follow the [Agent Skills](https://agentskills.io) open standard. Stick to the
frontmatter fields both tools understand (`name`, `description`,
`argument-hint`, `user-invocable`, `disable-model-invocation`); Claude-only
fields are silently ignored by Copilot, so they're safe to add.

Mark a skill `user-invocable` to get a `/name` slash command in both tools —
the **cross-tool slash-command mechanism** (R-54). Do not add a separate
prompts surface; cross-tool slash commands ship as `user-invocable` skills.

## Add agents

Create `.claude/agents/<name>.md` in the **Claude subagent format** (or run
`/agent-creator`): frontmatter with `name`, `description`, and a
comma-separated `tools` list using Claude tool names (`Read, Grep, Glob,
Bash, Edit, Write`). Claude Code reads this natively; Copilot detects the
same files and maps the tool names to its own. Claude-only fields (`model`,
`permissionMode`, …) are safe — Copilot ignores them.

## Settings & hooks

- `.claude/settings.json` — commit it. Define hooks here: the `hooks` block
  is read by **both** tools in the same format (R-46). `permissions` is
  Claude Code only — set Copilot's equivalents in `.vscode/settings.json`.
  Keep the starter `deny` rule for `.env` files.
- `.claude/settings.local.json` — personal overrides; keep it gitignored.
- `.vscode/settings.json` — Copilot editor feature flags. Keep
  `chat.useClaudeMdFile` **off**: Copilot already reads `AGENTS.md`, so
  reading `CLAUDE.md` (which just imports it) would double-load.

## Path-scoped instructions

Use the default mechanism: create `.claude/rules/<scope>.md` with `paths:`
glob frontmatter (R-52). Both tools read these and load them automatically
when working on matching files. One scope per file; a repo uses rules XOR
nested AGENTS.md, never both (R-53).

Known tool caveat: path-scoped rules trigger when matching files are *read* —
they may not load while creating a brand-new matching file. Keep universal
musts in root `AGENTS.md`.

For the **compat variant** (chosen at setup when the team also uses other
AGENTS.md-ecosystem tools): place a nested `AGENTS.md` in the subtree it
governs, and give every nested `AGENTS.md` a sibling `CLAUDE.md` containing
`@AGENTS.md`, mirroring the root-level pairing — Copilot reads nested
`AGENTS.md` files; Claude Code reads only nested `CLAUDE.md` files
(R-13..R-16).

## Verify it works

- **Copilot (VS Code):** the `/` menu lists the skills; the agent picker
  shows `docs-auditor` (installed in every set-up project); `AGENTS.md` loads.
  Confirm via **Chat: Open Diagnostics**.
- **Claude Code:** the `/` menu lists the same skills; `docs-auditor` is
  available as a subagent; `CLAUDE.md` (→ `AGENTS.md`) appears in context.
