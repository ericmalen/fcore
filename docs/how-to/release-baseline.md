# Release a baseline version

Maintainer how-to: cut a tagged Agent Base release that set-up projects can
pin and sync against (consumer side: [baseline-sync](./baseline-sync.md)).

## When to tag

Tag when consumers should be able to pull the change:

- Permanent-baseline asset changes (`BASELINE_COPIES` in
  `scripts/lib/baseline.mjs`: `base-check`, `docs`, `git-conventions`,
  `skill-creator`, `agent-creator`, `docs-auditor`, `retro`, `log-report`,
  `eval-runner`).
- Audit rule changes (`spec/rules.md` + `scripts/audit.mjs`).
- CI template changes (`templates/ci/`).

Internal-only work (tests, this repo's docs, dev tooling) does not need a tag.

## Semver rules

| Bump | When |
| --- | --- |
| patch | Copy-only baseline content changes; bug fixes with no schema impact |
| minor | New optional marker fields, new optional skills/templates, new audit info/warning findings |
| major | Breaking marker schema, setup pipeline, or target-layout changes |

`sync-baseline` treats patch/minor within the same major as compatible by
default; majors need `--allow-major` (human-reviewed).

## Cut a release

From a clean tree on `main`:

```sh
npm version patch   # or minor / major — bumps package.json, commits, tags vX.Y.Z
git push origin main --follow-tags
```

## Tag gate

Both pipelines (`.github/workflows/ci.yml`, `.azuredevops/azure-pipelines.yml`)
run a tag gate on `refs/tags/v*`: the tag must equal `v<package.json version>`
or the build fails. The full CI suite (tests, audits, starter build + strict
audit) also runs against the tag, so a published release is always
starter-clean.

## After release

- Projects pick it up: `sync-baseline --check` flags the stale pin;
  `--upgrade` applies it ([baseline-sync](./baseline-sync.md)).
- `baseline-pin-check` CI in consumer repos starts failing/warning on the old
  pin automatically — no announcement step required.

## Related

- [Baseline sync](./baseline-sync.md) — consumer pin/upgrade flow
- [Setup guide](./setup-guide.md) — initial install
