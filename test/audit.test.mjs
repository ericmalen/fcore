import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { audit } from '../scripts/audit.mjs';

function makeRepo(files, { git = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aikit-audit-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  if (git) {
    const r = spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0);
  }
  return dir;
}

const rules = (report) => [...new Set(report.findings.map((f) => f.rule))].sort();
const of = (report, rule) => report.findings.filter((f) => f.rule === rule);

// ── The canonical conformant repo: zero findings ────────────────────────────

const CONFORMANT = {
  'AGENTS.md': `# Demo Project

## Overview

A demo.

## Conventions

Use strict mode everywhere.

## Do Not

- No secrets in code.
`,
  'CLAUDE.md': '@AGENTS.md\n',
  '.gitignore': '.claude/settings.local.json\n',
  '.claude/agent-base.json': '{ "standard": "1.0.0", "toolRepo": "https://github.com/ericmalen/agent-base", "pin": "v1.0.0", "lastSyncedAt": "2026-06-10", "setupAt": "2026-06-10", "githubCodeReview": false }\n',
  '.claude/settings.json': `{
  "permissions": {
    "deny": ["Read(./.env)", "Read(./.env.*)"]
  }
}
`,
  '.claude/skills/README.md': '# Skills\nConventions for this folder.\n',
  '.claude/skills/base-check/SKILL.md': `---
name: base-check
description: Audits this repo's AI setup against agent-base conventions. Use when checking for drift or when asked to fix AI-config findings.
---

# base-check

Run the bundled audit and fix findings by rule ID.
`,
  '.vscode/settings.json': `{
  "chat.useAgentsMdFile": true,
  "chat.useClaudeMdFile": false,
  "chat.useCustomizationsInParentRepositories": true,
  "chat.useAgentSkills": true,
  "chat.useCustomAgentHooks": true,
  "chat.subagents.allowInvocationsFromSubagents": true,
  "chat.tools.terminal.enableAutoApprove": false,
  "chat.tools.terminal.autoApprove": {},
  "explorer.fileNesting.enabled": true,
  "explorer.fileNesting.patterns": { "AGENTS.md": "CLAUDE.md" }
}
`,
};

// CONFORMANT's .vscode/settings.json with key overrides (null = delete key).
function vscodeSettings(overrides = {}) {
  const base = JSON.parse(CONFORMANT['.vscode/settings.json']);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) delete base[k];
    else base[k] = v;
  }
  return JSON.stringify(base, null, 2) + '\n';
}

test('conformant repo produces zero findings', () => {
  const repo = makeRepo(CONFORMANT);
  try {
    const report = audit({ root: repo });
    assert.deepEqual(report.findings, [], JSON.stringify(report.findings, null, 2));
    assert.deepEqual(report.summary, { error: 0, warning: 0, info: 0 });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ── Vendored skills (UPSTREAM marker): style rules suppressed ───────────────

test('vendored skill: style rules suppressed, load-critical still fire', () => {
  const body = Array.from({ length: 250 }, (_, i) => `line ${i}`).join('\n');
  const repo = makeRepo({
    '.claude/skills/vendored-skill/UPSTREAM': 'https://github.com/example/skills @ abc123\n',
    '.claude/skills/vendored-skill/SKILL.md':
      `---\nname: wrong-name\ndescription: vendored, used when testing\nbogus-key: 1\n---\n${body}\nreferences/x.md\n`,
  });
  try {
    const report = audit({ root: repo });
    const skillFindings = report.findings.filter((f) => (f.file ?? '').includes('vendored-skill'));
    const fired = skillFindings.map((f) => f.rule);
    assert.ok(fired.includes('R-17'), `R-17 must still fire; fired: ${fired.join(', ')}`);
    for (const suppressed of ['R-20', 'R-23', 'R-25']) {
      assert.ok(!fired.includes(suppressed), `${suppressed} must be suppressed; fired: ${fired.join(', ')}`);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ── Kitchen-sink violations repo: every expected rule fires ─────────────────

test('violations repo: expected rules fire', () => {
  const longDesc = 'x'.repeat(1100);
  const nested60 = '---\nscope: api\n---\n' + Array.from({ length: 60 }, (_, i) => `rule line ${i}`).join('\n') + '\n';
  const repo = makeRepo({
    // no AGENTS.md → R-01
    'CLAUDE.md': 'hello world\n@AGENTS.md\n', // wrong first line → R-11
    'src/api/AGENTS.md': nested60, // R-13 (60 lines), R-14 (frontmatter), R-15 (no sibling)
    '.claude/rules/style.md': '# Style\nNo paths frontmatter here.\n', // R-52 (+R-53 with nested present)
    '.claude/skills/Bad_Skill/SKILL.md': `---\nname: other-name\ndescription: ${longDesc}\nbogus-key: 1\n---\nSee [missing](references/gone.md).\n`,
    '.claude/skills/cat/sub/SKILL.md': '---\nname: sub\ndescription: nested too deep, used when testing\n---\nbody\n', // R-26
    '.claude/agents/MyAgent.md': `---\nmodel: claude-sonnet-4-0\n---\nDoes things.\n\n## Documents\n\n[link](AGENTS.md)\n`,
    '.github/chatmodes/dev.chatmode.md': 'old chatmode\n', // R-42
    '.github/prompts/go.prompt.md': '---\ndescription: x\n---\nbody\n', // R-54
    '.github/skills/x/SKILL.md': 'misplaced\n', // R-49
    '.claude/settings.json': '{ "permissions": { "deny": [] } }\n', // R-44 ×2
    '.gitignore': 'node_modules/\n', // R-47
    // no .vscode/settings.json → R-45; no marker → R-50
  });
  try {
    const report = audit({ root: repo });
    const fired = rules(report);
    for (const expected of [
      'R-01', 'R-11', 'R-13', 'R-14', 'R-15', 'R-17', 'R-18', 'R-19', 'R-25', 'R-26',
      'R-27', 'R-28', 'R-30', 'R-31', 'R-32', 'R-34', 'R-35', 'R-42', 'R-44', 'R-45',
      'R-47', 'R-48', 'R-49', 'R-50', 'R-52', 'R-53', 'R-54', 'R-07',
    ]) {
      assert.ok(fired.includes(expected), `expected ${expected} to fire; fired: ${fired.join(', ')}`);
    }
    // severities spot-checks
    assert.equal(of(report, 'R-01')[0].severity, 'error');
    assert.equal(of(report, 'R-17')[0].severity, 'error');
    assert.equal(of(report, 'R-19')[0].severity, 'error');
    assert.equal(of(report, 'R-26')[0].severity, 'error');
    assert.equal(of(report, 'R-44').length, 2);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ── R-09 conditional branches ───────────────────────────────────────────────

test('R-09: codeReview=true requires copilot-instructions.md (short, pointing at AGENTS.md)', () => {
  const repo = makeRepo({
    ...CONFORMANT,
    '.claude/agent-base.json': '{ "standard": "1.0.0", "toolRepo": "https://github.com/ericmalen/agent-base", "pin": "v1.0.0", "lastSyncedAt": "2026-06-10", "setupAt": "2026-06-10", "githubCodeReview": true }\n',
  });
  try {
    let report = audit({ root: repo });
    assert.equal(of(report, 'R-09').length, 1); // missing file

    mkdirSync(join(repo, '.github'), { recursive: true });
    writeFileSync(join(repo, '.github', 'copilot-instructions.md'), 'See AGENTS.md.\n');
    report = audit({ root: repo });
    assert.equal(of(report, 'R-09').length, 0);

    // oversized file fires
    writeFileSync(join(repo, '.github', 'copilot-instructions.md'), 'See AGENTS.md.\n' + 'y'.repeat(4100));
    const report2 = audit({ root: repo });
    assert.equal(of(report2, 'R-09').length, 1);
    assert.match(of(report2, 'R-09')[0].message, /4,000/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('R-09: codeReview=false flags a lingering copilot-instructions.md', () => {
  const repo = makeRepo({
    ...CONFORMANT,
    '.github/copilot-instructions.md': 'leftover\n',
  });
  try {
    const report = audit({ root: repo });
    assert.equal(of(report, 'R-09').length, 1);
    assert.match(of(report, 'R-09')[0].message, /folded/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('R-09: no recorded stance → info', () => {
  const { ['.claude/agent-base.json']: _omit, ...rest } = CONFORMANT;
  const repo = makeRepo({ ...rest, '.github/copilot-instructions.md': 'stuff\n' });
  try {
    const report = audit({ root: repo });
    const r09 = of(report, 'R-09');
    assert.equal(r09.length, 1);
    assert.equal(r09[0].severity, 'info');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ── compat mode: nested AGENTS.md requires the nested VS Code key ───────────

test('compat mode requires chat.useNestedAgentsMdFiles', () => {
  const repo = makeRepo({
    ...CONFORMANT,
    'src/AGENTS.md': '# API scope\nShort and focused.\n',
    'src/CLAUDE.md': '@AGENTS.md\n',
  });
  try {
    const report = audit({ root: repo });
    const r45 = of(report, 'R-45');
    assert.equal(r45.length, 1);
    assert.match(r45[0].message, /useNestedAgentsMdFiles/);
    // no R-53: only one mechanism in use (no rules files beyond README)
    assert.equal(of(report, 'R-53').length, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ── strict escalation + CLI exit codes ──────────────────────────────────────

test('strict escalates per spec (R-04 info → warning)', () => {
  const repo = makeRepo({
    ...CONFORMANT,
    'AGENTS.md': CONFORMANT['AGENTS.md'] + '\n<!-- TODO: fill this in -->\n',
  });
  try {
    assert.equal(of(audit({ root: repo }), 'R-04')[0].severity, 'info');
    assert.equal(of(audit({ root: repo, strict: true }), 'R-04')[0].severity, 'warning');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI: exit 0 on clean, exit 1 with --strict on any finding', () => {
  const cleanRepo = makeRepo(CONFORMANT);
  const todoRepo = makeRepo({
    ...CONFORMANT,
    'AGENTS.md': CONFORMANT['AGENTS.md'] + '\n<!-- TODO -->\n',
  });
  const cli = join(process.cwd(), 'scripts', 'audit.mjs');
  try {
    assert.equal(spawnSync(process.execPath, [cli, '--root', cleanRepo], { encoding: 'utf8' }).status, 0);
    // info-only findings: non-strict passes, strict fails
    assert.equal(spawnSync(process.execPath, [cli, '--root', todoRepo], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync(process.execPath, [cli, '--root', todoRepo, '--strict'], { encoding: 'utf8' }).status, 1);
    // --json emits parseable report
    const r = spawnSync(process.execPath, [cli, '--root', cleanRepo, '--json'], { encoding: 'utf8' });
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.summary.error, 0);
  } finally {
    rmSync(cleanRepo, { recursive: true, force: true });
    rmSync(todoRepo, { recursive: true, force: true });
  }
});

// ── R-45 completeness: auto-approve map + compat-key direction ──────────────

test('R-45: terminal auto-approve map must be present and empty', () => {
  const cases = [
    [vscodeSettings({ 'chat.tools.terminal.autoApprove': null }), 1], // absent → fires
    [vscodeSettings({ 'chat.tools.terminal.autoApprove': { ls: true } }), 1], // non-empty → fires
    [vscodeSettings({ 'chat.tools.terminal.autoApprove': [] }), 0], // empty array OK
    [vscodeSettings({}), 0], // empty object OK (CONFORMANT default)
  ];
  for (const [settings, expected] of cases) {
    const repo = makeRepo({ ...CONFORMANT, '.vscode/settings.json': settings });
    try {
      const hits = of(audit({ root: repo }), 'R-45').filter((f) => /autoApprove/.test(f.message));
      assert.equal(hits.length, expected, settings);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test('R-45: compat key without compat mechanism fires (reverse direction)', () => {
  const repo = makeRepo({
    ...CONFORMANT,
    '.vscode/settings.json': vscodeSettings({ 'chat.useNestedAgentsMdFiles': true }),
  });
  try {
    const r45 = of(audit({ root: repo }), 'R-45');
    assert.equal(r45.length, 1, JSON.stringify(r45));
    assert.match(r45[0].message, /useNestedAgentsMdFiles/);
    assert.match(r45[0].message, /R-53/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('payload skeletons (agent-base:slot markers) do not trigger compat mode', () => {
  const skeleton = '# <!-- agent-base:slot:intro -->\n\n<!-- agent-base:optional -->\n## Overview\n';
  const live = '# Sub scope\nShort and focused.\n';
  const skeletonRepo = makeRepo({ ...CONFORMANT, 'templates/instructions/AGENTS.md': skeleton });
  const liveRepo = makeRepo({ ...CONFORMANT, 'templates/instructions/AGENTS.md': live });
  try {
    // Skeleton: not live config — no compat, no nested-key requirement, zero findings.
    assert.deepEqual(audit({ root: skeletonRepo }).findings, []);
    // Same path without markers IS live nested config → compat requirements fire.
    const fired = rules(audit({ root: liveRepo }));
    assert.ok(fired.includes('R-45'), `expected R-45 (nested key); fired: ${fired.join(', ')}`);
    assert.ok(fired.includes('R-15'), `expected R-15 (missing shim); fired: ${fired.join(', ')}`);
  } finally {
    rmSync(skeletonRepo, { recursive: true, force: true });
    rmSync(liveRepo, { recursive: true, force: true });
  }
});

// ── R-50 marker content validation ──────────────────────────────────────────

test('R-50: unparseable marker and missing fields fire', () => {
  const badJson = makeRepo({ ...CONFORMANT, '.claude/agent-base.json': '{ not json\n' });
  const missingFields = makeRepo({ ...CONFORMANT, '.claude/agent-base.json': '{ "standard": "abc" }\n' });
  try {
    const r1 = of(audit({ root: badJson }), 'R-50');
    assert.equal(r1.length, 1);
    assert.match(r1[0].message, /not valid JSON/);

    const r2 = of(audit({ root: missingFields }), 'R-50');
    assert.ok(r2.some((f) => /missing required field/.test(f.message)));
    assert.match(r2.find((f) => /missing required field/.test(f.message)).message, /toolRepo, setupAt, githubCodeReview/);
  } finally {
    rmSync(badJson, { recursive: true, force: true });
    rmSync(missingFields, { recursive: true, force: true });
  }
});

// ── R-48 per-asset READMEs + R-54 stray prompt files ────────────────────────

test('R-48: per-asset README fires; vendored skill exempt', () => {
  const repo = makeRepo({
    ...CONFORMANT,
    '.claude/skills/some-skill/SKILL.md': '---\nname: some-skill\ndescription: Does x. Use when y.\n---\nbody\n',
    '.claude/skills/some-skill/README.md': 'per-asset readme\n', // → fires
    '.claude/skills/vend/UPSTREAM': 'https://example.com @ abc\n',
    '.claude/skills/vend/SKILL.md': '---\nname: vend\ndescription: vendored, used when testing\n---\nbody\n',
    '.claude/skills/vend/README.md': 'upstream ships one\n', // vendored → exempt
  });
  try {
    const r48 = of(audit({ root: repo }), 'R-48').filter((f) => /Per-asset/.test(f.message));
    assert.equal(r48.length, 1, JSON.stringify(r48));
    assert.equal(r48[0].file, '.claude/skills/some-skill/README.md');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('R-54: stray *.prompt.md outside .github/prompts fires', () => {
  const repo = makeRepo({ ...CONFORMANT, 'tools/old.prompt.md': 'legacy prompt\n' });
  try {
    const r54 = of(audit({ root: repo }), 'R-54');
    assert.equal(r54.length, 1);
    assert.equal(r54[0].file, 'tools/old.prompt.md');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ── R-07 reference resolution ───────────────────────────────────────────────

test('R-07: broken and valid references across surfaces', () => {
  const repo = makeRepo({
    ...CONFORMANT,
    'AGENTS.md': CONFORMANT['AGENTS.md'] + '\nSee [docs](docs/missing.md) and [spec](docs/real.md).\n',
    'docs/real.md': 'exists\n',
    '.claude/agents/README.md': '# Agents\n',
    '.claude/agents/reviewer.md': `---
name: reviewer
description: Reviews PRs. Use when a PR needs review.
tools: Read, Grep, Glob
---

Reviews pull requests; never edits files.

## Procedures

1. Read the diff.

## Never

- Never edit files.

## Documents

AGENTS.md
docs/nonexistent-thing.md
`,
  });
  try {
    const report = audit({ root: repo });
    const r07 = of(report, 'R-07');
    const targets = r07.map((f) => f.message);
    assert.equal(r07.length, 2, JSON.stringify(r07));
    assert.ok(targets.some((m) => m.includes('docs/missing.md')));
    assert.ok(targets.some((m) => m.includes('docs/nonexistent-thing.md')));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ── R-47 in a linked git worktree (B3): .git is a "gitdir:" file, not a dir ──

test('R-47: evaluates in a worktree checkout (.git is a gitdir: file)', () => {
  const repo = makeRepo({
    ...CONFORMANT,
    '.gitignore': 'node_modules/\n', // does NOT cover .claude/settings.local.json
    '.git': 'gitdir: /elsewhere/.git/worktrees/wt\n',
  }, { git: false });
  try {
    const r47 = of(audit({ root: repo }), 'R-47');
    assert.equal(r47.length, 1, 'R-47 must still evaluate when .git is a worktree pointer file');
    assert.match(r47[0].message, /settings\.local\.json/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ── R-23 false positive (link label that is path-shaped) ─────────────────────

test('R-23: a path-shaped link LABEL is not flagged as a bare sibling path', () => {
  const skill = (body) => ({
    ...CONFORMANT,
    '.claude/skills/README.md': '# Skills\n',
    '.claude/skills/demo/SKILL.md': `---\nname: demo\ndescription: Does demo work when demoing.\n---\n\n# demo\n\n${body}\n`,
    '.claude/skills/demo/references/architecture.md': '# Arch\n',
  });
  const linked = makeRepo(skill('See [references/architecture.md](references/architecture.md).'));
  const bare = makeRepo(skill('See references/architecture.md for detail.'));
  try {
    assert.equal(of(audit({ root: linked }), 'R-23').length, 0, 'well-formed link must not fire R-23');
    assert.ok(of(audit({ root: bare }), 'R-23').length >= 1, 'a truly bare path must still fire R-23');
  } finally {
    rmSync(linked, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  }
});

// ── R-45 (A4): a gitignored .vscode/settings.json passes on disk but won't ship ─

test('R-45: gitignored .vscode/settings.json fires; only a ".vscode/*"+negation clears it', () => {
  const hit = (gi) => of(audit({ root: makeRepo({ ...CONFORMANT, '.gitignore': gi }) }), 'R-45')
    .filter((f) => /gitignored/.test(f.message)).length;
  const base = '.claude/settings.local.json\n';
  // bare ".vscode/" excludes the directory — git can't re-include the file, so
  // a "!.vscode/settings.json" negation does NOT clear it (still fires).
  assert.equal(hit(base + '.vscode/\n'), 1, 'bare .vscode/ → fires');
  assert.equal(hit(base + '.vscode/\n!.vscode/settings.json\n'), 1, 'dir exclusion + file negation still ignored by git → fires');
  // contents glob leaves the dir itself un-excluded, so the negation works.
  assert.equal(hit(base + '.vscode/*\n!.vscode/settings.json\n'), 0, '.vscode/* + negation → committable → clean');
  // ".vscode/**" is also a contents glob: excludes the file, negation re-includes.
  assert.equal(hit(base + '.vscode/**\n'), 1, '.vscode/** → fires');
  assert.equal(hit(base + '.vscode/**\n!.vscode/settings.json\n'), 0, '.vscode/** + negation → committable → clean');
});

// ── R-52: block-style YAML paths lists are valid frontmatter ────────────────

test('R-52: block-style paths: list is accepted; missing paths still fires', () => {
  const rulesRepo = (file) => makeRepo({
    ...CONFORMANT,
    '.claude/rules/README.md': '# Rules\n',
    ...file,
  });
  const block = rulesRepo({ '.claude/rules/tests.md': '---\npaths:\n  - "**/*.test.ts"\n---\nTesting conventions.\n' });
  const noPaths = rulesRepo({ '.claude/rules/style.md': '---\nscope: style\n---\nStyle conventions.\n' });
  try {
    assert.equal(of(audit({ root: block }), 'R-52').length, 0, 'block-style paths list must pass');
    assert.equal(of(audit({ root: noPaths }), 'R-52').length, 1, 'frontmatter without paths must fire');
  } finally {
    rmSync(block, { recursive: true, force: true });
    rmSync(noPaths, { recursive: true, force: true });
  }
});

// ── R-47: bare ".claude" prefix entry counts (git ignores the dir either way) ─

test('R-47: bare ".claude" and ".claude/" gitignore entries both count', () => {
  for (const gi of ['.claude\n', '.claude/\n', '/.claude\n']) {
    const repo = makeRepo({ ...CONFORMANT, '.gitignore': gi });
    try {
      assert.equal(of(audit({ root: repo }), 'R-47').length, 0, JSON.stringify(gi));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

// ── R-23: inline code spans are exempt ──────────────────────────────────────

test('R-23: paths in inline code spans are exempt; bare relative paths still fire', () => {
  const skill = (body) => ({
    ...CONFORMANT,
    '.claude/skills/demo/SKILL.md': `---\nname: demo\ndescription: Does demo work when demoing.\n---\n\n# demo\n\n${body}\n`,
  });
  const coded = makeRepo(skill('Run `node ./scripts/run.mjs` to start.'));
  const bare = makeRepo(skill('See ./scripts/run.mjs to start.'));
  try {
    assert.equal(of(audit({ root: coded }), 'R-23').length, 0, 'inline code must not fire R-23');
    assert.ok(of(audit({ root: bare }), 'R-23').length >= 1, 'a bare relative path must still fire R-23');
  } finally {
    rmSync(coded, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  }
});

// ── R-35: fable alias is current ────────────────────────────────────────────

test('R-35: fable alias accepted; unknown model still fires', () => {
  const agent = (model) => ({
    ...CONFORMANT,
    '.claude/agents/README.md': '# Agents\n',
    '.claude/agents/probe.md': `---\ndescription: Probes things. Use when probing.\ntools: Read\nmodel: ${model}\n---\n\nProbes the system; never edits.\n\n## Procedures\n\n1. Probe.\n\n## Never\n\n- Edit.\n`,
  });
  const fable = makeRepo(agent('fable'));
  const bogus = makeRepo(agent('gpt-5'));
  try {
    assert.equal(of(audit({ root: fable }), 'R-35').length, 0, 'fable is a current alias');
    assert.equal(of(audit({ root: bogus }), 'R-35').length, 1, 'unknown model must fire');
  } finally {
    rmSync(fable, { recursive: true, force: true });
    rmSync(bogus, { recursive: true, force: true });
  }
});

// ── R-43: the committed clause — gitignored settings.json fires ─────────────

test('R-43: gitignored .claude/settings.json fires (committed clause)', () => {
  const ignored = makeRepo({
    ...CONFORMANT,
    '.gitignore': '.claude/settings.local.json\n.claude/settings.json\n',
  });
  const clean = makeRepo(CONFORMANT);
  try {
    const hits = of(audit({ root: ignored }), 'R-43').filter((f) => /gitignored/.test(f.message));
    assert.equal(hits.length, 1);
    assert.equal(hits[0].severity, 'info');
    assert.equal(of(audit({ root: clean }), 'R-43').length, 0);
  } finally {
    rmSync(ignored, { recursive: true, force: true });
    rmSync(clean, { recursive: true, force: true });
  }
});

// ── R-21: "whenever" satisfies the when-clause nudge ────────────────────────

test('R-21: a "whenever" description carries a when clause', () => {
  const repo = makeRepo({
    ...CONFORMANT,
    '.claude/skills/wf/SKILL.md': '---\nname: wf\ndescription: Does wf work, activated whenever wf-ing.\n---\nbody\n',
  });
  try {
    assert.equal(of(audit({ root: repo }), 'R-21').length, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
