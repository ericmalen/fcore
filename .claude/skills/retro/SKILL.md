---
name: retro
description: Orchestration quality-flywheel intake — turns one shipped bug report or substantive review finding from an orchestration-generated repo into exactly one new item in that repo's docs/orchestration/checklists/review-checklist.md, which the generated code-reviewer applies on every review. Use when a bug or review finding from orchestration-generated work needs to feed the review checklist. Not for general retrospectives, Agent Base-development bugs, or findings outside orchestration-generated repos; not for editing or reorganizing existing checklist items.
---

# retro

One finding in, one checklist item out. The target's
`docs/orchestration/checklists/review-checklist.md` is the flywheel: every
shipped bug or substantive review finding becomes a check the generated
code-reviewer applies to ALL future diffs.

## Input

A single bug report (`BUG-###`) or review finding (`PR-###`) from an
orchestration-generated repo, with enough detail to know what went wrong.

## Procedure

1. **Triage first.** If the root cause is a defect in an Agent Base template,
   blueprint, or skill (the same flaw would be regenerated), say so and route
   the fix there — do NOT add a checklist item. The checklist is for review
   judgment, not for papering over generation defects.
2. **Read the existing checklist** at
   `docs/orchestration/checklists/review-checklist.md` in the project. If
   absent, create it containing only a `# Review checklist` heading.
3. **Number.** Next CHK number = max existing CHK-### + 1; `CHK-001` if none
   exist. Never renumber or rewrite existing items.
4. **Generalize.** Distill the finding into one imperative check a reviewer
   can apply to ANY future diff — strip the incident specifics, keep the
   class of mistake. Example: "null deref in tag handler" becomes "check new
   handlers guard null inputs before member access".
5. **Append exactly one line** to the end of the file:

   ```
   - [ ] CHK-### (src: BUG-### or PR-###): <imperative, generally-applicable check>
   ```

## Rules

- One finding → at most one item. Never batch several checks from one finding.
- Append-only: existing items are immutable (numbers, text, order, state).
- If the distilled check duplicates an existing item, report the existing
  CHK-### instead of appending a near-duplicate.
- The src tag cites the originating BUG-### or PR-### so the item stays
  traceable.
