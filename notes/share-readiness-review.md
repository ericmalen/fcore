# FleetCore — Share-Readiness Review

_2026-06-15 · Scope: full current state, weighted toward the **adopter experience** — a colleague who will set up their own repo with it and form a first impression._

_Basis: ran `npm test` (446 pass / 4 todo / 0 fail, ~2.4s), the three CI gates (`docs-consistency`, `rule-check-map`, self-audit `--strict` — all clean), and a four-lane review (first-run UX, docs, code, messaging/hygiene). Every load-bearing claim below was spot-checked against the code/docs._

## Verdict

The **engine is ready; the wrapper isn't.** Correctness, tests, architecture, and conventions are in excellent shape — this is not a quality problem. What stands between you and sharing is (1) the working copy is mid-surgery right now, and (2) the on-ramp assumes the reader already speaks FleetCore's vocabulary. Both are fixable in roughly a focused day, most of it in docs and CLI messaging rather than core logic.

## What's already strong (leave these alone)

- **Tests + gates are green.** 450 tests (446 pass, 4 todo, 0 fail) in ~2.4s; `docs-consistency`, `rule-check-map`, and self-audit `--strict` all report clean.
- **Clean architecture.** Zero-dependency Node ≥20; even the two largest modules (`scripts/lib/audit/checks.mjs` ~614L, `orchestration/schemas.mjs` ~597L) are well-sectioned, not sprawling.
- **No cruft.** No debug `console.log`, no commented-out code, no stray `TODO/FIXME`; code style is uniform (by hand).
- **Skills self-audited.** All 27 assets scored against a rubric (`reports/skill-audit.md`), most 14–15/15.
- **Reference docs are mature** and fully cross-linked (internal links resolve clean).

## At a glance

| # | Finding | Area | Effort |
|---|---|---|:--:|
| **P0 — before you share at all** | | | |
| 1 | Working copy is mid-surgery (dirty feature branch + nested worktree) | Hygiene | XS |
| 2 | README first screen is dense and self-contradicts the value prop | Docs/Messaging | S |
| 3 | No getting-started tutorial for setup (only orchestration has one) | Docs | M |
| 4 | "adopt/adoption" contradicts terminology rule; key terms undefined | Docs/Messaging | S |
| **P1 — before sharing broadly** | | | |
| 5 | CLI fails late & deep — no pre-flight checks (near-P0) | UX | S |
| 6 | Auto-launch drops newcomers into an agent session with no framing | UX | S |
| 7 | Exit-code contract violated by 3 scripts | Code | S |
| 8 | Three arg-parsing dialects, one unsafe + one off-style | Code | M |
| 9 | No CONTRIBUTING.md | Messaging | S |
| **P2 — polish** | | | |
| 10 | 4 todo tests are gaps in the security-critical verifier path | Code | M |
| 11 | No formatter/linter (style enforced by hand) | Code | XS |
| 12 | `.gitignore` misses `.DS_Store`, `node_modules/`, `.claude/worktrees/` | Hygiene | XS |
| 13 | No README badges | Messaging | XS |
| 14 | Orchestration dominates the consumer docs tree | Docs | S |
| 15 | Minor code nits (stderr success line; marker field leak) | Code | XS |
| 16 | `notes/skill-workspaces/` — confirm committed eval scaffolding is intentional | Hygiene | XS |

---

## P0 — before you share at all

**1. The working copy is mid-surgery.**
On branch `erm/fix/starter-build-findings` with 3 uncommitted files (`fcore-onboard/SKILL.md`, `bin/lib/bootstrap-skill.mjs`, `orchestration-first-run.md`), plus an **untracked full nested checkout** at `.claude/worktrees/erm+fix+setup-pipeline-r3/` (git itself reports it `prunable`). Anyone you hand the folder to sees in-progress work and a confusing repo-inside-a-repo; it also double-matches local greps.
*Fix:* commit or stash the 3 files, `git worktree prune` (or `git worktree remove`) the nested checkout, then share from a clean `main` or a tagged release — not this branch. (Pairs with #12.)

**2. The README first screen doesn't land the pitch — and contradicts itself.**
"What this is" (`README.md:5–13`) is a ~110-word block mixing rule catalog + four-phase pipeline + baseline skills + optional orchestration before the reader knows what the tool *is*. Meanwhile `docs/explanation/why-this-way.md:45` declares the "headline feature… **skills-as-tooling**" — a different answer to "what is this." A colleague deciding whether to adopt bounces off the density and gets two mental models.
*Fix:* open with one plain sentence (e.g. *"FleetCore scaffolds and maintains a shared Claude Code + Copilot config in any repo, from one set of files"*), then 3–4 short bullets. Demote orchestration to a single "Advanced" line. Make `why-this-way.md` echo the README lead rather than introduce a competing headline.

**3. There is no getting-started tutorial for the main action.**
`docs/tutorials/` contains exactly one file — `orchestration-first-run.md`, the *optional/advanced* feature on test fixtures. The thing 100% of colleagues will do (set up their own repo) has only how-to/reference prose. This is the single highest-leverage missing doc for an adoption audience.
*Fix:* add `docs/tutorials/first-setup.md` — a linear walkthrough on a throwaway repo showing the actual terminal output, the two questions, and both approval gates. Link it as the first README "Next steps" item and from Quick start.

**4. "adopt/adoption" breaks the project's own vocabulary rule, and key terms are undefined.**
`docs/reference/terminology.md:41` flags "adopt/adoption (as pipeline nouns)" as retired vocabulary — yet the most-read guide's H1 is **"# Adopting fcore in a repository"** (`docs/how-to/setup-guide.md:1`), and the term recurs in `orchestration-first-run.md`, `orchestration-copilot-parity.md`, and `spec/rules.md`. Separately, load-bearing jargon — **slot, payload, drift, marker** — appears in README/AGENTS but has no row in `terminology.md`. A tool whose whole pitch is *enforced conventions* visibly breaking its own vocabulary rule is exactly what a careful adopter notices.
*Fix:* retitle the guide ("Setting up fcore in a repository"), sweep remaining `adopt → set up`, add `terminology.md` rows for slot/payload/drift/marker, and link terminology.md near the top of the README. (Also sweep prose that writes the slug `fcore` where the style guide mandates the display name "FleetCore.")

## P1 — before sharing broadly

**5. The CLI fails late and deep — add pre-flight checks.** *(borderline P0)*
`bin/fcore.mjs:89–124` validates only the target path. Node ≥20, "is this a git repo," and "is the tree clean" are enforced much later, *inside* `fcore-inventory` — after Claude Code has already launched. A colleague on older Node, or in a non-git/dirty dir, runs the headline command, watches an agent boot, and only then gets stopped.
*Fix:* a cheap pre-flight in the LLM-entry branch (`process.versions.node`, `git rev-parse`, `git status --porcelain`) that exits 2 with a plain message *before* staging/launch. Promote this to P0 if your colleagues' environments vary.

**6. Auto-launch drops a newcomer into an agent session with almost no framing.**
`launchNotice` is one line; then the screen clears and an agent starts creating branches/commits from a `~/.fcore/versions/…` path the user has never heard of. `fallbackInstructions` opens with *"Nothing in your repo runs until an AI session picks this up"* (`bin/lib/prompts.mjs:38`) — which reads like something broke. The staged-release dir appears in `$HOME` with no "safe to delete" note, and Windows always silently takes the fallback path while the README presents auto-launch as the default.
*Fix:* expand `launchNotice` to 2–3 lines of expectations (works on a branch — nothing merges; ~2 questions, 2 approval gates; Ctrl-C aborts); reword the fallback to lead with the action (*"Setup is staged. To start: open your AI tool in this repo and type `/fcore-bootstrap`"*); append "(cached build; safe to delete)" to the staged notice; add a one-line Windows note.

**7. The exit-code contract is violated by three scripts.**
The bin header promises "2 = usage error" and most scripts honor it, but usage/precondition failures exit `1` in `scripts/install-setup.mjs`, `scripts/build-starter.mjs`, and `scripts/build-fixture.mjs`. `install` and `starter` are advertised commands, so a script can't distinguish a usage mistake from a real failure.
*Fix:* use `exit(2)` for argv/usage/precondition in those three; reserve `1` for "ran fine, found problems" (the `audit`/`check`/`report` convention).

**8. Three arg-parsing dialects — one unsafe, one off-style.**
`apply.mjs`/`check.mjs` use a `value()` helper that hard-stops on a missing flag value (good — these have destructive paths); `audit`/`report`/`inventory-extract`/`headless-guard` use bare `args[++i]` (a trailing `--root` silently becomes cwd); `docs-consistency.mjs:88` uses `indexOf` with no validation and is the **only file in the repo using double quotes**.
*Fix:* lift `check.mjs`'s `value()`+loop into `scripts/lib/cli-args.mjs` and use it everywhere; convert `docs-consistency.mjs` to single quotes.

**9. No CONTRIBUTING.md.**
For a tool meant to be adopted and extended by colleagues, there's no "clone → `npm test` (needs Node ≥22) → branch/PR → cut a release" entry point. `release-baseline.md` exists but isn't framed as contribution.
*Fix:* a short `CONTRIBUTING.md` linking `docs/how-to/release-baseline.md`. (CODE_OF_CONDUCT optional for an internal share.)

## P2 — polish

**10. The 4 `todo` tests are real gaps in the security-critical path.** `test/seeded-defects.test.mjs:367–370` — the verifier "sabotage matrix": unjustified drop, dilution rewrite in a merge literal, bogus out-of-scope ruling, and a **prompt-injection fixture**. These prove the verifier catches an adversarial/compromised plan — exactly what a tool that rewrites repo config should demonstrate. *Fix:* implement them, or convert to a tracked issue with a code comment so they don't read as abandoned.

**11. No formatter/linter.** Style is impressively uniform by hand; a contributor's first PR will drift. Add a Prettier config or `.editorconfig`. *Highest-leverage P2 if colleagues will contribute.*

**12. `.gitignore` gaps.** Add `.DS_Store`, `node_modules/`, and `.claude/worktrees/`. The repo ships a `.gitignore` audit rule (R-47), so its own is on display.

**13. No README badges** (MIT / Node ≥20 / tests). Cheap credibility for a "450 tests pass" tool.

**14. Orchestration dominates the consumer docs tree** (~7 of ~19 docs) for a feature most adopters will skip, and `docs/how-to/orchestration-pilot.md` is an internal *process* doc sitting in consumer `how-to/`. Gate orchestration behind one "Advanced" README line; move the pilot doc out of `docs/`.

**15. Minor code nits.** `headless-guard.mjs:58` prints its *success* summary to stderr (mixed with machine stdout); `sync-baseline.mjs:226` manually strips `present`/`invalid` bookkeeping fields before writing the marker — consider `readMarker` returning `{present, invalid, data}` so the parsed content is cleanly separable.

**16. `notes/skill-workspaces/`** (~90 committed files of eval scaffolding) is the one "is this meant to be here?" directory a browser hits. Confirm it's intentional or relocate it.

---

## Recommended sequence

1. **Phase 0 — shareable today (~30 min):** #1 + #12. Clean the tree, prune the worktree, fix `.gitignore`. After this you can hand the folder to anyone without embarrassment.
2. **Phase 1 — make it land (~½–1 day):** #2, #3, #4 (impression + on-ramp) and #5, #6 (first-run). This is the bulk of the perceived-quality win and the part a new colleague actually feels.
3. **Phase 2 — engineering hygiene (~½ day):** #7, #8, #9, #11, then the remaining P2s as time allows.

## One strategic note

The deepest UX risk isn't any single string — it's **conceptual surface area.** In the first few minutes a newcomer meets npx-vs-clone, baseline/pin/drift/marker, dual-role assets, *and* an entire optional orchestration system. The highest-leverage move is to ruthlessly foreground the 80% path — *set up my repo, see value* — and demote everything else (orchestration especially) to clearly-labeled "advanced." Most of the P0/P1 doc fixes above are just instances of that one principle.
