---
name: api-testing
description: Procedure for testing API endpoint changes in the <!-- agent-base:slot:stack --> layer at <!-- agent-base:slot:layer-path -->. Use when an endpoint, handler, or route in that layer is added or modified and its behavior must be proven with tests. Not for UI testing, schema migrations, or layers outside <!-- agent-base:slot:layer-path -->.
---

How the layer specialist tests endpoint changes in
`<!-- agent-base:slot:layer-path -->` (<!-- agent-base:slot:stack -->).

## Procedure

1. Locate the existing test patterns. Find tests under
   `<!-- agent-base:slot:layer-path -->` that exercise endpoints similar to the
   one you changed — same router, same handler style. Read at least one
   end-to-end before writing anything: its setup, fixtures, assertion style,
   and file placement are your pattern.
2. Write or extend tests beside the ones you found, in the same directory
   and naming style. Follow the layer conventions:
   <!-- agent-base:slot:conventions -->.
3. Cover the change, not just the happy path:
   - **Request validation** — malformed bodies, missing required fields,
     wrong types; assert the rejection status and error shape.
   - **Error paths** — not-found, unauthorized, downstream failure; one test
     per distinct error response the endpoint can return.
   - **Contract with shared schemas** — if the endpoint's request or
     response types come from a shared schema or types package, assert
     against those definitions rather than re-declaring shapes inline, so
     contract drift fails the test.
4. Run `<!-- agent-base:slot:test-cmd -->`. Fix failures before reporting.
5. Quote the test command output verbatim in your report — pass/fail counts
   at minimum. Never summarize it away.

## Rules

- New endpoint behavior without a test is incomplete work.
- Extend the existing pattern; do not introduce a new test framework,
  helper layer, or directory layout.
- A skipped or commented-out test counts as a failing test.
