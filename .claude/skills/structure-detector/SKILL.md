---
name: structure-detector
description: Orchestration discovery step B1 — walks a project and identifies its layers/packages, the stack per layer, and test/build commands, producing the structural fields of repo-profile.json. Use when orchestration discovery of a project path begins (typically driven by the repo-analyst agent). Not for fcore setup inventory and not general code search.
---

# structure-detector

Detects the structural half of a repo profile: `name`, `type`, `layers[]`,
`packageManager`. Evidence only — a value you cannot point to a file for is
`null` (where the schema allows) plus a `gaps[]` entry, never a guess.

## Procedure

All inspection happens in the project path named by the caller.

1. **Repo identity.** `name` from the root manifest (`package.json` `name`,
   or the directory name if unnamed). `packageManager` from lockfiles
   (`package-lock.json` → npm, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn)
   or the manifest's `packageManager` field.
2. **Type.** `monorepo` iff multiple packages are declared (`workspaces` in
   the root manifest, `pnpm-workspace.yaml`, lerna/nx config); otherwise
   `single-package`.
3. **Layers.** One entry per declared package/workspace; for a
   single-package repo, exactly one entry with `path: "."`. Per layer:
   - `name`: the package's short name (workspace folder name). For a
     single-package repo, a short role word read from the manifest (`bin`
     entry → "cli", a server entry point → "api"), falling back to the
     package name — the layer name should say what the layer IS, not
     repeat the repo name.
   - `path`: root-relative folder.
   - `stack`: from actual dependencies in that package's manifest, refined
     by framework config inside the layer — some defining facts live only
     there (e.g. `schema.prisma` datasource names the database engine).
     Name the framework(s) that define the layer (e.g. "React + TypeScript
     + Vite", "Express + TypeScript", "Prisma + PostgreSQL"). A layer with
     no framework dependencies still needs a non-empty stack: describe the
     runtime role from manifest signals (`bin`, `type`, `engines`), e.g.
     "Node.js CLI (zero-dependency)". Refine with dependency-mapper output
     when available.
   - `manifestPath`: root-relative path of the file that evidences the
     layer's stack — its dependency manifest (`package.json`,
     `pyproject.toml`, `requirements.txt`, `go.mod`, `Cargo.toml`,
     `pom.xml`/`build.gradle`, `*.csproj`, `Gemfile`, `composer.json`; for a
     Terraform root, its primary module file such as `main.tf` or
     `versions.tf`). You already read this file to name the stack — record
     its path. A layer with no dependency manifest records its primary
     config or entry file (the file you would read first to understand the
     layer); `null` plus a `gaps[]` entry only when no such file exists at
     all.
   - `testCmd` / `buildCmd`: the runnable command for THAT layer, derived
     from declared scripts (workspace form, e.g. `npm test --workspace api`,
     when the root manages packages). A missing test script is `null` plus
     a `gaps[]` entry — untested code matters to orchestration dispatch. A
     missing build script is just `null`, no gap: many packages
     legitimately have nothing to build. Never invent a command.
4. **Verify commands.** Where cheap and side-effect-free, run each detected
   test command once to confirm it executes; a command that errors out is
   reported in `gaps[]`, not silently kept. Build commands are detected
   from scripts only, never run.

## Output

Report the structural fields as JSON matching the `validateRepoProfile`
shape ([schemas.mjs](../../../scripts/lib/orchestration/schemas.mjs)), plus
the `gaps[]` entries found. The caller assembles and validates the full
profile.
