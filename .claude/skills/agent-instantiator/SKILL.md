---
name: agent-instantiator
description: Orchestration generation step — instantiates ONE agent definition (specialist or orchestrator) from its agent template via pure slot substitution from a validated blueprint entry, writing the result into the target repo's .claude/agents/. Zero authoring; the same blueprint always yields byte-identical output. Use when an orchestration blueprint.json has passed the handoff gate and its agents must be materialized into a target repo. Not for creating or designing new agents (use agent-creator), not for instantiating paired skills (use skill-instantiator), not for ai-kit adoption materialization, and not for any agent work outside orchestration generation.
---

# agent-instantiator

Pure substitution, zero authoring: a blueprint agent entry plus a target path
in, one generated agent file out. The engine is
[instantiate.mjs](../../../scripts/lib/orchestration/instantiate.mjs) (strict
inline slot substitution — unfilled, unused, or malformed markers are all
errors). The template's sha256 pin in
[template-registry.json](../../../templates/orchestration/template-registry.json)
is verified before substituting — generating from a template that drifted
from its pin would produce a file no manifest version describes (C5).

## Inputs

- A blueprint entry: one of `specialists[]` or the `orchestrator` from a
  validated `docs/orchestration/blueprint.json` in the target.
- The target repo path.
- The entry's template: `templates/orchestration/agents/<templateId>.template.md`
  in the kit clone.

## Procedure

1. Derive the flat slot map — `entry.slots` PLUS the injected quartet:

   | slot | value |
   |---|---|
   | `name` | `entry.name` |
   | `tools` | `entry.tools.join(", ")` |
   | `model-tier` | `entry.modelTier` |
   | `turn-limit` | `String(entry.turnLimit)` |

   The orchestrator additionally gets the injected `dispatch-order` slot —
   `renderDispatchOrder(bp.dispatch_rules.dispatch_order)` from
   [dispatch-order.mjs](../../../scripts/lib/orchestration/dispatch-order.mjs).
   Specialists never get it (an unused slot is an error).

2. Instantiate the template strictly. From the kit clone root:

   ```
   node --input-type=module -e '
   import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
   import { createHash } from "node:crypto";
   import { instantiateTemplate } from "./scripts/lib/orchestration/instantiate.mjs";
   import { renderDispatchOrder } from "./scripts/lib/orchestration/dispatch-order.mjs";
   const [bpPath, agentName, target] = process.argv.slice(1);
   const bp = JSON.parse(readFileSync(bpPath, "utf8"));
   const entry = [...bp.specialists, bp.orchestrator].find((a) => a.name === agentName);
   if (!entry) { console.error(`no agent "${agentName}" in blueprint`); process.exit(1); }
   const tplPath = `templates/orchestration/agents/${entry.templateId}.template.md`;
   if (!existsSync(tplPath)) { console.error(`missing template ${tplPath}`); process.exit(1); }
   const source = readFileSync(tplPath, "utf8");
   const reg = JSON.parse(readFileSync("templates/orchestration/template-registry.json", "utf8")).agents[entry.templateId];
   if (!reg) { console.error(`templateId "${entry.templateId}" not in registry`); process.exit(1); }
   if (reg.sha256 && createHash("sha256").update(source, "utf8").digest("hex") !== reg.sha256) {
     console.error(`agent template ${entry.templateId}: source drifted from registry pin — bump version and update sha256`); process.exit(1);
   }
   const slots = { ...entry.slots, name: entry.name, tools: entry.tools.join(", "),
     "model-tier": entry.modelTier, "turn-limit": String(entry.turnLimit) };
   if (entry.name === bp.orchestrator.name) slots["dispatch-order"] = renderDispatchOrder(bp.dispatch_rules?.dispatch_order);
   const { content, errors } = instantiateTemplate(source, slots);
   if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
   mkdirSync(`${target}/.claude/agents`, { recursive: true });
   writeFileSync(`${target}/.claude/agents/${entry.name}.md`, content);
   console.log(`wrote ${target}/.claude/agents/${entry.name}.md`);
   ' <blueprint.json> <agent-name> <target>
   ```

3. On success the file lands at `<target>/.claude/agents/<entry.name>.md`,
   byte-exact as substituted — no reformatting, no edits.

## Error discipline

On ANY error (missing entry, missing template, drifted sha256 pin,
unfilled/unused/malformed slot): stop and report the error-string array
verbatim. Never write partial output; never hand-patch the template, the
slots, or the generated file. Fixes belong upstream in the blueprint
(re-gate it with handoff-validator) or in the kit template.

## Contract

Deterministic: the same blueprint entry against the same template version
produces byte-identical output on every run — so re-running against an
unchanged template is a no-op overwrite, never a merge.

This step does NOT update `generation-manifest.json` (scaffolder-owned) and
does NOT check for user edits the way regeneration does. Two consequences:

- If the target's generated file was hand-edited, re-instantiating clobbers
  the edit silently — check `drift-checker` first when in doubt.
- If the template's version was bumped since the last scaffold, the rewritten
  file will no longer match its manifest sha256 and drift-checker will
  misread it as USER-EDIT. After a template bump, re-scaffold (which refreshes
  the manifest) instead of single-asset re-instantiation.
