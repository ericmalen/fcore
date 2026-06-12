# Baseline sync (release pins)

Enterprise-style baseline management: projects **pin** an Agent Base release,
pull upgrades deterministically, and optionally let CI or a bot nudge when the
pin is stale.

## Marker

Every set-up project records releases in [`.claude/agent-base.json`](../../spec/target-layout.md):

```json
{
  "standard": "1.0.0",
  "toolRepo": "https://github.com/ericmalen/agent-base",
  "pin": "v1.0.0",
  "lastSyncedAt": "2026-06-11",
  "setupAt": "2026-03-01",
  "githubCodeReview": false
}
```

| Field | Role |
| --- | --- |
| `standard` | Semver of the Agent Base standard at setup/last sync |
| `toolRepo` | Agent Base repo URL (GitHub or Azure DevOps) — clone target and npx spec source |
| `pin` | Git tag resolved for audit CI (npx) and baseline sync |
| `lastSyncedAt` | Date baseline files were last synced from `pin` |
| `setupAt` | Date setup completed (immutable) |
| `githubCodeReview` | Setup policy flag (R-09/R-49) |

Agent Base tags releases (`v1.0.0`, `v1.4.0`, …). Patch/minor upgrades within
the same major are **compatible** by default.

## Commands

From a project root (or pass `--root`), via npx at your pin — no clone needed:

```sh
# CI / weekly nudge — exit 1 when pin is behind
npx github:ericmalen/agent-base#v1.2.0 sync --check

# Bot-friendly JSON plan (files to update, conflicts)
npx github:ericmalen/agent-base#v1.2.0 sync --report --json

# Apply safe updates (skips files with local edits vs the old release).
# Also works at a current pin: restores missing baseline files (repair).
npx github:ericmalen/agent-base#v1.2.0 sync --upgrade

# Preview only
npx github:ericmalen/agent-base#v1.2.0 sync --upgrade --dry-run
```

The same commands work from a clone
(`node /path/to/agent-base/scripts/sync-baseline.mjs --check` …).
Use `--allow-major` to consider the latest tag across major versions.

During development, point at a local clone:

```sh
node ~/tools/agent-base/scripts/sync-baseline.mjs --check --base-root ~/tools/agent-base
```

## What gets synced

Only **permanent baseline** assets (same set as post-merge install):

- `base-check`, `docs`, `git-conventions`, `skill-creator`, `agent-creator`
- `docs-auditor`, `retro`, `log-report`, `eval-runner`, `tracker-sync`

Setup-window skills (`.claude/agent-base-setup/`, `base-inventory` …) are
never touched.

## Conflict model

For each baseline file:

- Matches the old release, differs on the new release → **auto-update**
- Matches the new release already → **unchanged**
- Differs from both old and new release → **conflict** (human resolves, then re-run)

This is the polished version of “pull from source” — not silent auto-sync.

At a **current pin** (repair) there is no old → new delta: missing files are
restored, and locally edited files are left untouched and reported as drift —
they never block, and `--upgrade` exits 0 (policing content drift is
`base-check`'s job, not sync's). A pin **ahead** of the target — stale
`--base-root` checkout, deleted remote tags — is refused with exit 2, never a
silent downgrade.

## CI templates

Copy from a base checkout when the project has CI:

| Template | Purpose |
| --- | --- |
| `templates/ci/audit-strict.github.yml` / `.ado.yml` | Audit at **pinned** release (`--strict`) |
| `templates/ci/baseline-pin-check.github.yml` / `.ado.yml` | Fail/warn when `pin` is behind |

All compute an npx spec from the marker (`toolRepo` + `pin`) and run Agent
Base via `npx --yes` at that pin, failing hard when resolution fails — a bad
pin never silently falls back to an unpinned ref. For private repos, route
git credentials with an `insteadOf` rewrite (`secrets.KIT_TOKEN` on GitHub, a
secret pipeline variable on ADO — see comments in each template).

Note: workflow copies in your repo are **not** owned by `sync-baseline` (it
syncs only baseline skills/agents). When the templates change in Agent Base,
re-copy them from a checkout yourself — `--report` will never list them.

## Bot PR (optional)

`templates/ci/baseline-upgrade-bot.github.yml` is a scheduled workflow that
does the upgrade for you: weekly (or on manual dispatch) it runs
`sync-baseline --report --json`, and when the pin is behind with **zero
conflicts** it applies `--upgrade` and opens a PR titled
**"chore(agent-base): baseline v1.3.0 → v1.4.0"** with the real file diff.

Install: copy the template to `.github/workflows/`, enable the repo setting
*Allow GitHub Actions to create and approve pull requests*, and (private
Agent Base repo only) add a `KIT_TOKEN` secret — see comments in the template.

Safety rules, encoded in the workflow:

- PR only when `behind && conflictCount === 0`; conflicts turn the run red
  for a human to resolve instead.
- Never `--allow-major` — major upgrades are a deliberate human PR.
- Never auto-merge; rollback is closing the PR (branch auto-deletes).

No ADO equivalent ships yet — on Azure DevOps use the scheduled
`baseline-pin-check.ado.yml` nudge plus a manual `base-refresh` run.

### Renovate (supplement, not replacement)

Renovate can bump the `"pin"` string in the marker via a custom regex
manager, but it cannot copy skill trees — pair it with the bot workflow (or a
CI step running `sync-baseline --upgrade`) if your teams already use
Renovate. Otherwise the bot workflow alone is the simpler path.

## Migrating projects set up before v1.0.0

Pick your case from the marker (`.claude/agent-base.json`):

- **`standard` is semver, `pin` missing** → nothing to fix; sync derives the
  pin as `v<standard>`, and the first `--upgrade` writes the full marker
  shape (`pin`, `lastSyncedAt`).
- **`standard` is not semver (e.g. a sha)** → the marker fails validation.
  Edit the marker once by hand: set `standard` to the release you are
  effectively on (e.g. `1.0.0`), add `"pin": "v1.0.0"`, and check that
  `toolRepo` points at the current Agent Base repo URL (pre-rename projects
  may still point at the repo's retired v1 name). Then run `--upgrade`
  normally.
- **Pre-rename marker or layout** (marker file or paths from before the
  Agent Base rename) → run the full setup flow again
  ([setup guide](./setup-guide.md)); your current state is existing-project
  input, protected by the normal gates. Don't hand-migrate.

After any of these, also re-copy any CI templates your repo had installed
(`audit-strict`, `baseline-pin-check`) — older copies cloned at the pin (or,
before that, silently fell back to an unpinned clone); current ones resolve
via npx at the pin and fail loudly. See the note under
[CI templates](#ci-templates).

## Related

- [Setup guide](./setup-guide.md) — initial install
- [Terminology](../reference/terminology.md) — vocabulary
- `base-check` skill — post-sync audit loop
