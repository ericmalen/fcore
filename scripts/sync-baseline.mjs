#!/usr/bin/env node
// sync-baseline — deterministic, reviewable baseline upgrades for set-up projects.
//
// Usage (from project root or with --root):
//   node sync-baseline.mjs --check              # exit 1 if pin < latest compatible
//   node sync-baseline.mjs --report             # JSON plan for bots / Renovate
//   node sync-baseline.mjs --upgrade            # apply safe updates, bump pin
//                                               # (at a current pin: restores missing baseline files;
//                                               #  local edits report as drift, never block repair)
//   node sync-baseline.mjs --upgrade --dry-run  # show plan only
//
// Options:
//   --root <dir>           project root (default cwd)
//   --base-root <dir>      local base checkout as the NEW (target) version.
//                          NOTE: --report/--upgrade still shallow-clone the
//                          CURRENT pin unless --old-base-root is also given;
//                          pass both to run fully offline.
//   --old-base-root <dir>  local checkout of the CURRENT pin (with --base-root)
//   --allow-major          consider latest tag across major versions
//   --json                 machine-readable stdout
//
// Exit: 0 ok · 1 pin behind or upgrade had conflicts · 2 usage/internal error (incl. pin ahead of target)

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { readMarker, writeMarker, validateMarker, buildMarker } from './lib/marker.mjs';
import {
  compareSemver, latestCompatibleTag, listRemoteTags, shallowCloneAt, tagToSemver,
} from './lib/release.mjs';
import { planBaselineSync } from './lib/sync-plan.mjs';

function readBaseVersion(baseRoot) {
  try {
    const pkg = JSON.parse(readFileSync(join(baseRoot, 'package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function parseArgs(argv) {
  const opt = {
    root: process.cwd(),
    baseRoot: null,
    oldBaseRoot: null,
    check: false,
    report: false,
    upgrade: false,
    dryRun: false,
    allowMajor: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') opt.root = resolve(argv[++i]);
    else if (a === '--base-root' || a === '--kit-root') opt.baseRoot = resolve(argv[++i]); // --kit-root: legacy alias
    else if (a === '--old-base-root' || a === '--old-kit-root') opt.oldBaseRoot = resolve(argv[++i]);
    else if (a === '--check') opt.check = true;
    else if (a === '--report') opt.report = true;
    else if (a === '--upgrade') opt.upgrade = true;
    else if (a === '--dry-run') opt.dryRun = true;
    else if (a === '--allow-major') opt.allowMajor = true;
    else if (a === '--json') opt.json = true;
    else throw new Error(`unknown flag: ${a}`);
  }
  if (+!!opt.check + +!!opt.report + +!!opt.upgrade !== 1) {
    throw new Error('specify exactly one of --check, --report, --upgrade');
  }
  return opt;
}

function checkoutBase(toolRepo, pin, baseRootOverride) {
  if (baseRootOverride) return { path: baseRootOverride, cleanup: null };
  const tmp = mkdtempSync(join(tmpdir(), 'agent-base-sync-'));
  shallowCloneAt(toolRepo, pin, tmp);
  return { path: tmp, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

function applyFileUpdates(projectRoot, baseRoot, relPaths) {
  for (const rel of relPaths) {
    const from = join(baseRoot, rel);
    const to = join(projectRoot, rel);
    if (!existsSync(from)) throw new Error(`missing in Agent Base: ${rel}`);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
  }
}

export function runSyncBaseline(opt) {
  const root = resolve(opt.root);
  const marker = readMarker(root);
  const errors = validateMarker(marker);
  if (errors.length) {
    return { ok: false, exitCode: 2, error: `invalid marker: ${errors.join('; ')}` };
  }

  const pin = marker.pin ?? `v${marker.standard}`;
  const pinSem = tagToSemver(pin);

  let latest;
  if (opt.baseRoot) {
    latest = `v${readBaseVersion(opt.baseRoot)}`;
  } else {
    try {
      const tags = listRemoteTags(marker.toolRepo);
      latest = latestCompatibleTag(tags, pin, { allowMajor: opt.allowMajor }) ?? pin;
    } catch (e) {
      return { ok: false, exitCode: 2, error: e.message };
    }
  }

  const latestSem = tagToSemver(latest);
  const behind = pinSem && latestSem ? compareSemver(pinSem, latestSem) < 0 : false;

  if (opt.check) {
    const payload = { pin, latest, behind, toolRepo: marker.toolRepo };
    return {
      ok: !behind,
      exitCode: behind ? 1 : 0,
      payload,
      message: behind
        ? `baseline pin ${pin} is behind latest compatible ${latest}`
        : `baseline pin ${pin} is current`,
    };
  }

  const targetPin = latest;

  // Pin ahead of target (stale --base-root checkout, deleted remote tags):
  // proceeding would silently downgrade files and the marker.
  if (!behind && pinSem && latestSem && compareSemver(pinSem, latestSem) > 0) {
    return {
      ok: false,
      exitCode: 2,
      error: `baseline pin ${pin} is ahead of target ${targetPin} — stale --base-root checkout or missing remote tags; refusing to sync`,
    };
  }

  let oldCo = null;
  let newCo = null;
  try {
    if (opt.oldBaseRoot && opt.baseRoot) {
      oldCo = { path: opt.oldBaseRoot, cleanup: null };
      newCo = { path: opt.baseRoot, cleanup: null };
    } else if (!behind) {
      // Pin current: old and new baselines are identical, so one checkout
      // serves both sides and the plan reduces to missing-file repair.
      newCo = checkoutBase(marker.toolRepo, targetPin, opt.baseRoot);
      oldCo = newCo;
    } else {
      oldCo = checkoutBase(marker.toolRepo, pin, null);
      newCo = checkoutBase(marker.toolRepo, targetPin, opt.baseRoot);
    }

    const plan = planBaselineSync(root, oldCo.path, newCo.path);
    const payload = {
      pin,
      targetPin,
      latest: targetPin,
      behind,
      toolRepo: marker.toolRepo,
      ...plan.summary,
      updates: plan.updates,
      conflicts: plan.conflicts,
    };

    // Local edits only block an upgrade (the old → new delta could overwrite
    // them). At a current pin there is no delta: repair restores missing
    // files, leaves edited files untouched, and reports them as drift —
    // policing content drift is base-check's job, not sync's.
    const blocked = behind && plan.conflicts.length > 0;
    const drift = !behind && plan.conflicts.length
      ? ` (${plan.conflicts.length} locally edited file(s) left untouched)`
      : '';

    if (opt.report) {
      return {
        ok: !blocked,
        exitCode: blocked ? 1 : 0,
        payload,
        message: blocked
          ? `${plan.conflicts.length} conflict(s) block auto-sync`
          : behind
            ? `${plan.updates.length} file(s) ready to sync`
            : `${plan.updates.length} missing baseline file(s) to restore${drift}`,
      };
    }

    if (blocked) {
      return {
        ok: false,
        exitCode: 1,
        payload,
        message: `upgrade blocked: ${plan.conflicts.length} local edit conflict(s)`,
      };
    }

    if (!behind && plan.updates.length === 0) {
      return {
        ok: true,
        exitCode: 0,
        payload: { ...payload, applied: false },
        message: `already at latest compatible pin${drift}`,
      };
    }

    if (opt.dryRun) {
      return {
        ok: true,
        exitCode: 0,
        payload: { ...payload, applied: false, dryRun: true },
        message: behind
          ? `dry-run: would update ${plan.updates.length} file(s) to ${targetPin}`
          : `dry-run: would restore ${plan.updates.length} missing baseline file(s) at ${targetPin}${drift}`,
      };
    }

    applyFileUpdates(root, newCo.path, plan.updates);

    const today = new Date().toISOString().slice(0, 10);
    // Spread the existing marker first: fields a project added beyond the six
    // canonical ones survive the upgrade (buildMarker emits only its own).
    const { present, invalid, ...markerRest } = marker;
    writeMarker(root, {
      ...markerRest,
      ...buildMarker({
        standard: tagToSemver(targetPin)?.raw ?? String(marker.standard),
        toolRepo: marker.toolRepo,
        pin: targetPin,
        setupAt: marker.setupAt,
        lastSyncedAt: today,
        githubCodeReview: marker.githubCodeReview,
      }),
    });

    return {
      ok: true,
      exitCode: 0,
      payload: { ...payload, applied: true, pin: targetPin, lastSyncedAt: today },
      message: behind
        ? `upgraded baseline ${pin} → ${targetPin} (${plan.updates.length} file(s))`
        : `restored ${plan.updates.length} missing baseline file(s) at ${targetPin}${drift}`,
    };
  } finally {
    oldCo?.cleanup?.();
    if (newCo?.cleanup && newCo.path !== oldCo?.path) newCo.cleanup();
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const opt = parseArgs(process.argv.slice(2));
    const result = runSyncBaseline(opt);
    if (opt.json) {
      console.log(JSON.stringify(result.payload ?? { error: result.error }, null, 2));
    } else if (result.message) {
      console.log(`sync-baseline: ${result.message}`);
    } else if (result.error) {
      console.error(`sync-baseline: ${result.error}`);
    }
    process.exit(result.exitCode ?? (result.ok ? 0 : 1));
  } catch (e) {
    console.error(`sync-baseline: ${e.message}`);
    process.exit(2);
  }
}
