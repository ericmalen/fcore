# Decision-record workflow

> **Opt-in — off by default.** Decision records are produced only when
> `docs/decisions/` is listed in `.claude/docs-paths.json` `docsPaths`
> (the human enables them). Otherwise a decision's rationale lives in its
> commit/PR. The workflow below applies once the surface is enabled.

## When a decision warrants a record

Record it when the decision (a) constrains future work, (b) was made
between real alternatives, and (c) someone will later ask "why is it like
this?". Signals: choosing a dependency/platform/protocol, a schema or API
shape that's expensive to reverse, a deliberate deviation from a default
or standard, rejecting an obvious approach. Not record material: reversible
implementation detail, style preferences (those are conventions), choices
with no real alternative.

Recognize the moment proactively: when a change you're documenting or
implementing embodies such a decision and no record exists, offer to write
one — don't wait to be asked.

## Format (context → decision → consequences)

File: `docs/decisions/NNNN-short-slug.md`, NNNN zero-padded, append-only.
Skeleton in [templates](templates.md). Sections:

- **Status**: Accepted | Superseded by NNNN. Never edit a decision
  after acceptance — write a new record that supersedes it and update only
  the old one's Status line. Never delete.
- **Context**: the forces that were true at the time. Write it so a reader
  in two years understands the situation without tribal knowledge.
- **Decision**: one decision, stated actively ("We use X for Y").
- **Consequences**: what becomes easier, what becomes harder, what is now
  constrained — including the negative ones. A record with only upsides is
  marketing, not a record.

## Rationale integrity (non-negotiable)

Write only rationale you can source: the diff, the discussion, the author,
the constraints visible in code. If the "why" is unrecoverable, the
Context section says exactly that ("rationale not recorded at the time;
reconstructed context follows…") or you ask the author. NEVER invent a
plausible-sounding reason — a false "why" is worse than a missing one.

## Backfilling

When asked to document an old decision: gather evidence (git history,
code, the human), date the record with today's date noting the decision's
approximate original date, and mark reconstructed context explicitly.
