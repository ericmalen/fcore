# Agents and skills — orchestration inventory

What exists in the Agent Base repo, what setup installs into every target, and
what orchestration generation materializes per repo.

## Agent Base-side only (never installed)

Run from an open base checkout. Entry skill: `base-orchestrate`.

### Meta-agents

| Agent | Phase | Role |
| --- | --- | --- |
| `repo-analyst` | Discovery | Profile target → `repo-profile.json` |
| `requirements-interviewer` | Discovery | Policy Q&A → `decisions.json` |
| `plan-synthesizer` | Discovery | Synthesize → `blueprint.json` |
| `scaffolder` | Generation | Instantiate blueprint into target |
| `evaluator` | Quality | Pre-distribution gate + periodic review |

### Meta-skills

| Group | Skills |
| --- | --- |
| Discovery | `structure-detector`, `dependency-mapper`, `convention-detector`, `interview-guide`, `blueprint-generator`, `handoff-validator` |
| Generation | `agent-instantiator`, `skill-instantiator` |
| Quality | `drift-checker` (`eval-runner` is an optional lifecycle skill — see below) |

### Entry skills (Agent Base-only)

| Skill | Role |
| --- | --- |
| `base-setup` | Setup pipeline entry |
| `base-refresh` | Baseline upgrade loop (sync-baseline → audit) |
| `base-orchestrate` | Orchestration discovery + generation entry |
| `validate-setup` | End-to-end setup qualification |
| `validate-orchestration` | End-to-end orchestration behavior qualification (routing, completion protocol) — live sessions, not the unit test suite |

## Installed at setup (every target)

Shipped per the allowlist in `scripts/lib/baseline.mjs` (consumed by
`scripts/install-setup.mjs`).

### Agents

| Agent | Window |
| --- | --- |
| `docs-auditor` | Permanent |
| `setup-verifier` | Setup only (removed before merge) |

### Skills

| Skill | Notes |
| --- | --- |
| `base-check` | Permanent maintenance |
| `base-inventory`, `base-plan`, `base-apply`, `base-verify` | Setup window |
| `docs`, `git-conventions`, `agent-creator`, `skill-creator` | Permanent baseline |
| `retro`, `log-report`, `eval-runner`, `tracker-sync` | Optional lifecycle (R-55) — opt-in, not in the default baseline; selected at setup, added via `agent-base skills add`, or installed by `base-orchestrate`. Operate on orchestration surfaces. |

## Generated per target (orchestration only)

Present after `scaffolder` runs against an approved blueprint. Recorded in
`docs/orchestration/generation-manifest.json`. Never hand-edit — fix the
blueprint or Agent Base template and re-scaffold.

### Agent templates

| templateId | Typical name | Paired skills (blueprint) |
| --- | --- | --- |
| `orchestrator` | `feature-orchestrator` | — |
| `generic-specialist` | `<layer>-engineer` | `pairedSkills[]` — stack-conditional |
| `code-reviewer` | `code-reviewer` | — |
| `qa-agent` | `qa-agent` | — |
| `security-reviewer` | `security-reviewer` | — |

Roster, slot values, and `pairedSkills` come from `blueprint.json` — one
engineer specialist per CODE layer (always `generic-specialist`), plus
policy-driven reviewers. Optional stack skills (`ui-component-pattern`,
`api-testing`, `db-migration`) attach via `pairedSkills`, at most once per
blueprint.

### Payload docs (copied to `docs/orchestration/`)

| Doc | Role |
| --- | --- |
| `dispatch-rules.md` | Tier selection from `scope:` layer count |
| `tasks-format.md` | `tasks.md` grammar |
| `handoff-logging.md` | JSONL handoff log fields |
| `agent-teams.md` | Claude Code agent-team tier |
| `triage-rules.md` | Route findings to the right asset |
| `README.md` | Ownership, update flow, rollback |

## Authoring new agents and skills

Use `agent-creator` and `skill-creator` for **hand-authored** additions in any
repo. Orchestration **generated** agents follow a separate path: edit Agent Base
templates under `templates/orchestration/` or adjust the blueprint, then
re-run `scaffolder`.
