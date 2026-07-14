---
name: blueprint-generator
description: Orchestration discovery step B8 rulebook — the deterministic mapping rules the plan-synthesizer agent (B8) follows to build docs/orchestration/blueprint.json from a repo profile plus decisions doc: layers to generic-specialist with optional paired skills, policies to reviewer/QA specialists, and defaults for tiers, turn limits, and tools. Use when synthesizing an orchestration blueprint (typically driven by the plan-synthesizer agent). Not for instantiating templates, and not the completeness gate on the candidate blueprint (that's handoff-validator, B7).
---

# blueprint-generator

Maps `repo-profile.json` + `decisions.json` onto a `blueprint.json`
(`validateBlueprint` shape). Deterministic rules, no taste calls — when a
rule does not cover the repo, use `generic-specialist` with `pairedSkills:
[]`; never invent.

## Specialist selection

One engineer specialist per CODE layer **with an evidenced (non-null)
`testCmd`**. A layer whose `testCmd` is `null` (recorded as a profile gap)
gets NO engineer specialist — its `test-cmd` slot cannot be filled without
inventing, and inventing is forbidden. Report the omission in synthesis
output; the layer still appears in `dispatch_rules.dispatch_order` (derived
from the profile), so its changes route through consuming layers' specialists
and their reports. Every specialist uses `templateId: generic-specialist`;
stack evidence selects optional `pairedSkills`:

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

Evidence-driven additions — same stack-evidence signal as `pairedSkills`
above, not gated by any `decisions.json` field (no interview question; a
UI-bearing layer always gets a verifier, same as it always gets a paired
skill):

- any layer's stack evidence matches web signals (React / Vue / frontend
  build tool) and NOT React Native/Expo evidence: `ui-web-verifier`
- any layer's stack evidence matches `react-native` or `expo`:
  `ui-mobile-verifier`
- at most one of each per blueprint, regardless of how many layers match.

Always: one `feature-orchestrator` (templateId `orchestrator`).

Names are derived, not invented — the same inputs must yield the same
roster: engineer specialists are `<layer-name>-engineer` (layer name from
the profile, e.g. `frontend-engineer`, `shared-engineer`, `cli-engineer`);
policy and evidence-driven agents keep their templateId as name
(`code-reviewer`, `qa-agent`, `security-reviewer`, `ui-web-verifier`,
`ui-mobile-verifier`); the orchestrator is always `feature-orchestrator`.

**Skill prerequisite (not `pairedSkills`):** `ui-web-verifier`/
`ui-mobile-verifier` depend on the `ui-verify-web`/`ui-verify-ios` optional
skills (R-55) — static, unslotted, installed via `fcore skills add`, NOT the
templated `pairedSkills`/skill-instantiator pipeline (those skill ids are not
in this registry's `skills` map and have no `.template.md`). Don't populate
`pairedSkills` for these two agents. `fcore-fleet-config` installs the
matching skill as a generation prerequisite when the roster includes the
agent, the same way it already does for the lifecycle skills.

## Slot values (from the profile, per agent)

Engineer specialists: `layer-path`, `layer-context`, `stack`,
`test-cmd` (the layer's fields; a `null` testCmd means the layer gets no
specialist at all — see Specialist selection; never invent a command),
`manifest-path` (the layer's `manifestPath`; a `null` manifestPath on a
specialist-bearing layer blocks synthesis — report, don't invent),
`conventions` (joined from `conventions.*`, omitting nulls).

- `layer-path`: `` "the repository root" `` when `layer.path === "."`,
  else `` `path` `` — backticks in the VALUE, not the template, so a
  single-package layer reads as "under the repository root" rather than
  "under `.`". Never wrap this slot in template-level backticks.
- `layer-context`: NEVER hand-composed — compute it by running
  `layerContextSlot(profile, layer.name)` from
  [scaffold.mjs](../../../scripts/lib/orchestration/scaffold.mjs), e.g.

  ```sh
  node -e 'import("<fcore>/scripts/lib/orchestration/scaffold.mjs").then(async (m) => {
    const profile = JSON.parse(require("node:fs").readFileSync("<target>/docs/orchestration/repo-profile.json", "utf8"));
    console.log(m.layerContextSlot(profile, process.argv[1]));
  })' <layer-name>
  ```

  The block (build cmd, manifest, dependency edges, repo gaps) is inlined
  into the generated agent under its `## Layer context` section. Agent-only:
  paired-skill templates never receive it (`skillSlots()` filters it out at
  instantiation).
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
| ui-web-verifier | sonnet | 25 | Read, Grep, Glob, Bash, mcp__playwright |
| ui-mobile-verifier | sonnet | 25 | Read, Grep, Glob, Bash, mcp__ios-simulator |
| feature-orchestrator | opus | 60 | Read, Grep, Glob, Edit, Write, Bash, Agent |

Server-level MCP names in `tools[]` (`mcp__playwright`, `mcp__ios-simulator`)
grant every tool that server exposes — verified live against a generated
`ui-web-verifier`, no need to enumerate individual `mcp__playwright__browser_*`
names. The MCP server itself still needs `claude mcp add --scope project ...`
in the target and one-time interactive approval before its tools activate.

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
