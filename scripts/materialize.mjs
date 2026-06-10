#!/usr/bin/env node
// materialize — deterministically assemble the target tree from
// nodes + manifest + kit templates + literals (plan §3/§5 step 4).
//
// Conservation by construction: node bytes are copied verbatim from
// .adoption/nodes/, never re-typed. The only non-node bytes in generated
// output are: template bytes, literal bytes, and single "\n" separators
// (inserted only when a chunk does not end with a newline).
//
// Assembly semantics (owner decision, plan §13b):
// - Structured targets = targets with a kit template containing
//   `<!-- ai-kit:slot:NAME -->` markers. Entries attach content to a slot;
//   slot content is concatenated in MANIFEST ORDER and replaces the marker.
//   Unused markers are removed (the template's surrounding text stays).
// - Free-form targets (no template) = pure manifest-order concatenation.
//
// Usage: node scripts/materialize.mjs [--root <dir>] [--templates <dir>]
//                                     [--dry-run <outDir>]
// Writes .adoption/generated.json: { generated: {path: sha256}, deleted: [...] }

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { loadManifest, loadInventory, validateShape, keepFiles } from './lib/manifest.mjs';
import { stripJsonComments, splitLinesKeepEnds } from './lib/extract.mjs';

const sha = (t) => createHash('sha256').update(t).digest('hex');
const SLOT_RE = /^[ \t]*<!--\s*ai-kit:slot:([a-z0-9-]+)\s*-->[ \t]*\r?\n?/gm;

function fail(msg) {
  console.error(`materialize: ${msg}`);
  process.exit(1);
}

// Extract a node's text, or a line range of it (1-based inclusive, range
// relative to the node's own lines).
function nodeBytes(adoptionDir, nodeId, lines) {
  const text = readFileSync(join(adoptionDir, 'nodes', nodeId), 'utf8');
  if (!lines) return text;
  const ls = splitLinesKeepEnds(text);
  return ls.slice(lines[0] - 1, lines[1]).join('');
}

function deepMerge(base, override) {
  // override wins; objects merge recursively. Arrays replace.
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v && typeof v === 'object' && !Array.isArray(v)
        && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function materialize({ root, templatesDir, outRoot = null }) {
  root = resolve(root);
  const adoptionDir = join(root, '.adoption');
  const writeRoot = outRoot ? resolve(outRoot) : root;

  const manifest = loadManifest(adoptionDir);
  const inventory = loadInventory(adoptionDir);
  const shapeErrors = validateShape(manifest);
  if (shapeErrors.length) {
    throw new Error(`manifest shape invalid:\n  ${shapeErrors.join('\n  ')}`);
  }

  // ── 1. Collect chunks per target, in manifest order ───────────────────────
  // chunk: { target, slot|null, text, provenance }
  const chunks = [];
  const emittedLiterals = new Set(); // (literal::target::slot) emitted once

  for (const entry of manifest.entries) {
    switch (entry.op) {
      case 'move':
        chunks.push({
          target: entry.target, slot: entry.slot ?? null,
          text: nodeBytes(adoptionDir, entry.node),
          provenance: `node:${entry.node}`,
        });
        break;
      case 'split':
        for (const r of entry.ranges) {
          if (r.op === 'drop') continue; // accounted, not emitted
          chunks.push({
            target: r.target, slot: r.slot ?? null,
            text: nodeBytes(adoptionDir, entry.node, r.lines),
            provenance: `node:${entry.node}[${r.lines[0]}-${r.lines[1]}]`,
          });
        }
        break;
      case 'merge': {
        const key = `${entry.literal}::${entry.target}::${entry.slot ?? ''}`;
        if (emittedLiterals.has(key)) break; // many nodes → one literal: emit once
        emittedLiterals.add(key);
        const litPath = join(adoptionDir, entry.literal);
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

  const generated = {};
  const append = (acc, text) => {
    if (acc && !acc.endsWith('\n')) acc += '\n'; // additive separator only
    return acc + text;
  };

  for (const [target, targetChunks] of byTarget) {
    const templatePath = join(templatesDir, target);
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
      const seen = new Set();
      output = template.replace(SLOT_RE, (m, name) => {
        seen.add(name);
        return slotContent.has(name) ? slotContent.get(name) : '';
      });
      for (const slot of slotContent.keys()) {
        if (!seen.has(slot)) throw new Error(`target ${target}: slot "${slot}" not present in template`);
      }
    } else {
      output = '';
      for (const c of targetChunks) output = append(output, c.text);
    }
    const abs = join(writeRoot, target);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, output, 'utf8');
    generated[target] = sha(output);
  }

  // ── 2b. Static installs (greenfield wiring) ───────────────────────────────
  for (const ins of manifest.installs ?? []) {
    let text;
    if (ins.template) {
      const p = join(templatesDir, ins.template);
      if (!existsSync(p)) throw new Error(`install template missing: ${ins.template}`);
      text = readFileSync(p, 'utf8').replace(SLOT_RE, ''); // empty-slot instantiation
    } else {
      const p = join(adoptionDir, ins.literal);
      if (!existsSync(p)) throw new Error(`install literal missing: ${ins.literal}`);
      text = readFileSync(p, 'utf8');
    }
    if (generated[ins.file]) throw new Error(`install collides with assembled target: ${ins.file}`);
    const abs = join(writeRoot, ins.file);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text, 'utf8');
    generated[ins.file] = sha(text);
  }

  // ── 3. JSON key-level merges ───────────────────────────────────────────────
  for (const jm of manifest.jsonMerges ?? []) {
    const basePath = join(templatesDir, jm.base);
    if (!existsSync(basePath)) throw new Error(`jsonMerges base template missing: ${jm.base}`);
    const baseObj = JSON.parse(stripJsonComments(readFileSync(basePath, 'utf8')));
    const srcPath = join(root, jm.file);
    const srcObj = existsSync(srcPath)
      ? (JSON.parse(stripJsonComments(readFileSync(srcPath, 'utf8'))) ?? {})
      : {};
    // source keys preserved; kit template wins on its own keys
    const merged = deepMerge(srcObj, baseObj);
    const output = JSON.stringify(merged, null, 2) + '\n';
    const abs = join(writeRoot, jm.file);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, output, 'utf8');
    generated[jm.file] = sha(output);
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
    if (generated[f.path]) continue;
    deleted.push(f.path);
    const abs = join(writeRoot, f.path);
    if (outRoot == null && existsSync(abs)) rmSync(abs);
  }

  const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), generated, deleted };
  if (outRoot == null) {
    writeFileSync(join(adoptionDir, 'generated.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  }
  return result;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname;

if (isMain) {
  const args = process.argv.slice(2);
  const opt = { root: process.cwd(), templates: null, dryRun: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') opt.root = args[++i];
    else if (args[i] === '--templates') opt.templates = args[++i];
    else if (args[i] === '--dry-run') opt.dryRun = args[++i];
    else fail(`unknown flag: ${args[i]}`);
  }
  if (!opt.templates) {
    // default: templates/ next to this script's package root
    opt.templates = join(dirname(new URL(import.meta.url).pathname), '..', 'templates');
  }
  try {
    const res = materialize({ root: opt.root, templatesDir: opt.templates, outRoot: opt.dryRun });
    console.log(`materialize: ${Object.keys(res.generated).length} file(s) generated, ${res.deleted.length} source file(s) ${opt.dryRun ? 'would be ' : ''}removed.`);
  } catch (e) {
    fail(e.message);
  }
}
