#!/usr/bin/env node
// docs-consistency.mjs — relative Markdown links in Agent Base docs must
// resolve to existing files (Agent Base's own docs are not covered by the
// R-07 audit, which checks set-up-repo surfaces).
//
// A banned-vocabulary check lived here until June 2026; it was removed after
// review showed its only catch was a false positive (half the list was
// rename-shadows of retired ai-kit terms that never existed under the
// agent-base name).
//
// Usage: node scripts/docs-consistency.mjs [--root <dir>] [--json]
// Exit: 0 = clean · 1 = findings · 2 = usage.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flagValue } from './lib/cli-args.mjs';

const SCAN_DIRS = ['docs', 'templates', '.claude', 'spec'];
const SCAN_FILES = ['README.md', 'AGENTS.md', 'CLAUDE.md'];

function isVendored(dir) {
  // a directory carrying an UPSTREAM provenance marker is held to upstream's
  // conventions (see spec/rules.md, vendored exemption) — skip it entirely.
  return existsSync(join(dir, 'UPSTREAM'));
}

function* walk(dir, root) {
  if (isVendored(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    const rel = relative(root, p).split(sep).join('/');
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      yield* walk(p, root);
    } else if (
      e.name.endsWith('.md') || e.name.endsWith('.json')
      // consumer-shipped payload beyond md/json: CI templates + gitignore
      || (rel.startsWith('templates/') && (e.name.endsWith('.yml') || rel === 'templates/gitignore'))
    ) {
      if (e.name === 'settings.local.json') continue; // personal, gitignored
      yield rel;
    }
  }
}

export function collectFiles(root) {
  const files = [];
  for (const d of SCAN_DIRS) if (existsSync(join(root, d))) files.push(...walk(join(root, d), root));
  for (const f of SCAN_FILES) if (existsSync(join(root, f))) files.push(f);
  return { files };
}

const LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;

export function checkLinks(root, files) {
  const findings = [];
  for (const rel of files) {
    if (!rel.endsWith('.md')) continue;
    const text = readFileSync(join(root, rel), 'utf8');
    const lines = text.split('\n');
    let inFence = false;
    lines.forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return; }
      if (inFence) return;
      const prose = line.replace(/`[^`]*`/g, ''); // ignore inline-code examples
      for (const m of prose.matchAll(LINK_RE)) {
        let target = m[1];
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        target = target.split('#')[0];
        if (!target) continue;
        const abs = resolve(root, dirname(rel), decodeURIComponent(target));
        if (!existsSync(abs)) {
          findings.push({ check: 'broken-link', file: rel, line: i + 1, term: m[1] });
        }
      }
    });
  }
  return findings;
}

export function run(root) {
  const { files } = collectFiles(root);
  return checkLinks(root, files);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const bad = (m) => { console.error(`docs-consistency: ${m}`); process.exit(2); };
  let root = process.cwd();
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') root = resolve(flagValue(args, i++, '--root', bad));
    else if (args[i] === '--json') json = true;
    else bad(`unknown flag ${args[i]}`);
  }
  const findings = run(root);
  if (json) {
    console.log(JSON.stringify({ root, findings }, null, 2));
  } else {
    for (const f of findings) console.error(`${f.file}:${f.line}: [${f.check}] ${f.term}`);
    console.error(findings.length ? `${findings.length} finding(s)` : 'clean');
  }
  process.exit(findings.length ? 1 : 0);
}
