# Agent Base rule catalog

**This file is the single source of truth for the target state.** The audit enforces
every `mechanical` rule; the verifier rubric applies every `judgment` rule; docs
reference rules by ID and never restate them (R-51).

Version: 1.0 (June 2026) · Distilled from a pre-repo working draft (not
retained; decisions D-1..D-5 resolved)

**Conventions.**
- Rule IDs are permanent. Retired IDs are never reused (see Retired section).
- `mechanical` rules map 1:1 to an audit check keyed by the same ID; severity shown
  as `normal → strict` where `--strict` escalates.
- `judgment` rules appear in the verifier rubric; each carries a PASS and FAIL
  example here — the rubric is derived from this file.
- "non-blank lines" = lines containing at least one non-whitespace character.
- "first line" = first line of the file, byte-position 0, no preceding blank lines.
- *(compat)* rules apply only when the repo uses the nested-AGENTS.md compat option
  (see R-53).
- *(conditional: code-review)* rules branch on the setup answer recorded in the
  Agent Base marker (`.claude/agent-base.json`, field `githubCodeReview: true|false`).

---

## 1. Root instructions

**R-01 · Root AGENTS.md present** · mechanical · audit, error
Root `AGENTS.md` exists and is the repo's canonical AI instructions file.

**R-02 · Root AGENTS.md size cap** · mechanical · audit, warning
≤ 120 non-blank lines AND ≤ 6,000 characters. It loads on every interaction;
inflation degrades every task. (Reference point: GitHub code review reads only the
first 4,000 chars of its instruction files.)

**R-03 · Do Not section** · mechanical · audit, warning
Root AGENTS.md contains a `## Do Not` section.

**R-04 · No unfilled placeholders** · mechanical · audit, info → warning
No `<!-- TODO` markers remain in root AGENTS.md.

**R-05 · No directory-scoped rules at root** · judgment · rubric
Rules that apply only to a subtree belong in a path-scoped rules file (R-52) or
nested AGENTS.md (compat), not in root AGENTS.md.
PASS: "All API handlers live in `src/api/` (see `.claude/rules/api.md`)."
FAIL: a `## Frontend` section in root AGENTS.md listing React component naming rules
that only apply under `src/web/`.

**R-06 · No skill duplication at root** · judgment · rubric
Root AGENTS.md does not restate guidance that an installed skill owns; it may name
the skill.
PASS: "Commit messages follow Conventional Commits — the `git-conventions` skill has
the details."
FAIL: root AGENTS.md contains the full commit-type table that
`git-conventions/SKILL.md` also contains.

**R-07 · References resolve** · mechanical · audit, warning
Every local path reference — Markdown link targets on all surfaces, plain-text paths
in agent `## Documents` sections — resolves to an existing file. Applies to: root
AGENTS.md, nested AGENTS.md, rules files, agents, skills.

**R-08 · Root AGENTS.md structure and content discipline** · judgment · rubric
Sections follow Overview / Architecture (links, not explanations) / Conventions /
Do Not / More Context. Content is limited to what an AI cannot infer from the code.
PASS: Architecture section that is three links to design docs.
FAIL: Architecture section that explains the whole system in 80 lines, or a
Conventions entry like "write clean code" (inferable, content-free).

**R-09 · copilot-instructions.md is conditional** · mechanical · audit, warning ·
*(conditional: code-review)*
If `githubCodeReview: true`: `.github/copilot-instructions.md` exists, is ≤ 4,000
characters, and contains a pointer to AGENTS.md as the canonical file.
If `false`: the file does not exist (content folded into AGENTS.md during setup).
Rationale: GitHub.com code review reads only this file (first 4,000 chars); the
cloud coding agent reads AGENTS.md natively.

## 2. CLAUDE.md shim

**R-10 · Root CLAUDE.md present** · mechanical · audit, warning
Root `CLAUDE.md` exists. Claude Code reads CLAUDE.md, not AGENTS.md — do not
rely on any AGENTS.md fallback (reports of one are contested/unconfirmed; the
shim makes it moot, and Anthropic docs recommend exactly this shim pattern).

**R-11 · Shim imports AGENTS.md first** · mechanical · audit, warning → error
The first line of root CLAUDE.md is exactly `@AGENTS.md`.

**R-12 · Claude-only additions stay minimal** · judgment · rubric
Content below the import is genuinely Claude-specific and short; if there is none,
the file is the import line plus at most a brief comment.
PASS: import line + 4 lines explaining a Claude-specific hook.
FAIL: project conventions living in CLAUDE.md below the import (they belong in
AGENTS.md).

## 3. Path-scoped instructions (D-1: rules-first; nested = compat)

**R-52 · Rules files** · mechanical + judgment · audit, warning + rubric
Path-scoped rules live at `.claude/rules/<scope>.md` with valid `paths:` glob
frontmatter; each file ≤ 50 non-blank lines; one scope per file.
PASS: `rules/tests.md`, `paths: ["**/*.test.ts"]`, 20 lines of testing conventions.
FAIL: `rules/misc.md` mixing test rules, deploy rules, and frontend rules.

**R-53 · One scoping mechanism** · mechanical · audit, warning
A repo uses `.claude/rules/` XOR nested AGENTS.md pairs — never both. Adoption
defaults to rules; nested is chosen when the team needs other AGENTS.md-ecosystem
tools (Cursor, Codex, Gemini CLI, …).

**R-13 · *(compat)* Nested AGENTS.md size cap** · mechanical · audit, warning
≤ 50 non-blank lines.

**R-14 · *(compat)* No frontmatter in nested AGENTS.md** · mechanical · audit, warning
Scope comes from location, not YAML.

**R-15 · *(compat)* Sibling shim** · mechanical · audit, warning → error
Every nested AGENTS.md has a sibling CLAUDE.md whose first line is `@AGENTS.md`.

**R-16 · *(compat)* One scope per nested file** · judgment · rubric
A nested AGENTS.md covers exactly the subtree it sits in.
PASS: `src/api/AGENTS.md` describing API-layer rules only.
FAIL: `src/api/AGENTS.md` also defining frontend conventions "while we're here."

## 4. Skills

**R-17 · Name matches folder** · mechanical · audit, error
SKILL.md frontmatter `name:` equals the containing folder name exactly (both tools
silently fail to load otherwise).

**R-18 · Kebab-case skill names** · mechanical · audit, warning
`^[a-z0-9][a-z0-9-]*$`; no `:` or `/` (reserved for plugin namespacing).

**R-19 · Description length cap** · mechanical · audit, error
Skill `description:` ≤ 1,024 characters.

**R-20 · SKILL.md length cap** · mechanical · audit, warning
SKILL.md ≤ 200 lines. Longer content moves to sibling reference files (R-24).

**R-21 · Description states what + when** · judgment · rubric (audit hints only)
The description must let a model decide activation: what the skill does AND when to
use it; ideally what it is not for.
PASS: "REST API design review for endpoints under src/api. Use when adding or
modifying HTTP endpoints. Not for GraphQL."
FAIL: "API helper." / "Useful utilities for the backend."

**R-22 · No built-in command collisions** · mechanical · audit, info → warning
Skill names avoid VS Code built-ins: `create-skill`, `create-agent`,
`create-prompt`, `create-instruction`, `create-hook`, `init`, `plan`, `skills`,
`compact`, `troubleshoot`. (List tracked; update with tool releases.)

**R-23 · Sibling links are Markdown links** · mechanical · audit, warning
SKILL.md links sibling files with `[text](references/x.md)` — never bare
(`references/x.md`) or relative (`./`, `../`) plain-text paths. This is the
progressive-disclosure loading path in both tools. Paths inside code fences and
inline code spans are exempt (command examples are not references).

**R-24 · Progressive disclosure structure** · judgment · rubric
SKILL.md is a lean router; depth lives in `references/`, `examples/`, `scripts/`.
Single-file skills are fine when they fit comfortably under the R-20 cap.
PASS: 60-line SKILL.md linking 4 reference files loaded on demand.
FAIL: 190-line SKILL.md inlining three workflows to stay just under the cap.

**R-25 · Portable frontmatter** · mechanical · audit, warning
Frontmatter uses the portable core (`name`, `description`, `argument-hint`,
`user-invocable`, `disable-model-invocation`; spec metadata `license`,
`compatibility`, `metadata`). Tool-specific extras (`model`, `context`, `hooks`,
`allowed-tools`, `paths`, …) are permitted but the skill must not depend on them to
be usable in the other tool. `infer` is prohibited (deprecated).

**Vendored exemption** — a skill directory containing an `UPSTREAM` provenance
marker (vendored verbatim from a third party, e.g. Anthropic's `skill-creator`)
is held to upstream's conventions: the audit skips style rules R-20–R-25 for
it. Load-critical rules (R-17 name match, R-18 kebab-case, R-19 description
cap, R-26 placement) still apply. Never edit vendored skills — re-sync from the
upstream commit pinned in the marker.

**R-26 · Flat skill layout** · mechanical · audit, error
Skills sit at `.claude/skills/<id>/SKILL.md` — exactly one level. Neither tool
discovers category subfolders.

**R-54 · Slash commands are skills** · mechanical · audit, warning
User-facing commands ship as `user-invocable` skills (both tools render them in the
`/` menu). No `.github/prompts/` surface exists (D-4); lingering `*.prompt.md` files
are migration sources → convert to skills or ledger-drop.

## 5. Agents

**R-27 · Kebab-case agent filenames** · mechanical · audit, info → warning

**R-28 · tools: declared** · mechanical · audit, warning
Every agent declares `tools:` frontmatter — omission grants all tools.

**R-29 · Minimal tool grants** · judgment · rubric
Tools match the role: read-only reviewer = `Read, Grep, Glob`; editor adds
`Edit, Write`; executor adds `Bash`. Claude tool names (Copilot maps them).
PASS: a reviewer agent with `tools: Read, Grep, Glob`.
FAIL: a reviewer agent with `Bash, Edit, Write` "just in case."

**R-30 · Documents = plain root-relative paths** · mechanical · audit, warning
Agent `## Documents` sections list plain-text repo-root-relative paths (no Markdown
links) — the lazy-load signal, deliberately opposite of R-23.

**R-31 · Never section present** · mechanical · audit, warning

**R-32 · Procedures section present** · mechanical · audit, warning

**R-33 · Role statement opens the body** · mechanical-proxy + judgment · audit, warning + rubric
First non-heading body line states what the agent does and does not do.
PASS: "Reviews backend PRs for security issues; never edits files."
FAIL: body that opens with setup instructions and never states the role.

**R-34 · Agent description present and decisive** · mechanical + judgment · audit, warning + rubric
`description:` exists (mechanical) and tells the orchestrator what the agent does
and when to delegate to it (judgment — same PASS/FAIL pattern as R-21).

**R-35 · Current model references** · mechanical · audit, warning
`model:`, when present, is a current alias (`sonnet` / `opus` / `haiku` /
`fable` / `inherit`) or current full ID. Deprecated names (opus-4, sonnet-4 era)
are findings.

**R-36 · One agent, one responsibility** · judgment · rubric
PASS: `migration-verifier` that only verifies.
FAIL: `helper` that reviews, fixes, and deploys.

**R-37 · Flat orchestration default** · judgment · rubric
Subagent nesting only for genuine compositional need; review loops and human gates
live in the orchestrator.
PASS: orchestrator → 3 parallel workers, results joined at the top.
FAIL: worker that spawns its own reviewer which spawns a fixer, no gate anywhere.

## 6. Settings

**R-43 · Claude settings present and split** · mechanical · audit, info → warning
`.claude/settings.json` exists, is valid JSON, and is committed;
`.claude/settings.local.json` is gitignored (R-47).

**R-44 · .env reads denied** · mechanical · audit, warning → error
`permissions.deny` includes `Read(./.env)` and `Read(./.env.*)`.

**R-45 · VS Code key set pinned** · mechanical · audit, warning
`.vscode/settings.json` contains, with exact values:
`chat.useAgentsMdFile: true` · `chat.useClaudeMdFile: false` (critical — VS Code
default is now true and would inject the literal shim text) ·
`chat.useCustomizationsInParentRepositories: true` · `chat.useAgentSkills: true` ·
`chat.useCustomAgentHooks: true` · `chat.subagents.allowInvocationsFromSubagents:
true` (enables the mechanism — R-37 governs whether a given agent DESIGN
should nest; verifiers must not flag this setting as an R-37 conflict) · `chat.tools.terminal.enableAutoApprove: false` (deliberate override of the
now-true VS Code default) · empty terminal auto-approve rule map ·
`explorer.fileNesting.enabled: true` with `"AGENTS.md": "CLAUDE.md"` pattern ·
plus `chat.useNestedAgentsMdFiles: true` only when the compat option is active
(R-53).

**R-46 · Hooks live in .claude/settings.json** · mechanical + guidance · audit, info
Hooks, when used, are defined in `.claude/settings.json` — read natively by BOTH
tools (same format). Never delivered via plugins (known Stop-hook plugin bug).

## 7. Hygiene

**R-42 · No chatmodes** · mechanical · audit, warning
No `.github/chatmodes/` directory or `*.chatmode.md` files (deprecated → custom
agents). Brownfield: migration sources.

**R-47 · Gitignore coverage** · mechanical · audit, info → warning
`.gitignore` exists (in git repos) and covers `.claude/settings.local.json`.
Matching is prefix-aware (a `.claude` or `.claude/` entry counts). One matcher,
applied uniformly.

**R-48 · One README per asset folder** · mechanical · audit, info → warning
`.claude/agents/`, `.claude/skills/`, and `.claude/rules/` (when present) each have
exactly one `README.md`; no per-asset READMEs.

**R-49 · AI config homes** · mechanical · audit, warning
AI configuration lives under `.claude/`. Under `.github/`, only
`copilot-instructions.md` + `instructions/` are valid, and only when
`githubCodeReview: true` (R-09). `.github/{skills,agents,prompts,chatmodes}` are
findings (migration sources in existing project).

**R-50 · Maintenance surface installed** · mechanical · audit, warning
Set-up projects contain the `base-check` skill and the Agent Base marker
(`.claude/agent-base.json`). Required marker fields (warning when missing):
`standard` (semver), `toolRepo`, `setupAt`, `githubCodeReview`. Recommended
release-pin fields (info when missing): `pin`, `lastSyncedAt` — used by
baseline sync and the pin-resolved CI templates (npx at pin; clone fallback).
Candidate for promotion to warning once tagged pins are the norm across
set-up projects.

**R-51 · Rule-ID indirection** · mechanical · Agent Base CI
Agent Base docs, templates, and check metadata reference rules by R-ID only — never by
file line numbers. Thresholds are never restated without the R-ID alongside
(shipped templates may carry the operative value, since consumer repos have no
`spec/rules.md`, but must cite the R-ID). CI mechanically enforces the doc-link
and rule ⇄ audit-check halves, including `--strict` escalation arrows
(`docs-consistency`, `rule-check-map`); the no-restatement clause is
review-enforced. Not enforced in consumer repos.

---

## Audit exemptions (implementation)

Besides the vendored-UPSTREAM exemption above, the audit implementation carries
two narrow exemptions the rules would otherwise flag:

- **Setup-window tooling.** `.claude/agent-base-setup/`,
  `.claude/skills/base-{inventory,plan,apply,verify}/`, and
  `.claude/agents/setup-verifier.md` are skipped by the skills/agents/
  reference checks: they exist only between install and the base-verify
  teardown, and transient references (e.g. `.setup/report.md`) are legal
  there.
- **Payload skeletons.** Files containing `<!-- agent-base:slot:` markers are
  template payload, not live configuration, and are excluded from live-config
  checks.

## Retired IDs

| ID | Was | Disposition |
|---|---|---|
| R-38..R-41 | prompt-file rules | surface dropped (D-4); essence of R-41 → R-54 |

## Dropped v1 rules (machinery — no v2 equivalent)

Registration checks (`skill/agent-not-registered`), `pending-integration-present` +
sidecar flow, audit-report gitignore/leak checks, `isAiKitOwnAsset` and
manifest-role exemptions, migrate-specific permission allow-list entries,
hash-manifest update flow. (Two narrow exemptions DID survive into v2 — see
"Audit exemptions (implementation)" above.)

## Setup-flow inputs (not rules, recorded in the Agent Base marker)

- `githubCodeReview: true|false` — asked during setup (D-3); drives R-09/R-49.
- Path-scoping choice: rules (default) or nested-compat — drives R-52/R-53 vs
  R-13..R-16 and the R-45 nested key.
