---
name: log-report
description: Orchestration handoff-log analytics — aggregates a project's docs/orchestration/handoff-log.jsonl into a per-agent markdown table (dispatch count, failure rate, avg duration, turn utilization) and flags agents with failure rate > 20% or turn utilization > 80%. Use when asked to summarize, analyze, or report on an orchestration handoff log. Only for handoff-log.jsonl produced by orchestration-generated agents; not for generic log files, CI logs, Agent Base test output, or tasks.md status.
---

# log-report

Per-agent health summary of a target's `docs/orchestration/handoff-log.jsonl`.
Group by `to_agent` (the dispatched agent); each entry is one dispatch.

## Metrics

- **dispatches** — entry count.
- **failure rate** — (`failed` + `blocked`) / dispatches.
- **avg duration_ms** — mean of `duration_ms`.
- **turn utilization** — mean of `turns_used / turn_limit`, computed only over
  entries that captured BOTH fields (they are optional); `n/a` when no entry
  for that agent has them. Never guess missing values.
- **flags** — `FAILURE>20%` when failure rate > 20%; `UTIL>80%` when turn
  utilization > 80%.

Each line is validated with `validateHandoffLog` from Agent Base's
[schemas.mjs](../../../scripts/lib/orchestration/schemas.mjs)
(Agent Base-root path; resolution below);
invalid lines are reported with their line number and excluded from stats.

## Run

Locate an Agent Base root first (same resolution as base-check): an Agent Base clone if you
are in one; else the target's `.claude/agent-base-setup/` while the setup
tooling is still present (it carries `scripts/lib/` verbatim); else
shallow-clone the Agent Base repo (URL in `.claude/agent-base.json` → `toolRepo`). From
that root, with the target's log path as the argument:

```
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { validateHandoffLog } from "./scripts/lib/orchestration/schemas.mjs";
const lines = readFileSync(process.argv[1], "utf8").split("\n").filter((l) => l.trim());
const agents = new Map(); const invalid = [];
lines.forEach((line, i) => {
  let entry; try { entry = JSON.parse(line); } catch { invalid.push(`line ${i + 1}: not valid JSON`); return; }
  const errs = validateHandoffLog(entry);
  if (errs.length) { invalid.push(`line ${i + 1}: ${errs.join("; ")}`); return; }
  const a = agents.get(entry.to_agent) ?? { n: 0, fail: 0, dur: 0, util: [] };
  a.n += 1; if (entry.status !== "success") a.fail += 1; a.dur += entry.duration_ms;
  if (Number.isInteger(entry.turns_used) && Number.isInteger(entry.turn_limit)) a.util.push(entry.turns_used / entry.turn_limit);
  agents.set(entry.to_agent, a);
});
invalid.forEach((m) => console.log(`INVALID ${m} (excluded from stats)`));
const pct = (x) => `${(x * 100).toFixed(0)}%`;
console.log("| agent | dispatches | failure rate | avg duration_ms | turn utilization | flags |");
console.log("|---|---|---|---|---|---|");
for (const [name, a] of [...agents.entries()].sort()) {
  const fr = a.fail / a.n;
  const util = a.util.length ? a.util.reduce((s, x) => s + x, 0) / a.util.length : null;
  const flags = [fr > 0.2 ? "FAILURE>20%" : "", util !== null && util > 0.8 ? "UTIL>80%" : ""].filter(Boolean).join(", ") || "—";
  console.log(`| ${name} | ${a.n} | ${pct(fr)} | ${Math.round(a.dur / a.n)} | ${util === null ? "n/a" : pct(util)} | ${flags} |`);
}
' <path-to-target>/docs/orchestration/handoff-log.jsonl
```

## Report

Return the INVALID lines (if any) and the table verbatim, then one sentence
per flagged agent suggesting a follow-up (e.g. raise `turnLimit` in the
blueprint, or inspect `failure_reason` values for the failing agent). An
empty or missing log is reported as "no handoff entries", not an error.
