# templates/optional-skills

Source for optional skills whose `src` differs from their project `dst` in
the `OPTIONAL_SKILLS` registry (`scripts/lib/baseline.mjs`). Kept out of
`.claude/skills/` because they have no target here — FleetCore itself has no
web or mobile UI, so a UI-verification skill would just be dead weight in
this repo's own context (see `AGENTS.md` "Do Not").

The orchestration-lifecycle optional skills (`checklist-intake`, `log-report`,
`eval-runner`, `tracker-sync`) stay dual-role in `.claude/skills/` — they're
dogfooded here. This directory is for optional skills that are fcore-side
only: never installed into this repo, only shipped into set-up projects via
`fcore skills add <name>` (or selected at setup).

Each subfolder is a normal skill directory (`SKILL.md`, house style R-17
through R-26) — audited on the *project* side after install, not here.
