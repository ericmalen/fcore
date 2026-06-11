import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { instantiateTemplate } from '../scripts/lib/orchestration/instantiate.mjs';
import { renderDispatchOrder } from '../scripts/lib/orchestration/dispatch-order.mjs';
import { validateGenerationManifest, validateTaskBacklog } from '../scripts/lib/orchestration/schemas.mjs';
import { parseTasksMd } from '../scripts/lib/orchestration/parse-tasks.mjs';
import { planGeneration, manifestFor } from '../scripts/lib/orchestration/scaffold.mjs';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'orchestration');
const TEMPLATES = join(import.meta.dirname, '..', 'templates', 'orchestration', 'agents');
const loadFixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));

// C1/C3 acceptance: every agent entry of the hand-written A3 fixture and
// both synthesized Phase B blueprints fully instantiates against its
// template — strict both ways, so this is simultaneously the "no orphan
// slots" lint and the "no unfillable template" lint.
const BLUEPRINTS = [
  'maxi-repo.blueprint.json',
  'maxi-repo.synthesized.blueprint.json',
  'mini-repo.synthesized.blueprint.json',
];

// Same derivation the instantiator skills use: declared slots + the
// injected quartet from blueprint fields, plus the rendered dispatch order
// on the orchestrator only.
const slotMapFor = (agent, bp) => ({
  ...agent.slots,
  name: agent.name,
  tools: agent.tools.join(', '),
  'model-tier': agent.modelTier,
  'turn-limit': String(agent.turnLimit),
  ...(agent === bp.orchestrator
    ? { 'dispatch-order': renderDispatchOrder(bp.dispatch_rules.dispatch_order) }
    : {}),
});

for (const fixture of BLUEPRINTS) {
  const bp = loadFixture(fixture);
  for (const agent of [...bp.specialists, bp.orchestrator]) {
    test(`C1 lint: ${fixture} → ${agent.name} (${agent.templateId}) instantiates clean`, () => {
      const path = join(TEMPLATES, `${agent.templateId}.template.md`);
      assert.ok(existsSync(path), `template ${agent.templateId}.template.md missing`);
      const { content, errors } = instantiateTemplate(readFileSync(path, 'utf8'), slotMapFor(agent, bp));
      assert.deepEqual(errors, []);
      assert.ok(!content.includes('agent-base:slot'), 'no marker text survives');
      assert.match(content, new RegExp(`^name: ${agent.name}$`, 'm'));
    });
  }
}

// C2: each skill template instantiates clean from its paired specialist's
// blueprint slots alone (no quartet — skills carry no agent identity).
const SKILL_TEMPLATES = join(import.meta.dirname, '..', 'templates', 'orchestration', 'skills');
const registry = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'templates', 'orchestration', 'template-registry.json'), 'utf8'),
);

for (const [skillId] of Object.entries(registry.skills)) {
  test(`C2 lint: ${skillId} instantiates from its paired specialist's slots`, () => {
    const bp = loadFixture('maxi-repo.synthesized.blueprint.json');
    const specialist = bp.specialists.find((s) => (s.pairedSkills ?? []).includes(skillId));
    assert.ok(specialist, `no maxi specialist lists pairedSkills "${skillId}"`);
    const tpl = readFileSync(join(SKILL_TEMPLATES, `${skillId}.template.md`), 'utf8');
    // C2 invariant stated directly, not via the fixture: exactly these 4 slots
    const markers = new Set([...tpl.matchAll(/<!--\s*agent-base:slot:([a-z0-9-]+)\s*-->/g)].map((m) => m[1]));
    assert.deepEqual([...markers].sort(), ['conventions', 'layer-path', 'stack', 'test-cmd']);
    const { content, errors } = instantiateTemplate(tpl, specialist.slots);
    assert.deepEqual(errors, []);
    assert.ok(!content.includes('agent-base:slot'));
    assert.match(content, new RegExp(`^name: ${skillId}$`, 'm'));
  });
}

test('C2 lint: registry and shipped templates cover each other exactly', () => {
  const agentFiles = readdirSync(TEMPLATES).filter((f) => f.endsWith('.template.md')).map((f) => f.replace('.template.md', ''));
  const skillFiles = readdirSync(SKILL_TEMPLATES).filter((f) => f.endsWith('.template.md')).map((f) => f.replace('.template.md', ''));
  assert.deepEqual(agentFiles.sort(), Object.keys(registry.agents).sort());
  assert.deepEqual(skillFiles.sort(), Object.keys(registry.skills).sort());
  for (const [skillId, meta] of Object.entries(registry.skills)) {
    assert.ok(Array.isArray(meta.stackEvidence) && meta.stackEvidence.length > 0,
      `${skillId} must declare stackEvidence hints for synthesis`);
  }
  const docFiles = readdirSync(join(import.meta.dirname, '..', 'templates', 'orchestration', 'docs'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace('.md', ''));
  assert.deepEqual(docFiles.sort(), Object.keys(registry.docs).sort());
});

test('C1 lint: every shipped template is referenced by at least one fixture blueprint', () => {
  const referenced = new Set(
    BLUEPRINTS.flatMap((f) => {
      const bp = loadFixture(f);
      return [...bp.specialists, bp.orchestrator].map((a) => a.templateId);
    }),
  );
  const shipped = readdirSync(TEMPLATES)
    .filter((f) => f.endsWith('.template.md'))
    .map((f) => f.replace('.template.md', ''));
  for (const id of shipped) {
    assert.ok(referenced.has(id), `template ${id} is orphaned — no fixture blueprint references it`);
  }
});

// ── C3: instantiator skill parity ───────────────────────────────────────────
// Each instantiator skill embeds its own node -e script (hand-duplicating
// the scaffolder's slot derivation and pairing), so it can silently drift
// from scaffold.mjs — e.g. a new injected slot added to agentSlotMap but not
// to the skill. These run the embedded scripts verbatim and assert
// byte-parity with planGeneration.

const ROOT = join(import.meta.dirname, '..');

const embeddedScript = (skillName) => {
  const md = readFileSync(join(ROOT, '.claude', 'skills', skillName, 'SKILL.md'), 'utf8');
  const m = md.match(/node --input-type=module -e '\n([\s\S]*?)\n\s*' <blueprint\.json>/);
  assert.ok(m, `embedded script block not found in ${skillName}/SKILL.md`);
  return m[1];
};

const planMaxi = () => {
  const bp = loadFixture('maxi-repo.blueprint.json');
  const readTemplate = (kind, id) => {
    const dir = kind === 'agent' ? 'agents' : kind === 'skill' ? 'skills' : 'docs';
    const file = kind === 'doc' ? `${id}.md` : `${id}.template.md`;
    const p = join(ROOT, 'templates', 'orchestration', dir, file);
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  };
  const { files, errors } = planGeneration(bp, registry, readTemplate);
  assert.deepEqual(errors, []);
  return { bp, files };
};

const runEmbedded = (script, agentName, target) => {
  const res = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script, join(FIXTURES, 'maxi-repo.blueprint.json'), agentName, target],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(res.status, 0, `script failed for ${agentName}: ${res.stderr}`);
  return res;
};

test('C3: agent-instantiator SKILL.md embedded script matches planGeneration byte-for-byte', () => {
  const script = embeddedScript('agent-instantiator');
  const { bp, files } = planMaxi();
  const target = mkdtempSync(join(tmpdir(), 'agent-instantiator-parity-'));
  try {
    for (const name of [bp.specialists[0].name, bp.orchestrator.name]) {
      runEmbedded(script, name, target);
      const written = readFileSync(join(target, '.claude', 'agents', `${name}.md`), 'utf8');
      const planned = files.find((f) => f.path === `.claude/agents/${name}.md`);
      assert.equal(written, planned.content, `${name}: skill script output diverges from planGeneration`);
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('C3: skill-instantiator SKILL.md embedded script matches planGeneration byte-for-byte', () => {
  const script = embeddedScript('skill-instantiator');
  const { bp, files } = planMaxi();
  const target = mkdtempSync(join(tmpdir(), 'skill-instantiator-parity-'));
  try {
    for (const specialist of bp.specialists) {
      const res = runEmbedded(script, specialist.name, target);
      const paired = specialist.pairedSkills ?? [];
      if (paired.length === 0) {
        assert.match(res.stdout, /nothing to write/, `${specialist.name}: zero-pairs path should report and exit 0`);
        continue;
      }
      for (const skillId of paired) {
        const written = readFileSync(join(target, '.claude', 'skills', skillId, 'SKILL.md'), 'utf8');
        const planned = files.find((f) => f.path === `.claude/skills/${skillId}/SKILL.md`);
        assert.equal(written, planned.content, `${skillId}: skill script output diverges from planGeneration`);
      }
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// ── E3: drift-checker fresh re-instantiation tracks the scaffolder ───────────
// drift-checker re-instantiates manifest entries and compares SHAs. It must
// derive slots from the SAME agentSlots() the scaffolder uses (it imports it);
// if it ever hand-rolled the derivation again, a clean target would spuriously
// report TEMPLATE-DRIFT. This scaffolds a clean target and runs the skill's
// real embedded classification script — all-MATCH is the regression guard.

const driftScript = () => {
  const md = readFileSync(join(ROOT, '.claude', 'skills', 'drift-checker', 'SKILL.md'), 'utf8');
  const m = md.match(/node --input-type=module -e '\n([\s\S]*?)\n' <project-path>/);
  assert.ok(m, 'manifest-entries script not found in drift-checker/SKILL.md');
  return m[1]; // first block = the agent/skill/doc classifier (uses agentSlots)
};

const scaffoldTarget = () => {
  const { bp, files } = planMaxi();
  const target = mkdtempSync(join(tmpdir(), 'drift-checker-'));
  for (const f of files) {
    mkdirSync(join(target, dirname(f.path)), { recursive: true });
    writeFileSync(join(target, f.path), f.content);
  }
  mkdirSync(join(target, 'docs', 'orchestration'), { recursive: true });
  writeFileSync(join(target, 'docs/orchestration/generation-manifest.json'),
    JSON.stringify(manifestFor(files), null, 2));
  writeFileSync(join(target, 'docs/orchestration/blueprint.json'), JSON.stringify(bp, null, 2));
  return { target, files };
};

const runDrift = (script, target) => {
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', script, target],
    { cwd: ROOT, encoding: 'utf8' });
  assert.equal(res.status, 0, `drift script failed: ${res.stderr}`);
  return res.stdout.trim().split('\n').filter(Boolean);
};

test('E3: drift-checker classifies a clean scaffolded target as all-MATCH', () => {
  const script = driftScript();
  const { target, files } = scaffoldTarget();
  try {
    const lines = runDrift(script, target);
    assert.equal(lines.length, files.length, 'one classification line per manifest entry');
    for (const line of lines) {
      assert.match(line, /^MATCH /, `drift on a clean target — slot derivation diverged from the scaffolder: ${line}`);
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('E3: drift-checker flags a hand-edited generated file as USER-EDIT only', () => {
  const script = driftScript();
  const { target } = scaffoldTarget();
  try {
    const victim = join(target, '.claude/agents/api-engineer.md');
    writeFileSync(victim, readFileSync(victim, 'utf8') + '\n<!-- hand edit -->\n');
    const lines = runDrift(script, target);
    const edited = lines.filter((l) => !l.startsWith('MATCH '));
    assert.deepEqual(edited, ['USER-EDIT .claude/agents/api-engineer.md'],
      'exactly the touched file is USER-EDIT, everything else MATCH');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// ── generation-manifest validator (C4 contract) ─────────────────────────────

const SHA = 'a'.repeat(64);
const ENTRY = { path: '.claude/agents/api-engineer.md', templateId: 'generic-specialist', templateVersion: '1.0.0', sha256: SHA };

test('validateGenerationManifest: well-formed manifest validates clean', () => {
  assert.deepEqual(validateGenerationManifest({ schemaVersion: 1, generated: [ENTRY] }), []);
});

test('validateGenerationManifest: non-object and empty shapes rejected', () => {
  assert.deepEqual(validateGenerationManifest(null), ['generation manifest must be an object']);
  assert.deepEqual(validateGenerationManifest({}), [
    'schemaVersion must be 1 (got undefined)',
    'generated must be a non-empty array',
  ]);
});

test('validateGenerationManifest: bad entries report per field', () => {
  const manifest = {
    schemaVersion: 1,
    generated: [
      { ...ENTRY, path: '/abs/path', templateVersion: 'v1', sha256: 'beef' },
      { ...ENTRY, path: '.claude/../escape.md' },
      'not-an-entry',
    ],
  };
  assert.deepEqual(validateGenerationManifest(manifest), [
    'generated[0].path must be root-relative without ".." (got /abs/path)',
    'generated[0].templateVersion must be semver x.y.z (got v1)',
    'generated[0].sha256 must be a 64-char lowercase hex digest',
    'generated[1].path must be root-relative without ".." (got .claude/../escape.md)',
    'generated[2] must be an object',
  ]);
});

test('validateGenerationManifest: duplicate paths rejected', () => {
  assert.deepEqual(validateGenerationManifest({ schemaVersion: 1, generated: [ENTRY, { ...ENTRY }] }), [
    'generated: duplicate path ".claude/agents/api-engineer.md"',
  ]);
});

// ── D1: seeded maxi-repo tasks.md ───────────────────────────────────────────

test('D1: maxi-repo fixture tasks.md parses and validates with 3 scoped backlog items', () => {
  const text = readFileSync(join(import.meta.dirname, 'fixtures', 'maxi-repo', 'tasks.md'), 'utf8');
  const { doc, errors } = parseTasksMd(text);
  assert.deepEqual(errors, []);
  assert.deepEqual(validateTaskBacklog(doc), []);
  assert.deepEqual(doc.backlog.map((t) => t.scope.length), [1, 2, 3]);
});
