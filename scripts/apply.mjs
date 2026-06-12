#!/usr/bin/env node
// apply — deterministically assemble the project tree from
// nodes + manifest + Agent Base templates + literals.
//
// Conservation by construction: node bytes are copied verbatim from
// .setup/nodes/, never re-typed. The only non-node bytes in generated
// output are: template bytes, literal bytes, and single "\n" separators
// (inserted only when a chunk does not end with a newline).
//
// Assembly semantics (owner decision):
// - Structured targets = targets with an Agent Base template containing
//   `<!-- agent-base:slot:NAME -->` markers. Entries attach content to a slot;
//   slot content is concatenated in MANIFEST ORDER and replaces the marker.
//   Unused markers are removed (the template's surrounding text stays).
// - Free-form targets (no template) = pure manifest-order concatenation.
//
// Usage: node scripts/apply.mjs [--root <dir>] [--templates <dir>]
//                                     [--dry-run <outDir>]
// Writes .setup/generated.json: { generated: {path: sha256}, deleted: [...] }

import { readFileSync, writeFileSync, mkdirSync, rmSync, rmdirSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadManifest, loadInventory, validateShape, keepFiles, isSafeRelPath } from './lib/manifest.mjs';
import { stripJsonComments, splitLinesKeepEnds } from './lib/extract.mjs';
import { SLOT_RE, OPTIONAL_RE, stripEmptyOptionalSections } from './lib/template.mjs';

const sha = (t) => createHash('sha256').update(t).digest('hex');

function fail(msg) {
  console.error(`apply: ${msg}`);
  process.exit(1);
}

// Extract a node's text, or a line range of it (1-based inclusive, range
// relative to the node's own lines).
function nodeBytes(setupDir, nodeId, lines) {
  const text = readFileSync(join(setupDir, 'nodes', nodeId), 'utf8');
  if (!lines) return text;
  const ls = splitLinesKeepEnds(text);
  if (lines[1] > ls.length) {
    throw new Error(`node ${nodeId}: range ${lines[0]}-${lines[1]} exceeds node length (${ls.length} lines)`);
  }
  return ls.slice(lines[0] - 1, lines[1]).join('');
}

// Write with the destination checked for a symlink first: writing THROUGH a
// committed symlink would clobber out-of-tree files.
function writeNoFollow(abs, text) {
  mkdirSync(dirname(abs), { recursive: true });
  let st = null;
  try { st = lstatSync(abs); } catch { /* ENOENT: fresh file */ }
  if (st?.isSymbolicLink()) throw new Error(`refusing to write through symlink: ${abs}`);
  writeFileSync(abs, text, 'utf8');
}

function deepMerge(base, override) {
  // override wins; objects merge recursively. Arrays replace.
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (k === '__proto__') continue; // plain assignment would mutate the prototype, not set a key
    if (v && typeof v === 'object' && !Array.isArray(v)
        && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function apply({ root, templatesDir, outRoot = null }) {
  root = resolve(root);
  const setupDir = join(root, '.setup');
  const writeRoot = outRoot ? resolve(outRoot) : root;

  const manifest = loadManifest(setupDir);
  const inventory = loadInventory(setupDir);
  const shapeErrors = validateShape(manifest);
  if (shapeErrors.length) {
    throw new Error(`manifest shape invalid:\n  ${shapeErrors.join('\n  ')}`);
  }

  // Inventory paths drive deletion (step 4) — an unsafe path would escape the
  // root. Refuse the whole apply before any write or delete.
  for (const f of inventory.files) {
    if (!isSafeRelPath(f.path)) {
      throw new Error(`inventory contains unsafe file path "${f.path}" — refusing to apply`);
    }
  }

  // ── COMPUTE PHASE (steps 1–4) ──────────────────────────────────────────────
  // No filesystem writes or deletes until every output is computed: all inputs
  // (node bytes, templates, literals, jsonMerge sources) are read and validated
  // here, and outputs accumulate in `outputs` (relPath → text). A failure
  // anywhere in this phase leaves the target tree byte-identical — no partial
  // convergence. A crash during the write phase below can still leave a
  // partial tree; that residual window is accepted.

  // ── 1. Collect chunks per target, in manifest order ───────────────────────
  // chunk: { target, slot|null, text, provenance }
  const chunks = [];
  const emittedLiterals = new Set(); // (literal::target::slot) emitted once

  for (const entry of manifest.entries) {
    switch (entry.op) {
      case 'move':
        chunks.push({
          target: entry.target, slot: entry.slot ?? null,
          text: nodeBytes(setupDir, entry.node),
          provenance: `node:${entry.node}`,
        });
        break;
      case 'split':
        for (const r of entry.ranges) {
          if (r.op === 'drop') continue; // accounted, not emitted
          chunks.push({
            target: r.target, slot: r.slot ?? null,
            text: nodeBytes(setupDir, entry.node, r.lines),
            provenance: `node:${entry.node}[${r.lines[0]}-${r.lines[1]}]`,
          });
        }
        break;
      case 'merge': {
        const key = `${entry.literal}::${entry.target}::${entry.slot ?? ''}`;
        if (emittedLiterals.has(key)) break; // many nodes → one literal: emit once
        emittedLiterals.add(key);
        const litPath = join(setupDir, entry.literal);
        if (!existsSync(litPath)) throw new Error(`merge literal missing: ${entry.literal}`);
        chunks.push({
          target: entry.target, slot: entry.slot ?? null,
          text: readFileSync(litPath, 'utf8'),
          provenance: `literal:${entry.literal}`,
        });
        break;
      }
      // keep-file, drop, supersede, out-of-scope: nothing to emit
    }
  }

  // ── 2. Assemble each target ────────────────────────────────────────────────
  const byTarget = new Map();
  for (const c of chunks) {
    if (!byTarget.has(c.target)) byTarget.set(c.target, []);
    byTarget.get(c.target).push(c);
  }

  const outputs = new Map(); // relPath → final text, in compute order
  const append = (acc, text) => {
    if (acc && !acc.endsWith('\n')) acc += '\n'; // additive separator only
    return acc + text;
  };

  for (const [target, targetChunks] of byTarget) {
    // structured instruction skeletons live under templates/instructions/<target-path>
    const templatePath = join(templatesDir, 'instructions', target);
    let output;
    if (existsSync(templatePath)) {
      const template = readFileSync(templatePath, 'utf8');
      const slotContent = new Map();
      for (const c of targetChunks) {
        const slot = c.slot;
        if (slot == null) {
          throw new Error(`target ${target} is structured (has template) — entry for ${c.provenance} must name a slot`);
        }
        slotContent.set(slot, append(slotContent.get(slot) ?? '', c.text));
      }
      // Drop optional sections whose slots got no content (R-08: no empty
      // skeleton headings), then fill remaining slots. A filled slot is never
      // in a dropped section, so the not-present check below still holds.
      const pruned = stripEmptyOptionalSections(template, new Set(slotContent.keys()));
      const seen = new Set();
      output = pruned.replace(SLOT_RE, (m, name) => {
        seen.add(name);
        return slotContent.has(name) ? slotContent.get(name) : '';
      }).replace(OPTIONAL_RE, '');
      for (const slot of slotContent.keys()) {
        if (!seen.has(slot)) throw new Error(`target ${target}: slot "${slot}" not present in template`);
      }
    } else {
      output = '';
      for (const c of targetChunks) output = append(output, c.text);
    }
    outputs.set(target, output);
  }

  // ── 2b. Static installs (starter template install) ───────────────────────────────
  for (const ins of manifest.installs ?? []) {
    let text;
    if (ins.template) {
      const p = join(templatesDir, ins.template);
      if (!existsSync(p)) throw new Error(`install template missing: ${ins.template}`);
      // starter: nothing fills slots → drop optional sections, then empty-
      // slot instantiation (no skeleton headings, no leftover markers).
      text = stripEmptyOptionalSections(readFileSync(p, 'utf8'), new Set())
        .replace(SLOT_RE, '').replace(OPTIONAL_RE, '');
    } else {
      const p = join(setupDir, ins.literal);
      if (!existsSync(p)) throw new Error(`install literal missing: ${ins.literal}`);
      text = readFileSync(p, 'utf8');
    }
    if (outputs.has(ins.file)) {
      throw new Error(`install target ${ins.file} already written by an earlier assembled target or install`);
    }
    outputs.set(ins.file, text);
  }

  // ── 3. JSON key-level merges ───────────────────────────────────────────────
  // Merge sources are snapshotted into .setup/merge-sources.json on the first
  // real apply (file → original source text, null if absent). Merging from the
  // live file would let hand-edits to the merged OUTPUT feed back in as
  // "source" and silently pass the reproducibility gate. A snapshot always
  // wins; the live file is only a fallback for pre-snapshot setups. The
  // repro re-apply (outRoot set) reads snapshots but never writes them.
  // Snapshot is READ here; its write happens in the write phase below.
  const snapPath = join(setupDir, 'merge-sources.json');
  const mergeSources = existsSync(snapPath)
    ? JSON.parse(readFileSync(snapPath, 'utf8'))
    : {};
  let mergeSourcesDirty = false;
  const mergedFiles = new Set();
  for (const jm of manifest.jsonMerges ?? []) {
    if (mergedFiles.has(jm.file)) throw new Error(`duplicate jsonMerges entry for ${jm.file}`);
    mergedFiles.add(jm.file);
    if (outputs.has(jm.file)) {
      throw new Error(`jsonMerges file ${jm.file} already written by an assembled target or install`);
    }
    const basePath = join(templatesDir, jm.base);
    if (!existsSync(basePath)) throw new Error(`jsonMerges base template missing: ${jm.base}`);
    const baseObj = JSON.parse(stripJsonComments(readFileSync(basePath, 'utf8')));
    let srcText;
    if (Object.hasOwn(mergeSources, jm.file)) {
      srcText = mergeSources[jm.file];
    } else {
      const srcPath = join(root, jm.file);
      srcText = existsSync(srcPath) ? readFileSync(srcPath, 'utf8') : null;
      if (outRoot == null) { mergeSources[jm.file] = srcText; mergeSourcesDirty = true; }
    }
    let srcObj = {};
    if (srcText != null) {
      try {
        srcObj = JSON.parse(stripJsonComments(srcText)) ?? {};
      } catch (e) {
        throw new Error(`existing ${jm.file} is not valid JSON(C): ${e.message} — fix the file or route it through the manifest`);
      }
    }
    // source keys preserved; Agent Base template wins on its own keys
    const merged = deepMerge(srcObj, baseObj);
    outputs.set(jm.file, JSON.stringify(merged, null, 2) + '\n');
  }

  // ── 3b. Guarantee R-47: .gitignore excludes personal settings ─────────────
  // Idempotent, and deliberately NOT recorded in `generated`: Agent Base owns only
  // this one line, not the whole file, so the reproducibility gate must never
  // sha-compare a existing project .gitignore it does not fully own. Coverage test
  // mirrors the R-47 audit check so apply and audit agree exactly.
  // Computed here against this run's pending output (or the on-disk file);
  // the append itself happens in the write phase.
  let gitignoreNext = null;
  {
    const LOCAL = '.claude/settings.local.json';
    const giOut = join(writeRoot, '.gitignore');
    const giSrc = join(root, '.gitignore');
    const cur = outputs.has('.gitignore') ? outputs.get('.gitignore')
      : existsSync(giOut) ? readFileSync(giOut, 'utf8')
      : existsSync(giSrc) ? readFileSync(giSrc, 'utf8') : null;
    const lines = (cur ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const covered = lines.some((l) =>
      l === LOCAL || l === 'settings.local.json' || l === '**/settings.local.json'
      || (l.endsWith('/') && LOCAL.startsWith(l.replace(/^\//, ''))));
    if (!covered) {
      gitignoreNext = cur == null || cur === '' ? LOCAL + '\n'
        : cur + (cur.endsWith('\n') ? '' : '\n') + LOCAL + '\n';
    }
  }

  // ── 4. Source-file lifecycle ───────────────────────────────────────────────
  // Extracted source files that are not keep-file and not regenerated as a
  // target are deleted (their nodes were dispositioned elsewhere).
  // Deletion set is derived from the MANIFEST (inventoried, not kept, not
  // regenerated) — recorded unconditionally so the bookkeeping is durable
  // across re-materializations, not a side effect of what happened to exist.
  const keep = keepFiles(manifest);
  const deleted = [];
  for (const f of inventory.files) {
    if (keep.has(f.path)) continue;
    if (outputs.has(f.path)) continue;
    deleted.push(f.path);
  }

  // ── WRITE PHASE ────────────────────────────────────────────────────────────
  // Every output is computed and every input validated; from here on, only
  // mechanical writes/deletes. writeNoFollow keeps its symlink guard at write
  // time (the destination is re-lstat'ed immediately before each write).
  const generated = {};
  for (const [relPath, text] of outputs) {
    writeNoFollow(join(writeRoot, relPath), text);
    generated[relPath] = sha(text);
  }
  if (gitignoreNext != null) {
    writeNoFollow(join(writeRoot, '.gitignore'), gitignoreNext);
  }
  if (mergeSourcesDirty) {
    writeNoFollow(snapPath, JSON.stringify(mergeSources, null, 2) + '\n');
  }
  if (outRoot == null) {
    for (const p of deleted) {
      const abs = join(writeRoot, p);
      if (existsSync(abs)) rmSync(abs);
      // prune now-empty parent dirs (e.g. .github/chatmodes after its last
      // file is dispositioned away) — empty dirs would trip the audit.
      // Unconditional (not only when this run deleted the file) so
      // re-materialization is idempotent.
      let parent = dirname(abs);
      const stopAt = resolve(writeRoot);
      while (parent !== stopAt && existsSync(parent)) {
        try {
          if (readdirSync(parent).length > 0) break;
          rmdirSync(parent);
        } catch { break; }
        parent = dirname(parent);
      }
    }
  }

  // no timestamp field: generated.json is committed state and must not churn
  // when a re-apply produces identical bytes
  const result = { schemaVersion: 1, generated, deleted };
  if (outRoot == null) {
    writeNoFollow(join(setupDir, 'generated.json'), JSON.stringify(result, null, 2) + '\n');
  }
  return result;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const opt = { root: process.cwd(), templates: null, dryRun: null };
  let i = 0;
  // a value flag with no value must hard-stop: a missing --dry-run dir would
  // otherwise silently fall through to a real, destructive apply
  const value = (flag) => {
    const v = args[++i];
    if (v === undefined || v.startsWith('--')) fail(`${flag} requires a value`);
    return v;
  };
  for (; i < args.length; i++) {
    if (args[i] === '--root') opt.root = value('--root');
    else if (args[i] === '--templates') opt.templates = value('--templates');
    else if (args[i] === '--dry-run') opt.dryRun = value('--dry-run');
    else fail(`unknown flag: ${args[i]}`);
  }
  if (!opt.templates) {
    // default: templates/ next to this script's package root
    opt.templates = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
  }
  try {
    const res = apply({ root: opt.root, templatesDir: opt.templates, outRoot: opt.dryRun });
    console.log(`apply: ${Object.keys(res.generated).length} file(s) generated, ${res.deleted.length} source file(s) ${opt.dryRun ? 'would be ' : ''}removed.`);
  } catch (e) {
    fail(e.message);
  }
}
