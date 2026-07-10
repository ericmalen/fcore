---
name: fcore-apply
description: Phase 3 of FleetCore setup — deterministically apply the approved manifest and converge the mechanical gates. Use after the setup plan is approved, in a fresh session.
---

# fcore-apply

The apply step writes the project tree from the approved manifest. You review
the rendered result and iterate — by editing `.setup/manifest.json` and
`.setup/literals/*` ONLY. NEVER edit generated files directly; the
reproducibility gate exists to catch exactly that.

Preconditions: `.setup/manifest.json` parses, and
`node .claude/fcore-onboard/scripts/check.mjs --root . --skip-repro` exits 0.

## Procedure

1. Apply:
   `node .claude/fcore-onboard/scripts/apply.mjs --root . --templates .claude/fcore-onboard/templates`
   First apply snapshots jsonMerge sources into `.setup/merge-sources.json` —
   commit it with the other `.setup/` artifacts (the repro gate merges from
   the snapshot, never the live file). Apply is all-or-nothing on validation
   errors: if it throws (e.g. an existing settings file is invalid JSON(C)),
   nothing was written — fix the named file or route it through the manifest.
   Apply also copies any optional skills named in the marker literal's
   `optionalSkills` (R-55) from the setup window to `.claude/skills/<name>/` —
   these are installed payload, not generated output, so they are absent from
   `generated.json` (the audit confirms their presence instead).
2. Read the generated files end to end. Judge coherence: section order,
   seams between verbatim blocks, orphaned references. Fix by reordering
   manifest entries, adjusting slots, or (sparingly, justified) a merge
   literal — then re-apply. Commit each iteration:
   `git add -A && git commit -m "chore(setup): apply iteration <n>"`
   **Pre-commit hooks:** if the project runs a formatter on commit (husky +
   lint-staged + prettier is common) it can rewrite generated roots
   (`AGENTS.md`/`CLAUDE.md` — `.claude/**` is usually already in
   `.prettierignore`) and break the byte-exact reproducibility gate. Commit
   setup commits with `git commit --no-verify`: the repro gate is the
   source of truth, and the hook only collides on generated files. Do NOT
   hand-edit a generated file to satisfy the formatter — that is still
   editing generated output. (`--no-verify` is for setup commits only; the
   hook stays live for normal development.)
3. Converge the mechanical gates — loop until BOTH exit 0:
   - `node .claude/fcore-onboard/scripts/check.mjs --root . --templates .claude/fcore-onboard/templates`
   - `node .claude/fcore-onboard/scripts/audit.mjs --root . --strict`
     (`--strict` fails on ANY finding — same threshold as the project's
     installed `audit-strict` CI gate; converging non-strict ships a repo
     that fails its own day-one CI)
   Audit findings carry rule IDs; fix via manifest/literal edits and
   re-apply. If an audit finding and repo content genuinely conflict,
   surface it to the user rather than silently dropping content.
4. Regenerate the report: `node .claude/fcore-onboard/scripts/report.mjs --root .`
5. Commit, then tell the user: fresh session → `fcore-verify` (or, with subagents
   enabled, the `fcore-onboard` orchestrator dispatches the next phase automatically).

If the iteration count climbs past ~6 without converging, STOP and report the
blocking pattern to the user (this is pivot-trigger telemetry — record it).