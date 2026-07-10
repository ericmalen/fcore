# Templates — load only at write time; never install empty

## Decision record (docs/decisions/NNNN-slug.md) — opt-in

```markdown
# NNNN: <decision, stated actively>

Status: Accepted
Date: YYYY-MM-DD

## Context

<forces true at the time — readable without tribal knowledge; mark
reconstructed context explicitly>

## Decision

We <decision>.

## Consequences

- <easier now>
- <harder/constrained now — include the real downsides>
```

## CHANGELOG.md (opt-in — off by default; enable per repo, and only when external consumers exist)

```markdown
# Changelog

Consumer-visible changes. Format: Breaking / Changed / Added / Fixed /
Deprecated, newest release first.

## [Unreleased]

## [X.Y.Z] - YYYY-MM-DD

### Breaking
- <change>. Migration: <steps>.

### Changed
- <consumer-visible behavior change>
```

## README spine (root)

```markdown
# <name>

<one paragraph: what it is, who it's for>

## Quickstart

<the shortest real path to first success>

## Documentation
<links into docs/ — only the sections that exist>
```

## Doc-type openers (first lines set the contract)

- Tutorial: "In this tutorial you'll build <X>. By the end you'll have
  <working end state>."
- How-to: "This guide shows how to <task>. It assumes <starting point>."
- Reference: a scannable structure (table/list) of facts; no prose lead
  needed beyond one orienting sentence.
- Explanation: "<Topic>: why it works the way it does."
