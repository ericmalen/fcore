# How to adopt the docs package

This guide shows how to add the docs standard to a repository. It assumes
the repo is in git.

## Path A — repo already on ai-kit (or adopting it now)

The package is part of the ai-kit catalog. During ai-kit adoption, existing
bespoke documentation rules in your instruction files are `supersede`d by
this package (your original text is preserved in the adoption review
report). To add it to an already-adopted repo, copy from the kit clone:

- `catalog/skills/docs/` → `.claude/skills/docs/`
- `catalog/agents/docs-auditor.md` → `.claude/agents/docs-auditor.md`

(Ask your AI assistant to do the copy; then run `docs setup`.)

## Path B — standalone (repo not using ai-kit)

Same two copies as above — the package has no dependency on the rest of
the kit. Both Claude Code and VS Code Copilot (agent mode) read those
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
