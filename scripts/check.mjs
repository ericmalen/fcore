#!/usr/bin/env node
// check — mechanical gates over manifest + inventory.
//   1. Completeness: every node and sweep candidate has exactly one disposition
//   2. Tiling: split ranges exactly cover the node (gaps = explicit drops)
//   3. Reproducibility: re-applying equals the working tree byte-for-byte
//   4. Scope: targets confined to AI-config surfaces
//
// The AI converges these gates by editing manifest/literals ONLY — never
// generated output.
//
// Usage: node scripts/check.mjs [--root <dir>] [--templates <dir>]
//                               [--skip-repro] [--json]
// Exit: 0 = all gates pass · 1 = violations · 2 = internal error

import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  loadManifest, loadInventory, validateShape, entriesByNode,
  keepFiles, outOfScopeFiles, isAllowedTarget,
} from './lib/manifest.mjs';
import { splitLinesKeepEnds } from './lib/extract.mjs';
import { apply } from './apply.mjs';
import { flagValue } from './lib/cli-args.mjs';

const sha = (t) => createHash('sha256').update(t).digest('hex');

export function check({ root, templatesDir, skipRepro = false }) {
  root = resolve(root);
  const setupDir = join(root, '.setup');
  const violations = [];
  const v = (gate, message) => violations.push({ gate, message });

  let manifest, inventory;
  try {
    manifest = loadManifest(setupDir);
    inventory = loadInventory(setupDir);
  } catch (e) {
    return { violations: [{ gate: 'load', message: e.message }] };
  }

  for (const err of validateShape(manifest)) v('shape', err);
  if (violations.length) return { violations }; // shape errors block the rest

  const byNode = entriesByNode(manifest);
  const keep = keepFiles(manifest);
  const oos = outOfScopeFiles(manifest);

  // ── 1. Completeness ────────────────────────────────────────────────────────
  const fileOfNode = new Map();
  for (const f of inventory.files) for (const id of f.nodes) fileOfNode.set(id, f.path);

  for (const [id, file] of fileOfNode) {
    const entries = byNode.get(id) ?? [];
    const covered = entries.length + (keep.has(file) ? 1 : 0);
    if (covered === 0) v('completeness', `node ${id} (${file}) has no disposition`);
    if (covered > 1) v('completeness', `node ${id} (${file}) has ${covered} dispositions — exactly one required`);
  }
  for (const id of byNode.keys()) {
    if (!fileOfNode.has(id)) v('completeness', `manifest references unknown node ${id}`);
  }
  for (const f of keep) {
    if (!inventory.files.some((x) => x.path === f)) v('completeness', `keep-file references non-inventoried file ${f}`);
  }
  for (const c of inventory.sweepCandidates) {
    const adopted = inventory.files.some((x) => x.path === c.file); // force-included on re-extract
    if (!oos.has(c.file) && !adopted) {
      v('completeness', `sweep candidate ${c.file} has no disposition (out-of-scope with reason, or re-extract with --include)`);
    }
  }
  // supersede deletes content against a catalog replacement — the replacement
  // must actually exist, or the disposition is a disguised drop
  for (const entry of manifest.entries) {
    if (entry.op !== 'supersede') continue;
    const skillRel = join('.claude', 'skills', entry.catalogSkill, 'SKILL.md');
    if (!existsSync(join(root, skillRel))) {
      v('completeness', `supersede of ${entry.node}: catalog skill "${entry.catalogSkill}" not found (${skillRel} missing)`);
    }
  }

  // ── 2. Tiling ──────────────────────────────────────────────────────────────
  for (const entry of manifest.entries) {
    if (entry.op !== 'split') continue;
    const nodePath = join(setupDir, 'nodes', entry.node);
    if (!existsSync(nodePath)) { v('tiling', `split node ${entry.node} bytes missing`); continue; }
    const total = splitLinesKeepEnds(readFileSync(nodePath, 'utf8')).length;
    const ranges = [...entry.ranges].sort((a, b) => a.lines[0] - b.lines[0]);
    let cursor = 1;
    for (const r of ranges) {
      if (r.lines[0] > cursor) {
        v('tiling', `split ${entry.node}: gap at lines ${cursor}-${r.lines[0] - 1} — add an explicit drop range with a reason`);
      } else if (r.lines[0] < cursor) {
        v('tiling', `split ${entry.node}: overlap at line ${r.lines[0]}`);
      }
      cursor = Math.max(cursor, r.lines[1] + 1);
    }
    if (cursor <= total) {
      v('tiling', `split ${entry.node}: gap at lines ${cursor}-${total} — add an explicit drop range with a reason`);
    }
    if (cursor > total + 1) {
      v('tiling', `split ${entry.node}: ranges exceed node length (${total} lines)`);
    }
  }

  // ── 3. Targets, literals, scope ────────────────────────────────────────────
  const inventoriedPaths = new Set(inventory.files.map((f) => f.path));
  const checkTarget = (t, where) => {
    if (!isAllowedTarget(t, inventoriedPaths)) v('scope', `${where}: target "${t}" outside AI-config surfaces`);
  };
  for (const entry of manifest.entries) {
    if (entry.op === 'move' || entry.op === 'merge') checkTarget(entry.target, `node ${entry.node}`);
    if (entry.op === 'split') {
      for (const r of entry.ranges) if (r.target) checkTarget(r.target, `node ${entry.node}`);
    }
    if (entry.op === 'merge' && !existsSync(join(setupDir, entry.literal))) {
      v('scope', `merge literal "${entry.literal}" does not exist under .setup/`);
    }
    if (entry.op === 'drop' && !entry.reason?.trim()) {
      v('scope', `drop of ${entry.node} has an empty reason`);
    }
  }
  for (const jm of manifest.jsonMerges ?? []) checkTarget(jm.file, 'jsonMerges');
  for (const ins of manifest.installs ?? []) {
    checkTarget(ins.file, 'installs');
    if (ins.literal && !existsSync(join(setupDir, ins.literal))) {
      v('scope', `install literal "${ins.literal}" does not exist under .setup/`);
    }
    if (ins.template && templatesDir && !existsSync(join(templatesDir, ins.template))) {
      v('scope', `install template "${ins.template}" does not exist in templates dir`);
    }
  }

  // ── 4. Reproducibility ─────────────────────────────────────────────────────
  if (!skipRepro && violations.length === 0) {
    const genPath = join(setupDir, 'generated.json');
    if (!existsSync(genPath)) {
      v('reproducibility', 'no generated.json — run apply first');
    } else {
      const recorded = JSON.parse(readFileSync(genPath, 'utf8'));
      const tmp = mkdtempSync(join(tmpdir(), 'fcore-repro-'));
      try {
        const fresh = apply({ root, templatesDir, outRoot: tmp });
        const paths = new Set([...Object.keys(recorded.generated), ...Object.keys(fresh.generated)]);
        for (const p of paths) {
          const wtAbs = join(root, p);
          if (!existsSync(wtAbs)) { v('reproducibility', `generated file missing from working tree: ${p}`); continue; }
          const wtSha = sha(readFileSync(wtAbs, 'utf8'));
          if (fresh.generated[p] !== wtSha) {
            v('reproducibility', `${p}: working tree differs from re-applied output — route the change through manifest/literals, never edit generated files`);
          }
        }
        // the FRESH deletion set, not the recorded one: a manifest edited
        // after apply must be judged against what apply would do NOW
        for (const p of fresh.deleted ?? []) {
          if (existsSync(join(root, p))) v('reproducibility', `source file ${p} should have been removed by apply but exists`);
        }
      } catch (e) {
        v('reproducibility', `re-apply failed: ${e.message}`);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }
  }

  return { violations };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const opt = { root: process.cwd(), templates: null, skipRepro: false, json: false };
  const usage = (msg) => { console.error(`check: ${msg}`); process.exit(2); };
  let i = 0;
  const value = (flag) => { const v = flagValue(args, i, flag, usage); i += 1; return v; };
  for (; i < args.length; i++) {
    if (args[i] === '--root') opt.root = value('--root');
    else if (args[i] === '--templates') opt.templates = value('--templates');
    else if (args[i] === '--skip-repro') opt.skipRepro = true;
    else if (args[i] === '--json') opt.json = true;
    else usage(`unknown flag ${args[i]}`);
  }
  if (!opt.templates) {
    opt.templates = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
  }
  const { violations } = check({ root: opt.root, templatesDir: opt.templates, skipRepro: opt.skipRepro });
  if (opt.json) {
    console.log(JSON.stringify({ pass: violations.length === 0, violations }, null, 2));
  } else if (violations.length === 0) {
    console.log('check: all gates pass (completeness, tiling, scope' + (opt.skipRepro ? '' : ', reproducibility') + ').');
  } else {
    for (const x of violations) console.log(`[${x.gate}] ${x.message}`);
    console.log(`\n${violations.length} violation(s). Fix by editing manifest/literals only.`);
  }
  process.exit(violations.length === 0 ? 0 : 1);
}
