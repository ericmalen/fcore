# Integration rules

The decision framework for brownfield migration: given a piece of existing
AI-config content, **where does it belong in ai-kit's structure?**

**Every disposition here is deterministic.** The migrator applies the rule,
shows the result in a single batch plan, and the user approves the batch as a
whole. It does **not** ask "what should I do with this file?" — there is no
per-file menu.

> **Implementation note.** These routing rules are applied by the `migrator`
> agent, which emits a structured routing JSON. The CLI `migrate stage` phase
> reads that JSON and performs all file I/O — no LLM token-generates body
> content. The rules here are the spec; `lib/migrate/dispositions/` and the
> migrator agent are the implementation.

ai-kit's organizing principle (see
[`docs/cross-tool-setup.md`](../../../../docs/cross-tool-setup.md)):

- `AGENTS.md` is the **canonical** instructions file. `CLAUDE.md` just imports it
  (`@AGENTS.md`) — Claude Code reads only `CLAUDE.md`, it has no `AGENTS.md`
  fallback, so `CLAUDE.md` must always exist as the import shim.
- Skills live in `.claude/skills/`, agents in `.claude/agents/` — both tools read
  them natively.
- `.github/` is Copilot-only legacy surface; ai-kit standardizes on
  `AGENTS.md` + `.claude/`.

## Per content kind

### `CLAUDE.md` (sidecar'd)

The consumer's `CLAUDE.md` usually holds real project rules. ai-kit's
`CLAUDE.md.ai-kit` is the `@AGENTS.md` import plus standard boilerplate.

- **All consumer content** → move into `AGENTS.md` under appropriate headings.
  It is tool-agnostic; `AGENTS.md` is where it belongs.
- `CLAUDE.md` is then **replaced with ai-kit's `CLAUDE.md`** — i.e.
  `CLAUDE.md.ai-kit` becomes `CLAUDE.md`. Delete the `.ai-kit` sidecar.
- There is no "genuine Claude-only notes" branch. If a line looks genuinely
  Claude-specific, the migrator may *note* it in the batch plan, but the default
  is everything → `AGENTS.md`.
- End state: `CLAUDE.md` equals ai-kit's version exactly (so it will
  **not** drift from `sourceHash`); the consumer's rules now live in `AGENTS.md`.

### `AGENTS.md` (sidecar'd)

The consumer already has an `AGENTS.md` — it is already canonical. ai-kit's
`AGENTS.md.ai-kit` is a TODO-placeholder template.

- Merge any **structural sections** from the template the consumer is missing
  (e.g. a "Do Not" section) — but as empty/short headings, not TODO placeholders.
- **Never** downgrade the consumer's real content to a TODO placeholder.
- Delete `AGENTS.md.ai-kit`.

### `.claude/settings.json` (sidecar'd)

- `deny` — **union** the two lists; always keep ai-kit's `.env` deny rules.
- `allow` — keep the consumer's list as-is.
- `hooks` — merge: keep the consumer's hooks, add any ai-kit ships.
- Delete `.claude/settings.json.ai-kit`.

### `.vscode/settings.json` (sidecar'd)

Everything in ai-kit's `.vscode/settings.json` is intended for the consumer
repo post-init — not just the AI-feature keys.

- **Merge ALL keys** from ai-kit's `.vscode/settings.json.ai-kit` into the
  consumer's file — including `explorer.fileNesting.*` and
  `chat.tools.terminal.*`, not only the `chat.*` AI keys.
- **Preserve** the consumer's extra keys (e.g. `editor.formatOnSave`).
- On a key **conflict**, ai-kit's value wins — its values are the intended
  configuration.
- Delete `.vscode/settings.json.ai-kit`.

### `.github/copilot-instructions.md`

Legacy Copilot-only instructions. ai-kit makes `AGENTS.md` canonical, and
Copilot reads `AGENTS.md` natively — so this file is redundant once its content
moves.

- Fold all substantive content into the **root `AGENTS.md`**.
- **Delete the original.** No thin-pointer stub, no "leave as-is".

### `.github/instructions/*.instructions.md`

Path-scoped Copilot instructions — each applies to one directory. ai-kit's
cross-tool equivalent is a nested `AGENTS.md`.

- For each file, fold its content into a **nested `AGENTS.md`** in the directory
  it was scoped to, and create a sibling `CLAUDE.md` containing `@AGENTS.md`
  (mirrors the root pairing; see `/layer-agents`).
- **Delete the original `.instructions.md`.**
- This preserves the path scoping while removing the Copilot-only file.

**Unscoped instruction files.** When `applyTo` is missing, empty, or resolves
only to the repo root (`**`), the file is "unscoped" — cross-cutting content
with no directory to nest under. Preflight folds these into the **root
`AGENTS.md`** and tags each source with `unscoped: true` so it shows up as
`[unscoped]` in the work-unit summary. This keeps the file visible to the user
rather than silently rolling it into the root fold; they can override the
routing during plan review if a different target makes more sense.

### `.github/chatmodes/*`, `.github/prompts/*`, other non-instruction files

These are not instruction files and have no ai-kit conflict.

- **Leave as-is.** Recorded as intentionally unmanaged. Deterministic "leave" —
  still no question.
- (`.github/prompts/` is a Copilot-only surface ai-kit explicitly
  supports; the consumer's own prompt files are fine where they are.)

### `.github/skills/<name>/`

Custom skills some teams added under `.github/` by analogy with
`.github/instructions/`, before VS Code Copilot Chat standardized on
`chat.useAgentSkills` reading from `.claude/`. ai-kit's canonical location is
`.claude/skills/<name>/` — flat, no category folder (Claude Code only
discovers skills one level deep).

- For each skill directory, copy every file into `.claude/skills/<name>/`.
- **Delete the originals** under `.github/skills/<name>/`.
- If `.claude/skills/<name>/` already exists, mark `hasCollision: true`,
  skip staging, and surface the source path under the leave-as-is review
  unit so the user resolves manually.

### `.github/agents/<name>.agent.md`

Custom agents some teams added under `.github/` by analogy with
`.github/skills/`. ai-kit's canonical location is `.claude/agents/`.

- Move `.github/agents/<name>.agent.md` → `.claude/agents/<name>.agent.md`.
  No category folder; agents live flat.
- **Delete the original.**
- Same collision handling as skills: `hasCollision: true` skips staging and
  surfaces the path under leave-as-is.

### Content overlapping an opt-in skill

If consumer prose duplicates a skill ai-kit offers (e.g. commit-message
conventions overlap `git-conventions`):

- **Skill already installed** → drop the duplicated prose from the merged file;
  point at the skill instead.
- **Skill not installed** → do **not** auto-install. Note in the batch plan that
  the skill exists and recommend `ai-kit init --skills <name>`.

## Detecting overlap with an un-installed opt-in skill

1. Read the opt-in `skills` block in `ai-kit.config.json` — each entry has a
   `description` naming its domain.
2. Grep the consumer's content for that domain's vocabulary (for
   `git-conventions`: "conventional commit", "feat:", "fix:", "PR title", "branch
   name").
3. On a match, surface it as a **recommendation** in the batch plan — never
   install silently.
