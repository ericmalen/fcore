# How to integrate the docs package

This guide shows how to add the docs standard to a repository. It assumes
the repo is in git.

## Path A — repo already on FleetCore (or being set up now)

The docs package is **baseline** fcore — it installs automatically when you
set up FleetCore (shipped path-for-path by `install-setup`, alongside the rest
of the permanent baseline). During setup, existing bespoke documentation rules in
your instruction files are `supersede`d by this package (your original text is
preserved in the setup review report). To add it to an already-set-up repo
that predates baseline status, copy from the fcore checkout:

- `.claude/skills/docs-manager/` → `.claude/skills/docs-manager/`
- `.claude/agents/docs-auditor.md` → `.claude/agents/docs-auditor.md`

(Ask your AI assistant to do the copy; then run `docs setup`.)

## Path B — standalone (repo not using fcore)

Same two copies as above — the package has no dependency on the rest of
FleetCore. Both Claude Code and GitHub Copilot (VS Code, agent mode) read those
locations natively; other agents can follow the conventions as plain
files via the AGENTS.md pointer that setup writes.

## Then, in both paths

1. Run `docs setup` (say "set up the docs standard in this repo"). It
   inspects the repo, proposes a proportionality tier with evidence,
   and — after your confirmation — writes the AGENTS.md section and only
   the structures your tier warrants.
2. Routine doc work now activates the standard automatically. The heavy
   audit/migration of existing docs runs only when you explicitly invoke
   the `docs-auditor` agent.
