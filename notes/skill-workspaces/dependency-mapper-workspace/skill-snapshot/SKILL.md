---
name: dependency-mapper
description: Orchestration discovery step B2 — maps internal package dependencies and the key external dependencies per layer of a target repo, refining layer stacks and revealing dispatch ordering for the repo profile. Use when orchestration discovery runs, after structure detection. Not a security or license audit.
---

# dependency-mapper

Maps who depends on whom: internal edges between a repo's own packages, and
the defining external dependencies per layer. A repo with no internal
dependencies (single package) is a normal result, not an error.

## Procedure

Run after structure-detector; its layer list is the input.

1. **Internal edges.** For each layer's manifest, list `dependencies` /
   `devDependencies` entries that name another layer of the same repo
   (workspace protocol `workspace:*`, matching package names, or relative
   `file:` links). Record as `consumer → provider` edges — these land in
   the profile's `internalEdges[]` as `{from: consumer, to: provider}` —
   marking dev-only edges (e.g. shared test utils) — they matter less for
   ordering. Zero edges → `internalEdges: []` (a recorded fact, not an
   omission) and move on. A layer with no
   recognizable manifest is reported as a gap for the caller's `gaps[]`,
   never silently skipped.
2. **Key external deps per layer.** From each layer's manifest, the
   handful of dependencies that define what the layer IS (framework, ORM,
   schema library, build tool) — not the full list. These confirm or refine
   the layer's `stack` string.
3. **Ordering signal.** From the internal edges, note which layers are
   providers (e.g. a shared types package consumed by ui and api). Providers
   change first when a task spans layers — state this ordering in the
   report. The profile's `internalEdges[]` carries the signal durably; the
   synthesizer later derives the blueprint's
   `dispatch_rules.dispatch_order` from it (`deriveDispatchOrder`).

## Output

Report: internal edge list (or "none"), key external deps per layer, and any
`stack` refinements for structure-detector's draft. No profile fields are
written directly; the caller merges — the edges become the profile's
`internalEdges[]`.
