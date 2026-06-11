# Workflow Tips

Practices for getting the most out of a customized Copilot system. This is the
opinionated companion to [`built-in-reference.md`](../reference/built-in-reference.md):
that doc describes what exists, this one recommends how to use it. Not a
general prompt engineering guide — scoped to working with agent-base's
conventions.

---

## Model selection

- **Plan with a heavy model, implement with a cheaper one.** Planning benefits
  disproportionately from reasoning depth; implementation is often mechanical
  once the plan exists. Set `chat.planAgent.defaultModel` for the Plan agent
  and `github.copilot.chat.implementAgent.model` for the handoff target.
- **Pin models in agent and skill frontmatter when stability matters.**
  Specify `model:` in the asset if its behavior is sensitive to model drift.
- **Adjust thinking effort for reasoning models.** Use the thinking-effort
  submenu in the model picker — turn it up for complex tasks, down for trivial
  ones.
- **Experiment.** Different models produce meaningfully different output for
  the same prompt. If a response is off, switch models before rewriting the
  prompt.

---

## Plan before you implement

- **Use the Plan agent for anything non-trivial.** It produces a structured
  plan saved to session memory. Review and refine before handing off.
- **Plan-first prevents solving the wrong problem.** Most bad agent output
  isn't bad implementation — it's implementation of the wrong thing. Catching
  that at the plan stage is cheap.
- **Hand off with context intact.** Plan in a local session, then hand off —
  run the task in Copilot CLI in the background, or use `/delegate` (from
  Copilot CLI) to send it to a cloud agent that runs in the background and
  ends in a PR for async review.
- **Don't expect the plan to persist.** Session memory clears when the
  conversation ends. Save important plans to disk before closing the session.

---

## When to use which session type

- **Local session** for interactive work, iteration, and anything needing
  VS Code-specific tools.
- **Copilot CLI (background)** for well-scoped tasks you don't need to watch.
  Use `git worktree` isolation so background work doesn't clash with your main
  workspace.
- **Cloud agent** for team-collaborative work that should end in a PR. Best
  for tasks that benefit from async review.
- **Parallel sessions are cheap.** Run multiple on independent tasks at once.

---

## Permission levels — pick deliberately

- **Default** for exploratory work or new agent configurations. You want to
  see what it tries.
- **Bypass Approvals** once an agent is proven. Skips confirmation noise
  without losing explicit gates.
- **Autopilot** only for scripted orchestrations with known-good agents. Not
  for exploration.

---

## Context management

- **`#file:` beats `#codebase`** when you know what's relevant. Explicit
  context is always higher signal than semantic retrieval.
- **Use `#codebase` for exploration**, not when you've already identified the
  files.
- **`/compact` before the context fills.** Response quality drops noticeably
  before the hard limit. Compact earlier than you think you need to.
- **`/clear` when switching tasks.** Don't carry irrelevant context into a new
  problem; start fresh.

---

## Iterating on AI output

- **Review before accepting.** AI output is a starting point. Pay particular
  attention to edge cases, error handling, and assumptions.
- **Run tests after AI changes.** Include test cases in the prompt so the
  agent verifies its own work.
- **Use checkpoints to rewind.** When the agent goes off track, roll back to
  a known-good state rather than chasing cascading fixes.
- **Short iterations beat long ones.** A 5-minute loop with fast feedback
  produces better output than a 30-minute monolithic prompt.

---

## When something misbehaves

- **Reach for `/troubleshoot` first.** It analyzes agent debug logs and
  surfaces why instructions were ignored, responses were slow, or tools
  weren't used. Pass `#session` to analyze a past session.
- **Check the Chat Customizations diagnostics view.** Right-click in the chat
  view → Diagnostics. Shows loaded instruction files and any errors.
- **If a skill doesn't activate, check the description.** The description
  drives auto-activation. Rewriting it to include both _what it does_ and
  _when to use it_ is often enough.

---

## Working with custom agents

- **Use the built-in Plan agent for planning**, not your custom ones. Reserve
  custom agents for task-specific personas.
- **Keep the tool list minimal.** Every tool granted is a way the agent can
  go off-script. See the tool tiers in [`conventions.md`](../reference/conventions.md#minimal-tool-lists).
- **Handoffs outperform megathinking agents.** A Plan → Implement → Review
  chain outperforms a single "do everything" agent.

---

## Using the meta-skills in agent-base

- **Start with `/skill-creator` and `/agent-creator`.** The meta-skills
  encode the conventions operationally; using them gives you a correct
  starting point.
- **Review what the meta-skill produces before committing.** Meta-skills are
  a starting point, not a rubber stamp. Tweak frontmatter descriptions and
  trim where needed.
- **Extract from conversations.** After a productive chat session,
  `/skill-creator` can extract a reusable skill from what you just did. Often
  better than starting from scratch.

---

## Keeping the config conformant

- **Run the `base-check` skill at any time** to audit the repo's AI
  configuration against the conventions ([`conventions.md`](../reference/conventions.md))
  and fix findings by rule ID.
- **If a file is doing two jobs, split it.** One role per agent, one workflow
  per skill, one scope per rules file — apply it as maintenance, not just at
  creation time.

---

## Resources

- [VS Code Best Practices](https://code.visualstudio.com/docs/copilot/best-practices)
- [VS Code Agent Planning](https://code.visualstudio.com/docs/copilot/chat/chat-agent-mode#_plan-and-iterate)
- [`built-in-reference.md`](../reference/built-in-reference.md) — what ships for free
- [`copilot-customization-reference.md`](../reference/copilot-customization-reference.md) — how to customize
- [`conventions.md`](../reference/conventions.md) — agent-base's do-and-don't sheet
