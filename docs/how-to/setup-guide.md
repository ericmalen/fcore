# Adopting agent-base in a repository

How to set up a repo (new or existing) for AI-assisted coding with both
Claude Code and GitHub Copilot (VS Code), using the setup tooling.

## What you need

- The repo in **git**, with a **clean working tree**
- **Node ≥ 20** present on your machine (the AI runs it — you never will)
- Claude Code, or Copilot in **agent mode** (skills do not load in
  non-agent modes such as Ask)

You never type a terminal command. The AI clones the kit, installs the
tooling, and runs every script itself.

## Starting a NEW project (starter)

Emit the clean target state directly from a Agent Base clone:

```sh
node ~/tools/agent-base/scripts/build-starter.mjs /path/to/new-repo --git
```

Fill in AGENTS.md and you're done. No AI session required. (The kit's CI
publishes the same output as a build artifact named `starter`, if you'd
rather download than run the script.)

## Setting up an EXISTING repo (or a new one, equivalently)

Open Claude Code or Copilot (agent mode) in your repo and paste ONE prompt:

> Clone https://dev.azure.com/&lt;org&gt;/agent-base/_git/agent-base into a temp folder
> and follow its .claude/skills/base-setup/SKILL.md to set up this repository.

That's the whole setup. The AI installs the tooling, commits it, and starts
the four-phase flow below. The setup-time tooling is removed again before
merge; what stays is the permanent baseline — the `base-check`, `docs`,
`git-conventions`, `skill-creator`, and `agent-creator` skills; the
orchestration lifecycle skills `retro`, `log-report`, and `eval-runner`
(dormant until orchestration generation creates their surfaces); and the
`docs-auditor` agent.

**Repeat users:** keep a Agent Base clone (`git clone <url> ~/tools/agent-base`), open
it in your tool, and say `/base-setup /path/to/repo`. The skill freshens
the clone, installs the tooling into the target, and orchestrates all four
phases from there.

**Copilot users:** Copilot will ask approval when the AI runs git/node — to
reduce prompts, allowlist `node .claude/agent-base-setup/scripts/*` and
read-only git verbs in `chat.tools.terminal.autoApprove`. Review the list
yourself — that is the point of it.

## The flow — four skills, four fresh sessions

| Session | Invoke | What happens | You decide |
|---|---|---|---|
| 1 | `base-inventory` | mechanical extraction of every AI surface + a sweep for buried AI instructions; setup branch created | — |
| 2 | `base-plan` | AI routes every piece of content (manifest); two setup questions | **Gate 1:** approve the plan + risk report |
| 3 | `base-apply` | deterministic assembly; mechanical gates converge (check + audit) | — |
| 4 | `base-verify` | independent fresh-context verification (rubric + loss-hunt) | **Gate 2:** review report + diff, merge |

Each phase validates the previous one's committed artifacts, so sessions can
be days apart. Abort at any point by deleting the `agent-base-setup` branch —
your repo is untouched until YOU merge.

## What the gates guarantee (honestly)

- Content routed as `move`/`split` is **conserved by construction** — scripts
  copy the original bytes; the AI never re-types it.
- Content that is `drop`ped or `merge`d (rewritten) is **visible and
  reviewed, not prevented**: full text of every drop and a side-by-side of
  every rewrite appear in your review report, risk-ordered, and an
  independent verifier pass hunts for losses before you see it.
- Nothing outside AI-config surfaces is touched (mechanically enforced), and
  generated files must reproduce byte-identically from the manifest — there
  is no "editing around the system".

## After setup

- `base-check` (installed skill) is your drift checker — run it any time.
  It stays after merge alongside the rest of the permanent baseline: the
  `docs`, `git-conventions`, `skill-creator`, and `agent-creator` skills;
  the orchestration lifecycle skills `retro`, `log-report`, and `eval-runner`;
  and the `docs-auditor` agent.
- Updating to a newer Agent Base release: use baseline sync, not a re-setup.
  `sync-baseline --check` flags a stale pin; `--report` shows the plan;
  `--upgrade` applies it — see [baseline-sync](./baseline-sync.md). The
  `base-refresh` skill (run from an Agent Base clone, like `base-setup`)
  walks the full loop for you. Re-run the full setup flow only for
  major/breaking changes to routing or layout; your current state is just
  new existing-project input, protected by the same machinery.
- Review the diff with move-detection on:
  `git diff main...agent-base-setup --color-moved=zebra --find-copies-harder`
