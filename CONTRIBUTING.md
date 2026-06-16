# Contributing to Agent Base

Thanks for helping improve Agent Base. This repo is the **setup tool**, not an
application — read [`AGENTS.md`](./AGENTS.md) first for the architecture and the
conventions that govern changes.

## Develop

- **Node ≥ 20** runs the scripts; **Node ≥ 22** runs the test suite.
- **Zero runtime dependencies** — don't add any without discussion. Staged
  releases are a plain directory copy, so a dependency would break every
  `npx`-resolved run (there's a packaging guard for this in `test/cli.test.mjs`).
- No install step: `git clone`, then `npm test`.

## Before you open a PR

Run the same gates CI runs — all must be clean:

```sh
npm test                          # unit + integration (Node ≥ 22)
npm run docs-consistency          # internal doc links resolve
npm run rule-check-map            # every spec rule maps to an audit check
node scripts/audit.mjs --strict   # this repo conforms to its own standard

# starter build + audit (the starter must be born conformant)
d="$(mktemp -d)/repo"; node scripts/build-starter.mjs "$d" && node scripts/audit.mjs --root "$d" --strict
```

## Conventions

- **Rule-ID indirection (R-51):** cite rules by their `R-…` ID in
  [`spec/rules.md`](./spec/rules.md); never restate a rule's text.
- Behavior-changing edits to `scripts/`, `templates/`, or `test/` update the
  affected docs in the same change.
- **Where a new feature gets tested.** Match the feature to the layer that
  owns it:
  - A new mechanical rule → an emitting check in
    [`scripts/lib/audit/checks.mjs`](./scripts/lib/audit/checks.mjs); the
    `rule-check-map` gate fails CI if a rule has no check (or vice versa).
  - Setup-flow behavior (marker fields, installed assets, apply/check/audit
    interplay) → a deterministic test in
    [`test/roundtrip.test.mjs`](./test/roundtrip.test.mjs) that runs `apply` +
    `check` (incl. reproducibility) + `audit` — this is the CI regression lock
    (e.g. the R-55 optional-skill cases).
  - Full pipeline coverage → add/adjust a fixture in
    [`test/fixtures/defs.mjs`](./test/fixtures/defs.mjs) (document any new
    `expect` field there) plus a matching assertion in
    [`scripts/validate-assert.mjs`](./scripts/validate-assert.mjs), so the
    manual `validate-setup` matrix exercises it end-to-end.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org)
  (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`), scoped where it
  helps (e.g. `fix(cli): …`).
- CLI exit codes: `0` ok · `1` ran but found problems / a subprocess failed ·
  `2` usage or precondition error.
- Work on a branch and open a PR into `main`. Decisions live in commits, PRs,
  and release notes — there is no CHANGELOG.

## Releasing (maintainers)

See [`docs/how-to/release-baseline.md`](./docs/how-to/release-baseline.md).
