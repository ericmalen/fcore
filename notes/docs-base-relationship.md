# docs-manager skill · docs-auditor · fcore-check — how they relate

_2026-06-16 · follow-up to the 2026-06-15 share-readiness review. Records the
mental model and the hardening applied on `erm/chore/share-readiness-followups`._

## They sit on two different axes

The three are easy to conflate but operate on **disjoint surfaces** — they are
complementary, not competing.

**Documentation-content axis — `docs-auditor` (agent) → `docs-manager` (skill).**
A propose→execute pair. The auditor reads everything and proposes a plan,
changing nothing (`tools: Read, Grep, Glob, Bash`). The skill executes —
writes docs, sorts files into Diátaxis quadrants, rewrites links. Both concern
documentation quality only.

**AI-config-conformance axis — `fcore-check` (skill) → `scripts/audit.mjs`.**
Audits the AI-config surface (AGENTS.md, skills, agents, settings) against the
R-rules in `spec/rules.md`. It never inspects `docs/` prose; no rule in the
catalog governs doc content (only R-07 reference-resolution and R-48
one-README touch docs at all).

**Naming trap:** `scripts/check.mjs` is a *third, separate* thing — the
setup-pipeline gate (completeness / tiling / reproducibility / scope over the
manifest), used by fcore-apply/fcore-verify. It is **not** the conformance audit.
Don't conflate it with "fcore check."

## Ordering

- Within docs-manager: auditor **before** skill (propose → human approval → execute) —
  but only for heavy audits/migrations; routine edits skip the auditor.
- docs-manager vs fcore-check: orthogonal, so neither is a prerequisite. But run
  **fcore-check after any docs restructure**, because a restructure can edit
  AGENTS.md (adds the Documentation section) and rewrite links in `.claude/**`
  / `spec/`. fcore-check is the net that catches what that introduces — e.g.
  AGENTS.md crossing the R-02 size cap, or a broken R-07 reference.

## Can running docs-manager ruin fcore?

Bounded, and now guarded:

- **In a consumer repo:** low. The only overlap is docs rewriting inbound
  links in `.claude/**` (edits link targets, never deletes) plus adding the
  AGENTS.md docs section.
- **In FleetCore itself:** higher, because `spec/` and `.claude/` are both
  live config *and* declared doc locations. The concrete failure mode: a
  careless docs reformat touching `spec/rules.md` could break the strict
  `**R-NN · title · type · enforcement**` line format that `rule-check-map.mjs`
  and the audit parse by regex. fcore-check would **not** catch that —
  `audit.mjs` is closed-world over the AI-config surface; `rules.md` integrity
  is guarded by the FleetCore CI gate (`rule-check-map`), not by fcore-check.
- **Mitigation added (4a):** the docs-manager skill now carries an explicit
  non-negotiable carve-out — source-of-truth and live-config files
  (`spec/` rule catalogs / target layouts, `.claude/**`, `AGENTS.md`/`CLAUDE.md`)
  are never reclassified, moved, reformatted, or split by a restructure; only
  their links may be rewritten. The risk drops from "process guardrail only" to
  a written invariant in the skill.

## Is fcore-check thorough enough — does it enforce all rules?

Split answer:

- **Mechanical rules: yes, provably.** `rule-check-map.mjs` gates that every
  mechanical/"audit" rule has a matching check, no check emits a retired ID,
  and `--strict` escalation arrows are in sync.
- **Judgment rules (~12: R-05/06/08/12/16/21/24/29/33/34/36/37): no — not
  mechanically.** They live in `references/rubric.md`. fcore-check ran them as an
  *advisory* pass with no forcing function.
- **Mitigation added (4b):** the fcore-check skill now makes the rubric pass a
  **required** step whenever an instruction-bearing file changed (skippable only
  when none did, and the skip must be stated). Still LLM-judgment, but no longer
  silently optional.

## Follow-up branch changes (post-1.2.1)

1. **Verifier sabotage** — completed the matrix in
   `validate-setup/references/sabotage.md` with the missing prompt-injection
   scenario (now n/4); resolved the 4 `test.todo` placeholders in
   `seeded-defects.test.mjs` into a pointer comment (the mechanical half stays
   unit-tested in `fixtures.test.mjs`).
2. **Dead eval scaffolding** — removed `notes/skill-workspaces/` from version
   control and gitignored it (mirrors `reports/`).
3. **Orchestration docs** — moved the internal pilot protocol out of consumer
   `docs/how-to/` to `notes/orchestration-pilot.md`, links rewritten. README
   already gates orchestration to one optional line.
4. **Boundary hardening** — 4a + 4b above.
