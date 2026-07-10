# Setting up a repository with FleetCore

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

At most you type one `npx` command. The AI resolves FleetCore, installs the
tooling, and runs every script itself.

## Starting a NEW project (starter)

Emit the clean target state directly:

```sh
npx github:ericmalen/fcore#v2.1.1 init /path/to/new-repo --git
# or, from a clone:
node ~/tools/fcore/scripts/build-starter.mjs /path/to/new-repo --git
```

Fill in AGENTS.md and you're done. No AI session required. The starter ships
the same permanent baseline as a full setup — all baseline skills plus the
docs-auditor agent — so it is born current for `sync-baseline`. (FleetCore's
CI publishes the same output as a build artifact named `starter`, if you'd
rather download than run the script.)

## Setting up an EXISTING repo (or a new one, equivalently)

From your repo root:

```sh
npx github:ericmalen/fcore#v2.1.1 onboard
```

This stages the release at a stable path, then hands off down a chain:

1. **Claude Code CLI on your PATH** (running in a real terminal, not a
   script) → it launches `claude` right in your repo with setup already
   started. Answer its questions; that's it.
2. **No `claude` (Copilot users, Windows)** → it drops a one-shot
   `/fcore-bootstrap` launcher skill into the repo (untracked, deletes
   itself on use). Open Claude Code or Copilot (agent mode) in the repo and
   type `/fcore-bootstrap`.
3. **Fallback** → it prints the exact prompt to paste into your AI session.

`--no-launch` skips step 1; `--print` skips 1 and 2 (never writes to the
repo — the release is still staged).
Non-GitHub hosting uses the `git+<https-url>#<tag>` spec form — see the
[CLI reference](../reference/fcore-cli.md).

Prefer zero terminal? Paste ONE prompt instead:

> Clone https://github.com/ericmalen/fcore into a temp folder
> and follow its .claude/skills/fcore-onboard/SKILL.md to set up this repository.

Either way that's the whole setup. The AI installs the tooling, commits it,
and starts the four-phase flow below. The setup-time tooling is removed again
before merge; what stays is the permanent baseline — the `fcore-check`, `docs-manager`,
`git-conventions`, `skill-creator`, and `agent-creator` skills; the
orchestration lifecycle skills `checklist-intake`, `log-report`, `eval-runner`, and
`tracker-sync` (dormant until orchestration generation creates their
surfaces); and the `docs-auditor` agent.

**Working from a clone (FleetCore development, or fallback):** keep a clone
(`git clone <url> ~/tools/fcore`), open it in your tool, and say
`/fcore-onboard /path/to/repo`. The skill freshens the clone, installs the
tooling into the target, and orchestrates all four phases from there.

**Copilot users:** Copilot will ask approval when the AI runs git/node — to
reduce prompts, allowlist `node .claude/fcore-onboard/scripts/*` and
read-only git verbs in `chat.tools.terminal.autoApprove`. Review the list
yourself — that is the point of it.

## The flow — four skills, four fresh sessions

| Session | Invoke | What happens | You decide |
|---|---|---|---|
| 1 | `fcore-inventory` | mechanical extraction of every AI surface + a sweep for buried AI instructions; setup branch created | — |
| 2 | `fcore-plan` | AI routes every piece of content (manifest); setup questions (Copilot review, path-scoping, optional lifecycle skills — default none) | **Gate 1:** approve the plan + risk report |
| 3 | `fcore-apply` | deterministic assembly; mechanical gates converge (check + audit) | — |
| 4 | `fcore-verify` | independent fresh-context verification (rubric + loss-hunt) | **Gate 2:** review report + diff, merge |

Each phase validates the previous one's committed artifacts, so sessions can
be days apart. Abort at any point by deleting the `fcore-onboard` branch —
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

- `fcore-check` (installed skill) is your drift checker — run it any time.
  It stays after merge alongside the rest of the permanent baseline: the
  `docs-manager`, `git-conventions`, `skill-creator`, and `agent-creator` skills and
  the `docs-auditor` agent. Its `references/lifecycle.md` is the full
  in-project "what next" map (deep sweeps, orchestration, refresh).
- Orchestration (a generated multi-agent team + `tasks.md` backlog) is
  **optional and evidence-driven** — most projects never need it. Once the
  repo has a code layer with a test command:
  `npx github:ericmalen/fcore#<pin> fleet-config` (pin from
  `.claude/fcore.json`). It runs FleetCore-side and is deliberately
  not installed into the project. See
  [orchestration-guide](./orchestration-guide.md).
- The orchestration lifecycle skills `checklist-intake`, `log-report`, `eval-runner`,
  and `tracker-sync` are optional (R-55) — not installed by default. Add any
  with `fcore skills add <name>` (list with `fcore skills list`);
  `fcore-fleet-config` installs all four automatically when you generate
  orchestration.
- Updating to a newer FleetCore release: use baseline sync, not a re-setup.
  `sync-baseline --check` flags a stale pin; `--report` shows the plan;
  `--upgrade` applies it — see [baseline-sync](./baseline-sync.md). The
  `fcore-update` skill (run from a fcore checkout, like `fcore-onboard` —
  `npx github:ericmalen/fcore#<new-tag> update` starts it)
  walks the full loop for you. Re-run the full setup flow only for
  major/breaking changes to routing or layout; your current state is just
  new existing-project input, protected by the same machinery.
- Review the diff with move-detection on:
  `git diff main...fcore-onboard --color-moved=zebra --find-copies-harder`
