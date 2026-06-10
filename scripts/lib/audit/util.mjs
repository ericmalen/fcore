// Shared helpers for the v2 audit. Zero-dep, pure where possible.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stripJsonComments } from '../extract.mjs';

export function readSafe(p) {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

export const exists = existsSync;

export function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.adoption', 'dist', 'build', 'coverage',
  '.next', '.venv', 'target', 'out', '.turbo', '.cache', 'v1-reference',
  'ai-kit-adoption', // adoption-time tooling dir (.claude/ai-kit-adoption)
]);

// Adoption-time tooling — present only during migration; never audited
// (mirrors the extractor's universe exclusion).
const TOOLING_RE = [
  /^\.claude\/ai-kit-adoption\//,
  /^\.claude\/skills\/adopt-(inventory|plan|materialize|verify)\//,
  /^\.claude\/agents\/adoption-verifier\.md$/,
];
export function isAdoptionTooling(rel) {
  return TOOLING_RE.some((re) => re.test(rel));
}

// Recursive walk yielding absolute file paths; skips junk dirs.
export function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile()) yield full;
  }
}

// Minimal frontmatter parser (scalar key: value). Never throws.
export function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { frontmatter: {}, body: text, hasFrontmatter: false };
  const rest = text.slice(3);
  const end = rest.indexOf('\n---');
  if (end === -1) return { frontmatter: {}, body: text, hasFrontmatter: false };
  const fmText = rest.slice(0, end);
  const body = rest.slice(end + 4).replace(/^[^\n]*\n?/, '');
  const frontmatter = {};
  for (const line of fmText.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (!key || /^\s/.test(line)) continue; // skip nested/indented yaml
    let val = line.slice(colon + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    frontmatter[key] = val;
  }
  return { frontmatter, body, hasFrontmatter: true };
}

export function frontmatterKeys(text) {
  if (!text.startsWith('---')) return [];
  const rest = text.slice(3);
  const end = rest.indexOf('\n---');
  if (end === -1) return [];
  return rest.slice(0, end).split('\n')
    .filter((l) => /^[A-Za-z][\w-]*\s*:/.test(l))
    .map((l) => l.slice(0, l.indexOf(':')).trim());
}

export function nonBlankLines(text) {
  return text.split('\n').filter((l) => l.trim() !== '').length;
}

export function stripFences(text) {
  // Replace fenced code block CONTENT with blank lines (keeps line numbers stable).
  const lines = text.split('\n');
  let inFence = false;
  return lines.map((l) => {
    if (/^ {0,3}(`{3,}|~{3,})/.test(l)) { inFence = !inFence; return ''; }
    return inFence ? '' : l;
  }).join('\n');
}

export function lineOf(text, re) {
  const idx = text.search(re);
  if (idx === -1) return undefined;
  return text.slice(0, idx).split('\n').length;
}

export function parseJsonc(text) {
  try { return JSON.parse(stripJsonComments(text)); } catch { return null; }
}

// Finding constructor — every finding keys to a rule ID from spec/rules.md.
export function finding(rule, severity, file, message, extra = {}) {
  return { rule, severity, file, message, ...extra };
}

// Read the kit marker (.claude/ai-kit.json). Returns {} when absent/unparseable.
export function readMarker(root) {
  const text = readSafe(join(root, '.claude', 'ai-kit.json'));
  if (!text) return { present: false };
  const parsed = parseJsonc(text);
  if (!parsed) return { present: true, invalid: true };
  return { present: true, ...parsed };
}
