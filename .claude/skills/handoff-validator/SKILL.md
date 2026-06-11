---
name: handoff-validator
description: Orchestration discovery gate B7 — checks an orchestration blueprint's completeness before it is handed to generation: schema validity, every specialist's slots fill its template with zero leftovers, dispatch rules and eval requirements present. Use when a blueprint.json is about to be written or accepted. Not for validating profiles, decisions docs, or generated agents.
---

# handoff-validator

The gate between Discovery and Generation: a blueprint passes only if
generation can run it deterministically with zero manual edits. Both checks
run from the Agent Base clone.

## Checks

1. **Schema** —

   ```
   node --input-type=module -e '
   import { readFileSync } from "node:fs";
   import { validateBlueprint } from "./scripts/lib/orchestration/schemas.mjs";
   const errors = validateBlueprint(JSON.parse(readFileSync(process.argv[1], "utf8")));
   if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
   console.log("schema ok");
   ' <blueprint.json>
   ```

2. **Generation dry-run** — run the real generation planner
   (`planGeneration`, the same code the scaffolder executes) against the
   Agent Base's registry and templates, discarding the planned files:

   ```
   node --input-type=module -e '
   import { readFileSync, existsSync } from "node:fs";
   import { planGeneration } from "./scripts/lib/orchestration/scaffold.mjs";
   const bp = JSON.parse(readFileSync(process.argv[1], "utf8"));
   const registry = JSON.parse(readFileSync("templates/orchestration/template-registry.json", "utf8"));
   const where = { agent: (id) => `templates/orchestration/agents/${id}.template.md`,
     skill: (id) => `templates/orchestration/skills/${id}.template.md`,
     doc: (id) => `templates/orchestration/docs/${id}.md` };
   const readTemplate = (kind, id) =>
     existsSync(where[kind](id)) ? readFileSync(where[kind](id), "utf8") : null;
   const { errors } = planGeneration(bp, registry, readTemplate);
   if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
   console.log("generation dry-run ok");
   ' <blueprint.json>
   ```

   One pass, zero reimplementation, covers: slot completeness for the
   orchestrator and every specialist (including the injected
   name/tools/model-tier/turn-limit quartet and the orchestrator's rendered
   dispatch-order), every paired skill instantiated from its specialist's
   slots, every `blueprint.docs` entry resolving in the registry, registry
   sha256 pin agreement, and generated-path collisions. Because the dry-run
   and the scaffolder share `planGeneration`, the gate's verdict is by
   construction the verdict generation would give — the two cannot drift.
   The blueprint's templateId vocabulary is closed (everything
   blueprint-generator may emit is registry-pinned), so an unresolvable id
   is a defect, never a "not yet authored" state to wave through.

3. **Eval + dispatch presence** — fully covered by the schema check:
   `evalRequirements.minGoldens`, `dispatch_rules` shape, and tier ordering
   (`subagent_max_scopes` < `agent_team_min_scopes`) are all enforced by
   `validateBlueprint`; no manual confirmation step.

## Verdict

Report PASS / REJECT with the error lines verbatim, and route the fix by
error class:

- slot errors, `not in registry`, duplicate generated path — blueprint
  defects: the caller fixes the blueprint (or the upstream
  profile/decisions) and re-runs.
- `missing from Agent Base`, `drifted from registry pin` — Agent Base defects: author the
  missing template or bump the version and re-pin in Agent Base; the blueprint
  is innocent.

Never hand-edit generated downstream files to compensate.
