#!/usr/bin/env node
// check-links.mjs — resolve every relative Markdown link in a repo's docs.
//
// Ships with the `docs-manager` skill so the restructure procedure has a concrete
// link check in any adopted repo (FleetCore's own docs-consistency tool stays
// FleetCore-side; the setup audit only covers AI-config surfaces, not docs/).
//
// Walks *.md under the repo (skipping junk dirs), resolves each relative link
// target against the filesystem, and reports the ones that don't exist. A link's
// `#fragment` is resolved too: when the target is a Markdown file, the fragment
// must match a heading slug (GitHub algorithm) or an explicit HTML `id`/`name`
// anchor in it. External (http/mailto) and inline-code paths are skipped.
// Zero dependencies.
//
// Usage: node .claude/skills/docs-manager/scripts/check-links.mjs [--root <dir>] [--json]
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

// The set of `#fragment` targets a Markdown file exposes: a heading slug per ATX
// heading (GitHub/GFM algorithm, with -1/-2 suffixes for duplicates) plus every
// explicit HTML `id`/`name` anchor. Headings inside code fences are ignored.
export function anchorsOf(text) {
  const anchors = new Set();
  const counts = new Map();
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const h = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (h) {
      const slug = h[1]
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // [t](u) / ![t](u) → t
        .replace(/`([^`]*)`/g, '$1')               // `code` → code
        .replace(/[*_~]/g, '')                     // emphasis markers
        .trim().toLowerCase()
        .replace(/[^a-z0-9 _-]/g, '')              // drop punctuation/unicode
        .replace(/ /g, '-');
      if (slug) {
        const n = counts.get(slug) ?? 0;
        anchors.add(n ? `${slug}-${n}` : slug);
        counts.set(slug, n + 1);
      }
    }
    for (const m of line.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/g)) {
      anchors.add(m[1].toLowerCase());
    }
  }
  return anchors;
}

export function checkLinks(root) {
  const findings = [];
  const anchorCache = new Map(); // absFile → Set<anchor>; only .md files are cached
  const anchorsFor = (abs, knownText) => {
    let set = anchorCache.get(abs);
    if (!set) {
      let txt = knownText;
      if (txt == null) { try { txt = readFileSync(abs, 'utf8'); } catch { return null; } }
      set = anchorsOf(txt);
      anchorCache.set(abs, set);
    }
    return set;
  };
  for (const rel of walk(root, root)) {
    const text = readFileSync(join(root, rel), 'utf8');
    const lines = text.split('\n');
    let inFence = false;
    lines.forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return; }
      if (inFence) return;
      const prose = line.replace(/`[^`]*`/g, ''); // ignore inline-code examples
      for (const m of prose.matchAll(LINK_RE)) {
        const target = m[1];
        if (/^(https?:|mailto:)/.test(target)) continue;
        const hash = target.indexOf('#');
        const pathPart = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : decodeURIComponent(target.slice(hash + 1)).toLowerCase();
        let abs, knownText;
        if (pathPart === '') {
          abs = join(root, rel); knownText = text; // same-file anchor
        } else {
          abs = resolve(root, dirname(rel), decodeURIComponent(pathPart));
          if (!existsSync(abs)) { findings.push({ file: rel, line: i + 1, target }); continue; }
        }
        // line-range fragments (#L10, #L10-L20) target code, not headings — skip.
        if (frag && !/^l\d/.test(frag) && abs.endsWith('.md')) {
          const anchors = anchorsFor(abs, knownText);
          if (anchors && !anchors.has(frag)) {
            findings.push({ file: rel, line: i + 1, target, anchor: true });
          }
        }
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
    for (const f of findings) console.error(`${f.file}:${f.line}: ${f.anchor ? 'broken anchor' : 'broken link'} -> ${f.target}`);
    console.error(findings.length ? `${findings.length} broken link(s)` : 'all links resolve');
  }
  process.exit(findings.length ? 1 : 0);
}
