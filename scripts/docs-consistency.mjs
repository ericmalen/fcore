#!/usr/bin/env node
// docs-consistency.mjs — relative Markdown links in FleetCore docs must
// resolve to existing files (FleetCore's own docs are not covered by the
// R-07 audit, which checks set-up-repo surfaces). A link's `#fragment` is also
// resolved: when the target is a Markdown file, the fragment must match a
// heading slug (GitHub algorithm) or an explicit HTML `id`/`name` anchor in it.
//
// A banned-vocabulary check lived here until June 2026; it was removed after
// review showed its only catch was a false positive (half the list was
// rename-shadows of terms retired in an earlier rebrand that never existed
// under this repo's current name).
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

export function checkLinks(root, files) {
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
          if (!existsSync(abs)) {
            findings.push({ check: 'broken-link', file: rel, line: i + 1, term: target });
            continue;
          }
        }
        // line-range fragments (#L10, #L10-L20) target code, not headings — skip.
        if (frag && !/^l\d/.test(frag) && abs.endsWith('.md')) {
          const anchors = anchorsFor(abs, knownText);
          if (anchors && !anchors.has(frag)) {
            findings.push({ check: 'broken-anchor', file: rel, line: i + 1, term: target });
          }
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
