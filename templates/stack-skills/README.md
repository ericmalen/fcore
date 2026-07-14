# templates/stack-skills

Vendored, framework-specific skills in the one optional tier (R-55), with
their own install trigger (profile stack match, vs. the lifecycle and
UI-verification skills' triggers). Installed into a
project by `fcore-fleet-config` when a profile layer's `stack` matches a
catalog entry's `stackEvidence` (see `matchStackSkills` in
`scripts/lib/orchestration/stack-skills.mjs`), or by hand via
`fcore skills add <name>`. Never installed into FleetCore's own
`.claude/skills/` — same reasoning as `templates/optional-skills/`: FleetCore
has no target stack for these to serve.

Every entry in `catalog.json` needs a matching `OPTIONAL_SKILLS` entry in
`scripts/lib/baseline.mjs` (`src: templates/stack-skills/<name>`) and a
skill directory here — enforced by a consistency test
(`test/optional-skills.test.mjs`).

## Curation policy

Nothing here is copied verbatim from an upstream source. Every skill is
**adapted** through `skill-creator` before it lands: rewritten to this
project's house style (R-17 through R-26), stripped of anything
stack-irrelevant, and re-attributed. `catalog.json` records the real
provenance (`origin`, `upstream`, `upstreamRef`, `license`) so a reviewer can
verify the claim later — `license: "UNVERIFIED"` means exactly that: don't
treat the content as legally clear to ship until someone checks.

`stackEvidence` / `notEvidence` follow the same shape and pitfall as
`blueprint-generator`'s verifier-agent rule (e.g. `react` matching React
Native unless excluded) — set `notEvidence` whenever a keyword collides
across stacks.
