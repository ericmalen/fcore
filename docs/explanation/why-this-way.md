# Why This Way

Optional reading. Design rationale for readers curious about the choices baked
into agent-base. Skip this and go to [`conventions.md`](../reference/conventions.md) if
you just want the rules.

## Why agent-base, not a fork

The author of agent-base maintains a mature Copilot setup in a production
repo. Copying it wholesale would ship stack-specific and domain-specific
content — layering rules, framework conventions, internal workflow names — that
would require subtraction before addition in any other project.

agent-base inverts that. You start with the structure and conventions, then add
your own content. No deleting before building.

## Why a shared `.claude/` home

This repo targets both GitHub Copilot (VS Code) and Claude Code. One directory
is read natively by both for agents and skills: `.claude/`. Copilot's default
search paths include `.claude/skills/` and `.claude/agents/`; Claude Code reads
nothing under `.github/`. Copilot would also accept `.github/skills/` or the
tool-agnostic `.agents/skills/`, but `.claude/` is the one location Claude Code
reads too — so agents and skills live there: one copy, both tools, no symlinks,
no drift. (One nuance: in `.claude/settings.json`, the `hooks` block is read by
both tools, but `permissions` is Claude-Code-only — Copilot's equivalents live
in `.vscode/settings.json`.) `.github/` *AI-instruction surfaces* exist only
when GitHub-side code review is in use (R-09/R-49) — CI workflows live under
`.github/` regardless. See
[`cross-tool-setup.md`](../how-to/cross-tool-setup.md).

## Why AGENTS.md plus a CLAUDE.md shim

`AGENTS.md` is the open standard read by Copilot, Cursor, Codex, Aider,
Gemini CLI, and others — the natural home for canonical instructions. But
Claude Code reads only `CLAUDE.md`. Shipping a `CLAUDE.md` whose first line is
`@AGENTS.md` (Claude's import syntax) gives both tools one source of truth
without duplication: you edit `AGENTS.md`; Claude Code pulls it in through the
shim. The same reasoning sets `chat.useClaudeMdFile` to off in VS Code —
Copilot already reads `AGENTS.md` directly, so also reading `CLAUDE.md` (which
just imports it) would double-load the content.

## Why meta-skills

The headline feature of agent-base is **skills-as-tooling**. Two meta-skills
— `skill-creator` and `agent-creator` — walk you through
producing new assets that conform to the conventions. (`skill-creator` is
Anthropic's official skill-authoring tool, shipped here as a baseline skill.)

Prose teaches conventions slowly. Tooling teaches them the first time you use
them. Typing `/skill-creator` and being asked the questions the skill
enforces is faster than reading a style guide, and it produces a file that is
already conformant.

## Why lazy-load by default

Context relevance beats context volume. Model quality degrades when it is fed
references that don't apply to the current task.

- Agent `## Documents` sections use plain-text paths so the agent opens docs on
  demand instead of every time it loads.
- Skills use progressive disclosure: frontmatter during discovery, body on
  activation, sibling files only when linked.

Eager loading everything is cheap to write and expensive to run. Lazy loading is
the default here.

## Why one README per folder

Per-asset READMEs sprawl quickly. A folder with 15 agents and 15 READMEs
duplicates the same framing 15 times — and drifts when conventions change.

One README per asset-type folder covers the same ground with less maintenance.
The READMEs explain the pattern. The annotated example assets (like
`example-reviewer`, kept Agent Base-side) show what good looks like. Individual
assets stay lean.

## Why annotated examples instead of blank templates

A blank template with TODOs tells you where to type. An annotated example shows
you what to type and why it belongs there.

The meta-skills provide the templates (paste-ready, stub content). The
example assets (like `example-reviewer.md`) provide the annotated versions with
inline comments explaining the non-obvious choices — they are Agent Base-side examples
to copy from, not assets installed into set-up projects. Together they cover both
modes — "I just need a starting point" and "I want to see a real one."

## Why flat orchestration (by default)

Both Copilot and Claude Code support nested subagents (a subagent invoking
subagents). Token cost compounds with depth, and recursive chains are easy to
introduce by accident and hard to debug.

agent-base prefers a **flat topology** as the default: one orchestrator
calls every specialist directly. Reasons:

- Easier to debug — every call appears in the orchestrator's transcript.
- Easier to reason about — no implicit depth.
- Cheaper — no compounding subagent invocations.
- Harder to accidentally make recursive — flat agents can't chain into a
  five-deep loop.

agent-base does not ship an orchestration layer. When you add one,
review loops and human gates go in the orchestrator, not between specialists.
Nesting is available when a specialist legitimately needs its own helpers —
treat it as a deliberate choice, not the default.
