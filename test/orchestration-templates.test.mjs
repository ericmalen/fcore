import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { instantiateTemplate } from '../scripts/lib/orchestration/instantiate.mjs';

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
// injected quartet from blueprint fields.
const slotMapFor = (agent) => ({
  ...agent.slots,
  name: agent.name,
  tools: agent.tools.join(', '),
  'model-tier': agent.modelTier,
  'turn-limit': String(agent.turnLimit),
});

for (const fixture of BLUEPRINTS) {
  const bp = loadFixture(fixture);
  for (const agent of [...bp.specialists, bp.orchestrator]) {
    test(`C1 lint: ${fixture} → ${agent.name} (${agent.templateId}) instantiates clean`, () => {
      const path = join(TEMPLATES, `${agent.templateId}.template.md`);
      assert.ok(existsSync(path), `template ${agent.templateId}.template.md missing`);
      const { content, errors } = instantiateTemplate(readFileSync(path, 'utf8'), slotMapFor(agent));
      assert.deepEqual(errors, []);
      assert.ok(!content.includes('ai-kit:slot'), 'no marker text survives');
      assert.match(content, new RegExp(`^name: ${agent.name}$`, 'm'));
    });
  }
}

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
