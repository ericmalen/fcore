# Your first setup

A hands-on walkthrough: set up a throwaway repo end to end so you can see
exactly what Agent Base does — the two questions it asks, the two approval
gates, and what it leaves behind — without risking a real project.

For the task-oriented version (flags, Copilot/Windows paths, the clone
workflow), see the [setup guide](../how-to/setup-guide.md). Unfamiliar words are
defined in [terminology](../reference/terminology.md).

## What you need

- **Node ≥ 20** (the AI runs it — you never will) and **git**.
- **Claude Code** on your PATH, or **GitHub Copilot in agent mode** in VS Code.
- A throwaway repo to practice on (next step).

## 1. Make a throwaway repo

```sh
mkdir agent-base-demo && cd agent-base-demo
git init -q
printf '# Demo\n' > README.md
git add -A && git commit -q -m "initial"
```

The working tree must be **clean** (everything committed) before setup — Agent
Base refuses to run on a dirty tree so its own changes stay reviewable.

## 2. Start setup

```sh
npx github:ericmalen/agent-base#v1.2.1 setup
```

What happens, in order:

1. The release is **staged** to `~/.agent-base/versions/v1.2.1/` (a cached
   build — safe to delete later).
2. If the `claude` CLI is on your PATH, Agent Base launches Claude Code right
   here with setup already started. No CLI (Copilot or Windows)? It drops a
   one-shot `/agent-base-bootstrap` skill into the repo and prints a prompt —
   open your AI tool in the repo and type `/agent-base-bootstrap` to begin.

Either way you land in an AI session that drives the next four phases, working
on a dedicated `agent-base-setup` branch — **nothing touches `main` until you
merge.**

## 3. Phase 1 — inventory

The session runs `base-inventory`: it mechanically catalogs every existing AI
surface (there are almost none in a fresh repo) and creates the setup branch.
Nothing to decide here.

## 4. Phase 2 — plan (Gate 1)

`base-plan` proposes how each piece of content maps into the standard layout,
then asks the **two setup questions**:

- **GitHub code review?** — whether to install the `.github/` AI code-review
  surfaces. Say no for this demo.
- **Path-scoping mechanism?** — `.claude/rules/` (the default) vs nested
  `AGENTS.md` pairs. Take the default.

Then you reach **Gate 1**: review the proposed plan and its risk report, and
approve. This is a real stop — read what it intends to do before continuing.

## 5. Phase 3 — apply

`base-apply` assembles the files deterministically and runs its own checks
(`check` + `audit`) until they converge. No input needed.

## 6. Phase 4 — verify (Gate 2)

`base-verify` re-checks the result in a fresh context — a rubric pass plus a
loss-hunt — and hands you **Gate 2**: a review report and a diff. Inspect it
with move-detection on:

```sh
git diff main...agent-base-setup --color-moved=zebra --find-copies-harder
```

Merge when you're satisfied. Want to bail instead? Delete the
`agent-base-setup` branch — your repo is untouched.

## What you're left with

A repo on the **standard layout**: `AGENTS.md` plus a `CLAUDE.md` shim, a
`.claude/` home shared by both tools, and the **permanent baseline** — the
`base-check`, `docs`, `git-conventions`, `skill-creator`, and `agent-creator`
skills and the `docs-auditor` agent. (The orchestration-lifecycle skills are
optional, R-55 — opt in with `agent-base skills add` or let `base-orchestrate`
install them.) The setup-time tooling has removed itself.

Run `base-check` any time to audit for **drift**, and `sync` to pull a newer
baseline release — see [baseline sync](../how-to/baseline-sync.md).

## Next steps

- [Setup guide](../how-to/setup-guide.md) — the full task reference (flags,
  Copilot/Windows, clone workflow).
- [CLI reference](../reference/agent-base-cli.md) — every `agent-base` command.
- [Terminology](../reference/terminology.md) — canonical vocabulary.
- [Workflow tips](../how-to/workflow-tips.md) — practical day-to-day guidance.
- [Orchestration guide](../how-to/orchestration-guide.md) — optional, once
  your repo has its first tested code layer.
