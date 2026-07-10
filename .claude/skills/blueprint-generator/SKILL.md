---
name: blueprint-generator
description: Orchestration discovery step B7 — the rulebook for synthesizing docs/orchestration/blueprint.json from a repo profile plus decisions doc, mapping layers to generic-specialist with optional paired skills, policies to reviewer/QA specialists, and defaults for tiers, turn limits, and tools. Use when synthesizing an orchestration blueprint (typically driven by the plan-synthesizer agent). Not for instantiating templates.
---

# blueprint-generator

Maps `repo-profile.json` + `decisions.json` onto a `blueprint.json`
(`validateBlueprint` shape). Deterministic rules, no taste calls — when a
rule does not cover the repo, use `generic-specialist` with `pairedSkills:
[]`; never invent.

## Specialist selection

One engineer specialist per CODE layer. Every layer uses `templateId:
generic-specialist`; stack evidence selects optional `pairedSkills`:

| Layer evidence (stack/deps) | pairedSkills |
| --- | --- |
| React / Vue / frontend build tool | `["ui-component-pattern"]` |
| HTTP server framework (Express, Fastify, …) | `["api-testing"]` |
| ORM / migrations (Prisma, …) | `["db-migration"]` |
| anything else | `[]` |

**Dedup rule:** each skill id may appear on at most one specialist per
blueprint. If a second layer matches the same skill, assign `[]` and report
the collision in synthesis output — do not silently duplicate.

Policy-driven additions from `decisions.json`:

- always: `code-reviewer` (every `reviewGates` value needs one)
- `qaDepth` ≥ `unit-and-integration`: `qa-agent`
- `securityRequirements` ≠ `none`: `security-reviewer`

Always: one `feature-orchestrator` (templateId `orchestrator`).

Names are derived, not invented — the same inputs must yield the same
roster: engineer specialists are `<layer-name>-engineer` (layer name from
the profile, e.g. `frontend-engineer`, `shared-engineer`, `cli-engineer`);
policy agents keep their templateId as name (`code-reviewer`, `qa-agent`,
`security-reviewer`); the orchestrator is always `feature-orchestrator`.

## Slot values (from the profile, per agent)

Engineer specialists: `layer-path`, `stack`, `test-cmd` (the layer's
fields; a `null` testCmd blocks synthesis — report, don't invent),
`manifest-path` (the layer's `manifestPath`; a `null` manifestPath blocks
synthesis the same way — report, don't invent), `conventions` (joined from
`conventions.*`, omitting nulls).
`code-reviewer`: `checklist-path`
(`docs/orchestration/checklists/review-checklist.md`), `conventions`.
Orchestrator: `tasks-path` (`tasks.md`), `handoff-log-path`
(`docs/orchestration/handoff-log.jsonl`), `dispatch-doc`
(`docs/orchestration/dispatch-rules.md`).

## Defaults

| Agent | modelTier | turnLimit | tools |
| --- | --- | --- | --- |
| engineer specialists | sonnet | 30 (20 when db-migration paired) | Read, Grep, Glob, Edit, Write, Bash |
| code-reviewer / security-reviewer | opus | 15 | Read, Grep, Glob |
| qa-agent | sonnet | 20 | Read, Grep, Glob, Bash |
| feature-orchestrator | opus | 60 | Read, Grep, Glob, Edit, Write, Bash, Agent |

`evalRequirements.minGoldens: 2` everywhere. `dispatch_rules` defaults:
`{"subagent_max_scopes": 2, "agent_team_min_scopes": 3,
"agent_team_on_cross_repo": true, "pipeline_when": ["scheduled",
"multi_day"]}`. `dispatch_rules.routing_policy` copies
`decisions.orchestrationRouting` (`always` | `threshold` | `manual`),
defaulting to `threshold` when absent; it drives the always-loaded routing
block at generation (R-56). `dispatch_rules.dispatch_order` is DERIVED, never
hand-ordered: `deriveDispatchOrder(profile.layers, profile.internalEdges)`
in [dispatch-order.mjs](../../../scripts/lib/orchestration/dispatch-order.mjs);
`[]` when the profile
has no edges; a cycle is an error — stop and report, don't reorder.
`docs`: dispatch-rules.md, tasks-format.md, handoff-logging.md,
agent-teams.md, triage-rules.md (under `docs/orchestration/`). Never set
`templateVersion` — pins live in the generation manifest.

## Gate

Run handoff-validator (sibling skill) on the candidate before writing.
