#!/usr/bin/env node
// sync-baseline — deterministic, reviewable baseline upgrades for set-up projects.
//
// Usage (from project root or with --root):
//   node sync-baseline.mjs --check              # exit 1 if pin < latest compatible
//   node sync-baseline.mjs --report             # JSON plan for bots / Renovate
//   node sync-baseline.mjs --upgrade            # apply safe updates, bump pin
//   node sync-baseline.mjs --upgrade --dry-run  # show plan only
//
// Options:
//   --root <dir>       project root (default cwd)
//   --kit-root <dir>   use local Agent Base clone (skip network; for dev/tests)
//   --allow-major      consider latest tag across major versions
//   --json             machine-readable stdout
//
// Exit: 0 ok · 1 pin behind or upgrade had conflicts · 2 usage/internal error

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { readMarker, writeMarker, validateMarker, buildMarker } from './lib/marker.mjs';
import {
  compareSemver, latestCompatibleTag, listRemoteTags, shallowCloneAt, tagToSemver,
} from './lib/release.mjs';
import { planBaselineSync } from './lib/sync-plan.mjs';

function readKitVersion(kitRoot) {
  try {
    const pkg = JSON.parse(readFileSync(join(kitRoot, 'package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function parseArgs(argv) {
  const opt = {
    root: process.cwd(),
    kitRoot: null,
    oldKitRoot: null,
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
    else if (a === '--kit-root') opt.kitRoot = resolve(argv[++i]);
    else if (a === '--old-kit-root') opt.oldKitRoot = resolve(argv[++i]);
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

function checkoutKit(toolRepo, pin, kitRootOverride) {
  if (kitRootOverride) return { path: kitRootOverride, cleanup: null };
  const tmp = mkdtempSync(join(tmpdir(), 'agent-base-sync-'));
  shallowCloneAt(toolRepo, pin, tmp);
  return { path: tmp, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

function applyFileUpdates(projectRoot, kitRoot, relPaths) {
  for (const rel of relPaths) {
    const from = join(kitRoot, rel);
    const to = join(projectRoot, rel);
    if (!existsSync(from)) throw new Error(`missing in kit: ${rel}`);
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
  if (opt.kitRoot) {
    latest = `v${readKitVersion(opt.kitRoot)}`;
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
  if (opt.upgrade && !behind) {
    return {
      ok: true,
      exitCode: 0,
      payload: { pin, latest: targetPin, behind: false, applied: false },
      message: 'already at latest compatible pin',
    };
  }

  let oldCo = null;
  let newCo = null;
  try {
    if (opt.oldKitRoot && opt.kitRoot) {
      oldCo = { path: opt.oldKitRoot, cleanup: null };
      newCo = { path: opt.kitRoot, cleanup: null };
    } else {
      oldCo = checkoutKit(marker.toolRepo, pin, null);
      newCo = checkoutKit(marker.toolRepo, targetPin, opt.kitRoot);
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

    if (opt.report) {
      return {
        ok: plan.conflicts.length === 0,
        exitCode: plan.conflicts.length ? 1 : 0,
        payload,
        message: plan.conflicts.length
          ? `${plan.conflicts.length} conflict(s) block auto-sync`
          : `${plan.updates.length} file(s) ready to sync`,
      };
    }

    if (plan.conflicts.length) {
      return {
        ok: false,
        exitCode: 1,
        payload,
        message: `upgrade blocked: ${plan.conflicts.length} local edit conflict(s)`,
      };
    }

    if (opt.dryRun) {
      return {
        ok: true,
        exitCode: 0,
        payload: { ...payload, applied: false, dryRun: true },
        message: `dry-run: would update ${plan.updates.length} file(s) to ${targetPin}`,
      };
    }

    applyFileUpdates(root, newCo.path, plan.updates);

    const today = new Date().toISOString().slice(0, 10);
    writeMarker(root, buildMarker({
      standard: tagToSemver(targetPin)?.raw ?? String(marker.standard),
      toolRepo: marker.toolRepo,
      pin: targetPin,
      setupAt: marker.setupAt,
      lastSyncedAt: today,
      githubCodeReview: marker.githubCodeReview,
    }));

    return {
      ok: true,
      exitCode: 0,
      payload: { ...payload, applied: true, pin: targetPin, lastSyncedAt: today },
      message: `upgraded baseline ${pin} → ${targetPin} (${plan.updates.length} file(s))`,
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
