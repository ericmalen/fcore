---
name: drift-checker
description: Detects drift in an orchestration-generated project by re-instantiating every generation-manifest entry from the CURRENT FleetCore templates plus the stored blueprint and comparing sha256 digests, and by re-rendering decisions.md — separating TEMPLATE-DRIFT (FleetCore template moved on; remedy is re-scaffold) from USER-EDIT (generated file or rendered companion touched on disk; remedy is human conflict resolution). Use when checking whether a target's generated agents, skills, docs, or decisions.md still match what generation would produce today. Not git diff, not the fcore setup reproducibility audit, and not for repos without docs/orchestration/generation-manifest.json.
---

# drift-checker

Compares a generated target against what the CURRENT FleetCore templates plus the
target's stored `docs/orchestration/blueprint.json` would produce, using the
SHA-256 record in `docs/orchestration/generation-manifest.json`. Two drift
kinds, ALWAYS reported separately — they have different remedies:

- **TEMPLATE-DRIFT** — re-instantiated content differs from the manifest
  SHA, but the file on disk still equals it: the FleetCore template moved on.
  Remedy: re-scaffold (re-run the instantiators, refresh the manifest).
- **USER-EDIT** — the file on disk differs from the manifest SHA (or is
  missing): someone touched a generated file. Remedy: human conflict
  resolution — port the edit upstream into the template or blueprint, or
  revert it; never silently overwrite. Disk-vs-manifest wins when both
  drifts coexist.

## Checks 1 + 3 — manifest entries (agents, docs; skills are check 3)

Slot maps for re-instantiation, paired via
[template-registry.json](../../../templates/orchestration/template-registry.json):

- **agents** (`.claude/agents/<name>.md`) — slots come from `agentSlots(agent,
  blueprint)`, imported from
  [scaffold.mjs](../../../scripts/lib/orchestration/scaffold.mjs): the
  blueprint entry's `slots` plus the injected `name`/`tools`/`model-tier`/
  `turn-limit` quartet, plus the orchestrator's rendered `dispatch-order`. This
  is the SAME function the scaffolder uses, so re-instantiation here cannot
  drift from what generation wrote — never re-derive the slot map by hand.
- **skills** (`.claude/skills/<id>/SKILL.md`) — `skillSlots(owner.slots)`,
  imported from scaffold.mjs (drops agent-only slots like `layer-context`),
  no quartet; the owner is the specialist whose `pairedSkills` lists that
  skill id in the blueprint.
- **docs** — verbatim copies; hash the FleetCore doc file directly.

From the fcore checkout root, target path as the argument:

```
node --input-type=module -e '
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { instantiateTemplate } from "./scripts/lib/orchestration/instantiate.mjs";
import { agentSlots, skillSlots } from "./scripts/lib/orchestration/scaffold.mjs";
const t = process.argv[1];
const manifest = JSON.parse(readFileSync(`${t}/docs/orchestration/generation-manifest.json`, "utf8"));
const bp = JSON.parse(readFileSync(`${t}/docs/orchestration/blueprint.json`, "utf8"));
const reg = JSON.parse(readFileSync("templates/orchestration/template-registry.json", "utf8"));
const sha = (s) => createHash("sha256").update(s).digest("hex");
const agents = [...bp.specialists, bp.orchestrator];
for (const en of manifest.generated) {
  const onDisk = existsSync(`${t}/${en.path}`) ? sha(readFileSync(`${t}/${en.path}`, "utf8")) : null;
  let fresh;
  if (en.path.startsWith(".claude/agents/")) {
    const a = agents.find((x) => x.name === basename(en.path, ".md"));
    if (!a) { console.log(`ERROR ${en.path}: no blueprint entry`); continue; }
    fresh = sha(instantiateTemplate(readFileSync(`templates/orchestration/agents/${en.templateId}.template.md`, "utf8"), agentSlots(a, bp)).content ?? "");
  } else if (en.path.startsWith(".claude/skills/")) {
    const owner = bp.specialists.find((x) => (x.pairedSkills ?? []).includes(en.templateId));
    if (!owner) { console.log(`ERROR ${en.path}: no owning specialist`); continue; }
    fresh = sha(instantiateTemplate(readFileSync(`templates/orchestration/skills/${en.templateId}.template.md`, "utf8"), skillSlots(owner.slots)).content ?? "");
  } else {
    fresh = sha(readFileSync(`templates/orchestration/docs/${en.templateId}.md`, "utf8"));
  }
  console.log(`${onDisk !== en.sha256 ? "USER-EDIT" : fresh !== en.sha256 ? "TEMPLATE-DRIFT" : "MATCH"} ${en.path}`);
}
' <project-path>
```

`ERROR` lines mean the manifest, blueprint, and registry disagree — report
them as corruption, not drift.

## Check 2 — rendered decisions.md

`decisions.md` is rendered from `decisions.json` by
[render-decisions.mjs](../../../scripts/lib/orchestration/render-decisions.mjs)
and never authored, so ANY byte difference is a hand-edited rendered
companion — report it as USER-EDIT:

```
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { renderDecisionsMd } from "./scripts/lib/orchestration/render-decisions.mjs";
const t = process.argv[1];
const fresh = renderDecisionsMd(JSON.parse(readFileSync(`${t}/docs/orchestration/decisions.json`, "utf8")));
console.log(fresh === readFileSync(`${t}/docs/orchestration/decisions.md`, "utf8")
  ? "MATCH docs/orchestration/decisions.md"
  : "USER-EDIT docs/orchestration/decisions.md (hand-edited rendered companion)");
' <project-path>
```

## Report

Two sections, never merged:

1. **TEMPLATE-DRIFT** — affected paths; recommend re-scaffolding from the
   current templates and refreshing the manifest.
2. **USER-EDIT** — affected paths (including decisions.md if check 2
   differs); each needs a human to decide upstream-port vs revert.

All-MATCH means no drift; say so explicitly. ERROR lines go in their own
corruption note above both sections.
