# Phase 3 results — interim (sandbox runs, June 2026)

Provenance per row matters: **CC-real** = actual Claude Code v2.1.170, headless,
in the sandbox. **Sandbox-pipeline** = the adoption pipeline driven directly with
fresh-context subagents playing the verifier (faithful to the fresh-session
model; not the Claude Code harness). **Owner-interactive** = pending — your
runbook runs (full Claude Code UX + the entire Copilot column).

## mixed-messy: full adoption run — COMPLETED, gates green

| Step | Provenance | Result |
|---|---|---|
| Phase 1 inventory | **CC-real** | ✅ one shot: skill triggered headless, preconditions, branch, extractor, commit, candidates flagged, fresh-session handoff |
| Phase 2 plan (opening) | **CC-real** | ✅ triage judgment correct: both candidates ruled in-scope; commit-then-`--include` re-extract executed as designed |
| Phase 2 plan (manifest) | Sandbox-pipeline | ✅ 11 nodes + 2 candidates dispositioned; check --skip-repro clean |
| Phase 3 materialize + gates | Sandbox-pipeline | ✅ 13 files generated, 4 sources removed; check (incl. reproducibility) + audit exit 0 |
| Verifier invocation ① | Fresh subagent | ✅ matrix produced, no skipped rows; **9 coherence findings incl. a real kit template bug** |
| Fix loop (manifest-only edits) | Sandbox-pipeline | ✅ iteration 2 converged; coherent AGENTS.md, all canonical sections |
| Verifier invocation ② | Fresh subagent | ✅ independently sha-verified claims; 8 KEEP, **1 ESCALATE-TO-HUMAN** (correct behavior); caught inaccurate drop reasons + a bookkeeping defect |
| Sentinels | — | ✅ 7/7 accounted: 6 present in output, 1 (S-010) dropped-with-reason, full text in report |
| Merged-bytes | — | 23.2% — distorted by tiny fixture (two merges, both verbatim-or-better; one forced by frontmatter, one stripping fixture meta-text). Re-baseline on `large` |

### Defects found and FIXED during the run (the point of Phase 3)

1. **Mixed-file design gap:** forced-include files with human + AI content
   (CONTRIBUTING.md) couldn't be reassembled — scope gate rejected the source
   path as target. Fix: inventoried source paths are valid targets.
2. **Kit template bug (verifier ① find):** ai-kit-check pointed at a
   nonexistent script path — would have shipped broken into every adoption.
3. **Audit blind spot:** adoption tooling itself was being audited (false
   R-53/R-45/R-21 findings from the tooling's own template/skills). Fix:
   tooling exclusion mirroring the extractor's.
4. **Heading-seam pattern (verifier ① find):** verbatim blocks carry source
   headings into slots → duplicate/conflicting headings. Fix: documented
   split-strip pattern in the manifest reference (extraction-first compatible).
5. **Deletion bookkeeping (verifier ② find):** `generated.json` deleted-list
   was an existence side effect, not manifest-derived. Fixed.
6. **Inaccurate boilerplate drop reasons (verifier ② find):** reasons must be
   per-entry accurate; requirement added to the manifest reference.

### Open items from the run

- **ESCALATE (needs Eric):** n0004 tabs-vs-spaces conflict — adoption chose
  AGENTS.md's "tabs" over the older CLAUDE.md's "spaces" and dropped the
  loser with full text in the report. Verifier correctly demands explicit
  human ack. (In real adoptions this is a Gate-1/Gate-2 decision; the
  fixture's contradiction is intentional.)
- Template enhancement (queued, Phase 4): optional skeleton sections should
  collapse when their slot is empty (empty Overview/Architecture headings).
- Cosmetic: blank-line seams between concatenated single-line rules.

## Harness notes (sandbox-specific, not product findings)

Headless `claude -p` works for short phases (phase 1 fits one window) but the
sandbox's 45s/command cap kills long judgment turns mid-generation; resume
replay then exceeds the window itself. Full headless phases need an
uncapped environment — colleagues' interactive sessions have no such cap.
This is why plan/materialize/verify above are sandbox-pipeline provenance.

## Remaining for Phase 3 completion

1. Sabotage runs ×3 (catch-rate metric) — fresh-subagent verifier per defect.
2. Remaining fixtures through the pipeline (greenfield ✅ already via tests;
   claude-only, copilot-only, adversarial, injection, large).
3. **Owner runbook runs** (docs/validation-runbook.md): full interactive
   Claude Code UX + the entire Copilot column + the two VS Code live checks.
   These cannot be produced in the sandbox and gate the go/no-go.
