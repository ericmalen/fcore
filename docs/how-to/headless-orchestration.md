# Headless orchestration runs

How to run the generated `feature-orchestrator` on a schedule — GitHub
Actions or Azure DevOps Pipelines — so backlog items ship as reviewable PRs
without a human at the keyboard. The pipelines are thin shells over
unit-tested guard logic; a run always ends at PR creation, **never a merge**.

## What you need

- Orchestration **generation completed** in the project
  (`docs/orchestration/generation-manifest.json` exists — see the
  [orchestration guide](./orchestration-guide.md))
- A seeded `tasks.md` with at least one unblocked, non-`triage` Backlog item
- The matching CI template copied from a fcore checkout:
  - `templates/ci/orchestrator-run.github.yml` → `.github/workflows/`
  - `templates/ci/orchestrator-run.ado.yml` → `.azuredevops/` (point a
    pipeline at it)

## Secrets and permissions

| Platform | Required | Optional |
|---|---|---|
| GitHub | `ANTHROPIC_API_KEY` secret; repo setting "Allow GitHub Actions to create and approve pull requests" | `KIT_TOKEN` (private FleetCore repo); `AZURE_DEVOPS_PAT` (tracker sync against ADO) |
| ADO | `ANTHROPIC_API_KEY` secret variable; build service identity granted "Contribute" + "Create pull request" on the repo | `FCORE_TOKEN` (private FleetCore repo); `AZURE_DEVOPS_PAT` (tracker sync) |

No other credentials: PR creation uses the platform's own token
(`github.token` / `System.AccessToken`), and the agent itself is told never
to push — the pipeline pushes.

## What a run does

1. **Resolve FleetCore at pin** — computes the npx spec from the marker
   (`toolRepo` + `pin`) and runs every FleetCore command via
   `npx --yes <spec>`; a failed resolution fails the run, never an unpinned
   fallback.
2. **Guard** — the `headless-guard` command (a thin CLI over
   `scripts/lib/orchestration/headless-guard.mjs`) decides
   run/skip: skips on empty Backlog, on blocked-or-`triage`-only Backlog
   (tracker imports awaiting scoping never burn a run), or while a previous
   `orch/` PR is open (one writer at a time, DD-11). Otherwise it picks the
   first eligible task, top-down.
3. **Tracker sync (optional)** — when `docs/orchestration/tracker-sync.json`
   exists, chains `tracker-sync --apply` and commits the `tasks.md` change
   onto the work branch, so intake rides in the same PR.
4. **Run the orchestrator** — installs the Claude CLI and runs `claude -p`
   against the generated `feature-orchestrator` for exactly **one task**,
   `--max-turns 80`, commit-per-unit-of-work on branch `orch/run-<build id>`.
5. **Push + PR** — only if commits exist; PR body links the audit trail.
   Review and merge manually.

## Audit trail

Git history on the `orch/` branch + `docs/orchestration/handoff-log.jsonl`
(the orchestrator logs every dispatch, plus one permanent completion entry
per finished task — `tasks.md`'s own `## Done` line is transient and gets
pruned) + the pipeline run logs. No custom server, ever. Use the `log-report`
skill over the handoff log for per-agent health.

## Cost and tuning

- `--max-turns 80` caps a runaway session; raise it only after a few runs
  show real utilization (check `log-report` turn utilization).
- One task per run keeps PRs reviewable and spend predictable; raise cadence
  (cron) before raising tasks-per-run.
- The guard makes empty runs nearly free: they stop before the Claude CLI is
  installed.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Run skipped, log shows `reason=orchestrator-pr-open` | A previous `orch/` PR is still open — review and merge/close it first |
| Run skipped, `reason=backlog-all-blocked` | Only blocked or `scope: triage` items remain — scope the imports (remove their `blocked:` line) |
| `claude` exits non-zero after max turns | The task was too big for the cap — split it in `tasks.md` or raise `--max-turns` in the template |
| Task bounced to Backlog with `blocked:` | Working as designed (failure protocol, one retry) — read the referenced handoff-log entry |
| PR creation fails on ADO | Build service identity lacks "Create pull request" — Project Settings → Repositories → Security |
| Pin resolution fails | The marker's `pin` tag is missing or unreachable via npx — fix `.claude/fcore.json` (and git credentials for a private repo), never fall back unpinned |

## Further reading

- [Orchestration guide](./orchestration-guide.md) — the five-session flow
- [Troubleshooting](./orchestration-troubleshooting.md) — session failures
