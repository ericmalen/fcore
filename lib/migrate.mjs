import { join } from 'node:path';
import { existsSync, unlinkSync, renameSync, writeFileSync } from 'node:fs';
import { getScaffoldRoot, getConsumerRoot } from './paths.mjs';
import { loadRegistry } from './registry.mjs';
import { readManifest } from './manifest.mjs';
import { confirm } from './prompt.mjs';
import { log } from './log.mjs';
import { audit } from './audit.mjs';
import { enumerate } from './migrate/work-units.mjs';
import { loadRouting, loadScope, saveScope, SCOPE_FILE, ROUTING_FILE } from './migrate/routing.mjs';
import { PLAN_FILE, buildAndWrite, planExists, readPlan } from './migrate/plan.mjs';
import { clear as clearStaging, write as writeStaging } from './migrate/staging.mjs';
import { applyMigration } from './migrate/apply-exec.mjs';
import { stageUnit as stageMarkdownFold } from './migrate/dispositions/markdown-fold.mjs';
import { stageUnit as stageAgentsMdMerge } from './migrate/dispositions/agents-md-merge.mjs';
import { stageUnit as stageJsonMerge } from './migrate/dispositions/json-merge.mjs';
import { stageUnit as stageLeaveAsIs } from './migrate/dispositions/leave-as-is.mjs';
import { stageUnit as stageGithubRoute } from './migrate/dispositions/github-route.mjs';
import { validateRoutingSemantic, formatValidationErrors } from './migrate/routing-validate.mjs';

export async function migrate(flags, aiKitRootOverride) {
  const aiKitRoot = aiKitRootOverride ?? getScaffoldRoot(import.meta.url);
  const consumerRoot = flags._consumerRoot ?? getConsumerRoot();
  const registry = loadRegistry(aiKitRoot);
  const manifest = readManifest(consumerRoot, registry.manifestName);

  if (!manifest) {
    log.error('Not initialized — run `ai-kit init` first.');
    process.exit(1);
  }

  const phase = flags.phase ?? detectPhase(consumerRoot);

  if (phase === 'preflight') {
    await runPreflight(consumerRoot, manifest, flags);
  } else if (phase === 'stage') {
    await runStage(consumerRoot, manifest, flags);
  } else if (phase === 'apply') {
    await runApply(consumerRoot, manifest, registry, flags);
  } else {
    log.error(`Unknown phase: ${phase}. Use preflight, stage, or apply.`);
    process.exit(1);
  }
}

// ── Phase detection ────────────────────────────────────────────────────────

function detectPhase(consumerRoot) {
  if (planExists(consumerRoot)) return 'apply';
  if (existsSync(join(consumerRoot, ROUTING_FILE))) return 'stage';
  return 'preflight';
}

// ── Preflight ──────────────────────────────────────────────────────────────

async function runPreflight(consumerRoot, manifest, _flags) {
  const pending = manifest.pendingIntegration ?? [];
  const unmanaged = manifest.preexistingUnmanaged ?? [];

  if (pending.length === 0 && unmanaged.length === 0) {
    log.blank();
    log.success('  Nothing to migrate — pendingIntegration and preexistingUnmanaged are both empty.');
    log.blank();
    return;
  }

  // Clear stale state from a previous interrupted run
  clearStaging(consumerRoot);
  const routingPath = join(consumerRoot, ROUTING_FILE);
  if (existsSync(routingPath)) unlinkSync(routingPath);

  const units = enumerate(manifest, consumerRoot);

  saveScope(consumerRoot, {
    schemaVersion: 1,
    consumerRoot,
    installedOptInSkills: manifest.installed?.skills ?? [],
    workUnits: units,
  });

  log.blank();
  log.header('  Migration preflight');
  log.blank();
  log.info(`  ${pending.length} pending integration(s), ${unmanaged.length} unmanaged path(s)`);
  log.blank();
  log.info('  Work units:');
  for (const u of units) {
    log.info(`    ${u.id} — ${unitSummary(u)}`);
  }
  log.blank();
  log.dim(`  Scope written → ${SCOPE_FILE}`);
  log.blank();
  log.info(`  Next: invoke the migrator agent. It will read ${SCOPE_FILE}`);
  log.info(`  and write ${ROUTING_FILE} with routing decisions.`);
  log.info('  Then run `ai-kit migrate --phase stage`.');
  log.blank();
}

// ── Stage ──────────────────────────────────────────────────────────────────

async function runStage(consumerRoot, _manifest, _flags) {
  const routingRaw = loadRouting(consumerRoot);
  if (!routingRaw) {
    log.error(`Routing file not found: ${ROUTING_FILE}`);
    log.error('Run preflight + migrator agent first.');
    process.exit(1);
  }

  // Merge agent's h2Routing decisions back into the authoritative scope.
  // The agent only needs to emit h2Routing (+ optionally suggestedH1, skillOverlapNotes).
  // All other fields (manifestDelta, deletions, shimInstall, shimReplace) come from scope.
  const scope = loadScope(consumerRoot);
  const routing = scope ? mergeRoutingIntoScope(scope, routingRaw) : routingRaw;

  // Semantic validation — catch non-canonical targets, stale line ranges, etc.
  const validationErrors = validateRoutingSemantic(routing, consumerRoot);
  if (validationErrors.length > 0) {
    // Rename routing file so it's preserved for debugging but won't be picked up on re-run
    const routingAbs = join(consumerRoot, ROUTING_FILE);
    const failedPath = routingAbs + '.failed';
    renameSync(routingAbs, failedPath);
    log.blank();
    log.error(formatValidationErrors(validationErrors));
    log.blank();
    log.warn(`  Routing JSON preserved at ${ROUTING_FILE}.failed for debugging.`);
    log.info('  Re-invoke the migrator agent to produce a corrected routing JSON.');
    log.blank();
    process.exit(1);
  }

  log.blank();
  log.header('  Building staging files…');
  log.blank();

  clearStaging(consumerRoot);

  const unitResults = [];
  const allSnapshots = new Map(); // file → snapshot (dedup by path)

  for (const unit of routing.workUnits) {
    log.info(`  Staging: ${unit.id} (${unit.type})`);
    const result = dispatch(unit, consumerRoot);
    unitResults.push({ unit, ...result });
    writeStaging(consumerRoot, result.stagingFiles);
    for (const snap of result.premiseSnapshots) {
      allSnapshots.set(snap.file, snap);
    }
  }

  log.blank();
  log.info('  Writing migration plan…');

  buildAndWrite(consumerRoot, {
    units: routing.workUnits,
    stageResults: unitResults,
    premiseSnapshots: [...allSnapshots.values()],
  });

  // Consume routing + scope (no longer needed)
  const scopePath = join(consumerRoot, SCOPE_FILE);
  const routingPath = join(consumerRoot, ROUTING_FILE);
  if (existsSync(scopePath)) unlinkSync(scopePath);
  if (existsSync(routingPath)) unlinkSync(routingPath);

  log.blank();
  log.success(`  ✓ Plan written → ${PLAN_FILE}`);
  log.blank();
  log.info('  Review the plan and staging files before applying:');
  log.dim(`    cat ${PLAN_FILE}`);
  log.blank();
  log.info('  When ready, run `ai-kit migrate --phase apply`.');
  log.blank();
}

// ── Apply ──────────────────────────────────────────────────────────────────

async function runApply(consumerRoot, manifest, registry, flags) {
  if (!planExists(consumerRoot)) {
    log.error(`No plan found. Run preflight + stage first.`);
    process.exit(1);
  }

  if (!flags.yes) {
    log.blank();
    log.header('  Migration plan');
    log.blank();
    log.info(readPlan(consumerRoot));

    const proceed = await confirm('Apply this migration plan?');
    if (!proceed) {
      log.blank();
      log.info('  Aborted. Plan file preserved — run again to re-apply.');
      log.blank();
      return;
    }
  }

  log.blank();
  log.header('  Applying migration…');
  log.blank();

  const { moved, deleted } = applyMigration(consumerRoot, manifest, registry);

  log.success(`  ✓ ${moved} file(s) moved, ${deleted} sidecar(s) deleted.`);
  log.blank();

  const report = await audit({ _consumerRoot: consumerRoot });

  const reportPath = join(consumerRoot, '.claude', 'ai-kit-audit-report.json');
  writeFileSync(reportPath, JSON.stringify({ summary: report.summary, findings: report.findings }, null, 2));

  const e = report.summary.error ?? 0;
  const w = report.summary.warning ?? 0;
  const i = report.summary.info ?? 0;
  const parts = [];
  if (e) parts.push(`${e} error(s)`);
  if (w) parts.push(`${w} warning(s)`);
  if (i) parts.push(`${i} info`);

  if (e > 0 || w > 0) {
    log.warn(`  Audit: ${parts.join(', ')} → see .claude/ai-kit-audit-report.json`);
  } else {
    log.info(`  Audit: clean${i > 0 ? ` (${i} info)` : ''}.`);
  }
  log.blank();
}

// ── Helpers ────────────────────────────────────────────────────────────────

// Merge h2Routing (and suggestedH1, skillOverlapNotes) from the agent's routing JSON
// back into the authoritative scope units. Scope is the single source of truth for
// manifestDelta, deletions, shimInstall, shimReplace — the agent never needs to copy them.
function mergeRoutingIntoScope(scope, routing) {
  const routingById = new Map((routing.workUnits ?? []).map(u => [u.id, u]));
  const merged = scope.workUnits.map(scopeUnit => {
    const routeUnit = routingById.get(scopeUnit.id);
    if (!routeUnit) return scopeUnit;

    if (scopeUnit.type !== 'markdown-fold') return scopeUnit;

    const routingByPath = new Map((routeUnit.sources ?? []).map(s => [s.path, s]));
    return {
      ...scopeUnit,
      skillOverlapNotes: routeUnit.skillOverlapNotes ?? scopeUnit.skillOverlapNotes,
      sources: (scopeUnit.sources ?? []).map(src => {
        const rsrc = routingByPath.get(src.path);
        if (!rsrc) return src;
        const normalized = (rsrc.h2Routing ?? []).map(r => ({
          ...r,
          sourceHeading: ensureH2Prefix(r.sourceHeading ?? r.heading),
          targetHeading: ensureH2Prefix(r.targetHeading),
        }));
        return {
          ...src,
          h2Routing: normalized,
          ...(rsrc.suggestedH1 ? { suggestedH1: rsrc.suggestedH1 } : {}),
        };
      }),
    };
  });
  return { ...scope, workUnits: merged };
}

function ensureH2Prefix(h) {
  if (!h) return h;
  return h.startsWith('## ') ? h : '## ' + h;
}

function dispatch(unit, consumerRoot) {
  switch (unit.type) {
    case 'markdown-fold':       return stageMarkdownFold(unit, consumerRoot);
    case 'agents-md-merge':     return stageAgentsMdMerge(unit, consumerRoot);
    case 'json-merge':          return stageJsonMerge(unit, consumerRoot);
    case 'leave-as-is':         return stageLeaveAsIs(unit, consumerRoot);
    case 'github-skill-route':  return stageGithubRoute(unit, consumerRoot);
    case 'github-agent-route':  return stageGithubRoute(unit, consumerRoot);
    case 'github-tree-cleanup': return stageLeaveAsIs(unit, consumerRoot);
    default: throw new Error(`Unknown unit type: ${unit.type}`);
  }
}

function unitSummary(u) {
  switch (u.type) {
    case 'markdown-fold': {
      const labels = (u.sources ?? []).map(s => {
        const p = s.path ?? s;
        return s?.unscoped ? `${p} [unscoped]` : p;
      });
      return `fold ${labels.join(', ')} → ${u.target}`;
    }
    case 'agents-md-merge': return `add missing sections to ${u.target}`;
    case 'json-merge': return `merge ${u.sources[0]} + ${u.sources[1]} → ${u.target}`;
    case 'leave-as-is': return `review ${(u.paths ?? []).length} unmanaged path(s) (no changes)`;
    case 'github-skill-route': return `route ${u.source} → ${u.target}${u.hasCollision ? ' [collision]' : ''}`;
    case 'github-agent-route': return `route ${u.source} → ${u.target}${u.hasCollision ? ' [collision]' : ''}`;
    case 'github-tree-cleanup': return `sweep ${u.deletions?.length ?? 0} stale .github/ path(s)`;
    default: return u.type;
  }
}
