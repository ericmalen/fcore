#!/usr/bin/env node
// check-links.mjs — resolve every relative Markdown link in a repo's docs.
//
// Ships with the `docs` skill so the restructure procedure has a concrete
// link check in any adopted repo (Agent Base's own docs-consistency tool stays
// Agent Base-side; the setup audit only covers AI-config surfaces, not docs/).
//
// Walks *.md under the repo (skipping junk dirs), resolves each relative link
// target against the filesystem, and reports the ones that don't exist.
// External (http/mailto), in-page anchors (#…), and inline-code paths are
// skipped. Zero dependencies.
//
// Usage: node .claude/skills/docs/scripts/check-links.mjs [--root <dir>] [--json]
// Exit 0 = all links resolve, 1 = one or more broken.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.setup', 'dist', 'build', 'coverage',
  '.next', '.venv', 'target', 'out', '.turbo', '.cache',
]);

function* walk(dir, root) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(join(dir, e.name), root);
    } else if (e.isFile() && e.name.endsWith('.md')) {
      yield relative(root, join(dir, e.name)).split(sep).join('/');
    }
  }
}

const LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;

export function checkLinks(root) {
  const findings = [];
  for (const rel of walk(root, root)) {
    const lines = readFileSync(join(root, rel), 'utf8').split('\n');
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
        if (!existsSync(abs)) findings.push({ file: rel, line: i + 1, target: m[1] });
      }
    });
  }
  return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const root = args.includes('--root') ? resolve(args[args.indexOf('--root') + 1]) : process.cwd();
  const findings = checkLinks(root);
  if (args.includes('--json')) {
    console.log(JSON.stringify({ root, findings }, null, 2));
  } else {
    for (const f of findings) console.error(`${f.file}:${f.line}: broken link -> ${f.target}`);
    console.error(findings.length ? `${findings.length} broken link(s)` : 'all links resolve');
  }
  process.exit(findings.length ? 1 : 0);
}
