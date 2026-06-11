---
name: agent-creator
description: "Walks the user through creating a new custom agent that conforms to this project's conventions — lean role statement, minimal tools list, explicit boundaries, lazy-load Documents section, Claude subagent format in .claude/agents/. Use whenever the user wants to create, add, or set up a custom agent, specialized role, reviewer, implementer, or orchestrator — even when they describe it as a 'persona,' 'role,' or 'assistant' rather than using the word 'agent.'"
argument-hint: "[agent role in one sentence]"
---

# Create Agent

## Purpose

Scaffold a new custom agent that conforms to this project's conventions —
minimal tools, explicit boundaries, lazy-load `## Documents` section. Agents go
in `.claude/agents/` using the Claude subagent format, which both Claude Code
and Copilot read.

## Workflow

1. Ask the user:
   1. **What role does the agent play?** (one sentence).
   2. **Is it read-only, or does it edit files?**
   3. **Does it need to execute terminal commands?**
   4. **What docs should it consult?**
2. Determine the `tools` list by starting from the tiers in
   [tool-tiers](./references/tool-tiers.md) —
   read-only, editor, executor, orchestrator — and grant the minimum set. Do
   not add tools "just in case." Use **Claude tool names** (`Read, Grep, Glob,
   Bash, Edit, Write`) as a comma-separated list; Copilot maps them to its own
   tools automatically. Omitting `tools` grants all tools.
3. Generate the agent file at `.claude/agents/{name}.md` using
   [`./templates/agent.template.md`](./templates/agent.template.md).
4. Compose the role statement: one line — what the agent does **and** what it
   never does.
5. Fill `## Procedures` with numbered steps the agent follows.
6. Fill `## Never` with explicit boundaries. A read-only agent's Never list
   should always include "modify any file."
7. Fill `## Documents` with **plain-text paths** (not Markdown links). This is
   a project convention: the agent reads documents on demand via the Read
   tool, never up-front. Plain-text paths also visually distinguish agent
   Documents sections from skill bodies (which use Markdown links for
   progressive disclosure).
8. **Read the generated file back to the user** — especially the role
   statement, tools list, and boundaries. These are the three fields a small
   mistake damages most.
9. Tell the user how to try the agent: in Claude Code, delegate to it by name;
   in Copilot, pick it from the agent picker. Both discover `.claude/agents/`
   automatically.

## Conventions checklist

- [ ] One agent, one responsibility.
- [ ] Tools list is minimal — do not grant what isn't needed.
- [ ] `## Documents` uses plain-text paths, not Markdown links.
- [ ] Body avoids inlining knowledge; it points to docs, not restates them.
- [ ] Role statement names what the agent never does.
- [ ] Frontmatter sticks to fields both tools understand, or Claude-only fields
      that Copilot safely ignores — see `.claude/agents/README.md`.

## Flat orchestration reminder

agent-base prefers flat orchestration: orchestrators call every specialist
directly. Nesting is possible but compounds token cost and is harder to debug —
it should be a deliberate choice. If this agent is part of an orchestrated
workflow, default to having the orchestrator call it directly rather than
chaining it under another specialist.

## References

- [Custom agents in agent-base](../../agents/README.md)
- [Tool tiers](./references/tool-tiers.md)
