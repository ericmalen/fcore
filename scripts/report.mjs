#!/usr/bin/env node
// report — generate the risk-ordered human review report from
// manifest + nodes. Mechanical generation; the verifier and the human read
// this, never spelunk commits.
//
// Risk order: drops (full text) → out-of-scope (full matched text) →
// merges/supersedes (side-by-side) → splits (range map) → moves/keeps
// (collapsed counts) → headline counters incl. merged-bytes %.
//
// Usage: node scripts/report.mjs [--root <dir>] [--out <file>]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest, loadInventory } from './lib/manifest.mjs';
import { splitLinesKeepEnds } from './lib/extract.mjs';

const fence = (text) => '```\n' + text.replace(/```/g, '`​``') + (text.endsWith('\n') ? '' : '\n') + '```\n';

export function generateReport({ root }) {
  root = resolve(root);
  const adoptionDir = join(root, '.setup');
  const manifest = loadManifest(adoptionDir);
  const inventory = loadInventory(adoptionDir);

  const nodeText = (id) => readFileSync(join(adoptionDir, 'nodes', id), 'utf8');
  const nodeMeta = (id) => inventory.nodes[id] ?? {};
  const label = (id) => {
    const m = nodeMeta(id);
    return `\`${id}\` — ${m.file ?? '?'}${m.heading ? ` › "${m.heading}"` : m.kind ? ` (${m.kind})` : ''}`;
  };

  const groups = { drop: [], oos: [], merge: [], supersede: [], split: [], move: [], keep: [] };
  for (const e of manifest.entries) {
    if (e.op === 'drop') groups.drop.push(e);
    else if (e.op === 'out-of-scope') groups.oos.push(e);
    else if (e.op === 'merge') groups.merge.push(e);
    else if (e.op === 'supersede') groups.supersede.push(e);
    else if (e.op === 'split') groups.split.push(e);
    else if (e.op === 'move') groups.move.push(e);
    else if (e.op === 'keep-file') groups.keep.push(e);
  }

  let sourceBytes = 0;
  for (const id of Object.keys(inventory.nodes)) sourceBytes += inventory.nodes[id].bytes ?? 0;
  const norm = (t) => t.replace(/\s+/g, ' ').trim();
  const isVerbatimLiteral = (e) => {
    try {
      const lit = readFileSync(join(adoptionDir, e.literal), 'utf8');
      return norm(lit) === norm(nodeText(e.node));
    } catch { return false; }
  };
  let mergedBytes = 0, verbatimLitBytes = 0;
  for (const e of groups.merge) {
    if (isVerbatimLiteral(e)) verbatimLitBytes += nodeMeta(e.node).bytes ?? 0;
    else mergedBytes += nodeMeta(e.node).bytes ?? 0;
  }
  for (const e of groups.supersede) mergedBytes += nodeMeta(e.node).bytes ?? 0;
  let droppedBytes = 0;
  for (const e of groups.drop) droppedBytes += nodeMeta(e.node).bytes ?? 0;
  const pct = (n) => sourceBytes === 0 ? '0.0' : ((n / sourceBytes) * 100).toFixed(1);

  const L = [];
  L.push('# Setup review report');
  L.push('');
  L.push('Generated mechanically from the manifest. Sections are RISK-ORDERED —');
  L.push('review top to bottom; the top sections are where content can be lost.');
  L.push('');
  L.push('## Headline');
  L.push('');
  L.push(`| Metric | Value |`);
  L.push(`|---|---|`);
  L.push(`| Source nodes | ${Object.keys(inventory.nodes).length} (${sourceBytes} bytes) |`);
  L.push(`| moved/split (conserved by construction) | ${groups.move.length} move, ${groups.split.length} split |`);
  L.push(`| kept in place | ${groups.keep.length} files |`);
  L.push(`| **dropped** | ${groups.drop.length} (${pct(droppedBytes)}% of source bytes) |`);
  L.push(`| **merged/superseded (REWRITTEN text — REVIEW)** | ${groups.merge.length + groups.supersede.length} (${pct(mergedBytes)}% of source bytes rewritten) |`);
  L.push(`| verbatim-via-literal (cosmetic routing, byte-equivalent) | ${pct(verbatimLitBytes)}% of source bytes |`);
  L.push(`| out-of-scope rulings | ${groups.oos.length} |`);
  L.push(`| installed (Agent Base templates/literals) | ${(manifest.installs ?? []).length} |`);
  L.push('');
  L.push(`> Merged-bytes fraction is the creeping-merge tripwire. Extraction-first`);
  L.push(`> policy: this number should be small; every point of it is judgment-`);
  L.push(`> checked text, not construction-guaranteed text.`);
  L.push('');

  L.push('## 1. Dropped content (full source text — nothing below survives)');
  L.push('');
  if (!groups.drop.length) L.push('_None._');
  for (const e of groups.drop) {
    L.push(`### ${label(e.node)}`);
    L.push(`**Reason:** ${e.reason}`);
    L.push('');
    L.push(fence(nodeText(e.node)));
  }
  // drop-ranges inside splits are also losses — surface them here
  for (const e of groups.split) {
    for (const r of e.ranges) {
      if (r.op !== 'drop') continue;
      const ls = splitLinesKeepEnds(nodeText(e.node));
      L.push(`### ${label(e.node)} lines ${r.lines[0]}–${r.lines[1]} (split drop-range)`);
      L.push(`**Reason:** ${r.reason}`);
      L.push('');
      L.push(fence(ls.slice(r.lines[0] - 1, r.lines[1]).join('')));
    }
  }
  L.push('');

  L.push('## 2. Out-of-scope rulings (full matched text — same risk as drops)');
  L.push('');
  if (!groups.oos.length) L.push('_None._');
  for (const e of groups.oos) {
    L.push(`### ${e.file}`);
    L.push(`**Reason:** ${e.reason}`);
    const cand = inventory.sweepCandidates.find((c) => c.file === e.file);
    if (cand) {
      L.push('');
      L.push('Matched lines:');
      L.push('');
      for (const h of cand.hits) L.push(`- L${h.line} (\`${h.marker}\`): ${h.text}`);
    }
    L.push('');
  }

  L.push('## 3. Merged / superseded (side-by-side — judge whether meaning survived)');
  L.push('');
  if (!groups.merge.length && !groups.supersede.length) L.push('_None._');
  for (const e of groups.merge) {
    L.push(`### ${label(e.node)} → literal \`${e.literal}\` (target: ${e.target})`);
    if (e.note) L.push(`**Note:** ${e.note}`);
    L.push('');
    L.push('**Source (original bytes):**');
    L.push('');
    L.push(fence(nodeText(e.node)));
    L.push('**Replacement (literal):**');
    L.push('');
    const lit = join(adoptionDir, e.literal);
    L.push(fence(existsSync(lit) ? readFileSync(lit, 'utf8') : '(LITERAL MISSING)'));
  }
  for (const e of groups.supersede) {
    L.push(`### ${label(e.node)} → catalog skill \`${e.catalogSkill}\``);
    if (e.note) L.push(`**Note:** ${e.note}`);
    L.push('');
    L.push('**Source (original bytes):**');
    L.push('');
    L.push(fence(nodeText(e.node)));
  }

  L.push('## 4. Splits (range map)');
  L.push('');
  if (!groups.split.length) L.push('_None._');
  for (const e of groups.split) {
    L.push(`### ${label(e.node)}`);
    L.push('');
    L.push('| Lines | Disposition |');
    L.push('|---|---|');
    for (const r of e.ranges) {
      L.push(`| ${r.lines[0]}–${r.lines[1]} | ${r.op === 'drop' ? `DROP — ${r.reason}` : `→ ${r.target}${r.slot ? `#${r.slot}` : ''}`} |`);
    }
    L.push('');
  }

  L.push('## 5. Moves and keeps (conserved by construction — collapsed)');
  L.push('');
  L.push('| Source | Disposition |');
  L.push('|---|---|');
  for (const e of groups.move) L.push(`| ${label(e.node)} | → ${e.target}${e.slot ? `#${e.slot}` : ''} |`);
  for (const e of groups.keep) L.push(`| ${e.file} | kept in place |`);
  L.push('');

  return L.join('\n') + '\n';
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const opt = { root: process.cwd(), out: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') opt.root = args[++i];
    else if (args[i] === '--out') opt.out = args[++i];
    else { console.error(`report: unknown flag ${args[i]}`); process.exit(2); }
  }
  const md = generateReport({ root: opt.root });
  const outPath = opt.out ?? join(opt.root, '.setup', 'report.md');
  writeFileSync(outPath, md, 'utf8');
  console.log(`report: written → ${outPath}`);
}
