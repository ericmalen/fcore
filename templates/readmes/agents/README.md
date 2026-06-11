# Agents

Specialized roles both Claude Code and GitHub Copilot (VS Code) can delegate
to. One agent = one responsibility.

Conventions (enforced by `base-check`): kebab-case filenames; a one-line role
statement opening the body; `description` saying what the agent does and when
to delegate; an explicit `tools:` list (omitting it grants ALL tools); `##
Procedures` and `## Never` sections; `## Documents` listing plain
repo-root-relative paths (no Markdown links — agents lazy-load these).

To author a new agent, run the `agent-creator` skill. Run the `base-check`
skill to audit this folder against the full rule set.
