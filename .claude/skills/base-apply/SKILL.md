---
name: base-apply
description: Phase 3 of Agent Base setup — deterministically apply the approved manifest and converge the mechanical gates. Use after the setup plan is approved, in a fresh session.
---

# base-apply

The apply step writes the project tree from the approved manifest. You review
the rendered result and iterate — by editing `.setup/manifest.json` and
`.setup/literals/*` ONLY. NEVER edit generated files directly; the
reproducibility gate exists to catch exactly that.

Preconditions: `.setup/manifest.json` parses, and
`node .claude/agent-base-setup/scripts/check.mjs --root . --skip-repro` exits 0.

## Procedure

1. Apply:
   `node .claude/agent-base-setup/scripts/apply.mjs --root . --templates .claude/agent-base-setup/templates`
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
   - `node .claude/agent-base-setup/scripts/check.mjs --root . --templates .claude/agent-base-setup/templates`
   - `node .claude/agent-base-setup/scripts/audit.mjs --root .`
   Audit findings carry rule IDs; fix via manifest/literal edits and
   re-apply. If an audit finding and repo content genuinely conflict,
   surface it to the user rather than silently dropping content.
4. Regenerate the report: `node .claude/agent-base-setup/scripts/report.mjs --root .`
5. Commit, then tell the user: fresh session → `base-verify`.

If the iteration count climbs past ~6 without converging, STOP and report the
blocking pattern to the user (this is pivot-trigger telemetry — record it).