# Changelog workflow

> **Opt-in — off by default.** CHANGELOG.md is produced only when
> `CHANGELOG.md` is listed in `.claude/docs-paths.json` `docsPaths`. The
> existence test below still governs whether enabling it is appropriate
> at all.

## Existence test (apply before anything else)

A user-facing CHANGELOG.md exists only when the repo has consumers beyond
its maintainers — published package, deployed API other teams call,
versioned artifact others depend on. Evidence: public package manifest,
publish workflow, version tags, install instructions aimed at outsiders.
No external consumers → no changelog; commit history serves maintainers.
If one exists in such a repo, recommend retiring it (flag, don't delete
unilaterally).

## What an entry is

Behavior as experienced by the consumer — never implementation activity.

- YES: "POST /orders now rejects unknown currency codes (400)."
- YES: "BREAKING: config key `timeout` renamed `timeoutMs`. Migration:
  rename the key; values unchanged."
- NO: "Refactored OrderService", "Updated dependencies", "Improved tests"
  (invisible to consumers — omit entirely).

Sections per release: Breaking (with migration steps — a breaking entry
without migration steps is incomplete), Changed, Added, Fixed, Deprecated.
Unreleased entries accumulate under `## [Unreleased]` and move under a
version heading at release. Newest first.

## Maintenance discipline

When a behavior-changing edit lands and a changelog exists, the entry is
written in the SAME change — describing the consumer-visible effect, not
the commit. If you cannot tell whether a change is consumer-visible, ask;
don't pad the changelog defensively.
