# templates/optional-skills

Source for optional skills whose `src` differs from their project `dst` in
the `OPTIONAL_SKILLS` registry (`scripts/lib/baseline.mjs`). Kept out of
`.claude/skills/` because they have no target here — FleetCore itself has no
web or mobile UI, so a UI skill would just be dead weight in this repo's own
context (see `AGENTS.md` "Do Not").

Two UI families live here. Verification: `ui-verify-web`, `ui-verify-ios`
(drive a browser / the iOS Simulator via MCP). Web generation:
`frontend-design` (visual design guidance, vendored from Anthropic's skills
repo — keep `LICENSE.txt` with it and re-vendor rather than fork) and
`app-ui-craft` (product-UI usability: forms, tables, async states, keyboard
access — authored here). The generation pair installs alongside
`ui-verify-web` so agents build good UIs, not just verify bad ones.

The orchestration-lifecycle optional skills (`checklist-intake`, `log-report`,
`eval-runner`, `tracker-sync`) stay dual-role in `.claude/skills/` — they're
dogfooded here. This directory is for optional skills that are fcore-side
only: never installed into this repo, only shipped into set-up projects via
`fcore skills add <name>` (selected at setup, or installed by
`fcore-fleet-config` when orchestration generation includes the matching
evidence-driven verifier agent — `ui-web-verifier`/`ui-mobile-verifier`).

Each subfolder is a normal skill directory (`SKILL.md`, house style R-17
through R-26) — audited on the *project* side after install, not here.

Sibling directory `templates/stack-skills/` holds the stack skills — same
opt-in tier (R-55), different install trigger: vendored, framework-specific
practice skills matched against a profile layer's `stack`
(`matchStackSkills`, `scripts/lib/orchestration/stack-skills.mjs`) rather
than against a fixed verifier agent in the roster. Same reasoning for living
outside `.claude/skills/`, same install path (`fcore skills add` /
`fcore-fleet-config`).
