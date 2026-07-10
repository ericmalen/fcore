# Built-in Reference

What ships out of the box with VS Code + GitHub Copilot — no customization
required. This is the "what do I get for free" doc. For customization (custom
instructions, prompts, agents, skills), see
[`copilot-customization-reference.md`](./copilot-customization-reference.md).

VS Code releases weekly, so treat specifics as a starting point and verify
against the official docs if something looks off.

---

## Built-in slash commands

Type `/` in the Chat view to see what's available in your current surface.
Availability varies: some commands only run in VS Code, some only in Copilot
CLI, some in both.

| Command                                | What it does                                                                                                         | Where                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `/init`                                | Generate a repo-wide `.github/copilot-instructions.md` tailored to the codebase. fcore uses `AGENTS.md` instead — move the generated content into `AGENTS.md` and delete the generated file. | VS Code, Visual Studio |
| `/create-prompt`                       | Generate a `.prompt.md` file from a description — not part of fcore's surface (R-54: cross-tool slash commands ship as `user-invocable` skills) | VS Code                |
| `/create-skill`                        | Generate a skill folder with `SKILL.md`                                                                              | VS Code                |
| `/create-agent`                        | Generate a `.agent.md` file                                                                                          | VS Code                |
| `/plan`                                | Switch to the Plan agent                                                                                             | VS Code                |
| `/skills`                              | Open the Configure Skills menu                                                                                       | VS Code                |
| `/compact`                             | Compress conversation history to free context                                                                        | VS Code, Copilot CLI   |
| `/troubleshoot`                        | Diagnose why instructions, skills, or agents didn't behave as expected. Accepts `#session` for past-session analysis | VS Code                |
| `/autoApprove` (a.k.a. `/yolo` in CLI) | Toggle auto-approve for the current session                                                                          | VS Code, Copilot CLI   |
| `/clear`                               | Clear chat history                                                                                                   | VS Code                |
| `/delegate`                            | Hand off to a cloud agent (background)                                                                               | Copilot CLI            |
| `/fix`                                 | Fix errors in selected code                                                                                          | VS Code                |
| `/tests`                               | Generate tests for selected code                                                                                     | VS Code                |
| `/explain`                             | Explain selected code                                                                                                | VS Code                |
| `/new`                                 | Scaffold a new project                                                                                               | VS Code                |

User-invocable skills (from `.claude/skills/`) appear in the same `/` menu —
that is fcore's cross-tool slash-command mechanism (R-54).

> **Note:** fcore ships meta-skills named `/skill-creator` (Anthropic's
> official authoring tool) and `/agent-creator` — distinct from VS Code's
> built-in `/create-skill` and `/create-agent` above. fcore's versions
> follow Anthropic's spec and this project's conventions; VS Code's
> built-ins generate generic files.

---

## Built-in agents

The agents that ship with Copilot. Custom agents from `.claude/agents/` appear
in the same picker.

| Agent           | What it does                                                                             |
| --------------- | ---------------------------------------------------------------------------------------- |
| Agent (default) | General-purpose agent with full tool access                                              |
| Ask             | Q&A without code edits — read-only by design                                             |
| Plan            | Produces an implementation plan and saves it to session memory                           |
| ~~Edit~~        | Deprecated — use Agent mode for multi-file edits                                         |

---

## Built-in tools

Tools available to agents, in Copilot's native `category/tool` namespace; the
bare parent name (e.g. `search`) grants the whole category. Note: fcore
agents use **Claude tool names** in `tools:` (R-29) — this table is the
Copilot-native vocabulary those names are mapped onto. VS Code releases
weekly and the list evolves — confirm against the
[Custom Agents docs](https://code.visualstudio.com/docs/copilot/customization/custom-agents)
if a tool doesn't resolve.

| Tool                                | Purpose                                           |
| ----------------------------------- | ------------------------------------------------- |
| `read` / `read/readFile`            | Read files                                        |
| `search` / `search/codebase`        | Semantic codebase search (uses `#codebase` index) |
| `search/changes`                    | Changes since last commit                         |
| `search/usages`                     | Find references to a symbol                       |
| `edit` / `edit/editFiles`           | Modify files                                      |
| `execute` / `execute/runInTerminal` | Run terminal commands                             |
| `execute/createAndRunTask`          | Create and run a VS Code task                     |
| `todos`                             | Maintain an agent task list                       |
| `agent` / `agent/runSubagent`       | Invoke subagents                                  |
| `read/problems`                     | Read diagnostics from the Problems panel          |
| `githubRepo`                        | Cross-repo GitHub code search                     |
| `web` / `web/fetch`                 | Fetch web content                                 |

Copilot enforces a 128-tool-per-request cap. Large tool sets are auto-managed
via `github.copilot.chat.virtualTools.threshold`.

---

## Context mechanisms (`#` mentions)

Explicit context additions. Typing `#` opens a picker.

| Mention              | Adds to context                           |
| -------------------- | ----------------------------------------- |
| `#file:path`         | A specific file                           |
| `#codebase`          | Semantic codebase search results          |
| `#selection`         | Current editor selection                  |
| `#symbol:name`       | A specific symbol                         |
| `#terminalSelection` | Terminal output selection                 |
| `#session`           | A past chat session (for `/troubleshoot`) |
| `#problems`          | Current diagnostics                       |
| `#changes`           | Pending / uncommitted changes             |

---

## Chat participants (`@` mentions)

Built-in participants that route queries to specialized handlers. Custom agents
appear in the same `@` menu.

| Participant  | Purpose                                                                  |
| ------------ | ------------------------------------------------------------------------ |
| `@github`    | GitHub-specific queries (issues, PRs, repos)                             |
| `@terminal`  | Terminal-focused help                                                    |
| `@vscode`    | VS Code feature help                                                     |
| `@workspace` | Workspace-scoped queries (largely superseded by `#codebase` in agent mode) |

---

## Keyboard shortcuts (VS Code)

| Shortcut (macOS / Win-Linux) | Action                               |
| ---------------------------- | ------------------------------------ |
| `⌃⌘I` / `Ctrl+Alt+I`         | Open Chat view                       |
| `⌘I` / `Ctrl+I`              | Inline chat                          |
| `⌘N` / `Ctrl+N` (in chat)    | New chat session                     |
| `⇧⌘I` / `Ctrl+Shift+I`       | Switch to agent mode                 |
| `Shift+Tab`                  | Cycle permission / Accept-edits mode |
| `Alt+/`                      | Inline chat alternative              |

---

## Session types

| Type                     | Where it runs                                              | Best for                                   |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------------ |
| Local                    | In VS Code with full workspace access                      | Interactive work, iteration                |
| Copilot CLI (background) | Local machine, background, optional Git worktree isolation | Well-defined tasks you don't need to watch |
| Cloud                    | Remote, creates PRs                                        | Team collaboration, long-running tasks     |

---

## Permission levels

| Level                 | Behavior                                             |
| --------------------- | ---------------------------------------------------- |
| Default Approvals     | Prompts before destructive actions                   |
| Bypass Approvals      | Skips confirmations; still stops at explicit gates   |
| Autopilot _(preview)_ | Self-approves, retries on errors, runs to completion |

Cycle with `Shift+Tab` in an active chat session.

---

## Settings worth knowing

Short list of non-customization settings. The customization-related settings
(instructions, prompts, agents, skills) live in
[`copilot-customization-reference.md#recommended-workspace-settings`](./copilot-customization-reference.md#recommended-workspace-settings) — not duplicated here.

| Setting                                            | What it does                                           |
| -------------------------------------------------- | ------------------------------------------------------ |
| `chat.disableAIFeatures`                           | Kill switch for all Copilot features                   |
| `chat.autopilot.enabled`                           | Enable the Autopilot permission level                  |
| `chat.agent.thinking.collapsedTools`               | Collapse tool call details in the chat view            |
| `github.copilot.chat.virtualTools.threshold`       | Auto-manage large tool sets (>128)                     |
| `chat.planAgent.defaultModel`                      | Default model for the Plan agent                       |
| `github.copilot.chat.implementAgent.model`         | Model for implementation handoffs                      |
| `chat.tools.terminal.enableAutoApprove`            | Auto-approve terminal commands (use with care)         |

---

## Resources

- [GitHub Copilot (VS Code) overview](https://code.visualstudio.com/docs/copilot/overview)
- [Chat](https://code.visualstudio.com/docs/copilot/chat/copilot-chat)
- [Agent Mode](https://code.visualstudio.com/docs/copilot/chat/chat-agent-mode)
- [Slash Commands](https://code.visualstudio.com/docs/copilot/reference/copilot-vscode-features)
- [Keyboard Shortcuts Reference](https://code.visualstudio.com/docs/getstarted/keybindings)
- [Copilot CLI](https://docs.github.com/copilot/using-github-copilot/github-copilot-in-the-cli)
