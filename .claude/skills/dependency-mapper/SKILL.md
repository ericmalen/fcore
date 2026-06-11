---
name: dependency-mapper
description: Orchestration discovery step B2 — maps internal package dependencies and the key external dependencies per layer of a project, refining layer stacks and revealing dispatch ordering for the repo profile. Use when orchestration discovery runs, after structure detection. Not a security or license audit.
---

# dependency-mapper

Maps who depends on whom: internal edges between a repo's own packages, and
the defining external dependencies per layer. A repo with no internal
dependencies (single package) is a normal result, not an error.

Manifests are the only evidence this step needs. A declared dependency IS
an edge — do not crawl source files to check whether the dependency is
actually imported. Whether a declared edge is exercised in code is a
question for the team during the interview, and chasing it burns turns
without changing any edge.

## Procedure

Run after structure-detector; its layer list is the input.

1. **Internal edges.** For each layer's manifest, list `dependencies` /
   `devDependencies` entries that name another layer of the same repo
   (workspace protocol `workspace:*`, matching package names, or relative
   `file:` links — the protocol doesn't matter, the reference does). Record
   each as a `{from: consumer, to: provider}` edge for the profile's
   `internalEdges[]`, using layer names (not scoped package names). Mark
   edges that exist only in `devDependencies` (e.g. shared test utils) as
   dev-only so downstream readers can weigh them. Zero edges →
   `internalEdges: []` (a recorded fact, not an omission) and move on.
2. **Key external deps per layer.** From each layer's manifest, the
   handful of dependencies that define what the layer IS (framework, ORM,
   schema library, build tool) — not the full list. These confirm or refine
   the layer's `stack` string. A layer with zero dependencies is itself a
   defining fact — report "none", never pad.
3. **Ordering signal.** From the internal edges, note which layers are
   providers (e.g. a shared types package consumed by ui and api). Providers
   change first when a task spans layers — state this ordering in the
   report. A layer no other layer consumes is also worth stating here (an
   island is an ordering observation, not a gap). The profile's
   `internalEdges[]` carries the signal durably; the synthesizer later
   derives the blueprint's `dispatch_rules.dispatch_order` from it
   (`deriveDispatchOrder` — which weighs dev-only edges like any other, so
   the dev-only mark informs human readers, not the sort).
4. **Gaps.** Exactly one finding belongs in this step's contribution to the
   caller's `gaps[]`: a layer whose manifest is missing or unreadable — its
   dependencies are unknowable, and it must never be silently skipped.
   Everything else that looks gap-shaped is another step's job: dependency
   protocol and convention observations (bare `"*"` vs `workspace:*`) are
   convention-detector's (B3), toolchain and build wiring is
   structure-detector's (B1), and unconsumed layers belong in the ordering
   signal above. Keeping B2's gaps to manifest absence keeps the merged
   profile's `gaps[]` actionable instead of noisy.

## Output

Report: internal edge list (or "none"), key external deps per layer, any
`stack` refinements for structure-detector's draft, the ordering signal,
and gaps per step 4. No profile fields are written directly; the caller
merges — the edges become the profile's `internalEdges[]`.
