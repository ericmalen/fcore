import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { planGeneration, manifestFor, findUserEdits } from '../scripts/lib/orchestration/scaffold.mjs';
import { validateGenerationManifest } from '../scripts/lib/orchestration/schemas.mjs';

const ROOT = join(import.meta.dirname, '..');
const FIXTURES = join(import.meta.dirname, 'fixtures', 'orchestration');
const loadFixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
const registry = JSON.parse(readFileSync(join(ROOT, 'templates', 'orchestration', 'template-registry.json'), 'utf8'));

const TEMPLATE_DIRS = {
  agent: (id) => join(ROOT, 'templates', 'orchestration', 'agents', `${id}.template.md`),
  skill: (id) => join(ROOT, 'templates', 'orchestration', 'skills', `${id}.template.md`),
  doc: (id) => join(ROOT, 'templates', 'orchestration', 'docs', `${id}.md`),
};
const readTemplate = (kind, id) => {
  const p = TEMPLATE_DIRS[kind](id);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};

test('planGeneration: maxi synthesized blueprint plans the full asset set', () => {
  const { files, errors } = planGeneration(loadFixture('maxi-repo.synthesized.blueprint.json'), registry, readTemplate);
  assert.deepEqual(errors, []);
  const paths = files.map((f) => f.path);
  // 8 agents + 3 paired skills (ui/api/db engineers) + README + 5 docs
  assert.equal(files.length, 17);
  assert.ok(paths.includes('docs/orchestration/README.md'));
  assert.ok(paths.includes('.claude/agents/feature-orchestrator.md'));
  assert.ok(paths.includes('.claude/skills/api-testing/SKILL.md'));
  assert.ok(paths.includes('docs/orchestration/dispatch-rules.md'));
  // generic-specialist (shared-engineer) pairs with no skills
  assert.ok(!paths.some((p) => p.includes('shared-engineer/SKILL')));
});

test('planGeneration: mini synthesized blueprint plans agents + docs, no paired skills for generic', () => {
  const { files, errors } = planGeneration(loadFixture('mini-repo.synthesized.blueprint.json'), registry, readTemplate);
  assert.deepEqual(errors, []);
  const skillPaths = files.filter((f) => f.path.startsWith('.claude/skills/'));
  assert.deepEqual(skillPaths, []); // generic-specialist + code-reviewer pair with nothing
});

test('planGeneration: orchestrator carries the rendered dispatch order, per target', () => {
  const orchOf = (fixture) => planGeneration(loadFixture(fixture), registry, readTemplate)
    .files.find((f) => f.path === '.claude/agents/feature-orchestrator.md');
  // maxi: provider-first chain from dispatch_rules.dispatch_order
  assert.match(orchOf('maxi-repo.synthesized.blueprint.json').content, /shared → ui → api → db/);
  // mini: no internal edges → the fixed unconstrained phrase (outputs differ where fixtures differ, DD-12)
  assert.match(orchOf('mini-repo.synthesized.blueprint.json').content, /no internal ordering constraints/);
});

test('planGeneration: deterministic — repeat runs produce deeply equal plans and manifests', () => {
  const bp = loadFixture('maxi-repo.synthesized.blueprint.json');
  const first = planGeneration(bp, registry, readTemplate);
  const second = planGeneration(bp, registry, readTemplate);
  assert.deepEqual(first, second);
  assert.deepEqual(manifestFor(first.files), manifestFor(second.files));
});

test('manifestFor: plan manifest validates and SHAs are content-derived', () => {
  const { files } = planGeneration(loadFixture('maxi-repo.synthesized.blueprint.json'), registry, readTemplate);
  const manifest = manifestFor(files);
  assert.deepEqual(validateGenerationManifest(manifest), []);
  assert.equal(manifest.generated.length, files.length);
  // a content change must change the SHA
  const tweaked = manifestFor([{ ...files[0], content: files[0].content + ' ' }]);
  assert.notEqual(tweaked.generated[0].sha256, manifest.generated[0].sha256);
});

test('planGeneration: unknown templateId and missing template fail all-or-nothing', () => {
  const bp = loadFixture('mini-repo.synthesized.blueprint.json');
  bp.specialists[0].templateId = 'nonexistent';
  const { files, errors } = planGeneration(bp, registry, readTemplate);
  assert.deepEqual(files, []);
  assert.deepEqual(errors, ['agent cli-engineer: templateId "nonexistent" not in registry']);
});

test('planGeneration: instantiation errors propagate with agent context', () => {
  const bp = loadFixture('mini-repo.synthesized.blueprint.json');
  delete bp.specialists[0].slots['test-cmd'];
  const { files, errors } = planGeneration(bp, registry, readTemplate);
  assert.deepEqual(files, []);
  assert.ok(errors.length > 0);
  assert.ok(errors.every((m) => m.startsWith('agent cli-engineer: unfilled slot "test-cmd"')));
});

test('planGeneration: unregistered doc in blueprint.docs fails', () => {
  const bp = loadFixture('mini-repo.synthesized.blueprint.json');
  bp.docs.push('docs/orchestration/made-up.md');
  const { files, errors } = planGeneration(bp, registry, readTemplate);
  assert.deepEqual(files, []);
  assert.deepEqual(errors, ['doc docs/orchestration/made-up.md: "made-up" not in registry']);
});

test('planGeneration: registry sha pin mismatch refuses to generate', () => {
  const bp = loadFixture('mini-repo.synthesized.blueprint.json');
  const tampered = (kind, id) => {
    const src = readTemplate(kind, id);
    return kind === 'agent' && id === 'generic-specialist' ? src + '\n<!-- drifted -->\n' : src;
  };
  const { files, errors } = planGeneration(bp, registry, tampered);
  assert.deepEqual(files, []);
  assert.deepEqual(errors, [
    'agent template generic-specialist: source drifted from registry pin — bump version and update sha256',
  ]);
});

test('planGeneration: duplicate pairedSkills collide on skill paths, all-or-nothing', () => {
  const bp = loadFixture('maxi-repo.synthesized.blueprint.json');
  const clone = JSON.parse(JSON.stringify(bp.specialists.find((s) => s.name === 'api-engineer')));
  clone.name = 'api2-engineer';
  bp.specialists.push(clone);
  const { files, errors } = planGeneration(bp, registry, readTemplate);
  assert.deepEqual(files, []);
  assert.deepEqual(errors, ['duplicate generated path ".claude/skills/api-testing/SKILL.md" — two blueprint entries collide']);
});

test('registry pins: every sha256 matches its shipped file (edit a template → update the registry)', () => {
  const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
  for (const [section, kind] of [['agents', 'agent'], ['skills', 'skill'], ['docs', 'doc']]) {
    for (const [id, meta] of Object.entries(registry[section])) {
      assert.equal(typeof meta.sha256, 'string', `${section}.${id} missing sha256 pin`);
      assert.match(meta.version, /^\d+\.\d+\.\d+$/, `${section}.${id} version must be semver`);
      assert.equal(sha(readTemplate(kind, id)), meta.sha256,
        `${section}.${id}: shipped file drifted from registry pin — bump version + re-pin sha256`);
    }
  }
});

test('validateGenerationManifest: unknown keys rejected at both levels (determinism guard)', () => {
  const entry = { path: 'x.md', templateId: 't', templateVersion: '1.0.0', sha256: 'a'.repeat(64) };
  assert.deepEqual(
    validateGenerationManifest({ schemaVersion: 1, generatedAt: 'now', generated: [{ ...entry, writtenAt: 1 }] }),
    [
      'unknown key "generatedAt" — the manifest is deterministic state, no extra fields',
      'generated[0]: unknown key "writtenAt"',
    ],
  );
});

// ── C5: update flow ─────────────────────────────────────────────────────────

test('C5: findUserEdits — pristine target clean, edited file reported, deleted file not a conflict', () => {
  const { files } = planGeneration(loadFixture('maxi-repo.synthesized.blueprint.json'), registry, readTemplate);
  const manifest = manifestFor(files);
  const disk = new Map(files.map((f) => [f.path, f.content]));
  const read = (p) => disk.has(p) ? disk.get(p) : null;

  assert.deepEqual(findUserEdits(manifest, read), []);

  disk.set('.claude/agents/api-engineer.md', disk.get('.claude/agents/api-engineer.md') + '\n// hand edit\n');
  disk.delete('docs/orchestration/tasks-format.md');
  assert.deepEqual(findUserEdits(manifest, read), ['.claude/agents/api-engineer.md']);
});

test('C5: template improvement → version bump → regenerated file, no conflict', () => {
  const bp = loadFixture('mini-repo.synthesized.blueprint.json');
  const v1 = planGeneration(bp, registry, readTemplate);
  assert.deepEqual(v1.errors, []);
  const v1Manifest = manifestFor(v1.files);
  const disk = new Map(v1.files.map((f) => [f.path, f.content]));

  // Agent Base-side template improvement, registry updated in the same change
  const improved = readTemplate('agent', 'generic-specialist') + '\n<!-- improved guidance -->\n';
  const sha = (t) => createHash('sha256').update(t, 'utf8').digest('hex');
  const bumpedRegistry = JSON.parse(JSON.stringify(registry));
  bumpedRegistry.agents['generic-specialist'] = { version: '1.1.0', sha256: sha(improved) };
  const readBumped = (kind, id) => (kind === 'agent' && id === 'generic-specialist') ? improved : readTemplate(kind, id);

  // pristine target → no conflicts, regeneration proceeds
  assert.deepEqual(findUserEdits(v1Manifest, (p) => disk.get(p) ?? null), []);
  const v2 = planGeneration(bp, bumpedRegistry, readBumped);
  assert.deepEqual(v2.errors, []);
  const entry = manifestFor(v2.files).generated.find((g) => g.path === '.claude/agents/cli-engineer.md');
  const oldEntry = v1Manifest.generated.find((g) => g.path === '.claude/agents/cli-engineer.md');
  assert.equal(entry.templateVersion, '1.1.0');
  assert.notEqual(entry.sha256, oldEntry.sha256);
});
