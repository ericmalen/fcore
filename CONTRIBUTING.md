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
- Commits follow [Conventional Commits](https://www.conventionalcommits.org)
  (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`), scoped where it
  helps (e.g. `fix(cli): …`).
- CLI exit codes: `0` ok · `1` ran but found problems / a subprocess failed ·
  `2` usage or precondition error.
- Work on a branch and open a PR into `main`. Decisions live in commits, PRs,
  and release notes — there is no CHANGELOG.

## Releasing (maintainers)

See [`docs/how-to/release-baseline.md`](./docs/how-to/release-baseline.md).
