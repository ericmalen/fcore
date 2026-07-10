// Shared helpers for the v2 audit. Zero-dep, pure where possible.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { stripJsonComments } from '../extract.mjs';

export function readSafe(p) {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

export const exists = existsSync;

export function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

// True for a normal repo (.git is a directory) AND a linked git worktree
// (.git is a "gitdir:" pointer FILE). R-47 only reads <root>/.gitignore, which
// lives in the worktree root regardless, so the gitdir target is not resolved.
export function isGitRepo(root) {
  const dot = join(root, '.git');
  if (isDir(dot)) return true;
  const txt = readSafe(dot);
  return txt != null && txt.startsWith('gitdir:');
}

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.setup', 'dist', 'build', 'coverage',
  '.next', '.venv', 'target', 'out', '.turbo', '.cache',
  'fcore-onboard', // setup-time tooling dir (.claude/fcore-onboard)
]);

// Setup-time tooling — present only during setup; never audited
// (mirrors the extractor's universe exclusion).
const TOOLING_RE = [
  /^\.claude\/fcore-onboard\//,
  /^\.claude\/skills\/base-(inventory|plan|apply|verify)\//,
  /^\.claude\/agents\/setup-verifier\.md$/,
];
export function isSetupTooling(rel) {
  return TOOLING_RE.some((re) => re.test(rel));
}

// Vendored third-party assets — an UPSTREAM provenance marker beside SKILL.md
// means the skill is held to upstream's conventions, not FleetCore's. The audit
// skips style rules (R-20..R-25) for these; load-critical rules still apply.
export function isVendored(root, rel) {
  return existsSync(join(root, dirname(rel), 'UPSTREAM'));
}

// Template payload skeletons — files carrying fcore slot/optional markers are
// FleetCore payload, not live configuration; live-config checks skip them
// (spec/rules.md: Audit exemptions).
export function isPayloadSkeleton(text) {
  return /<!--\s*fcore:(slot|optional)/.test(text ?? '');
}

// Recursive walk yielding absolute file paths; skips junk dirs.
export function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    // Claude Code session worktrees (.claude/worktrees/<branch>) hold full
    // transient repo copies — never live config.
    if (e.name === 'worktrees' && basename(dir) === '.claude') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile()) yield full;
  }
}

// Minimal frontmatter parser. Handles scalar `key: value`, block lists
// (`key:` + indented `- item` lines → array), and folded/literal block scalars
// (`key: >` / `key: |`, optional +/- chomping → continuation lines joined with
// spaces). Nested maps still collapse to '' (skipped). Not general YAML. Never throws.
export function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { frontmatter: {}, body: text, hasFrontmatter: false };
  const rest = text.slice(3);
  const end = rest.indexOf('\n---');
  if (end === -1) return { frontmatter: {}, body: text, hasFrontmatter: false };
  const fmText = rest.slice(0, end);
  const body = rest.slice(end + 4).replace(/^[^\n]*\n?/, '');
  const frontmatter = {};
  const unquote = (v) => (
    (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))
      ? v.slice(1, -1) : v);
  const lines = fmText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s/.test(line)) continue; // continuation lines are consumed by their key below
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (!key) continue;
    let val = line.slice(colon + 1).trim();
    if (/^[>|][+-]?$/.test(val)) {
      // Folded/literal block scalar: join the indented continuation block.
      const block = [];
      while (i + 1 < lines.length && (lines[i + 1].trim() === '' || /^\s/.test(lines[i + 1]))) {
        block.push(lines[++i].trim());
      }
      val = block.filter(Boolean).join(' ');
    } else if (val === '') {
      // Block list: collect indented `- item` entries as an array.
      const items = [];
      while (i + 1 < lines.length && /^\s+-\s/.test(lines[i + 1])) {
        items.push(unquote(lines[++i].replace(/^\s+-\s*/, '').trim()));
      }
      if (items.length > 0) val = items;
    } else {
      val = unquote(val);
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

// Blank inline `code` spans with spaces (keeps line numbers and offsets stable).
// Command examples in inline code are not path references (R-23, R-07).
export function stripInlineCode(text) {
  return text.replace(/(`+)[^`\n]*?\1/g, (m) => ' '.repeat(m.length));
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

// Optional-skill renames from the v2.0.0 rebrand (old name → new name).
const LEGACY_OPTIONAL_SKILL_NAMES = { retro: 'checklist-intake' };

// Read-only translation of a marker parsed from the pre-v2.0.0 marker path
// (.claude/agent-base.json) to current field values. Audit never writes, so
// unlike marker.mjs's writeMarker this never migrates the file on disk —
// running sync-baseline or `fcore skills add/remove` does that.
function migrateLegacyFields(fields) {
  const out = { ...fields };
  if (typeof out.toolRepo === 'string') {
    out.toolRepo = out.toolRepo.replace('ericmalen/agent-base', 'ericmalen/fcore');
  }
  if (Array.isArray(out.optionalSkills)) {
    out.optionalSkills = out.optionalSkills.map((s) => LEGACY_OPTIONAL_SKILL_NAMES[s] ?? s);
  }
  return out;
}

// Read the FleetCore marker (.claude/fcore.json, falling back to the
// pre-v2.0.0 .claude/agent-base.json). Returns {} when absent/unparseable.
export function readMarker(root) {
  let text = readSafe(join(root, '.claude', 'fcore.json'));
  let legacy = false;
  if (!text) {
    text = readSafe(join(root, '.claude', 'agent-base.json'));
    if (!text) return { present: false };
    legacy = true;
  }
  const parsed = parseJsonc(text);
  if (!parsed) return { present: true, invalid: true };
  return { present: true, ...(legacy ? migrateLegacyFields(parsed) : parsed) };
}
