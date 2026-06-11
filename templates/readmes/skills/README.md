# Skills

On-demand knowledge for AI tools. Each skill is a folder directly under
`.claude/skills/` containing a `SKILL.md` (flat — neither Claude Code nor
Copilot discovers nested skill folders).

Conventions (enforced by `base-check`): frontmatter `name` matches the folder
name; `description` says what the skill does AND when to use it (≤ 1,024
chars); `SKILL.md` stays under 200 lines and links sibling `references/`,
`examples/`, `scripts/` files with Markdown links so they load on demand.

To author a new skill, run the `skill-creator` skill. Run the `base-check`
skill to audit this folder against the full rule set.
