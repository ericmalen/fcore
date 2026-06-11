# maxi-repo (test fixture)

Four-layer npm-workspaces monorepo fixture for orchestration discovery
verification (agent-base plan, fixture spec in the build plan). Dependencies are
declared in manifests but never installed; tests use only Node built-ins;
build scripts are stubs.

Layers: `apps/ui` (React + TypeScript + Vite), `apps/api`
(Express + TypeScript), `packages/db` (Prisma + PostgreSQL),
`packages/shared` (TypeScript + Zod).
