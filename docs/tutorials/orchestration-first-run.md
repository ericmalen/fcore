# Orchestration first run

A guided walkthrough using Agent Base's **fixture repos** — not a production
project. You learn the five-session flow without touching a real codebase.

## What you need

- This base checkout open in Claude Code or Copilot agent mode (a clone, or the release `npx github:ericmalen/agent-base#v1.2.1 orchestrate` stages — it opens the session for you when the `claude` CLI is on PATH)
- Node ≥ 20
- Familiarity with [setup](../how-to/setup-guide.md) (target must be
  set up first — fixtures below are pre-built for orchestration tests)

## Fixture repos

| Fixture | Path | Shape |
| --- | --- | --- |
| mini-repo | `test/fixtures/mini-repo` | Single-package CLI |
| maxi-repo | `test/fixtures/maxi-repo` | Four layers: shared, ui, api, db |

Golden artifacts live in `test/fixtures/orchestration/` — profiles, decisions,
and synthesized blueprints you can compare against.

## Tutorial path (maxi-repo)

### 1. Inspect a golden profile

Read `test/fixtures/orchestration/maxi-repo.profile.json`. Note `layers[]`,
`internalEdges[]`, and `conventions`. This is what `repo-analyst` produces.

### 2. Review decisions

Open `test/fixtures/orchestration/maxi-repo.decisions.json` and the rendered
`maxi-repo.decisions.md`. These encode TDD depth, review gates, security, and
QA policy — Gate 1 material.

### 3. Study the blueprint

Open `test/fixtures/orchestration/maxi-repo.synthesized.blueprint.json`.
Check `specialists[]` (one engineer per layer + reviewers), `dispatch_rules`
(including `dispatch_order`), and `docs[]`.

### 4. Dry-run generation

From the Agent Base root:

```sh
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { planGeneration } from './scripts/lib/orchestration/scaffold.mjs';
const registry = JSON.parse(readFileSync('templates/orchestration/template-registry.json','utf8'));
const bp = JSON.parse(readFileSync('test/fixtures/orchestration/maxi-repo.synthesized.blueprint.json','utf8'));
const read = (kind,id) => readFileSync(\`templates/orchestration/\${kind==='doc'?'docs':kind+'s'}/\${id}.\${kind==='doc'?'md':'template.md'}\`,'utf8');
const { files, errors } = planGeneration(bp, registry, read);
console.log(errors.length ? errors : files.map(f => f.path).join('\n'));
"
```

You should see paths under `.claude/agents/`, `.claude/skills/`, and
`docs/orchestration/` — no errors.

### 5. Run the full skill (optional)

On a **throwaway copy** of a fixture (never the golden tree itself):

1. Set up the copy if needed (`/base-setup`).
2. Run `/base-orchestrate /path/to/copy`.
3. Stop at Gate 1 and Gate 2 to read `decisions.md` and the blueprint roster.
4. After generation, seed `tasks.md` using the grammar in
   `templates/orchestration/docs/tasks-format.md`.
5. Open the copy and invoke `feature-orchestrator` on one backlog item.

## mini-repo variant

Repeat steps 1–4 with `mini-repo.*` fixtures. The synthesized blueprint
selects `generic-specialist` with `pairedSkills: []` for the single layer
and has an empty `dispatch_order` — the repo-agnostic guardrail.

## What to verify

- `docs/orchestration/generation-manifest.json` lists every generated file
  with SHA pins.
- Re-running scaffold against the same blueprint is byte-identical.
- `feature-orchestrator` stops at PR/diff presentation — no auto-merge.

## Next steps

- [Orchestration how-to](../how-to/orchestration-guide.md) — production flow.
- [Troubleshooting](../how-to/orchestration-troubleshooting.md) — per-session
  failure modes.
- [Orchestration concepts](../explanation/orchestration.md) — architecture.
- [Agents and skills reference](../reference/agents-and-skills.md) — full
  inventory.
