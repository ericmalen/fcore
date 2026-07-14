---
name: ui-component-pattern
description: Procedure for adding or modifying a component in the <!-- fcore:slot:stack --> layer at <!-- fcore:slot:layer-path -->. Use when a UI component in that layer must be created or changed and should match the codebase's existing component pattern. Not for API endpoints, styling-system overhauls, or layers outside <!-- fcore:slot:layer-path -->.
---

How the layer specialist adds or modifies components in
<!-- fcore:slot:layer-path --> (<!-- fcore:slot:stack -->).

## Procedure

1. Find an existing component as the pattern. Pick one under
   <!-- fcore:slot:layer-path --> that is closest in kind to what you are
   building — same level (page, container, leaf), similar props surface.
   Read it fully: file layout, prop typing, styling approach, test
   placement. That component is your template; do not invent a new style.
   The layer manifest (`<!-- fcore:slot:manifest-path -->`) names the
   framework and build tooling in play.
2. Follow the naming conventions the pattern demonstrates — file name,
   component name, prop names, test file name. Layer conventions:
   <!-- fcore:slot:conventions -->.
3. Keep state local. Component state stays inside the component unless you
   find concrete evidence it must be shared — an existing store the sibling
   components already use, or an acceptance criterion that requires it.
   Cite that evidence in your report if you lift state up.
4. Wire the component the same way its siblings are wired: same export
   style, same registration or routing step if the layer has one.
5. Add or update tests beside the pattern component's tests, matching their
   style and depth.
6. Run `<!-- fcore:slot:test-cmd -->`. Fix failures before reporting.
7. Quote the test command output verbatim in your report — pass/fail counts
   at minimum. Never summarize it away.

## Rules

- One pattern component read end-to-end before any new file is created.
- No new styling approach, state library, or directory layout — extend what
  exists.
- A component that renders but breaks the layer's tests is not done.
