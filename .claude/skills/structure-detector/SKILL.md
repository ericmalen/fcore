---
name: structure-detector
description: Orchestration discovery step B1 — walks a target repo and identifies its layers/packages, the stack per layer, and test/build commands, producing the structural fields of repo-profile.json. Use during orchestration discovery of a target repo path (typically driven by the repo-analyst agent). Not for ai-kit adoption inventory and not general code search.
---

# structure-detector

Detects the structural half of a repo profile: `name`, `type`, `layers[]`,
`packageManager`. Evidence only — a value you cannot point to a file for is
`null` (where the schema allows) plus a `gaps[]` entry, never a guess.

## Procedure

All inspection happens in the target repo path named by the caller.

1. **Repo identity.** `name` from the root manifest (`package.json` `name`,
   or the directory name if unnamed). `packageManager` from lockfiles
   (`package-lock.json` → npm, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn)
   or the manifest's `packageManager` field.
2. **Type.** `monorepo` iff multiple packages are declared (`workspaces` in
   the root manifest, `pnpm-workspace.yaml`, lerna/nx config); otherwise
   `single-package`.
3. **Layers.** One entry per declared package/workspace; for a
   single-package repo, exactly one entry with `path: "."`. Per layer:
   - `name`: the package's short name (workspace folder name).
   - `path`: root-relative folder.
   - `stack`: from actual dependencies in that package's manifest — name the
     framework(s) that define the layer (e.g. "React + TypeScript + Vite",
     "Express + TypeScript", "Prisma + PostgreSQL"). Refine with
     dependency-mapper output when available.
   - `testCmd` / `buildCmd`: the runnable command for THAT layer, derived
     from declared scripts (workspace form, e.g. `npm test --workspace api`,
     when the root manages packages). A script that does not exist is `null`
     plus a `gaps[]` entry — never invent a command.
4. **Verify commands.** Where cheap and side-effect-free, run each detected
   test command once to confirm it executes; a command that errors out is
   reported in `gaps[]`, not silently kept.

## Output

Report the structural fields as JSON matching the `validateRepoProfile`
shape (`scripts/lib/orchestration/schemas.mjs`), plus the `gaps[]` entries
found. The caller assembles and validates the full profile.
