# Adopting agent-base in a repository

How to set up a repo (new or existing) for AI-assisted coding with both
Claude Code and GitHub Copilot (VS Code), using the setup tooling.

## What you need

- The repo in **git**, with a **clean working tree**
- **Node ≥ 20** present on your machine (the AI runs it — you never will)
- Claude Code, or Copilot in **agent mode** (skills do not load in
  non-agent modes such as Ask)

Any OS where git and Node run — macOS, Linux, Windows. The tooling is
zero-dependency Node invoked as `node <script>.mjs` (shell-agnostic, no
bash required); the only external command it spawns is `git`. The CI
templates run on hosted Ubuntu runners, not your machine.

At most you type one `npx` command. The AI resolves Agent Base, installs the
tooling, and runs every script itself.

## Starting a NEW project (starter)

Emit the clean target state directly:

```sh
npx github:ericmalen/agent-base#v1.1.0 starter /path/to/new-repo --git
# or, from a clone:
node ~/tools/agent-base/scripts/build-starter.mjs /path/to/new-repo --git
```

Fill in AGENTS.md and you're done. No AI session required. (Agent Base's CI
publishes the same output as a build artifact named `starter`, if you'd
rather download than run the script.)

## Setting up an EXISTING repo (or a new one, equivalently)

From your repo root:

```sh
npx github:ericmalen/agent-base#v1.1.0 setup
```

This stages the release at a stable path, then hands off down a chain:

1. **Claude Code CLI on your PATH** → it launches `claude` right in your
   repo with setup already started. Answer its questions; that's it.
2. **No `claude` (Copilot users, Windows)** → it drops a one-shot
   `/agent-base-bootstrap` launcher skill into the repo (untracked, deletes
   itself on use). Open Claude Code or Copilot (agent mode) in the repo and
   type `/agent-base-bootstrap`.
3. **Fallback** → it prints the exact prompt to paste into your AI session.

`--no-launch` skips step 1; `--print` skips 1 and 2 (touches nothing).
Non-GitHub hosting uses the `git+<https-url>#<tag>` spec form — see the
[CLI reference](../reference/agent-base-cli.md).

Prefer zero terminal? Paste ONE prompt instead:

> Clone https://dev.azure.com/&lt;org&gt;/agent-base/_git/agent-base into a temp folder
> and follow its .claude/skills/base-setup/SKILL.md to set up this repository.

Either way that's the whole setup. The AI installs the tooling, commits it,
and starts the four-phase flow below. The setup-time tooling is removed again
before merge; what stays is the permanent baseline — the `base-check`, `docs`,
`git-conventions`, `skill-creator`, and `agent-creator` skills; the
orchestration lifecycle skills `retro`, `log-report`, `eval-runner`, and
`tracker-sync` (dormant until orchestration generation creates their
surfaces); and the `docs-auditor` agent.

**Working from a clone (Agent Base development, or fallback):** keep a clone
(`git clone <url> ~/tools/agent-base`), open it in your tool, and say
`/base-setup /path/to/repo`. The skill freshens the clone, installs the
tooling into the target, and orchestrates all four phases from there.

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
  the orchestration lifecycle skills `retro`, `log-report`, `eval-runner`,
  and `tracker-sync`; and the `docs-auditor` agent.
- Updating to a newer Agent Base release: use baseline sync, not a re-setup.
  `sync-baseline --check` flags a stale pin; `--report` shows the plan;
  `--upgrade` applies it — see [baseline-sync](./baseline-sync.md). The
  `base-refresh` skill (run from a base checkout, like `base-setup` —
  `npx github:ericmalen/agent-base#<new-tag> refresh` prints the prompt)
  walks the full loop for you. Re-run the full setup flow only for
  major/breaking changes to routing or layout; your current state is just
  new existing-project input, protected by the same machinery.
- Review the diff with move-detection on:
  `git diff main...agent-base-setup --color-moved=zebra --find-copies-harder`
