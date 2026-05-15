import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { validateRouting } from '../lib/migrate/routing.mjs';
import { validateRoutingSemantic } from '../lib/migrate/routing-validate.mjs';
import { deriveTargetDirs, isUnscopedApplyTo } from '../lib/migrate/applyto.mjs';
import { findPreexistingUnmanaged } from '../lib/brownfield.mjs';
import { snapshot, verifyAll } from '../lib/migrate/premise.mjs';
import { applyDeltas } from '../lib/migrate/manifest-resolve.mjs';
import { stageUnit as stageMarkdownFold } from '../lib/migrate/dispositions/markdown-fold.mjs';
import { stageUnit as stageJsonMerge } from '../lib/migrate/dispositions/json-merge.mjs';
import { stageUnit as stageLeaveAsIs } from '../lib/migrate/dispositions/leave-as-is.mjs';
import { stageUnit as stageGithubRoute } from '../lib/migrate/dispositions/github-route.mjs';
import { clear as clearStaging, write as writeStaging, STAGING_DIR } from '../lib/migrate/staging.mjs';
import { buildAndWrite, parsePlan, PLAN_FILE } from '../lib/migrate/plan.mjs';
import { applyMigration } from '../lib/migrate/apply-exec.mjs';
import { enumerate } from '../lib/migrate/work-units.mjs';
import { buildManifest, addFileEntry, addPendingIntegration, addPreexistingUnmanaged } from '../lib/manifest.mjs';
import { loadRegistry } from '../lib/registry.mjs';
import { getScaffoldRoot } from '../lib/paths.mjs';

const FIXTURE = join(fileURLToPath(import.meta.url), '../../test/fixtures/rr-api-mini');
const MANIFEST_NAME = '.claude/ai-kit.json';

function tmp() {
  return mkdtempSync(join(tmpdir(), 'ai-kit-migrate-'));
}

function copyFixture(dir = 'pre') {
  const dest = tmp();
  cpSync(join(FIXTURE, dir), dest, { recursive: true });
  return dest;
}

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

// ── routing.mjs ──────────────────────────────────────────────────────────────

test('validateRouting — accepts valid routing JSON', () => {
  const routing = readJson(join(FIXTURE, 'routing.json'));
  assert.doesNotThrow(() => validateRouting(routing));
});

test('validateRouting — rejects missing schemaVersion', () => {
  assert.throws(() => validateRouting({ workUnits: [] }), /schemaVersion/);
});

test('validateRouting — rejects unknown unit type', () => {
  assert.throws(() => validateRouting({
    schemaVersion: 1,
    workUnits: [{ id: 'x', type: 'unknown', manifestDelta: [], deletions: [] }],
  }), /Unknown unit type/);
});

test('validateRouting — accepts markdown-fold without h2Routing (injected from scope at stage)', () => {
  // Agent-emitted routing JSON need not include h2Routing — scope merge provides it.
  assert.doesNotThrow(() => validateRouting({
    schemaVersion: 1,
    workUnits: [{
      id: 'x', type: 'markdown-fold',
      sources: [{ path: 'CLAUDE.md' }], // no h2Routing — valid agent output
    }],
  }));
});

// ── premise.mjs ──────────────────────────────────────────────────────────────

test('snapshot — existing file', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'foo.md'), 'line1\nline2\nline3\n');
  const snap = snapshot(join(dir, 'foo.md'));
  assert.equal(snap.exists, true);
  assert.equal(snap.lines, 3);
  assert.equal(snap.first, 'line1');
  assert.equal(snap.last, 'line3');
});

test('snapshot — absent file', () => {
  const snap = snapshot('/nonexistent/path/foo.md');
  assert.equal(snap.exists, false);
  assert.equal(snap.lines, 0);
});

test('verifyAll — ok when nothing drifted', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'f.md'), 'a\nb\n');
  const snap = snapshot(join(dir, 'f.md'));
  const { ok, drifted } = verifyAll([snap]);
  assert.equal(ok, true);
  assert.equal(drifted.length, 0);
});

test('verifyAll — detects drift', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'f.md'), 'a\nb\n');
  const snap = snapshot(join(dir, 'f.md'));
  writeFileSync(join(dir, 'f.md'), 'a\nb\nc\n');
  const { ok, drifted } = verifyAll([snap]);
  assert.equal(ok, false);
  assert.equal(drifted.length, 1);
});

// ── manifest-resolve.mjs ─────────────────────────────────────────────────────

test('applyDeltas — resolvePending removes entry, flips installedAs, drops sidecar', () => {
  const m = buildManifest({ sourceRepo: 'r', commit: null, mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });
  addFileEntry(m, 'CLAUDE.md', { sourceHash: 'abc', installedAs: 'CLAUDE.md.ai-kit', role: 'wiring', sidecar: true });
  addPendingIntegration(m, { managedPath: 'CLAUDE.md', sidecarPath: 'CLAUDE.md.ai-kit', reason: 'test' });

  applyDeltas(m, [{ kind: 'resolvePending', managedPath: 'CLAUDE.md' }]);

  assert.equal(m.pendingIntegration.length, 0);
  assert.equal(m.files['CLAUDE.md'].installedAs, 'CLAUDE.md');
  assert.equal(m.files['CLAUDE.md'].sidecar, undefined);
  assert.equal(m.files['CLAUDE.md'].sourceHash, 'abc');
});

test('applyDeltas — never touches sacred fields', () => {
  const m = buildManifest({ sourceRepo: 'http://example.com', commit: 'deadbeef', mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });
  addPendingIntegration(m, { managedPath: 'CLAUDE.md', sidecarPath: 'CLAUDE.md.ai-kit', reason: 'test' });

  const sacredBefore = JSON.stringify({ schemaVersion: m.schemaVersion, source: m.source, mode: m.mode, installed: m.installed });
  applyDeltas(m, [{ kind: 'resolvePending', managedPath: 'CLAUDE.md' }]);
  const sacredAfter = JSON.stringify({ schemaVersion: m.schemaVersion, source: m.source, mode: m.mode, installed: m.installed });

  assert.equal(sacredBefore, sacredAfter);
});

test('applyDeltas — resolveUnmanaged removes from preexistingUnmanaged', () => {
  const m = buildManifest({ sourceRepo: 'r', commit: null, mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });
  addPreexistingUnmanaged(m, '.claude/settings.local.json');

  applyDeltas(m, [{ kind: 'resolveUnmanaged', path: '.claude/settings.local.json' }]);

  assert.equal(m.preexistingUnmanaged.length, 0);
});

// ── markdown-fold disposition ────────────────────────────────────────────────

test('markdown-fold — routes H2s, demotes headings, preserves body', () => {
  const dir = copyFixture();
  const routing = readJson(join(FIXTURE, 'routing.json'));
  const unit = routing.workUnits.find(u => u.id === 'root-agents-md');

  const { stagingFiles, premiseSnapshots } = stageMarkdownFold(unit, dir);

  assert.ok(stagingFiles.length >= 1, 'should produce at least one staging file');
  const agentsMdFile = stagingFiles.find(f => f.relPath === 'AGENTS.md');
  assert.ok(agentsMdFile, 'should produce AGENTS.md staging file');

  const content = agentsMdFile.content;

  // Check canonical H2s present
  assert.ok(content.includes('## Overview'), 'has ## Overview');
  assert.ok(content.includes('## Architecture'), 'has ## Architecture');
  assert.ok(content.includes('## Conventions'), 'has ## Conventions');
  assert.ok(content.includes('## Do Not'), 'has ## Do Not');

  // Consumer body preserved verbatim
  assert.ok(content.includes('A REST API for managing widgets'), 'Overview body preserved');
  assert.ok(content.includes('dotnet run --project src/Api'), 'Common Commands body preserved');
  assert.ok(content.includes('Never call external APIs'), 'Critical Notes body preserved');

  // Heading demotion: ## Architecture sub-heading becomes ###
  assert.ok(content.includes('### Layers'), 'Architecture sub-heading demoted');

  // keepOriginalHeading=true for Common Commands → appears as ### Common Commands
  assert.ok(content.includes('### Common Commands'), 'keepOriginalHeading preserves as H3');

  // keepOriginalHeading=false for Project Overview → body only, no ### Project Overview
  assert.ok(!content.includes('### Project Overview'), 'Project Overview heading dropped');

  // Shim file produced
  const shimFile = stagingFiles.find(f => f.relPath === 'CLAUDE.md');
  assert.ok(shimFile, 'should produce CLAUDE.md shim staging file');
  assert.ok(shimFile.content.includes('@AGENTS.md'), 'CLAUDE.md shim contains @AGENTS.md');

  // Premise snapshots include source + target
  assert.ok(premiseSnapshots.some(s => s.file.endsWith('CLAUDE.md')), 'snapshots CLAUDE.md');
  assert.ok(premiseSnapshots.some(s => s.file.endsWith('AGENTS.md')), 'snapshots AGENTS.md');
});

test('markdown-fold — code blocks not split as H2', () => {
  const dir = tmp();
  // Create a CLAUDE.md with ## inside a fenced code block
  writeFileSync(join(dir, 'CLAUDE.md'), [
    '# My Project',
    '',
    '## Architecture',
    '',
    'Example:',
    '```yaml',
    '## this is not a heading',
    '  key: value',
    '```',
    '',
    'Real content here.',
  ].join('\n') + '\n');
  writeFileSync(join(dir, 'AGENTS.md'), [
    '# Project',
    '',
    '## Overview',
    '',
    '## Architecture',
    '',
    '## Conventions',
    '',
    '## Do Not',
    '',
    '## More Context',
    '',
  ].join('\n') + '\n');

  const unit = {
    type: 'markdown-fold',
    target: 'AGENTS.md',
    shimInstall: null,
    sources: [{
      path: 'CLAUDE.md',
      h2Routing: [{
        sourceHeading: '## Architecture',
        sourceLineRange: [3, 11],
        targetHeading: '## Architecture',
        demote: false,
        keepOriginalHeading: false,
      }],
    }],
  };

  const { stagingFiles } = stageMarkdownFold(unit, dir);
  const out = stagingFiles.find(f => f.relPath === 'AGENTS.md').content;

  // The ## inside the code block should NOT create a separate section
  assert.ok(out.includes('## this is not a heading'), 'code block content preserved verbatim');
  assert.ok(out.includes('Real content here'), 'body after code block preserved');
});

test('markdown-fold — rewrites relative markdown links to stay valid after fold', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'CLAUDE.md'), [
    '# Project',
    '',
    '## Conventions',
    '',
    'See [helper](./scripts/foo.sh) and [docs](docs/intro.md).',
    '',
  ].join('\n') + '\n');
  mkdirSync(join(dir, '.cursor', 'rules'), { recursive: true });
  writeFileSync(join(dir, '.cursor', 'rules', 'backend.md'), [
    '# Backend',
    '',
    '## Architecture',
    '',
    'See [neighbor](./neighbor.md).',
    '',
  ].join('\n') + '\n');
  writeFileSync(join(dir, 'AGENTS.md'), [
    '# Project',
    '',
    '## Overview',
    '',
    '## Architecture',
    '',
    '## Conventions',
    '',
    '## Do Not',
    '',
    '## More Context',
    '',
  ].join('\n') + '\n');

  const unit = {
    type: 'markdown-fold',
    target: 'AGENTS.md',
    shimInstall: null,
    sources: [
      {
        path: 'CLAUDE.md',
        h2Routing: [{
          sourceHeading: '## Conventions',
          targetHeading: '## Conventions',
          demote: false,
          keepOriginalHeading: false,
        }],
      },
      {
        path: '.cursor/rules/backend.md',
        h2Routing: [{
          sourceHeading: '## Architecture',
          targetHeading: '## Architecture',
          demote: false,
          keepOriginalHeading: false,
        }],
      },
    ],
  };

  const { stagingFiles } = stageMarkdownFold(unit, dir);
  const out = stagingFiles.find(f => f.relPath === 'AGENTS.md').content;

  // CLAUDE.md → AGENTS.md is a same-dir move; ./scripts/foo.sh stays.
  assert.ok(out.includes('[helper](./scripts/foo.sh)'),
    `same-dir relative link preserved; got: ${out}`);
  // Absolute consumer-root path docs/intro.md is unchanged.
  assert.ok(out.includes('[docs](docs/intro.md)'),
    `absolute root path unchanged; got: ${out}`);
  // .cursor/rules/backend.md → AGENTS.md: ./neighbor.md must rewrite.
  assert.ok(out.includes('[neighbor](./.cursor/rules/neighbor.md)'),
    `cross-dir relative link rewritten; got: ${out}`);
});

// ── json-merge disposition ───────────────────────────────────────────────────

test('json-merge — aikit-wins-on-conflict: consumer keys preserved, ai-kit overwrites on conflict', () => {
  const dir = copyFixture();
  const routing = readJson(join(FIXTURE, 'routing.json'));
  const unit = routing.workUnits.find(u => u.id === 'vscode-settings');

  const { stagingFiles } = stageJsonMerge(unit, dir);
  const merged = JSON.parse(stagingFiles[0].content);

  // Consumer-only key preserved
  assert.equal(merged['editor.formatOnSave'], true);
  assert.equal(merged['editor.tabSize'], 2);

  // ai-kit keys present
  assert.equal(merged['chat.tools.autoApprove'], false);
  assert.equal(merged['chat.agent.enabled'], true);
  assert.ok('github.copilot.enable' in merged);
});

test('json-merge — JSONC comments stripped before parse', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'consumer.json'), '{"a": 1}\n');
  writeFileSync(join(dir, 'aikit.json'), '{\n  // a comment\n  "b": 2\n}\n');

  const unit = {
    type: 'json-merge',
    mergeStrategy: 'aikit-wins-on-conflict',
    target: 'consumer.json',
    sources: ['consumer.json', 'aikit.json'],
    deletions: ['aikit.json'],
    manifestDelta: [],
  };

  const { stagingFiles } = stageJsonMerge(unit, dir);
  const merged = JSON.parse(stagingFiles[0].content);
  assert.equal(merged.a, 1);
  assert.equal(merged.b, 2);
});

test('json-merge — deny-union-allow-keep-hooks-merge: deny is union', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'consumer.json'), JSON.stringify({
    permissions: { deny: ['Bash(rm -rf *)'], allow: ['Bash(git*)'] },
  }) + '\n');
  writeFileSync(join(dir, 'aikit.json'), JSON.stringify({
    permissions: { deny: ['Read(.env)', 'Bash(rm -rf *)'] },
  }) + '\n');

  const unit = {
    type: 'json-merge',
    mergeStrategy: 'deny-union-allow-keep-hooks-merge',
    target: 'consumer.json',
    sources: ['consumer.json', 'aikit.json'],
    deletions: ['aikit.json'],
    manifestDelta: [],
  };

  const { stagingFiles } = stageJsonMerge(unit, dir);
  const merged = JSON.parse(stagingFiles[0].content);

  // Union: consumer first, ai-kit novel entries appended, no duplicates
  assert.deepEqual(merged.permissions.deny, ['Bash(rm -rf *)', 'Read(.env)']);
  // allow kept from consumer only
  assert.deepEqual(merged.permissions.allow, ['Bash(git*)']);
});

// ── instructions-fold via markdown-fold ──────────────────────────────────────

test('markdown-fold — instructions-fold source: strips frontmatter, folds H2s, shimReplace creates shim', () => {
  const dir = tmp();
  mkdirSync(join(dir, '.github/instructions'), { recursive: true });
  mkdirSync(join(dir, 'src/api'), { recursive: true });
  writeFileSync(join(dir, '.github/instructions/backend.instructions.md'), [
    '---',
    'applyTo: src/api/**',
    '---',
    '',
    '## Backend Conventions',
    '',
    'Use Result<T> for error propagation.',
  ].join('\n') + '\n');

  const unit = {
    type: 'markdown-fold',
    target: 'src/api/AGENTS.md',
    shimReplace: { path: 'src/api/CLAUDE.md', content: '@AGENTS.md\n' },
    sources: [{
      path: '.github/instructions/backend.instructions.md',
      originType: 'instructions-fold',
      h2Routing: [{
        sourceHeading: '## Backend Conventions',
        sourceLineRange: [2, 4],
        targetHeading: '## Conventions',
        demote: true,
        keepOriginalHeading: true,
      }],
    }],
    deletions: ['.github/instructions/backend.instructions.md'],
    manifestDelta: [],
  };

  const { stagingFiles } = stageMarkdownFold(unit, dir);

  const agentsMd = stagingFiles.find(f => f.relPath === 'src/api/AGENTS.md');
  const claudeMd = stagingFiles.find(f => f.relPath === 'src/api/CLAUDE.md');

  assert.ok(agentsMd, 'nested AGENTS.md staged at correct path');
  assert.ok(claudeMd, 'nested CLAUDE.md shim staged');
  assert.ok(agentsMd.content.includes('Use Result<T>'), 'body content preserved');
  assert.ok(agentsMd.content.includes('## Conventions'), 'content routed to canonical section');
  assert.equal(claudeMd.content, '@AGENTS.md\n');
});

// ── apply-exec: refuses sacred deletions ─────────────────────────────────────

test('apply-exec — refuses to delete .claude/settings.local.json', () => {
  const dir = tmp();
  // Write a plan that tries to delete the sacred file
  writeFileSync(join(dir, PLAN_FILE), [
    '# Migration plan',
    '',
    '## Summary',
    '',
    '## Moves',
    '',
    '## Premise snapshots',
    '',
    '## Manifest changes',
    '',
    '## Deletions',
    '',
    '- .claude/settings.local.json',
    '',
  ].join('\n'));

  const m = buildManifest({ sourceRepo: 'r', commit: null, mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });
  const aiKitRoot = getScaffoldRoot(import.meta.url);
  const registry = loadRegistry(aiKitRoot);

  assert.throws(
    () => applyMigration(dir, m, registry),
    /Refusing to delete sacred local file/,
  );
});

// ── End-to-end: stage + apply on rr-api-mini ────────────────────────────────

test('e2e — stage + apply on rr-api-mini fixture', async () => {
  const dir = copyFixture();
  const manifestPath = join(dir, MANIFEST_NAME);
  const routing = readJson(join(FIXTURE, 'routing.json'));

  // Write routing JSON to simulate agent output
  writeFileSync(
    join(dir, '.ai-kit-migration-routing.json'),
    JSON.stringify(routing, null, 2) + '\n',
  );

  const manifest = readJson(manifestPath);

  // Stage: read routing, build staging, write plan
  clearStaging(dir);
  const allStageResults = [];
  const allSnapshots = new Map();

  for (const unit of routing.workUnits) {
    let result;
    if (unit.type === 'markdown-fold') result = stageMarkdownFold(unit, dir);
    else if (unit.type === 'json-merge') result = stageJsonMerge(unit, dir);
    else result = stageLeaveAsIs(unit, dir);
    allStageResults.push({ unit, ...result });
    writeStaging(dir, result.stagingFiles);
    for (const s of result.premiseSnapshots) allSnapshots.set(s.file, s);
  }

  buildAndWrite(dir, {
    units: routing.workUnits,
    stageResults: allStageResults,
    premiseSnapshots: [...allSnapshots.values()],
  });

  assert.ok(existsSync(join(dir, PLAN_FILE)), 'plan file written');

  // Apply
  const aiKitRoot = getScaffoldRoot(import.meta.url);
  const registry = loadRegistry(aiKitRoot);
  const freshManifest = readJson(manifestPath);

  applyMigration(dir, freshManifest, registry);

  // Assertions
  assert.ok(!existsSync(join(dir, PLAN_FILE)), 'plan file cleaned up');
  assert.ok(!existsSync(join(dir, '.ai-kit-staging')), 'staging dir cleaned up');
  assert.ok(!existsSync(join(dir, 'CLAUDE.md.ai-kit')), 'sidecar deleted');
  assert.ok(!existsSync(join(dir, '.vscode/settings.json.ai-kit')), '.vscode sidecar deleted');

  // CLAUDE.md should be the shim
  const claudeMd = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
  assert.ok(claudeMd.includes('@AGENTS.md'), 'CLAUDE.md is the @AGENTS.md shim');

  // AGENTS.md should contain consumer content
  const agentsMd = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(agentsMd.includes('A REST API for managing widgets'), 'consumer content in AGENTS.md');
  assert.ok(agentsMd.includes('## Overview'), 'canonical sections present');
  assert.ok(agentsMd.includes('## Architecture'), 'canonical sections present');

  // .vscode/settings.json should have both consumer + ai-kit keys
  const vscode = readJson(join(dir, '.vscode/settings.json'));
  assert.equal(vscode['editor.formatOnSave'], true, 'consumer key preserved');
  assert.equal(vscode['chat.tools.autoApprove'], false, 'ai-kit key merged');

  // Manifest: pendingIntegration empty, installedAs flipped, sidecar gone
  const finalManifest = readJson(manifestPath);
  assert.equal(finalManifest.pendingIntegration.length, 0, 'pendingIntegration cleared');
  assert.equal(finalManifest.files['CLAUDE.md'].installedAs, 'CLAUDE.md', 'installedAs flipped');
  assert.equal(finalManifest.files['CLAUDE.md'].sidecar, undefined, 'sidecar field removed');
  assert.equal(finalManifest.files['.vscode/settings.json'].installedAs, '.vscode/settings.json');

  // Sacred file untouched
  assert.ok(existsSync(join(dir, '.claude/settings.local.json')), 'sacred local file untouched');
});

test('e2e — premise drift blocks apply', () => {
  const dir = copyFixture();
  const routing = readJson(join(FIXTURE, 'routing.json'));

  // Build staging
  clearStaging(dir);
  const allStageResults = [];
  const allSnapshots = new Map();

  for (const unit of routing.workUnits) {
    let result;
    if (unit.type === 'markdown-fold') result = stageMarkdownFold(unit, dir);
    else if (unit.type === 'json-merge') result = stageJsonMerge(unit, dir);
    else result = stageLeaveAsIs(unit, dir);
    allStageResults.push({ unit, ...result });
    writeStaging(dir, result.stagingFiles);
    for (const s of result.premiseSnapshots) allSnapshots.set(s.file, s);
  }

  buildAndWrite(dir, {
    units: routing.workUnits,
    stageResults: allStageResults,
    premiseSnapshots: [...allSnapshots.values()],
  });

  // Mutate CLAUDE.md after plan was written
  writeFileSync(join(dir, 'CLAUDE.md'), 'totally different content\n');

  const aiKitRoot = getScaffoldRoot(import.meta.url);
  const registry = loadRegistry(aiKitRoot);
  const manifest = readJson(join(dir, MANIFEST_NAME));

  assert.throws(
    () => applyMigration(dir, manifest, registry),
    /Premise drift/,
  );

  // No real files moved
  assert.ok(!existsSync(join(dir, 'CLAUDE.md.ai-kit')) === false, 'sidecar still present');
});

test('e2e — perf guard: stage + apply < 2s', () => {
  const dir = copyFixture();
  const routing = readJson(join(FIXTURE, 'routing.json'));
  const t0 = Date.now();

  clearStaging(dir);
  const allStageResults = [];
  const allSnapshots = new Map();

  for (const unit of routing.workUnits) {
    let result;
    if (unit.type === 'markdown-fold') result = stageMarkdownFold(unit, dir);
    else if (unit.type === 'json-merge') result = stageJsonMerge(unit, dir);
    else result = stageLeaveAsIs(unit, dir);
    allStageResults.push({ unit, ...result });
    writeStaging(dir, result.stagingFiles);
    for (const s of result.premiseSnapshots) allSnapshots.set(s.file, s);
  }

  buildAndWrite(dir, {
    units: routing.workUnits,
    stageResults: allStageResults,
    premiseSnapshots: [...allSnapshots.values()],
  });

  const aiKitRoot = getScaffoldRoot(import.meta.url);
  const registry = loadRegistry(aiKitRoot);
  const manifest = readJson(join(dir, MANIFEST_NAME));
  applyMigration(dir, manifest, registry);

  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 2000, `stage + apply should complete in < 2s, took ${elapsed}ms`);
});

// ── applyto.mjs ───────────────────────────────────────────────────────────────

test('deriveTargetDirs — global glob → root', () => {
  assert.deepEqual(deriveTargetDirs('**'), ['']);
});

test('deriveTargetDirs — path glob → static prefix', () => {
  assert.deepEqual(deriveTargetDirs('src/**/*.ts'), ['src']);
});

test('deriveTargetDirs — deep path glob', () => {
  assert.deepEqual(deriveTargetDirs('src/api/**'), ['src/api']);
});

test('deriveTargetDirs — multi-glob → one dir per prefix', () => {
  const dirs = deriveTargetDirs('src/**,test/**');
  assert.ok(dirs.includes('src'));
  assert.ok(dirs.includes('test'));
  assert.equal(dirs.length, 2);
});

test('deriveTargetDirs — null input → null', () => {
  assert.equal(deriveTargetDirs(null), null);
  assert.equal(deriveTargetDirs(undefined), null);
  assert.equal(deriveTargetDirs(''), null);
});

// Bug 1 — isUnscopedApplyTo distinguishes deliberate root scope from no scope
test('isUnscopedApplyTo — missing/empty applyTo is unscoped', () => {
  assert.equal(isUnscopedApplyTo(null), true);
  assert.equal(isUnscopedApplyTo(undefined), true);
  assert.equal(isUnscopedApplyTo(''), true);
});

test('isUnscopedApplyTo — global glob ** is unscoped', () => {
  assert.equal(isUnscopedApplyTo('**'), true);
});

test('isUnscopedApplyTo — directory glob is scoped', () => {
  assert.equal(isUnscopedApplyTo('src/**'), false);
  assert.equal(isUnscopedApplyTo('src/api/**'), false);
});

test('isUnscopedApplyTo — multi-glob with at least one scoped dir is scoped', () => {
  assert.equal(isUnscopedApplyTo('src/**,tests/**'), false);
});

// Bug 1 — work-units flags unscoped instruction files on the root-fold source
test('work-units.enumerate — unscoped .instructions.md tagged unscoped on root-fold source', () => {
  const dir = tmp();
  mkdirSync(join(dir, '.github/instructions'), { recursive: true });
  writeFileSync(join(dir, '.github/instructions/cross-cutting.instructions.md'),
    '---\n---\n\n## Pipeline\n\nUse Azure DevOps.\n');

  const m = buildManifest({ sourceRepo: 'r', commit: null, mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });
  addPreexistingUnmanaged(m, '.github/instructions/cross-cutting.instructions.md');

  const units = enumerate(m, dir);
  const root = units.find(u => u.id === 'root-agents-md');
  assert.ok(root, 'root-agents-md fold unit emitted');
  const src = root.sources.find(s => s.path === '.github/instructions/cross-cutting.instructions.md');
  assert.ok(src, 'unscoped file present as a source');
  assert.equal(src.unscoped, true, 'source flagged unscoped');
});

test('work-units.enumerate — scoped .instructions.md not flagged unscoped', () => {
  const dir = tmp();
  mkdirSync(join(dir, '.github/instructions'), { recursive: true });
  writeFileSync(join(dir, '.github/instructions/backend.instructions.md'),
    '---\napplyTo: src/api/**\n---\n\n## Backend\n');

  const m = buildManifest({ sourceRepo: 'r', commit: null, mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });
  addPreexistingUnmanaged(m, '.github/instructions/backend.instructions.md');

  const units = enumerate(m, dir);
  const nested = units.find(u => u.target === 'src/api/AGENTS.md');
  assert.ok(nested, 'nested fold unit emitted');
  const src = nested.sources.find(s => s.path === '.github/instructions/backend.instructions.md');
  assert.equal(src.unscoped, undefined, 'scoped source not flagged unscoped');
});

// Bug 2 — .github/skills/* and .github/agents/* discovery + routing
test('findPreexistingUnmanaged — discovers .github/skills and .github/agents files', () => {
  const dir = tmp();
  mkdirSync(join(dir, '.github/skills/foo/references'), { recursive: true });
  mkdirSync(join(dir, '.github/agents'), { recursive: true });
  writeFileSync(join(dir, '.github/skills/foo/SKILL.md'),
    '---\nname: foo\n---\n# Foo\n');
  writeFileSync(join(dir, '.github/skills/foo/references/notes.md'), 'notes\n');
  writeFileSync(join(dir, '.github/agents/bar.agent.md'),
    '---\nname: bar\n---\n# Bar\n');

  const unmanaged = findPreexistingUnmanaged(dir, new Set());
  assert.ok(unmanaged.includes('.github/skills/foo/SKILL.md'), 'finds SKILL.md');
  assert.ok(unmanaged.includes('.github/skills/foo/references/notes.md'), 'finds nested skill file');
  assert.ok(unmanaged.includes('.github/agents/bar.agent.md'), 'finds agent file');
});

test('work-units.enumerate — emits github-skill-route grouped by skill name', () => {
  const dir = tmp();
  mkdirSync(join(dir, '.github/skills/foo/references'), { recursive: true });
  writeFileSync(join(dir, '.github/skills/foo/SKILL.md'),
    '---\nname: foo\ndescription: Does things when invoked\n---\n# Foo\n');
  writeFileSync(join(dir, '.github/skills/foo/references/notes.md'), 'notes\n');

  const m = buildManifest({ sourceRepo: 'r', commit: null, mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });
  addPreexistingUnmanaged(m, '.github/skills/foo/SKILL.md');
  addPreexistingUnmanaged(m, '.github/skills/foo/references/notes.md');

  const units = enumerate(m, dir);
  const unit = units.find(u => u.id === 'github-skill-foo');
  assert.ok(unit, 'github-skill-foo unit emitted');
  assert.equal(unit.type, 'github-skill-route');
  assert.equal(unit.category, undefined, 'no category field on flat-install units');
  assert.equal(unit.target, '.claude/skills/foo');
  assert.equal(unit.hasCollision, false);
  assert.equal(unit.files.length, 2);
  assert.ok(unit.files.some(f => f.dst === '.claude/skills/foo/SKILL.md'));
  assert.ok(unit.files.some(f => f.dst === '.claude/skills/foo/references/notes.md'));
  // Deletions: 2 source files + the leaf .github/skills/foo dir so apply-exec rmdirs it.
  assert.equal(unit.deletions.length, 3);
  assert.ok(unit.deletions.includes('.github/skills/foo'), 'leaf dir included for rmdir');
});

test('work-units.enumerate — emits github-agent-route for each agent file', () => {
  const dir = tmp();
  mkdirSync(join(dir, '.github/agents'), { recursive: true });
  writeFileSync(join(dir, '.github/agents/bar.agent.md'),
    '---\nname: bar\n---\n# Bar\n');

  const m = buildManifest({ sourceRepo: 'r', commit: null, mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });
  addPreexistingUnmanaged(m, '.github/agents/bar.agent.md');

  const units = enumerate(m, dir);
  const unit = units.find(u => u.id === 'github-agent-bar');
  assert.ok(unit, 'github-agent-bar unit emitted');
  assert.equal(unit.type, 'github-agent-route');
  assert.equal(unit.target, '.claude/agents/bar.agent.md');
  assert.equal(unit.hasCollision, false);
  assert.deepEqual(unit.deletions, ['.github/agents/bar.agent.md']);
});

test('github-route — stages content for non-collision skill route', () => {
  const dir = tmp();
  mkdirSync(join(dir, '.github/skills/foo'), { recursive: true });
  writeFileSync(join(dir, '.github/skills/foo/SKILL.md'),
    '---\nname: foo\n---\n# Foo\nbody\n');

  const unit = {
    id: 'github-skill-foo',
    type: 'github-skill-route',
    skillName: 'foo',
    source: '.github/skills/foo',
    target: '.claude/skills/foo',
    files: [{ src: '.github/skills/foo/SKILL.md', dst: '.claude/skills/foo/SKILL.md' }],
    hasCollision: false,
    deletions: ['.github/skills/foo/SKILL.md'],
    manifestDelta: [{ kind: 'resolveUnmanaged', path: '.github/skills/foo/SKILL.md' }],
  };

  const { stagingFiles, premiseSnapshots } = stageGithubRoute(unit, dir);
  assert.equal(stagingFiles.length, 1);
  assert.equal(stagingFiles[0].relPath, '.claude/skills/foo/SKILL.md');
  assert.ok(stagingFiles[0].content.includes('body'));
  assert.equal(premiseSnapshots.length, 1);
});

test('github-route — collision unit produces no staging', () => {
  const dir = tmp();
  const unit = {
    id: 'github-skill-foo',
    type: 'github-skill-route',
    hasCollision: true,
    files: [{ src: '.github/skills/foo/SKILL.md', dst: '.claude/skills/foo/SKILL.md' }],
  };
  const { stagingFiles, premiseSnapshots } = stageGithubRoute(unit, dir);
  assert.equal(stagingFiles.length, 0);
  assert.equal(premiseSnapshots.length, 0);
});

test('e2e — github-skill-route + github-agent-route stage + apply', () => {
  const registry = loadRegistry(getScaffoldRoot(import.meta.url));
  const dir = tmp();
  mkdirSync(join(dir, '.github/skills/foo'), { recursive: true });
  mkdirSync(join(dir, '.github/agents'), { recursive: true });
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.github/skills/foo/SKILL.md'),
    '---\nname: foo\ndescription: Does X when invoked\n---\n# Foo\n');
  writeFileSync(join(dir, '.github/agents/bar.agent.md'),
    '---\nname: bar\ndescription: Does Y when invoked\n---\n# Bar\n');

  const manifest = buildManifest({ sourceRepo: 'r', commit: null, mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });
  addPreexistingUnmanaged(manifest, '.github/skills/foo/SKILL.md');
  addPreexistingUnmanaged(manifest, '.github/agents/bar.agent.md');
  writeFileSync(join(dir, '.claude/ai-kit.json'), JSON.stringify(manifest, null, 2));

  const units = enumerate(manifest, dir);

  clearStaging(dir);
  const stageResults = [];
  const snapshots = new Map();
  for (const u of units) {
    const res = stageGithubRoute(u, dir);
    stageResults.push({ unit: u, ...res });
    writeStaging(dir, res.stagingFiles);
    for (const s of res.premiseSnapshots) snapshots.set(s.file, s);
  }
  buildAndWrite(dir, { units, stageResults, premiseSnapshots: [...snapshots.values()] });

  const freshManifest = JSON.parse(readFileSync(join(dir, '.claude/ai-kit.json'), 'utf8'));
  applyMigration(dir, freshManifest, registry);

  assert.ok(existsSync(join(dir, '.claude/skills/foo/SKILL.md')), 'skill moved');
  assert.ok(existsSync(join(dir, '.claude/agents/bar.agent.md')), 'agent moved');
  assert.ok(!existsSync(join(dir, '.github/skills/foo/SKILL.md')), 'github source deleted');
  assert.ok(!existsSync(join(dir, '.github/agents/bar.agent.md')), 'github agent deleted');

  const final = JSON.parse(readFileSync(join(dir, '.claude/ai-kit.json'), 'utf8'));
  assert.ok(!final.preexistingUnmanaged.includes('.github/skills/foo/SKILL.md'),
    'skill removed from preexistingUnmanaged');
  assert.ok(!final.preexistingUnmanaged.includes('.github/agents/bar.agent.md'),
    'agent removed from preexistingUnmanaged');
});

// ── github-tree-cleanup + dir deletions ───────────────────────────────────────

test('work-units.enumerate — appends leaf .github/skills/<name> dir to skill route deletions', () => {
  const dir = tmp();
  mkdirSync(join(dir, '.github/skills/foo'), { recursive: true });
  writeFileSync(join(dir, '.github/skills/foo/SKILL.md'),
    '---\nname: foo\ndescription: Does things when invoked\n---\n# Foo\n');

  const m = buildManifest({ sourceRepo: 'r', commit: null, mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });
  addPreexistingUnmanaged(m, '.github/skills/foo/SKILL.md');

  const units = enumerate(m, dir);
  const unit = units.find(u => u.id === 'github-skill-foo');
  assert.ok(unit.deletions.includes('.github/skills/foo'), 'leaf dir in deletions');
});

test('work-units.enumerate — emits github-tree-cleanup unit with parent dirs + prompts sweep', () => {
  const dir = tmp();
  mkdirSync(join(dir, '.github/agents'), { recursive: true });
  mkdirSync(join(dir, '.github/skills/foo'), { recursive: true });
  mkdirSync(join(dir, '.github/prompts'), { recursive: true });
  writeFileSync(join(dir, '.github/agents/bar.agent.md'),
    '---\nname: bar\ndescription: Y\n---\n# Bar\n');
  writeFileSync(join(dir, '.github/skills/foo/SKILL.md'),
    '---\nname: foo\ndescription: X\n---\n# Foo\n');
  writeFileSync(join(dir, '.github/prompts/hello.prompt.md'),
    '---\nname: hello\n---\n# Hello\n');

  const m = buildManifest({ sourceRepo: 'r', commit: null, mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });
  addPreexistingUnmanaged(m, '.github/agents/bar.agent.md');
  addPreexistingUnmanaged(m, '.github/skills/foo/SKILL.md');
  addPreexistingUnmanaged(m, '.github/prompts/hello.prompt.md');

  const units = enumerate(m, dir);
  const cleanup = units.find(u => u.id === 'github-tree-cleanup');
  assert.ok(cleanup, 'cleanup unit emitted');
  assert.equal(cleanup.type, 'github-tree-cleanup');
  // Prompt file deleted + all three parent dirs (in apply-after-leaves order)
  assert.ok(cleanup.deletions.includes('.github/prompts/hello.prompt.md'), 'prompt file deleted');
  assert.ok(cleanup.deletions.includes('.github/agents'), '.github/agents queued for rmdir');
  assert.ok(cleanup.deletions.includes('.github/skills'), '.github/skills queued for rmdir');
  assert.ok(cleanup.deletions.includes('.github/prompts'), '.github/prompts queued for rmdir');
});

test('work-units.enumerate — no cleanup unit when no .github/ AI-config exists', () => {
  const dir = tmp();
  const m = buildManifest({ sourceRepo: 'r', commit: null, mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });

  const units = enumerate(m, dir);
  assert.ok(!units.some(u => u.id === 'github-tree-cleanup'), 'no cleanup when nothing to clean');
});

test('e2e — github-skill-route apply removes leaf .github/skills/<name> dir', () => {
  const registry = loadRegistry(getScaffoldRoot(import.meta.url));
  const dir = tmp();
  mkdirSync(join(dir, '.github/skills/foo'), { recursive: true });
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.github/skills/foo/SKILL.md'),
    '---\nname: foo\ndescription: Does X when invoked\n---\n# Foo\n');

  const manifest = buildManifest({ sourceRepo: 'r', commit: null, mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });
  addPreexistingUnmanaged(manifest, '.github/skills/foo/SKILL.md');
  writeFileSync(join(dir, '.claude/ai-kit.json'), JSON.stringify(manifest, null, 2));

  const units = enumerate(manifest, dir);

  clearStaging(dir);
  const stageResults = [];
  const snapshots = new Map();
  for (const u of units) {
    const res = stageGithubRoute(u, dir);
    stageResults.push({ unit: u, ...res });
    writeStaging(dir, res.stagingFiles);
    for (const s of res.premiseSnapshots) snapshots.set(s.file, s);
  }
  buildAndWrite(dir, { units, stageResults, premiseSnapshots: [...snapshots.values()] });

  const freshManifest = JSON.parse(readFileSync(join(dir, '.claude/ai-kit.json'), 'utf8'));
  applyMigration(dir, freshManifest, registry);

  assert.ok(existsSync(join(dir, '.claude/skills/foo/SKILL.md')), 'skill moved');
  assert.ok(!existsSync(join(dir, '.github/skills/foo')), 'leaf .github/skills/foo dir gone');
  assert.ok(!existsSync(join(dir, '.github/skills')), '.github/skills parent dir gone');
});

test('e2e — apply-exec skips rmdir on non-empty .github/agents (stray README.md)', () => {
  const registry = loadRegistry(getScaffoldRoot(import.meta.url));
  const dir = tmp();
  mkdirSync(join(dir, '.github/agents'), { recursive: true });
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.github/agents/bar.agent.md'),
    '---\nname: bar\ndescription: Y\n---\n# Bar\n');
  // Stray non-routeable sibling
  writeFileSync(join(dir, '.github/agents/README.md'), '# Agents folder\n');

  const manifest = buildManifest({ sourceRepo: 'r', commit: null, mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });
  addPreexistingUnmanaged(manifest, '.github/agents/bar.agent.md');
  addPreexistingUnmanaged(manifest, '.github/agents/README.md');
  writeFileSync(join(dir, '.claude/ai-kit.json'), JSON.stringify(manifest, null, 2));

  const units = enumerate(manifest, dir);

  clearStaging(dir);
  const stageResults = [];
  const snapshots = new Map();
  for (const u of units) {
    const res = stageGithubRoute(u, dir);
    stageResults.push({ unit: u, ...res });
    writeStaging(dir, res.stagingFiles);
    for (const s of res.premiseSnapshots) snapshots.set(s.file, s);
  }
  buildAndWrite(dir, { units, stageResults, premiseSnapshots: [...snapshots.values()] });

  const freshManifest = JSON.parse(readFileSync(join(dir, '.claude/ai-kit.json'), 'utf8'));
  applyMigration(dir, freshManifest, registry);

  assert.ok(existsSync(join(dir, '.claude/agents/bar.agent.md')), 'agent moved');
  assert.ok(!existsSync(join(dir, '.github/agents/bar.agent.md')), 'github agent deleted');
  // Stray README.md survives; .github/agents/ stays because it's not empty
  assert.ok(existsSync(join(dir, '.github/agents/README.md')), 'stray README untouched');
  assert.ok(existsSync(join(dir, '.github/agents')), 'non-empty .github/agents not rmdir\'d');
});

// ── normalize-agent: model field coercion ─────────────────────────────────────

test('normalizeAgentFrontmatter — coerces model array to first canonical slug', async () => {
  const { normalizeAgentFrontmatter } = await import('../lib/migrate/normalize-agent.mjs');
  const input = '---\nname: API Agent\nmodel: ["Claude Sonnet 4.6", "Claude Opus 4.6"]\n---\n# Body\n';
  const out = normalizeAgentFrontmatter(input);
  assert.ok(out.includes('model: sonnet'), `expected sonnet, got: ${out}`);
  assert.ok(!out.includes('['), 'array bracket gone');
});

test('normalizeAgentFrontmatter — coerces verbose scalar to slug', async () => {
  const { normalizeAgentFrontmatter } = await import('../lib/migrate/normalize-agent.mjs');
  const out = normalizeAgentFrontmatter('---\nmodel: Claude Opus 4.7\n---\nbody\n');
  assert.ok(out.includes('model: opus'));
});

test('normalizeAgentFrontmatter — unknown value falls back to inherit', async () => {
  const { normalizeAgentFrontmatter } = await import('../lib/migrate/normalize-agent.mjs');
  const out = normalizeAgentFrontmatter('---\nmodel: gpt-5\n---\nbody\n');
  assert.ok(out.includes('model: inherit'));
});

test('normalizeAgentFrontmatter — canonical scalar untouched', async () => {
  const { normalizeAgentFrontmatter } = await import('../lib/migrate/normalize-agent.mjs');
  const input = '---\nmodel: sonnet\n---\nbody\n';
  assert.equal(normalizeAgentFrontmatter(input), input);
});

test('normalizeAgentFrontmatter — file with no model field unchanged', async () => {
  const { normalizeAgentFrontmatter } = await import('../lib/migrate/normalize-agent.mjs');
  const input = '---\nname: foo\ndescription: X\n---\nbody\n';
  assert.equal(normalizeAgentFrontmatter(input), input);
});

test('github-route — stages agent with normalized model from array', () => {
  const dir = tmp();
  mkdirSync(join(dir, '.github/agents'), { recursive: true });
  writeFileSync(join(dir, '.github/agents/api.agent.md'),
    '---\nname: "API Agent"\nmodel: ["Claude Sonnet 4.6", "Claude Opus 4.6"]\n---\n# Body\n');

  const unit = {
    id: 'github-agent-api', type: 'github-agent-route', agentName: 'api',
    source: '.github/agents/api.agent.md', target: '.claude/agents/api.agent.md',
    files: [{ src: '.github/agents/api.agent.md', dst: '.claude/agents/api.agent.md' }],
    hasCollision: false,
    deletions: ['.github/agents/api.agent.md'],
    manifestDelta: [],
  };

  const { stagingFiles } = stageGithubRoute(unit, dir);
  assert.equal(stagingFiles.length, 1);
  assert.ok(stagingFiles[0].content.includes('model: sonnet'), 'model coerced to sonnet');
  assert.ok(!stagingFiles[0].content.includes('Claude Sonnet 4.6'), 'verbose name removed');
});

test('work-units.enumerate — flags collision when target already exists, skips deletions', () => {
  const dir = tmp();
  mkdirSync(join(dir, '.github/skills/foo'), { recursive: true });
  mkdirSync(join(dir, '.claude/skills/foo'), { recursive: true });
  writeFileSync(join(dir, '.github/skills/foo/SKILL.md'),
    '---\nname: foo\n---\n# Foo new\n');
  writeFileSync(join(dir, '.claude/skills/foo/SKILL.md'),
    '---\nname: foo\n---\n# Foo existing\n');

  const m = buildManifest({ sourceRepo: 'r', commit: null, mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });
  addPreexistingUnmanaged(m, '.github/skills/foo/SKILL.md');

  const units = enumerate(m, dir);
  const unit = units.find(u => u.id === 'github-skill-foo');
  assert.ok(unit);
  assert.equal(unit.hasCollision, true);
  assert.equal(unit.deletions.length, 0, 'no deletions on collision');
  assert.equal(unit.manifestDelta.length, 0, 'no manifest delta on collision');
  // Source surfaced under leave-as-is for manual resolution
  const leave = units.find(u => u.type === 'leave-as-is');
  assert.ok(leave, 'leave-as-is unit emitted');
  assert.ok(leave.paths.includes('.github/skills/foo/SKILL.md'),
    'collision source listed under leave-as-is');
});

// ── brownfield nested scan ────────────────────────────────────────────────────

test('findPreexistingUnmanaged — discovers nested CLAUDE.md and AGENTS.md', () => {
  const dir = tmp();
  mkdirSync(join(dir, 'src/api'), { recursive: true });
  writeFileSync(join(dir, 'src/CLAUDE.md'), '# Src instructions\n');
  writeFileSync(join(dir, 'src/api/AGENTS.md'), '## Overview\n\nsome content\n');

  const unmanaged = findPreexistingUnmanaged(dir, new Set());

  assert.ok(unmanaged.includes('src/CLAUDE.md'), 'finds nested CLAUDE.md');
  assert.ok(unmanaged.includes('src/api/AGENTS.md'), 'finds deeply nested AGENTS.md');
});

test('findPreexistingUnmanaged — excludes node_modules and dist', () => {
  const dir = tmp();
  mkdirSync(join(dir, 'node_modules/some-pkg'), { recursive: true });
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'node_modules/some-pkg/CLAUDE.md'), '# should be ignored\n');
  writeFileSync(join(dir, 'dist/AGENTS.md'), '# should be ignored\n');

  const unmanaged = findPreexistingUnmanaged(dir, new Set());

  assert.ok(!unmanaged.some(p => p.includes('node_modules')), 'ignores node_modules');
  assert.ok(!unmanaged.some(p => p.includes('dist')), 'ignores dist');
});

test('findPreexistingUnmanaged — does not report root CLAUDE.md or AGENTS.md', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'CLAUDE.md'), '# root\n');
  writeFileSync(join(dir, 'AGENTS.md'), '# root\n');

  const unmanaged = findPreexistingUnmanaged(dir, new Set());

  assert.ok(!unmanaged.includes('CLAUDE.md'), 'root CLAUDE.md excluded');
  assert.ok(!unmanaged.includes('AGENTS.md'), 'root AGENTS.md excluded');
});

// ── work-units: nested paths ──────────────────────────────────────────────────

test('work-units.enumerate — nested CLAUDE.md → markdown-fold unit with shimReplace', () => {
  const dir = tmp();
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/CLAUDE.md'), '## Conventions\n\nsome rules\n');

  const m = buildManifest({ sourceRepo: 'r', commit: null, mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });
  addPreexistingUnmanaged(m, 'src/CLAUDE.md');

  const units = enumerate(m, dir);
  const unit = units.find(u => u.id === 'nested-agents-md-src');

  assert.ok(unit, 'nested markdown-fold unit emitted');
  assert.equal(unit.type, 'markdown-fold');
  assert.equal(unit.target, 'src/AGENTS.md');
  assert.ok(unit.sources.some(s => s.path === 'src/CLAUDE.md'), 'src/CLAUDE.md is a source');
  assert.ok(unit.shimReplace?.path === 'src/CLAUDE.md', 'shimReplace targets src/CLAUDE.md');
  assert.equal(unit.shimReplace.content, '@AGENTS.md\n');
  assert.ok(unit.manifestDelta.some(d => d.kind === 'installNested'), 'installNested delta present');
});

test('work-units.enumerate — nested AGENTS.md only → unit with CLAUDE.md shimReplace', () => {
  const dir = tmp();
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/AGENTS.md'), '## Conventions\n\nsome rules\n');

  const m = buildManifest({ sourceRepo: 'r', commit: null, mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });
  addPreexistingUnmanaged(m, 'src/AGENTS.md');

  const units = enumerate(m, dir);
  const unit = units.find(u => u.id === 'nested-agents-md-src');

  assert.ok(unit, 'nested markdown-fold unit emitted for pre-existing AGENTS.md');
  assert.equal(unit.target, 'src/AGENTS.md');
  assert.ok(unit.shimReplace?.path === 'src/CLAUDE.md', 'shimReplace creates CLAUDE.md shim');
});

test('work-units.enumerate — both nested CLAUDE.md and AGENTS.md → single unit', () => {
  const dir = tmp();
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/CLAUDE.md'), '## Conventions\n\nrules\n');
  writeFileSync(join(dir, 'src/AGENTS.md'), '## Overview\n\nexisting\n');

  const m = buildManifest({ sourceRepo: 'r', commit: null, mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });
  addPreexistingUnmanaged(m, 'src/CLAUDE.md');
  addPreexistingUnmanaged(m, 'src/AGENTS.md');

  const units = enumerate(m, dir);
  const nestedUnits = units.filter(u => u.id === 'nested-agents-md-src');

  assert.equal(nestedUnits.length, 1, 'single unit for both CLAUDE.md + AGENTS.md');
  assert.ok(nestedUnits[0].sources.some(s => s.path === 'src/CLAUDE.md'), 'CLAUDE.md is source');
});

// ── markdown-fold: canonical skeleton seed ────────────────────────────────────

test('markdown-fold — seeds canonical H2 skeleton when target absent', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'CLAUDE.md'), '## Conventions\n\nsome rule\n');

  const unit = {
    type: 'markdown-fold',
    target: 'src/AGENTS.md', // does not exist
    sources: [{
      path: 'CLAUDE.md',
      originType: 'claude-md-fold',
      h2Routing: [{
        sourceHeading: '## Conventions',
        sourceLineRange: [1, 3],
        targetHeading: '## Conventions',
        demote: false,
        keepOriginalHeading: false,
      }],
    }],
    deletions: [],
    manifestDelta: [],
  };

  const { stagingFiles } = stageMarkdownFold(unit, dir);
  const out = stagingFiles.find(f => f.relPath === 'src/AGENTS.md')?.content ?? '';

  assert.ok(out.includes('## Overview'), 'canonical ## Overview seeded');
  assert.ok(out.includes('## Architecture'), 'canonical ## Architecture seeded');
  assert.ok(out.includes('## Conventions'), 'canonical ## Conventions seeded');
  assert.ok(out.includes('## Do Not'), 'canonical ## Do Not seeded');
  assert.ok(out.includes('## More Context'), 'canonical ## More Context seeded');
  assert.ok(out.includes('some rule'), 'consumer content folded in');
});

// ── markdown-fold: shimReplace ────────────────────────────────────────────────

test('markdown-fold — shimReplace stages replacement file with shim content', () => {
  const dir = tmp();
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/CLAUDE.md'), '## Conventions\n\nrules\n');

  const unit = {
    type: 'markdown-fold',
    target: 'src/AGENTS.md',
    shimReplace: { path: 'src/CLAUDE.md', content: '@AGENTS.md\n' },
    sources: [{
      path: 'src/CLAUDE.md',
      originType: 'claude-md-fold',
      h2Routing: [{
        sourceHeading: '## Conventions',
        sourceLineRange: [1, 3],
        targetHeading: '## Conventions',
        demote: false,
        keepOriginalHeading: false,
      }],
    }],
    deletions: [],
    manifestDelta: [],
  };

  const { stagingFiles, premiseSnapshots } = stageMarkdownFold(unit, dir);

  const shimFile = stagingFiles.find(f => f.relPath === 'src/CLAUDE.md');
  assert.ok(shimFile, 'shimReplace produces staging file');
  assert.equal(shimFile.content, '@AGENTS.md\n');
  assert.ok(premiseSnapshots.some(s => s.file.endsWith('src/CLAUDE.md')), 'shimReplace path snapshotted');
});

// ── routing-validate ──────────────────────────────────────────────────────────

test('routing-validate — accepts canonical targetHeadings', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'CLAUDE.md'), '## Overview\n\ncontent\n## Conventions\n\nrules\n');

  const routing = {
    schemaVersion: 1,
    workUnits: [{
      id: 'root-agents-md', type: 'markdown-fold', target: 'AGENTS.md',
      sources: [{ path: 'CLAUDE.md', originType: 'claude-md-fold', h2Routing: [
        { sourceHeading: '## Overview', sourceLineRange: [1, 2], targetHeading: '## Overview', demote: true, keepOriginalHeading: false },
        { sourceHeading: '## Conventions', sourceLineRange: [4, 5], targetHeading: '## Conventions', demote: true, keepOriginalHeading: false },
      ]}],
      deletions: [], manifestDelta: [],
    }],
  };

  const errors = validateRoutingSemantic(routing, dir);
  assert.equal(errors.length, 0);
});

test('routing-validate — rejects non-canonical targetHeading with suggestion', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'CLAUDE.md'), '## Workflow\n\ncontent\n');

  const routing = {
    schemaVersion: 1,
    workUnits: [{
      id: 'root-agents-md', type: 'markdown-fold', target: 'AGENTS.md',
      sources: [{ path: 'CLAUDE.md', originType: 'claude-md-fold', h2Routing: [
        { sourceHeading: '## Workflow', sourceLineRange: [1, 2], targetHeading: '## Workflow', demote: true, keepOriginalHeading: true },
      ]}],
      deletions: [], manifestDelta: [],
    }],
  };

  const errors = validateRoutingSemantic(routing, dir);
  assert.ok(errors.some(e => e.field === 'targetHeading'), 'rejects non-canonical targetHeading');
  assert.ok(errors.some(e => e.reason.includes('Non-canonical')), 'error message includes "Non-canonical"');
});

test('routing-validate — accepts non-canonical targetHeading that matches pre-existing AGENTS.md H2', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'CLAUDE.md'), '## Workflow\n\ncontent\n');
  writeFileSync(join(dir, 'AGENTS.md'), '## Workflow\n\nexisting\n');

  const routing = {
    schemaVersion: 1,
    workUnits: [{
      id: 'root-agents-md', type: 'markdown-fold', target: 'AGENTS.md',
      sources: [{ path: 'CLAUDE.md', originType: 'claude-md-fold', h2Routing: [
        { sourceHeading: '## Workflow', sourceLineRange: [1, 2], targetHeading: '## Workflow', demote: true, keepOriginalHeading: true },
      ]}],
      deletions: [], manifestDelta: [],
    }],
  };

  const errors = validateRoutingSemantic(routing, dir);
  assert.equal(errors.length, 0, 'consumer H2 in merge base is a valid target');
});

test('routing-validate — accepts sourceLineRange out of bounds (not validated)', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'CLAUDE.md'), '## Overview\n\ncontent\n');

  const routing = {
    schemaVersion: 1,
    workUnits: [{
      id: 'root-agents-md', type: 'markdown-fold', target: 'AGENTS.md',
      sources: [{ path: 'CLAUDE.md', originType: 'claude-md-fold', h2Routing: [
        { sourceHeading: '## Overview', sourceLineRange: [1, 999], targetHeading: '## Overview', demote: true, keepOriginalHeading: false },
      ]}],
      deletions: [], manifestDelta: [],
    }],
  };

  // sourceLineRange bounds are not validated (fold logic uses heading names, not line numbers)
  const errors = validateRoutingSemantic(routing, dir);
  assert.ok(!errors.some(e => e.field?.startsWith('sourceLineRange')), 'sourceLineRange bounds not validated');
});

test('routing-validate — rejects bare-string source', () => {
  const dir = tmp();

  const routing = {
    schemaVersion: 1,
    workUnits: [{
      id: 'root-agents-md', type: 'markdown-fold', target: 'AGENTS.md',
      sources: ['CLAUDE.md'], // bare string, not object
      deletions: [], manifestDelta: [],
    }],
  };

  const errors = validateRoutingSemantic(routing, dir);
  assert.ok(errors.some(e => e.field === 'sources[]'), 'rejects bare-string source');
});

// ── manifest-resolve: installNested ──────────────────────────────────────────

test('applyDeltas — installNested adds file entry with nested-agents-md role', () => {
  const m = buildManifest({ sourceRepo: 'r', commit: null, mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });

  applyDeltas(m, [{ kind: 'installNested', path: 'src/AGENTS.md' }]);

  assert.equal(m.files['src/AGENTS.md']?.role, 'nested-agents-md');
  assert.equal(m.files['src/AGENTS.md']?.installedAs, 'src/AGENTS.md');
});

test('applyDeltas — installNested removes path from preexistingUnmanaged', () => {
  const m = buildManifest({ sourceRepo: 'r', commit: null, mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });
  m.preexistingUnmanaged = ['src/AGENTS.md', 'other/file.md'];

  applyDeltas(m, [{ kind: 'installNested', path: 'src/AGENTS.md' }]);

  assert.ok(!m.preexistingUnmanaged.includes('src/AGENTS.md'), 'removed from preexistingUnmanaged');
  assert.ok(m.preexistingUnmanaged.includes('other/file.md'), 'other entries preserved');
});

// ── end-to-end: nested CLAUDE.md + pre-existing AGENTS.md ────────────────────

test('e2e — nested CLAUDE.md folds into pre-existing AGENTS.md, shimReplace creates shim', () => {
  const registry = loadRegistry(getScaffoldRoot(import.meta.url));
  const dir = tmp();
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, '.claude'), { recursive: true });

  // Consumer files
  writeFileSync(join(dir, 'src/CLAUDE.md'), '# src Docs\n\n## Conventions\n\nuse Result<T>\n');
  writeFileSync(join(dir, 'src/AGENTS.md'), '# src\n\n## Overview\n\nexisting overview\n');

  // Minimal manifest
  const manifest = buildManifest({ sourceRepo: 'r', commit: null, mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });
  addPreexistingUnmanaged(manifest, 'src/CLAUDE.md');
  addPreexistingUnmanaged(manifest, 'src/AGENTS.md');
  writeFileSync(join(dir, '.claude/ai-kit.json'), JSON.stringify(manifest, null, 2));

  // enumerate work units
  const units = enumerate(manifest, dir);
  assert.equal(units.length, 1, 'one unit for src/');
  const unit = units[0];
  assert.equal(unit.target, 'src/AGENTS.md');
  assert.equal(unit.type, 'markdown-fold');

  // Inject h2Routing (simulating migrator agent)
  const unitWithRouting = {
    ...unit,
    sources: unit.sources.map(s => ({
      ...s,
      h2Routing: [{ sourceHeading: '## Conventions', targetHeading: '## Conventions',
        demote: true, keepOriginalHeading: false }],
    })),
  };

  // Stage
  clearStaging(dir);
  const result = stageMarkdownFold(unitWithRouting, dir);
  writeStaging(dir, result.stagingFiles);
  buildAndWrite(dir, { units: [unitWithRouting], stageResults: [{ unit: unitWithRouting, ...result }],
    premiseSnapshots: result.premiseSnapshots });

  // Apply
  const freshManifest = JSON.parse(readFileSync(join(dir, '.claude/ai-kit.json'), 'utf8'));
  applyMigration(dir, freshManifest, registry);

  // Verify
  const agentsMd = readFileSync(join(dir, 'src/AGENTS.md'), 'utf8');
  assert.ok(agentsMd.includes('## Overview'), 'pre-existing section preserved');
  assert.ok(agentsMd.includes('existing overview'), 'pre-existing content preserved');
  assert.ok(agentsMd.includes('## Conventions'), 'folded section present');
  assert.ok(agentsMd.includes('use Result<T>'), 'folded content present');

  const shim = readFileSync(join(dir, 'src/CLAUDE.md'), 'utf8');
  assert.equal(shim, '@AGENTS.md\n', 'src/CLAUDE.md replaced with shim');

  const finalManifest = JSON.parse(readFileSync(join(dir, '.claude/ai-kit.json'), 'utf8'));
  assert.equal(finalManifest.files['src/AGENTS.md']?.role, 'nested-agents-md', 'manifest tracks nested AGENTS.md');
  assert.ok(!finalManifest.preexistingUnmanaged.includes('src/AGENTS.md'), 'cleared from preexistingUnmanaged');
  assert.ok(!finalManifest.preexistingUnmanaged.includes('src/CLAUDE.md'), 'src/CLAUDE.md cleared from preexistingUnmanaged');
});

// ── end-to-end: multi-glob instructions → two nested targets ─────────────────

test('e2e — multi-glob instructions file produces two units, content in both', () => {
  const registry = loadRegistry(getScaffoldRoot(import.meta.url));
  const dir = tmp();
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'tests'), { recursive: true });
  mkdirSync(join(dir, '.github/instructions'), { recursive: true });
  mkdirSync(join(dir, '.claude'), { recursive: true });

  const instructionsContent = '---\napplyTo: src/**,tests/**\n---\n\n## Conventions\n\nshared rule\n';
  writeFileSync(join(dir, '.github/instructions/shared.instructions.md'), instructionsContent);

  const manifest = buildManifest({ sourceRepo: 'r', commit: null, mode: 'brownfield',
    installedBaseSkills: [], installedBaseAgents: [], installedSkills: [], installedAgents: [] });
  addPreexistingUnmanaged(manifest, '.github/instructions/shared.instructions.md');
  writeFileSync(join(dir, '.claude/ai-kit.json'), JSON.stringify(manifest, null, 2));

  const units = enumerate(manifest, dir);
  assert.equal(units.length, 2, 'two units for src/ and tests/');
  assert.ok(units.some(u => u.target === 'src/AGENTS.md'), 'src unit present');
  assert.ok(units.some(u => u.target === 'tests/AGENTS.md'), 'tests unit present');

  // Stage and apply both units
  clearStaging(dir);
  const allSnapshots = new Map();
  const unitResults = [];
  for (const unit of units) {
    const withRouting = {
      ...unit,
      sources: unit.sources.map(s => ({
        ...s,
        h2Routing: [{ sourceHeading: '## Conventions', targetHeading: '## Conventions',
          demote: true, keepOriginalHeading: false }],
      })),
    };
    const result = stageMarkdownFold(withRouting, dir);
    unitResults.push({ unit: withRouting, ...result });
    writeStaging(dir, result.stagingFiles);
    for (const snap of result.premiseSnapshots) allSnapshots.set(snap.file, snap);
  }
  buildAndWrite(dir, { units: units.map((u, i) => unitResults[i].unit),
    stageResults: unitResults, premiseSnapshots: [...allSnapshots.values()] });

  const freshManifest = JSON.parse(readFileSync(join(dir, '.claude/ai-kit.json'), 'utf8'));
  applyMigration(dir, freshManifest, registry);

  const srcAgents = readFileSync(join(dir, 'src/AGENTS.md'), 'utf8');
  const testsAgents = readFileSync(join(dir, 'tests/AGENTS.md'), 'utf8');
  assert.ok(srcAgents.includes('shared rule'), 'shared rule in src/AGENTS.md');
  assert.ok(testsAgents.includes('shared rule'), 'shared rule in tests/AGENTS.md');
  assert.ok(!existsSync(join(dir, '.github/instructions/shared.instructions.md')),
    'instructions file deleted');

  const finalManifest = JSON.parse(readFileSync(join(dir, '.claude/ai-kit.json'), 'utf8'));
  assert.equal(finalManifest.files['src/AGENTS.md']?.role, 'nested-agents-md');
  assert.equal(finalManifest.files['tests/AGENTS.md']?.role, 'nested-agents-md');
});
