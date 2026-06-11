// v2 audit checks. Every check keys to a rule ID in spec/rules.md.
// Mechanical rules only — judgment rules live in the verifier rubric.
// Target-state only (closed world): no input-classification logic here.

import { join, relative, dirname, basename } from 'node:path';
import {
  readSafe, exists, isDir, isGitRepo, walk, parseFrontmatter, frontmatterKeys,
  nonBlankLines, stripFences, lineOf, parseJsonc, finding as F, isSetupTooling, isVendored,
  isPayloadSkeleton,
} from './util.mjs';

// ── R-01..R-09: root instructions ───────────────────────────────────────────

export function checkRootInstructions(ctx) {
  const { root, marker } = ctx;
  const out = [];
  const agentsPath = join(root, 'AGENTS.md');
  const text = readSafe(agentsPath);

  if (text == null) {
    out.push(F('R-01', 'error', 'AGENTS.md', 'Root AGENTS.md is missing — it is the canonical AI instructions file.'));
  } else {
    const nb = nonBlankLines(text);
    const chars = text.length;
    if (nb > 120 || chars > 6000) {
      out.push(F('R-02', 'warning', 'AGENTS.md',
        `Root AGENTS.md too large (${nb} non-blank lines, ${chars} chars; caps: 120 / 6,000). It loads on every interaction.`));
    }
    if (!/^##\s*do\s*not\b/im.test(stripFences(text))) {
      out.push(F('R-03', 'warning', 'AGENTS.md', 'Missing a "## Do Not" section.'));
    }
    const todoLine = lineOf(text, /<!--\s*TODO/i);
    if (todoLine !== undefined) {
      out.push(F('R-04', 'info', 'AGENTS.md', 'Unfilled TODO placeholder remains.', { line: todoLine }));
    }
  }

  // R-09 — conditional on recorded code-review answer
  const ciPath = join(root, '.github', 'copilot-instructions.md');
  const ciText = readSafe(ciPath);
  if (marker.githubCodeReview === true) {
    if (ciText == null) {
      out.push(F('R-09', 'warning', '.github/copilot-instructions.md',
        'githubCodeReview is true but .github/copilot-instructions.md is missing (GitHub code review reads only this file).'));
    } else {
      if (ciText.length > 4000) {
        out.push(F('R-09', 'warning', '.github/copilot-instructions.md',
          `File is ${ciText.length} chars; GitHub code review reads only the first 4,000.`));
      }
      if (!/AGENTS\.md/.test(ciText)) {
        out.push(F('R-09', 'warning', '.github/copilot-instructions.md',
          'Should point to AGENTS.md as the canonical instructions file.'));
      }
    }
  } else if (marker.githubCodeReview === false) {
    if (ciText != null) {
      out.push(F('R-09', 'warning', '.github/copilot-instructions.md',
        'githubCodeReview is false — this file should have been folded into AGENTS.md and deleted.'));
    }
  } else if (ciText != null) {
    out.push(F('R-09', 'info', '.github/copilot-instructions.md',
      'Present, but no recorded code-review stance in the Agent Base marker — record githubCodeReview true/false.'));
  }

  return out;
}

// ── R-10..R-12: CLAUDE.md shim ──────────────────────────────────────────────

export function checkShim(ctx) {
  const out = [];
  const text = readSafe(join(ctx.root, 'CLAUDE.md'));
  if (text == null) {
    out.push(F('R-10', 'warning', 'CLAUDE.md', 'Root CLAUDE.md missing — Claude Code reads only CLAUDE.md (no AGENTS.md fallback).'));
    return out;
  }
  const firstLine = text.split('\n', 1)[0].trim();
  if (firstLine !== '@AGENTS.md') {
    out.push(F('R-11', 'warning', 'CLAUDE.md', `First line must be exactly "@AGENTS.md" (found: "${firstLine.slice(0, 60)}").`, { line: 1 }));
  }
  return out;
}

// ── R-13..R-16, R-52, R-53: path-scoped instructions ────────────────────────

export function checkPathScoping(ctx) {
  const { root } = ctx;
  const out = [];

  // discover both mechanisms
  const rulesDir = join(root, '.claude', 'rules');
  const ruleFiles = isDir(rulesDir)
    ? [...walk(rulesDir)].filter((p) => p.endsWith('.md') && basename(p) !== 'README.md')
    : [];
  const nestedAgents = [...walk(root)]
    .filter((p) => basename(p) === 'AGENTS.md' && relative(root, p) !== 'AGENTS.md')
    // Payload skeletons (agent-base slot/optional markers) are template payload, not
    // live config — they neither trigger compat mode nor get audited as nested
    // instructions (spec/rules.md: Audit exemptions).
    .filter((p) => !isPayloadSkeleton(readSafe(p)));

  ctx.compatMode = nestedAgents.length > 0;

  if (ruleFiles.length > 0 && nestedAgents.length > 0) {
    out.push(F('R-53', 'warning', '.claude/rules',
      `Repo uses BOTH .claude/rules/ (${ruleFiles.length} files) and nested AGENTS.md (${nestedAgents.length} files) — pick one mechanism.`));
  }

  for (const abs of ruleFiles) {
    const rel = relative(root, abs).replace(/\\/g, '/');
    const text = readSafe(abs);
    if (text == null) continue;
    const { frontmatter, body, hasFrontmatter } = parseFrontmatter(text);
    if (!hasFrontmatter || !frontmatter.paths) {
      out.push(F('R-52', 'warning', rel, 'Rules file must have frontmatter with a paths: glob list.'));
    }
    if (nonBlankLines(body) > 50) {
      out.push(F('R-52', 'warning', rel, `Rules file body has ${nonBlankLines(body)} non-blank lines (cap: 50).`));
    }
  }

  for (const abs of nestedAgents) {
    const rel = relative(root, abs).replace(/\\/g, '/');
    const text = readSafe(abs);
    if (text == null) continue;
    if (nonBlankLines(text) > 50) {
      out.push(F('R-13', 'warning', rel, `Nested AGENTS.md has ${nonBlankLines(text)} non-blank lines (cap: 50).`));
    }
    if (text.startsWith('---')) {
      out.push(F('R-14', 'warning', rel, 'Nested AGENTS.md must not have YAML frontmatter (scope comes from location).', { line: 1 }));
    }
    const sibling = join(dirname(abs), 'CLAUDE.md');
    const sibText = readSafe(sibling);
    const sibRel = relative(root, sibling).replace(/\\/g, '/');
    if (sibText == null) {
      out.push(F('R-15', 'warning', sibRel, 'Nested AGENTS.md needs a sibling CLAUDE.md shim (Claude Code loads CLAUDE.md per-directory).'));
    } else if (sibText.split('\n', 1)[0].trim() !== '@AGENTS.md') {
      out.push(F('R-15', 'warning', sibRel, 'Sibling CLAUDE.md first line must be exactly "@AGENTS.md".', { line: 1 }));
    }
  }

  return out;
}

// ── R-17..R-26, R-21 hints: skills ──────────────────────────────────────────

const PORTABLE_SKILL_KEYS = new Set([
  'name', 'description', 'argument-hint', 'user-invocable', 'disable-model-invocation',
  'license', 'compatibility', 'metadata',
]);
const TOOL_SPECIFIC_SKILL_KEYS = new Set([
  'model', 'context', 'hooks', 'allowed-tools', 'paths', 'effort', 'agent', 'version', 'mode',
]);
const VSCODE_BUILTINS = new Set([
  'create-skill', 'create-agent', 'create-prompt', 'create-instruction', 'create-hook',
  'init', 'plan', 'skills', 'compact', 'troubleshoot',
]);

export function checkSkills(ctx) {
  const { root } = ctx;
  const out = [];
  const skillsDir = join(root, '.claude', 'skills');
  if (!isDir(skillsDir)) return out;

  for (const abs of walk(skillsDir)) {
    if (basename(abs) !== 'SKILL.md') continue;
    const rel = relative(root, abs).replace(/\\/g, '/');
    if (isSetupTooling(rel)) continue;
    const parts = rel.split('/'); // .claude/skills/<id>/SKILL.md → 4 parts
    if (parts.length !== 4) {
      out.push(F('R-26', 'error', rel,
        'SKILL.md must sit exactly one level under .claude/skills/ — neither tool discovers nested skill folders.'));
      continue;
    }
    const folder = parts[2];
    const text = readSafe(abs);
    if (text == null) continue;
    const { frontmatter } = parseFrontmatter(text);

    if ((frontmatter.name ?? '') !== folder) {
      out.push(F('R-17', 'error', rel,
        `Frontmatter name "${frontmatter.name ?? '(missing)'}" must exactly match folder "${folder}" (skill silently fails to load otherwise).`));
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(folder)) {
      out.push(F('R-18', 'warning', rel, `Skill folder "${folder}" is not kebab-case.`));
    }
    const desc = frontmatter.description ?? '';
    if (desc.length > 1024) {
      out.push(F('R-19', 'error', rel, `Description is ${desc.length} chars (cap: 1,024).`));
    }
    // Vendored (UPSTREAM marker): upstream's conventions govern style — stop here.
    if (isVendored(root, rel)) continue;
    const lineCount = text.split('\n').length;
    if (lineCount > 200) {
      out.push(F('R-20', 'warning', rel, `SKILL.md is ${lineCount} lines (cap: 200) — move depth to references/.`));
    }
    // R-21 hints (rubric owns the rule; these are non-blocking nudges)
    if (!desc) {
      out.push(F('R-21', 'info', rel, 'Description missing — the rubric requires what + when.'));
    } else if (!/\bwhen\b/i.test(desc)) {
      out.push(F('R-21', 'info', rel, 'Description has no "when" clause — activation quality suffers.'));
    }
    if (VSCODE_BUILTINS.has(folder)) {
      out.push(F('R-22', 'info', rel, `Skill name "${folder}" collides with a VS Code built-in command.`));
    }
    // R-23: sibling references must be Markdown links. Strip well-formed links
    // first so a path-shaped LABEL — e.g. [references/x.md](references/x.md) —
    // isn't flagged as a bare path (the target is already a proper link).
    const stripped = stripFences(text);
    const noLinks = stripped.replace(/\[[^\]]*\]\([^)]*\)/g, '');
    const bare = noLinks.match(/(?<!\]\()(?<![\w/.-])(references|examples|scripts)\/[\w./-]+\.(md|sh|mjs|js|py)/);
    if (bare) {
      out.push(F('R-23', 'warning', rel,
        `Bare sibling path "${bare[0]}" — use a Markdown link so tools lazy-load it.`, { line: lineOf(noLinks, new RegExp(bare[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))) }));
    }
    if (/(^|\s)\.{1,2}\/[\w./-]+/m.test(stripped.replace(/\]\([^)]*\)/g, ''))) {
      out.push(F('R-23', 'warning', rel, 'Relative plain-text path (./ or ../) in body — use Markdown links.'));
    }
    // R-25: frontmatter whitelist + deprecated values
    for (const key of frontmatterKeys(text)) {
      if (!PORTABLE_SKILL_KEYS.has(key) && !TOOL_SPECIFIC_SKILL_KEYS.has(key)) {
        out.push(F('R-25', 'warning', rel, `Unknown frontmatter field "${key}" — not in the portable core or known tool-specific set.`));
      }
    }
    if (/^\s*(user-invocable|disable-model-invocation)\s*:\s*infer\s*$/m.test(text)) {
      out.push(F('R-25', 'warning', rel, '"infer" is deprecated — use explicit user-invocable / disable-model-invocation booleans.'));
    }
  }
  return out;
}

// ── R-27..R-35: agents ──────────────────────────────────────────────────────

const MODEL_ALIASES = new Set(['sonnet', 'opus', 'haiku', 'inherit']);
// Tracked deprecated/retired model-ID patterns (R-35). List tracked — update as
// Anthropic retires IDs (same discipline as the R-22 built-ins list).
const DEPRECATED_MODEL_PATTERNS = [
  /^claude-3/, // all 3.x IDs
  /^claude-(opus|sonnet)-4(-[01])?$/, // claude-{opus,sonnet}-4, -4-0, -4-1
];

export function checkAgents(ctx) {
  const { root } = ctx;
  const out = [];
  const agentsDir = join(root, '.claude', 'agents');
  if (!isDir(agentsDir)) return out;

  for (const abs of walk(agentsDir)) {
    if (!abs.endsWith('.md') || basename(abs) === 'README.md') continue;
    const rel = relative(root, abs).replace(/\\/g, '/');
    if (isSetupTooling(rel)) continue;
    const name = basename(abs, '.md');
    const text = readSafe(abs);
    if (text == null) continue;
    const { frontmatter, body } = parseFrontmatter(text);

    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      out.push(F('R-27', 'info', rel, `Agent filename "${name}.md" is not kebab-case.`));
    }
    if (!frontmatter.tools) {
      out.push(F('R-28', 'warning', rel, 'No "tools:" frontmatter — agent grants ALL tools by default. Declare the minimal set.'));
    }
    const docSection = text.match(/##\s+documents?\b[\s\S]*?(?=\n##|\s*$)/i)?.[0] ?? '';
    if (docSection && /\[.+?\]\(.+?\)/.test(docSection)) {
      out.push(F('R-30', 'warning', rel,
        '## Documents uses Markdown links — use plain repo-root-relative paths (lazy-load convention).',
        { line: lineOf(text, /##\s+documents?\b/i) }));
    }
    if (!/##\s+never\b/i.test(text)) {
      out.push(F('R-31', 'warning', rel, 'Missing "## Never" section.'));
    }
    if (!/##\s+procedures?\b/i.test(text)) {
      out.push(F('R-32', 'warning', rel, 'Missing "## Procedures" section.'));
    }
    const firstContent = body.split('\n').map((l) => l.trim()).filter(Boolean).find((l) => !l.startsWith('#'));
    if (!firstContent) {
      out.push(F('R-33', 'warning', rel, 'Missing role statement (first non-heading body line).'));
    }
    if (!frontmatter.description) {
      out.push(F('R-34', 'warning', rel, 'Missing description — the orchestrator cannot decide when to delegate.'));
    } else if (!/\bwhen\b/i.test(frontmatter.description)) {
      out.push(F('R-34', 'info', rel, 'Description has no "when" clause (rubric hint).'));
    }
    const model = frontmatter.model;
    if (model && !MODEL_ALIASES.has(model)) {
      if (DEPRECATED_MODEL_PATTERNS.some((re) => re.test(model))) {
        out.push(F('R-35', 'warning', rel, `model "${model}" is deprecated/retired — use sonnet/opus/haiku/inherit or a current full ID.`));
      } else if (!/^claude-/.test(model)) {
        out.push(F('R-35', 'warning', rel, `model "${model}" is not a recognized alias or claude-* ID.`));
      }
    }
  }
  return out;
}

// ── R-07: references resolve (all surfaces) ─────────────────────────────────

export function checkReferences(ctx) {
  const { root } = ctx;
  const out = [];
  const targets = [];

  const rootAgents = join(root, 'AGENTS.md');
  if (exists(rootAgents)) targets.push({ abs: rootAgents, agentDocs: false });
  for (const abs of walk(root)) {
    const rel = relative(root, abs).replace(/\\/g, '/');
    if (isSetupTooling(rel)) continue;
    const base = basename(abs);
    if (base === 'AGENTS.md' && rel !== 'AGENTS.md') {
      if (!isPayloadSkeleton(readSafe(abs))) targets.push({ abs, agentDocs: false });
    }
    else if (rel.startsWith('.claude/rules/') && abs.endsWith('.md') && base !== 'README.md') targets.push({ abs, agentDocs: false });
    else if (rel.startsWith('.claude/skills/') && base === 'SKILL.md') targets.push({ abs, agentDocs: false });
    else if (rel.startsWith('.claude/agents/') && abs.endsWith('.md') && base !== 'README.md') targets.push({ abs, agentDocs: true });
  }

  for (const { abs, agentDocs } of targets) {
    const rel = relative(root, abs).replace(/\\/g, '/');
    const text = readSafe(abs);
    if (!text) continue;
    const stripped = stripFences(text);
    const seen = new Set();

    const emit = (rawTarget, line) => {
      let t = rawTarget.trim().replace(/\s+["'(].*$/, '');
      if (!t || t.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(t) || (t.startsWith('<') && t.endsWith('>'))) return;
      t = t.split('#')[0].split('?')[0];
      if (!t) return;
      const key = `${line}:${t}`;
      if (seen.has(key)) return;
      seen.add(key);
      const relResolved = join(dirname(abs), t);
      const rootResolved = join(root, t.replace(/^\.?\//, ''));
      if (exists(relResolved) || exists(rootResolved)) return;
      out.push(F('R-07', 'warning', rel, `Reference "${t}" does not resolve to a file.`, { line }));
    };

    const linkRe = /!?\[[^\]]*\]\(([^)]+)\)/g;
    let m;
    while ((m = linkRe.exec(stripped)) !== null) {
      emit(m[1], stripped.slice(0, m.index).split('\n').length);
    }
    const lines = stripped.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const def = lines[i].match(/^\s*\[[^\]]+\]:\s+(\S+)/);
      if (def) emit(def[1], i + 1);
    }
    if (agentDocs) {
      const dm = text.match(/##\s+documents?\b([\s\S]*?)(?=\n##|\s*$)/i);
      if (dm) {
        const start = text.slice(0, dm.index).split('\n').length;
        const dlines = dm[1].split('\n');
        for (let i = 0; i < dlines.length; i++) {
          const line = dlines[i].trim();
          if (!line || line.startsWith('#') || /^[-*]\s/.test(line)) continue;
          if (/^\[.+?\]\(.+?\)$/.test(line) || !/[./]/.test(line) || /\s/.test(line)) continue;
          emit(line, start + i);
        }
      }
    }
  }
  return out;
}

// ── R-43..R-46: settings ────────────────────────────────────────────────────

const REQUIRED_DENY = ['Read(./.env)', 'Read(./.env.*)'];

export function checkClaudeSettings(ctx) {
  const { root } = ctx;
  const out = [];
  const rel = '.claude/settings.json';
  const text = readSafe(join(root, rel));
  if (text == null) {
    out.push(F('R-43', 'info', rel, 'Missing .claude/settings.json.'));
    return out;
  }
  const parsed = parseJsonc(text);
  if (!parsed) {
    out.push(F('R-43', 'info', rel, 'Not valid JSON.'));
    return out;
  }
  const deny = parsed.permissions?.deny ?? [];
  for (const rule of REQUIRED_DENY) {
    if (!deny.includes(rule)) {
      out.push(F('R-44', 'warning', rel, `permissions.deny must include "${rule}".`));
    }
  }
  // R-46: hooks placement
  if (isDir(join(root, '.github', 'hooks'))) {
    out.push(F('R-46', 'info', '.github/hooks',
      'Hooks should live in .claude/settings.json — read natively by BOTH tools.'));
  }
  return out;
}

const VSCODE_REQUIRED = {
  'chat.useAgentsMdFile': true,
  'chat.useClaudeMdFile': false,
  'chat.useCustomizationsInParentRepositories': true,
  'chat.useAgentSkills': true,
  'chat.useCustomAgentHooks': true,
  'chat.subagents.allowInvocationsFromSubagents': true,
  'chat.tools.terminal.enableAutoApprove': false,
  'explorer.fileNesting.enabled': true,
};

// Is .vscode/settings.json effectively gitignored? Models git's rule that a
// file CANNOT be re-included if a parent directory is excluded — so a bare
// ".vscode/" (directory exclusion) ignores the file even with a later
// "!.vscode/settings.json". Only a contents glob (".vscode/*") leaves the dir
// itself un-excluded so a file negation can take effect.
function vscodeSettingsIgnored(gi) {
  const target = '.vscode/settings.json';
  const lines = gi.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const parse = (l) => {
    const neg = l.startsWith('!');
    return { neg, pat: (neg ? l.slice(1) : l).replace(/^\//, '').replace(/\/$/, '') };
  };
  // Step 1: parent-directory exclusion is sticky — a file negation can't undo it.
  let dirExcluded = false;
  for (const l of lines) {
    const { neg, pat } = parse(l);
    if (pat === '.vscode' || pat === '**/.vscode') dirExcluded = !neg;
  }
  if (dirExcluded) return true;
  // Step 2: file-level patterns, last match wins (negations effective here).
  let ignored = false;
  for (const l of lines) {
    const { neg, pat } = parse(l);
    if (pat === target || pat === '.vscode/*' || pat === '**/settings.json') ignored = !neg;
  }
  return ignored;
}

export function checkVscodeSettings(ctx) {
  const { root, compatMode } = ctx;
  const out = [];
  const rel = '.vscode/settings.json';
  const text = readSafe(join(root, rel));
  if (text == null) {
    out.push(F('R-45', 'warning', rel, 'Missing .vscode/settings.json (required key set, R-45).'));
    return out;
  }
  const parsed = parseJsonc(text);
  if (!parsed) {
    out.push(F('R-45', 'warning', rel, 'Not valid JSON(C).'));
    return out;
  }
  const required = { ...VSCODE_REQUIRED };
  if (compatMode) required['chat.useNestedAgentsMdFiles'] = true;
  for (const [key, val] of Object.entries(required)) {
    if (parsed[key] !== val) {
      out.push(F('R-45', 'warning', rel, `"${key}" must be ${JSON.stringify(val)} (found: ${JSON.stringify(parsed[key])}).`));
    }
  }
  // R-45: empty terminal auto-approve rule map must be present (empty {} or []).
  const auto = parsed['chat.tools.terminal.autoApprove'];
  const autoEmpty = (Array.isArray(auto) && auto.length === 0)
    || (auto != null && typeof auto === 'object' && !Array.isArray(auto) && Object.keys(auto).length === 0);
  if (!autoEmpty) {
    out.push(F('R-45', 'warning', rel,
      `"chat.tools.terminal.autoApprove" must be present and empty (found: ${JSON.stringify(auto)}).`));
  }
  // R-45/R-53: the compat key may exist ONLY while the compat mechanism is active.
  if (!compatMode && parsed['chat.useNestedAgentsMdFiles'] === true) {
    out.push(F('R-45', 'warning', rel,
      '"chat.useNestedAgentsMdFiles" is set but no live nested AGENTS.md exist — the compat key belongs only with the compat mechanism (R-53).'));
  }
  const nesting = parsed['explorer.fileNesting.patterns'];
  if (!nesting || nesting['AGENTS.md'] !== 'CLAUDE.md') {
    out.push(F('R-45', 'warning', rel, 'explorer.fileNesting.patterns must nest CLAUDE.md under AGENTS.md.'));
  }
  // R-45: a gitignored .vscode/settings.json satisfies this check on disk but
  // never gets committed — the shared settings silently don't ship.
  if (isGitRepo(root)) {
    const gi = readSafe(join(root, '.gitignore'));
    if (gi != null && vscodeSettingsIgnored(gi)) {
      out.push(F('R-45', 'warning', rel,
        '.vscode/settings.json is gitignored — it passes on disk but will not be committed; un-ignore it with ".vscode/*" + "!.vscode/settings.json" (a file negation under a bare ".vscode/" does NOT work), or stop ignoring .vscode/.'));
    }
  }
  return out;
}

// ── R-42, R-47..R-50, R-54: hygiene ─────────────────────────────────────────

export function checkHygiene(ctx) {
  const { root, marker } = ctx;
  const out = [];

  // R-42 chatmodes
  if (isDir(join(root, '.github', 'chatmodes'))) {
    out.push(F('R-42', 'warning', '.github/chatmodes', 'Chat modes are deprecated — convert to custom agents (.claude/agents/).'));
  }
  for (const abs of walk(root)) {
    if (abs.endsWith('.chatmode.md')) {
      out.push(F('R-42', 'warning', relative(root, abs).replace(/\\/g, '/'), 'Deprecated .chatmode.md file — rename/convert to a custom agent.'));
    } else if (abs.endsWith('.prompt.md')) {
      // R-54: lingering migration sources anywhere in the tree (parity with R-42).
      out.push(F('R-54', 'warning', relative(root, abs).replace(/\\/g, '/'), 'Lingering *.prompt.md migration source — convert to a user-invocable skill.'));
    }
  }

  // R-54 prompts surface
  if (isDir(join(root, '.github', 'prompts'))) {
    out.push(F('R-54', 'warning', '.github/prompts', 'Prompts surface is dropped — convert *.prompt.md to user-invocable skills.'));
  }

  // R-49 misplaced AI config in .github
  for (const sub of ['skills', 'agents']) {
    if (isDir(join(root, '.github', sub))) {
      out.push(F('R-49', 'warning', `.github/${sub}`, `AI config belongs in .claude/${sub} — both tools read it there.`));
    }
  }
  if (marker.githubCodeReview === false && isDir(join(root, '.github', 'instructions'))) {
    out.push(F('R-49', 'warning', '.github/instructions', 'githubCodeReview is false — path-specific instruction files should be migrated.'));
  }

  // R-47 gitignore
  if (isGitRepo(root)) {
    const gi = readSafe(join(root, '.gitignore'));
    if (gi == null) {
      out.push(F('R-47', 'info', '.gitignore', 'Missing .gitignore.'));
    } else {
      const lines = gi.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      const covered = lines.some((l) =>
        l === '.claude/settings.local.json' || l === 'settings.local.json' || l === '**/settings.local.json'
        || (l.endsWith('/') && '.claude/settings.local.json'.startsWith(l.replace(/^\//, ''))));
      if (!covered) {
        out.push(F('R-47', 'info', '.gitignore', 'Must cover .claude/settings.local.json (personal settings never committed).'));
      }
    }
  }

  // R-48 asset folder READMEs — exactly one per folder, no per-asset READMEs.
  for (const dirRel of ['.claude/agents', '.claude/skills', '.claude/rules']) {
    if (isDir(join(root, dirRel)) && !exists(join(root, dirRel, 'README.md'))) {
      out.push(F('R-48', 'info', dirRel, 'Asset folder is missing its README.md.'));
    }
  }
  for (const sub of ['agents', 'skills', 'rules']) {
    const dir = join(root, '.claude', sub);
    if (!isDir(dir)) continue;
    for (const abs of walk(dir)) {
      if (basename(abs) !== 'README.md') continue;
      const rel = relative(root, abs).replace(/\\/g, '/');
      if (rel === `.claude/${sub}/README.md`) continue; // the sanctioned folder README
      if (isSetupTooling(rel)) continue;
      const segs = rel.split('/');
      if (sub === 'skills' && segs.length > 3
        && isVendored(root, [...segs.slice(0, 3), 'SKILL.md'].join('/'))) continue;
      out.push(F('R-48', 'info', rel, 'Per-asset README — R-48 allows exactly one README.md per asset folder.'));
    }
  }

  // R-50 maintenance surface — marker present AND carrying its required fields.
  if (!marker.present) {
    out.push(F('R-50', 'warning', '.claude/agent-base.json', 'Agent Base marker missing — record standard version, setupAt, githubCodeReview.'));
  } else if (marker.invalid) {
    out.push(F('R-50', 'warning', '.claude/agent-base.json', 'Agent Base marker is not valid JSON — re-record standard, setupAt, githubCodeReview.'));
  } else {
    const missing = ['standard', 'toolRepo', 'setupAt', 'githubCodeReview'].filter((k) => marker[k] === undefined);
    if (missing.length > 0) {
      out.push(F('R-50', 'warning', '.claude/agent-base.json', `Agent Base marker missing required field(s): ${missing.join(', ')}.`));
    }
    if (marker.standard != null && !/^\d+\.\d+\.\d+/.test(String(marker.standard))) {
      out.push(F('R-50', 'warning', '.claude/agent-base.json', 'standard should be semver (e.g. 1.4.0), not a git sha.'));
    }
    for (const k of ['pin', 'lastSyncedAt']) {
      if (marker[k] === undefined) {
        out.push(F('R-50', 'info', '.claude/agent-base.json', `Release pin field "${k}" missing — add for baseline sync (sync-baseline).`));
      }
    }
  }
  if (!exists(join(root, '.claude', 'skills', 'base-check', 'SKILL.md'))) {
    out.push(F('R-50', 'warning', '.claude/skills/base-check', 'Permanent base-check skill is not installed (after setup drift surface).'));
  }

  return out;
}
