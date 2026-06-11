# Agent Base orchestration — Complete Build Plan

Repo-agnostic agent/skill orchestration system, built in `agent-base` and distributed
through the existing setup installer (`scripts/install-setup.mjs` allowlist).
Discovery runs from an open Agent Base clone against a target path — same pattern as
`base-setup`. Verification targets are the repo fixtures (§9.5):
`test/fixtures/maxi-repo` (4-layer monorepo: ui / api / db / shared) and
`test/fixtures/mini-repo`; no acceptance ever runs against a real external repo.
All decisions below are final for v1; deviations require editing this doc first
(single source of truth). This is a build plan, not a living spec: when a phase
lands, its durable conventions graduate to `spec/rules.md` R-IDs (R-51) with
audit coverage (`rule-check-map`), and the corresponding DD becomes historical.

**Phase status (2026-06-11):** A–E complete and merged to `main`. Phase F in
progress — lifecycle skills (`retro`, `log-report`, `eval-runner`) ship to every
adopted repo; `spec/target-layout.md` documents the conditional orchestration
layer; discovery/generation meta-assets deliberately stay Agent Base-side (the
`base-setup` pattern). F1-remaining (self-serve docs), F3 (tracker bridge,
extended to GitHub parity per DD-14), and F4 (headless, both platforms per
DD-15) are being built; F2 pilot and the F4 live run remain human-executed
exit gates.

---

## 1. Locked design decisions

| #     | Decision                                                                                                                                                                                                | Rationale                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| DD-1  | Semantic work happens **only** in Discovery (Layer 1) and Execution (Layer 3). Generation (Layer 2) is **deterministic template instantiation** — slot-filling from blueprint values, no LLM authoring. | Preserves deterministic/semantic boundary; outputs are reproducible and SHA-recorded in the generation manifest (C4). |
| DD-2  | All structured artifacts are **JSON validated by zero-dependency validator modules** (error-string-array style, per `scripts/lib/manifest.mjs` `validateShape`); human-facing companions are Markdown **rendered deterministically from the JSON** — never authored in parallel. | Matches Agent Base's zero-dependency Node `.mjs` convention; one validation mechanism everywhere; single source of truth per artifact. |
| DD-3  | Work intake is a **`tasks.md` backlog file** in the project (spec in §9.2). No external tracker in v1; the Phase F tracker bridge (DD-14) makes the tracker **intake only** — `tasks.md` stays the canonical execution state.                                                               | Versioned with code, zero new tooling, agent-readable.                                                                 |
| DD-4  | Dispatch rule (encoded in blueprint, spec in §9.3): 1–2 layers touched → in-session subagents; 3+ layers or cross-repo → agent team; multi-day/scheduled → headless pipeline (Phase F only).            | Encodes the tiering decision instead of per-session judgment.                                                          |
| DD-5  | Template slot syntax is `<!-- agent-base:slot:name -->` (kebab-case) — same marker vocabulary as setup, but instantiation lives in a **separate module**, `scripts/lib/orchestration/instantiate.mjs`. Adoption's `template.mjs` does line-anchored *block routing* (lenient empty-string fill) and stays untouched; orchestration needs **inline scalar substitution** (slot values inside sentences/tables) plus **strict fill** — any unfilled slot fails instantiation with error-string-array reporting. Never ship a template literal. | Shares Agent Base's slot vocabulary without destabilizing the load-bearing setup module; inline semantics are a different operation from block routing; deterministic, grep-able, trivially testable. |
| DD-6  | Generated assets land in the target's `.claude/agents/` and `.claude/skills/` **only** — the shared home both Claude Code and Copilot read (R-49). No `.github/` mirrors; `spec/target-layout.md` lists `.github/agents|skills/` as deliberately absent.                                        | One set of files, two tools — matches Agent Base's dual-tool model; no second instantiation pass to drift.                |
| DD-7  | Discovery/generation outputs live in project at `docs/orchestration/` (`repo-profile.json`, `decisions.json` + rendered `decisions.md`, `blueprint.json`, `generation-manifest.json`).             | Docs serve human and agent audiences; lazy-loaded via `## Documents` sections.                                         |
| DD-8  | Flat orchestration only: feature-orchestrator calls all specialists directly. No nested subagents. **Parity caps at the subagent tier:** the agent-team tier (DD-4, D4) is Claude Code-only — on Copilot, every scope count runs the subagent path.                                              | Copilot constraint; keep Claude Code identical for parity at the flat tier; the team tier is a documented Claude-only extension, not silent divergence. |
| DD-9  | Tests: Node built-in test runner via `npm test` (`node --test "test/**/*.test.mjs"`, Node ≥ 22; shipped scripts stay Node ≥ 20), pure functions only (validators, slot-filling, renderers, parsers). Agent behavior is checked by evals, not unit tests.                                        | Matches Agent Base's existing test setup and testing scope.                                                               |
| DD-10 | Every shipped bug or substantive review finding becomes a checklist item via the `retro` skill (§7, Phase E). No exceptions.                                                                            | The compounding quality loop; Agent Base's long-term asset.                                                               |
| DD-11 | **One writer at a time on shared state.** During execution sessions, only the orchestrator writes `tasks.md` AND `handoff-log.jsonl`; specialists report results in their final message (in-session subagents) or via the team task list (agent teams); the orchestrator applies status changes and appends every log entry. As of F3, the `tracker-sync` skill is the **second authorized writer of `tasks.md`** — at intake/report boundaries only, never concurrently with an orchestrator session (preconditions: clean working tree, no active orchestrator session — human-attested when run manually, guaranteed by step ordering in headless pipelines). Sync writes via parse → mutate → render → validate. `handoff-log.jsonl` remains orchestrator-only.            | Prevents write contention on both shared files when agent teams run multiple concurrent sessions (Phase D); concurrent multi-session appends to one jsonl are not safe. Serialized turn-taking preserves the contention guarantee while letting intake flow in. |
| DD-12 | Repo-agnosticism is enforced from Phase B onward: every discovery-pipeline acceptance runs against **both** fixtures: maxi-repo and mini-repo (§9.5).                                                 | Prevents overfitting discovery skills to a 4-layer monorepo; keeps the core portability claim honest before Phase F.   |
| DD-13 | The per-target **generation manifest** (`docs/orchestration/generation-manifest.json`: generated file → template id, pinned template version, SHA) is orchestration-scoped state written by the scaffolder. It is **not** the setup routing manifest and **not** a revival of v1 sync machinery — its scope is exclusively Agent Base-generated orchestration files. **The manifest — not the blueprint — owns the version pins:** the scaffolder owns the manifest entirely, Discovery owns `blueprint.json` entirely; one writer per artifact, no machine-managed fields inside Discovery outputs. | Drift detection (E3) and update (C5) need a recorded baseline; keeping it separate preserves the v2 "no sync layer" stance for setup; single ownership keeps re-scaffolds from mutating their own input. |
| DD-14 | **Tracker bridge is directional, not a mirror** (F3): tracker items in intake state import as Backlog tasks (with `ref:` provenance, §9.2); task status pushes out to the tracker (state + comment); conflicts are reported, never auto-resolved; dry-run is the default, writes require `--apply`. Transports: **ADO = zero-dependency REST via `fetch` + PAT env var** (`ADO_ORG`/`ADO_PROJECT`/`AZURE_DEVOPS_PAT`) — a recorded deviation from the original "ADO MCP server" wording of F3: MCP needs interactive client config and cannot run in the F4 headless pipelines, while REST is unit-testable and reuses §9.4's no-custom-server posture. **GitHub = `gh` CLI** (GitHub Issues parity is a scope extension of the original ADO-only F3). Imports land with `scope: triage` + a `blocked:` line so the orchestrator can never dispatch an unscoped import. | One pure sync-plan core (`computeSyncPlan`) with thin per-platform adapters; tasks.md stays canonical (DD-3); zero-dependency and headless-reusable; no bidirectional field merge to drift. |
| DD-15 | **Headless execution is a thin pipeline shell over pure guard logic** (F4): both `templates/ci/orchestrator-run.{github,ado}.yml` install the Claude CLI (`npm i -g @anthropic-ai/claude-code`) and run `claude -p` against the generated feature-orchestrator with `ANTHROPIC_API_KEY` from platform secrets; run/skip decisions live in `scripts/lib/orchestration/headless-guard.mjs` (unit-tested); a run ends at branch push + PR creation — **never merge** (D5 preserved). The two templates stay structurally paired like `audit-strict.{github,ado}.yml`. | Pipelines themselves can't be unit-tested; pushing every decision into a pure module plus paired-structure tests keeps the YAML trivially reviewable on both platforms. |

---

## 2. Asset inventory (end state)

**Meta layer (lives in this repo; dual-role assets in `.claude/`, shipped to targets
per the `scripts/install-setup.mjs` allowlist — same mechanism as the setup
skills):**

- Validators (one module, `scripts/lib/orchestration/schemas.mjs`): `repo-profile`, `decisions-doc`, `orchestration-blueprint`, `task-backlog`, `handoff-log`, plus F3's `sync-plan` and `tracker-sync-config`
- Pure functions (`scripts/lib/orchestration/`): `parseTasksMd`, `renderDecisionsMd`, strict inline instantiation in `instantiate.mjs` (DD-5; `scripts/lib/template.mjs` untouched), `deriveDispatchOrder`/`renderDispatchOrder` in `dispatch-order.mjs` (provider-first dispatch order from profile edges), F3's `computeSyncPlan`/`applyImports` in `tracker-sync.mjs` + adapter helpers in `tracker-ado.mjs`/`tracker-gh.mjs`, F4's `decideHeadlessRun` in `headless-guard.mjs`
- Meta-agents (5, `.claude/agents/`): `repo-analyst`, `requirements-interviewer`, `plan-synthesizer`, `scaffolder`, `evaluator`
- Meta-skills (13, `.claude/skills/`): `structure-detector`, `dependency-mapper`, `convention-detector`, `interview-guide`, `blueprint-generator`, `handoff-validator`, `agent-instantiator`, `skill-instantiator`, `eval-runner`, `drift-checker`, `retro`, `log-report`, `tracker-sync` (F3)
- Templates (`templates/orchestration/`): 1 orchestrator template, 6 specialist templates (`ui-engineer`, `api-engineer`, `db-engineer`, `code-reviewer`, `qa-agent`, `security-reviewer`), 1 generic specialist template (fallback for repo shapes the six don't cover), skill templates per specialist
- Docs payload (`templates/orchestration/docs/`): `dispatch-rules.md`, `tasks-format.md`, `handoff-logging.md`, `triage-rules.md` — copied by the scaffolder into target `docs/orchestration/` iff referenced by a generated asset
- Fixtures (§9.5): `test/fixtures/maxi-repo` (4-layer monorepo verification target), `test/fixtures/mini-repo` (single-package repo-agnosticism guard)

**Generated per project (not shipped):**

- `feature-orchestrator` + specialists per blueprint (in `.claude/agents|skills/`, DD-6)
- `tasks.md`, `docs/orchestration/*` (incl. `generation-manifest.json`, `checklists/review-checklist.md`, `evals/<agent>/`) — no new repo-root directories beyond `tasks.md`

---

## 3. Repo layout (agent-base additions)

Existing zones are reused — no new top-level directories. `templates/` internal
paths stay load-bearing (`instructions/` untouched); `templates/orchestration/`
rides into targets inside `.claude/agent-base-setup/templates/` via the existing
wholesale copy in `install-setup.mjs`. Pre-F1 that ride-along is harmless
dead weight: `.claude/agent-base-setup/` is setup-time tooling that
`base-verify` removes before merge, so non-piloting adoptees never keep it.

```
agent-base/
├── scripts/lib/
│   ├── template.mjs               # existing; untouched (setup block routing)
│   └── orchestration/
│       ├── schemas.mjs            # 5 validators, validateShape-style (DD-2)
│       ├── instantiate.mjs        # strict inline slot fill (DD-5)
│       ├── render-decisions.mjs   # decisions.json → decisions.md (pure)
│       └── parse-tasks.mjs        # tasks.md parser (pure)
├── templates/orchestration/
│   ├── agents/                    # *.template.md with <!-- agent-base:slot:name --> markers
│   ├── skills/
│   └── docs/                      # dispatch-rules.md, tasks-format.md,
│                                  # handoff-logging.md, triage-rules.md
├── .claude/
│   ├── agents/                    # 5 meta-agents (dual-role: live here + allowlisted)
│   └── skills/                    # 12 meta-skills (dual-role; per-asset shipping
│                                  # decided in install-setup.mjs, Phase F1)
└── test/
    ├── fixtures/maxi-repo/        # 4-layer monorepo fixture (§9.5)
    ├── fixtures/mini-repo/        # single-package fixture (§9.5); test/ never ships
    └── orchestration-*.test.mjs   # node --test: validators, instantiator, renderer, parsers
```

Note (AGENTS.md "Do Not"): meta-agents/skills in `.claude/` auto-load while
developing Agent Base — that is wanted here, since discovery/generation runs from a
Agent Base clone against targets and fixtures (the `base-setup` pattern). Only
frontmatter descriptions enter context, so the cost is ~12 description lines —
kept tightly orchestration-scoped (§9.1) to avoid trigger collisions. Which
meta-skills ship to targets is decided per-asset in the allowlist at F1.

---

## Phase A — Contracts

**Goal:** every downstream layer compiles against these. Nothing else starts until A is done.

| Step | Work                                                                                                                                                                                                                                                                                                                    | Deliverable                                                    | Acceptance                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| A1   | Write `repo-profile` validator: repo name, type (mono/multi), layers[] (name, path, stack, test cmd, build cmd), internal dependency edges internalEdges[] (`{from: consumer, to: provider}` layer names; `[]` when none), package manager, CI system, conventions (naming, branching, commit style), detected gaps[]                                                                                                             | `validateRepoProfile` in `scripts/lib/orchestration/schemas.mjs` + unit tests | Validates hand-written maxi-repo **and** mini-repo profile fixtures; rejects 3 malformed fixtures                      |
| A2   | Write `decisions-doc` validator: TDD policy, review gates, security requirements, QA depth, definition-of-done, human-gate placement, each field with finite enum values. Includes `renderDecisionsMd` pure function: `decisions.json` → `decisions.md` (DD-2)                                                          | `validateDecisionsDoc` + `scripts/lib/orchestration/render-decisions.mjs` + tests | Fixture validation as A1; renderer is deterministic (same input → byte-identical output) and covers every schema field |
| A3   | Write `orchestration-blueprint` validator: specialists[] (name, template id, slot values, model tier, turn limit, tools[]), orchestrator config, **dispatch_rules** (DD-4 thresholds as data, plus derived `dispatch_order`: provider-first topological order of layer names computed from profile internalEdges via `deriveDispatchOrder`; `[]` = no internal ordering constraints), docs to reference, eval requirements per agent. **No version pins — those live in the generation manifest (DD-13)**. Model tier is an enum of logical tiers (`haiku \| sonnet \| opus`), never concrete model ids — the scaffolder (C4) owns the tier→model map     | `validateBlueprint` + tests                                    | Validates a hand-written blueprint fixture; rejects 3 malformed fixtures (full-instantiation check lives in C3/C4)     |
| A4   | Write `task-backlog` validator + `templates/orchestration/docs/tasks-format.md` per §9.2                                                                                                                                                                                                                                | Validator + doc + parser (`parseTasksMd`) with tests           | Parser round-trips the §9.2 example losslessly                                                                         |
| A5   | Write `handoff-log` validator: timestamp, from-agent, to-agent, task id, artifacts[], decision summary, duration_ms, status (success \| failed \| blocked), failure_reason, retry_count. **`model`, `turns_used`, `turn_limit` are optional** until capture is verified per runtime (see D7); required-ness revisited then | `validateHandoffLog` + tests                                   | Fixture validation incl. a failed-dispatch fixture and a fixture omitting the optional fields                          |
| A6   | Write `templates/orchestration/docs/dispatch-rules.md` (DD-4, expanded with examples from maxi-repo layers)                                                                                                                                                                                                             | Doc                                                            | Reviewed; referenced by orchestrator template                                                                          |

**Phase A done when:** all 5 validators export from `scripts/lib/orchestration/schemas.mjs`, all pure functions green under `npm test`, both docs written.

---

## Phase B — Discovery pipeline

**Goal:** point Agent Base at any repo, get a validated blueprint out. Semantic work lives here.

Per DD-12, every acceptance below runs against **two targets**: `test/fixtures/maxi-repo` and `test/fixtures/mini-repo`.

| Step | Work                                                                                                                                                                                                          | Deliverable                   | Acceptance                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| B0   | Create both fixtures per §9.5: `test/fixtures/maxi-repo` (4-layer npm-workspaces monorepo) and `test/fixtures/mini-repo` (tiny single-package Node CLI, deliberately different conventions)                                                       | Fixture repos                 | Both build, tests pass, committed under `test/fixtures/`                                                                                   |
| B1   | `structure-detector` skill: walk repo, identify layers/packages, stacks, test/build commands                                                                                                                  | Skill md (lazy-load doc refs) | Maxi-repo: detects ui/api/db/shared with correct stacks. Mini-repo: detects single package correctly                                   |
| B2   | `dependency-mapper` skill: internal package deps (→ profile `internalEdges[]`, durable — not chat-report-only), key external deps per layer                                                                   | Skill md                      | Maxi-repo: profile fixture carries ui→shared and api→shared edges, Prisma→db mapped correctly. Mini-repo: `internalEdges: []` without erroring |
| B3   | `convention-detector` skill: naming, branch, commit, lint/format config                                                                                                                                       | Skill md                      | Detects existing conventions and lists gaps on both targets; outputs differ where the fixtures differ                                  |
| B4   | `repo-analyst` agent: runs B1–B3, emits `docs/orchestration/repo-profile.json`, validates via A1 validator before writing                                                                                     | Agent md                      | Both targets produce profiles passing A1 validation with zero manual fixes                                                             |
| B5   | `interview-guide` skill: question bank keyed to profile gaps (TDD? gates? security posture? QA depth?). Every question maps to a `decisions-doc` field; no open-ended questions without a target field        | Skill md                      | Every decisions-doc field is reachable by at least one question                                                                        |
| B6   | `requirements-interviewer` agent: loads profile, asks only gap-driven questions, emits **`decisions.json` only** (canonical); `decisions.md` is produced by `renderDecisionsMd` (A2), never authored directly | Agent md                      | Maxi-repo run produces schema-valid decisions doc in one session; rendered .md matches renderer output byte-for-byte                   |
| B7   | `blueprint-generator` skill + `handoff-validator` skill (checks blueprint completeness: every specialist has all slots filled, dispatch rules present, eval requirements set)                                 | 2 skill mds                   | Validator rejects a blueprint with one missing slot                                                                                    |
| B8   | `plan-synthesizer` agent: profile + decisions → `blueprint.json`, computes `dispatch_rules.dispatch_order` from profile internalEdges via `deriveDispatchOrder` (pure, never hand-ordered), runs handoff-validator before writing | Agent md                      | Maxi-repo blueprint validates and names ≥4 specialists. Mini-repo blueprint validates and selects the generic specialist template (≥1) |

**Phase B done when:** full pipeline runs end-to-end on both targets and both blueprints pass A3 + B7 validation untouched.

---

## Phase C — Deterministic generation

**Goal:** blueprint in, working agent/skill files out, reproducibly. Zero LLM authoring (DD-1).

| Step | Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Deliverable                           | Acceptance                                                                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1   | Author templates: orchestrator + 6 specialists + generic fallback, each with `<!-- agent-base:slot:name -->` markers for: repo paths, stack names, test commands, conventions, doc references, model tier, turn limit                                                                                                                                                                                                                                                                                                                                                                                                                                                | `templates/orchestration/agents/*.template.md` | Slot lint: every slot name appears in blueprint schema; no orphan slots                                                                                  |
| C2   | Author skill templates per specialist (e.g., `api-testing`, `ui-component-pattern`) with same slot rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `templates/orchestration/skills/*.template.md` | Same slot lint                                                                                                                                           |
| C3   | `agent-instantiator` + `skill-instantiator` skills: pure slot substitution wrapped as skills, built on `scripts/lib/orchestration/instantiate.mjs` — inline-capable slot matching (mid-line markers), fails hard on any unfilled slot, error-string-array reporting (DD-5); `template.mjs` untouched; unit-tested                                                                                                                                                                                                                                                                                                                                                | Skills + `instantiate.mjs` + tests | Same blueprint → byte-identical output on repeat runs; an inline mid-line slot instantiates correctly. **The A3 blueprint fixture and both Phase B blueprints fully instantiate with zero manual edits** |
| C4   | `scaffolder` agent: reads blueprint, calls instantiators, writes target `.claude/agents/` + `.claude/skills/` (DD-6) and referenced docs to `docs/orchestration/`, records each generated file (template id, pinned version, SHA) in `docs/orchestration/generation-manifest.json` (DD-13)                                                                                                                                                                                                                                                                                                                                                                       | Agent md                              | Generation manifest lists every written file with matching SHAs; re-run is byte-identical; generated agents/skills pass the target audit (`node scripts/audit.mjs` — R-17..R-26, R-27..R-37) |
| C5   | Update flow (no CLI — re-run the `scaffolder` against the stored blueprint): when a template changes upstream, re-instantiation produces the updated asset; the generation manifest distinguishes clean regeneration from a user-edited file — on user edit, report the conflict and stop for human resolution (no sidecars; v2 dropped that machinery). Update bumps the pinned template version in the **generation manifest** (distinguishes "template improved" from "incompatible change" — major version bump requires explicit confirmation). **Ownership stays clean per DD-13: the scaffolder owns the manifest, Discovery owns the blueprint — re-scaffolds never mutate their own input. Documented in `docs/orchestration/` README.** Rollback = git revert of generated files; state this explicitly in generated orchestrator docs | Scaffolder behavior + tests           | Template edit → re-scaffold → regenerated file with version bump; user-edited file → conflict reported, nothing overwritten                              |

**Phase C done when:** the maxi-repo blueprint instantiates a complete agent set, generation-manifest-tracked, reproducible, updateable.

---

## Phase D — Execution loop

**Goal:** work flows from `tasks.md` through generated agents to merged commits.

| Step | Work                                                                                                                                                                                                                                                                                                                                                                                                                                 | Deliverable                     | Acceptance                                                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| D1   | Create `tasks.md` in the maxi-repo fixture per §9.2; seed with 3 backlog items of varying scope (1-layer, 2-layer, 3+-layer)                                                                                                                                                                                                                                                                                                                | File                            | Parses via A4 parser                                                                                                         |
| D2   | Orchestrator template (from C1) includes: read `tasks.md` → pick next Backlog item → apply dispatch rules → execute → update task status → **commit after every unit of work** → append handoff log. **Failure protocol:** on specialist failure, max 1 retry; on second failure the task returns to Backlog with an indented `blocked:` line referencing the handoff-log entry. Never silent retry loops. Write ownership per DD-11 | Behavior encoded in template    | 1-layer task completes end-to-end with status updates and commits; forced-failure test produces a `blocked:` Backlog entry   |
| D3   | Run the 2-layer task: orchestrator dispatches 2 specialists in-session (subagent path)                                                                                                                                                                                                                                                                                                                                               | Session run                     | Both layers changed, reviewer ran, task moved to Done                                                                        |
| D4   | Run the 3+-layer task via **Claude Code agent teams**: orchestrator session + per-layer sessions coordinating on shared task list. Only the orchestrator session writes `tasks.md` and `handoff-log.jsonl` (DD-11). Claude Code-only tier (DD-8). Document the exact invocation in `docs/orchestration/agent-teams.md`                                                                                                                                                                     | Doc + session run               | Cross-layer task completes; handoff log shows inter-agent negotiation points; `tasks.md` history shows single-writer commits |
| D5   | Human gate: nothing merges without review. Encode in orchestrator template: final step is "open PR / present diff, stop." Never auto-merge                                                                                                                                                                                                                                                                                           | Template rule                   | Verified on D2–D4 runs                                                                                                       |
| D6   | Structured handoff logging: the **orchestrator** appends every dispatch and return to `docs/orchestration/handoff-log.jsonl` (A5 schema). Single writer per DD-11 — specialists never append; in agent teams they report via the team task list and the orchestrator logs                                                                                                                                                            | Logging convention in templates | Log validates; one entry per dispatch in D3/D4 runs; D4 run shows only orchestrator-session commits touching the log         |
| D7   | **Verify optional A5 fields:** during D3/D4 runs, test whether `model`, `turns_used`, `turn_limit` are reliably capturable in Claude Code and Copilot. Promote to required in the schema only where capture is confirmed; otherwise they stay optional and `log-report` (E5) degrades gracefully                                                                                                                                     | Findings note + schema decision | Schema reflects verified reality; no field is required that a runtime can't populate                                         |

**Phase D done when:** all three seeded tasks shipped through the loop with logs, commits, and human-gated merges.

> **D7 findings (2026-06-11):** `model`, `turns_used`, `turn_limit` captured
> successfully in every Claude Code dispatch across the D3 (subagent) and D4
> (team) runs. Copilot capture remains unverified, so the fields stay
> **optional** in the A5 schema and `log-report` keeps its `n/a` degradation.
> Revisit if a Copilot run confirms capture.

---

## Phase E — Quality flywheel

**Goal:** the system improves from its own failures.

| Step | Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Deliverable                              | Acceptance                                                                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1   | `retro` skill: input = bug report or review finding; output = appended item in `docs/orchestration/checklists/review-checklist.md` (format: `- [ ] CHK-### (src: BUG-###/PR-###): <check>`); code-reviewer template references this checklist via lazy-load                                                                                                                                                                                                                                                                  | Skill + checklist file + template update | Feed it 2 seeded maxi-repo findings → 2 well-formed checklist items the reviewer applies on next run                                                           |
| E2   | `eval-runner` skill: per generated agent, 2–3 golden examples in `docs/orchestration/evals/<agent>/` (input task + expected-properties checklist, not exact output). **Tiered runs:** per-edit regression check = 1× smoke run of affected agents' goldens; **release gate (via E4) = each golden 5×, pass rate ≥ 4/5** (agents are stochastic — single passes are meaningless for gating). Any edit to a template or meta-skill triggers at least the smoke tier before the change lands                                    | Skill + maxi-repo eval fixtures          | All generated agents have ≥2 goldens; runner reports pass _rates_ at the 5× tier; a deliberate template regression is caught by the smoke tier pre-merge |
| E3   | `drift-checker` skill: re-instantiate from current templates + stored blueprint, diff against `generation-manifest.json` SHAs (DD-13); report template-drift vs user-edit separately. Also re-renders `decisions.md` via `renderDecisionsMd` and diffs against the committed copy (DD-2 gate — rendered companions never hand-edited)                                                                                                                                                                     | Skill                                    | Detects a deliberate template change, a deliberate user edit, and a hand-edited `decisions.md`; classifies all three correctly                           |
| E4   | `evaluator` agent: wraps E2 (full 5× tier) + E3, runs on demand and as pre-distribution gate                                                                                                                                                                                                                                                                                                                                                                                                              | Agent md                                 | One command yields full orchestration health report                                                                                                                |
| E5   | `log-report` skill: parse `handoff-log.jsonl` → summary per agent (dispatch count, failure rate, avg duration, turn utilization vs. limit where captured per D7)                                                                                                                                                                                                                                                                                                                                          | Skill                                    | Report runs over D-phase logs; flags any agent with failure rate > 20% or turn utilization > 80% (when available)                                        |
| E6   | Triage taxonomy + periodic review. Write `templates/orchestration/docs/triage-rules.md` routing every finding to the right asset: template defect → fix template (propagates everywhere via C5 re-scaffold); blueprint defect → re-run synthesizer; skill gap → new/edited skill; one-off → checklist item via retro. Evaluator gains a review mode: run over handoff logs + eval pass-rate history, propose fixes routed per taxonomy, human-gated. Cadence: after every ~10 completed tasks or before each Agent Base release, whichever first | Doc + evaluator update                   | A seeded mixed batch (1 template defect, 1 skill gap, 1 one-off) gets routed to the correct asset types                                                  |

**Phase E done when:** retro loop has produced ≥5 checklist items from real findings, one periodic review has run with at least one routed fix applied, and evaluator gates a release.

---

## Phase F — Scale-out

**Goal:** team distribution and unattended execution. Start only after E is in routine use.

| Step | Work                                                                                                                                                                                                                                                                                                                                                       | Deliverable         | Acceptance                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------- |
| F1   | **Partial (2026-06-11).** Extend `scripts/install-setup.mjs` with orchestration lifecycle skills (`retro`, `log-report`, `eval-runner`); add the conditional **orchestration layer** section to `spec/target-layout.md`. `templates/orchestration/` and `scripts/lib/orchestration/` ride along with the wholesale `templates/` + `scripts/lib/` copies (setup-time only; removed by `base-verify`). **Deferred:** shipping discovery/generation meta-agents/skills to targets — they stay Agent Base-side and run from an Agent Base clone (same pattern as `base-setup`; see `install-setup.mjs` header comment) | Allowlist entries + tests + spec section | **Done:** lifecycle skills install verbatim; `spec/target-layout.md` covers generated surfaces. **Remaining:** self-serve docs — per-session expected outputs, time budgets, Gate 1/2 checklists, pre-flight checklist in `docs/how-to/orchestration-guide.md`; failure modes + Copilot inline fallback in `docs/how-to/orchestration-troubleshooting.md` |
| F2   | Teammate pilot: one colleague runs Discovery → Generation on a second **real** repo using only the docs. Capture friction → retro items. Protocol, intervention-counting rules, and report template live in `docs/how-to/orchestration-pilot.md`; completed reports land in `reports/orchestration-pilot-<repo>-<date>.md`                                                                                                                                                                                                                    | Protocol doc + pilot report        | Blueprint + generated agents with ≤2 interventions from you; every friction row routed per the triage taxonomy |
| F3   | Tracker bridge (DD-14): `tracker-sync` skill + CLI sync `tasks.md` ↔ **ADO work items (zero-dep REST) and GitHub Issues (`gh` CLI)** — import intake items to Backlog, push status out. Pure core `scripts/lib/orchestration/tracker-sync.mjs` + adapters `tracker-ado.mjs`/`tracker-gh.mjs`; `ref:` provenance line (§9.2); ships via `BASELINE_COPIES`                                                                                                                                                                                                                    | Skill + CLI + lib modules + tests               | Sync-plan matrix (import / status-update / conflict classes / idempotence) green on fixtures; CLI dry-run + `--apply` round-trip on a temp maxi-repo copy; live `gh` smoke on a scratch issue                              |
| F4   | Headless execution (DD-15): `claude -p` running the generated orchestrator against `tasks.md` on a schedule, **both** `templates/ci/orchestrator-run.github.yml` and `orchestrator-run.ado.yml`, structurally paired; run/skip guard in `scripts/lib/orchestration/headless-guard.mjs`; audit trail = git history + handoff-log + pipeline logs. No custom server, ever (security posture). When team setup warrants fleet-level visibility, switch observability from jsonl reports to Claude Code's native OpenTelemetry export | Pipeline YAML ×2 + guard module + doc | Guard decision matrix + paired-structure tests green; scheduled run completes a seeded task and opens a PR (live exit gate)        |

**Phase F done when:** ≥2 teammates self-serve Agent Base and one scheduled pipeline run has shipped a PR.

**R-ID graduation candidates (record now, graduate after F2 pilot + F4 live
run land, per the "when a phase lands" rule):** one-writer-at-a-time on
`tasks.md` (amended DD-11); tracker-is-intake / tasks.md-canonical (DD-14);
never-auto-merge in orchestration CI templates (DD-15). Graduating mid-phase
would force `rule-check-map` audit coverage for behavior the pilot may still
reshape.

---

## 8. Build order & first milestone

```
A (contracts) → B (discovery) → C (generation) → D (execution) → E (quality) → F (scale)
```

**Thin-slice milestone (build this before finishing any phase fully):**
A1 + A3 (two validators) → minimal B4 analyst → hand-write a blueprint → C3 instantiator → generate one specialist → run it on one tiny maxi-repo task.
This validates the whole pipeline shape in days, not weeks. Then return to complete phases in order.

---

## 9. Appendices

### 9.1 Naming conventions

- Agents: `kebab-case` role nouns (`repo-analyst`) — R-27
- Skills: `kebab-case` capability nouns (`structure-detector`) — R-18
- Templates: `<name>.template.md`; slots `<!-- agent-base:slot:name -->`, kebab-case (DD-5)
- Validators: `validate<Name>` functions, all exported from `scripts/lib/orchestration/schemas.mjs`, error-string-array style per `scripts/lib/manifest.mjs` (strict instantiation in `instantiate.mjs` reports the same way, DD-5)
- Checklist items: `CHK-###`; tasks: `T-###`
- Design decisions: `DD-##`; phase steps: `<PhaseLetter><n>` (e.g., `B4`) — namespaces never collide
- Meta-skill trigger descriptions must be **orchestration-scoped** — generic names (`retro`, `log-report`, `drift-checker`) collide with project skills post-F1; the description, not the name, is what prevents mis-triggering

### 9.2 tasks.md format (canonical)

```markdown
# Tasks

## Backlog

- [ ] T-001 | scope: api, db | Add asset-tagging endpoint
  - AC: POST /assets/:id/tags validates via shared Zod schema
  - AC: Prisma migration included; integration test passes

## In Progress

- [~] T-002 | scope: ui | Bilingual toggle on catalogue page (owner: feature-orchestrator)

## Done

- [x] T-000 | scope: shared | Extract tag schema to types.ts (commit: abc1234)
```

Rules: one task per line + indented `AC:` lines; `scope:` lists layers touched (drives dispatch); orchestrator moves lines between sections and appends commit SHA on completion. Failed tasks return to Backlog with an indented `blocked:` line referencing the handoff-log entry. **One writer at a time: the orchestrator during execution, `tracker-sync` at intake/report boundaries (DD-11); specialists never touch it.**

Tracker provenance (F3, DD-14): a task imported from or linked to a tracker
item carries one indented `ref:` line — `  - ref: AB#123` (ADO) or
`  - ref: #45` (GitHub; `owner/repo#45` accepted for cross-repo). Max one per
task; canonical render order within a task is title, `ref:`, `AC:` lines,
`blocked:`. Imports land as `scope: triage` plus
`  - blocked: needs human scoping (imported from <ref>)` — the orchestrator
skips `blocked:` items, so an unscoped import is never dispatched; a human
sets the real scope and removes the `blocked:` line to activate it.

### 9.3 Dispatch rules (data form, lives in blueprint)

```json
{
  "subagent_max_scopes": 2,
  "agent_team_min_scopes": 3,
  "agent_team_on_cross_repo": true,
  "pipeline_when": ["scheduled", "multi_day"],
  "dispatch_order": ["shared", "ui", "api", "db"]
}
```

On Copilot, scope counts ≥ `agent_team_min_scopes` still run the subagent path
(DD-8 — the team tier is Claude Code-only).

`dispatch_order` is derived, never authored: `deriveDispatchOrder(layers,
internalEdges)` emits a provider-first topological order of all layer names
(tie-break: providers before non-providers, then profile layer order), or `[]`
when the profile has no internal edges (= no ordering constraints). The
orchestrator dispatches a multi-layer task's scope in this order, so providers
like `shared` always change before their consumers.

### 9.4 Out of scope for v1 (explicit)

- Custom orchestration server (permanently out — security posture)
- LLM-authored agent generation (revisit only if template coverage proves insufficient; would become migrator-agent-style semantic tooling in a later release)
- RAG over protected information (policy constraint)
- Model mixing across vendors

### 9.5 Repo fixture specs

Both fixtures live under `test/fixtures/` and never ship (`test/` is never
installed into targets). They ARE the verification targets — no acceptance
ever runs against a real external repo. Execution-phase runs (Phase D) operate
on a temp git copy of the fixture (copy + `git init`), never in-tree.

**maxi-repo** — multi-layer target:

- 4-layer npm-workspaces monorepo: ui (React + TypeScript + Vite), api
  (Express + TypeScript), db (Prisma + PostgreSQL), shared (TypeScript + Zod)
- Dependencies declared in manifests only — never installed; stub `build`
  scripts and Node-builtin tests keep Agent Base zero-dependency; `ui` and `api`
  declare the `shared` workspace package (the internal edges B2 must map)
- One trivial unit test per layer (Node test runner)
- Conventions: kebab-case files, PascalCase React components,
  `feature/<ticket>-<slug>` branches, conventional commits; inert
  `azure-pipelines.yml`
- Golden discovery outcome committed: `maxi-repo.profile.json`; synthesizer
  must name ≥4 specialists (B8)

**mini-repo** — single-package counterweight (DD-12 guard against overfitting
discovery to the monorepo shape):

- Single-package Node CLI, ~5 source files, no workspaces
- One unit test (Node test runner), one lint config
- Conventions deliberately different from maxi-repo: different branch naming,
  different commit style, no Prisma/React/Express, no CI
- Golden discovery outcome committed: `mini-repo.profile.json`; synthesizer
  must select the **generic specialist template**
