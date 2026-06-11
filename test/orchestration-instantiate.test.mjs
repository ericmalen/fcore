import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { instantiateTemplate } from '../scripts/lib/orchestration/instantiate.mjs';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'orchestration');
const TEMPLATES = join(import.meta.dirname, '..', 'templates', 'orchestration', 'agents');

// Flat slot map an instantiator builds from a blueprint agent entry: declared
// slots plus the derived quartet (name, tools, model-tier, turn-limit).
function slotMapFor(agent) {
  return {
    ...agent.slots,
    name: agent.name,
    tools: agent.tools.join(', '),
    'model-tier': agent.modelTier,
    'turn-limit': String(agent.turnLimit),
  };
}

// ── inline substitution ─────────────────────────────────────────────────────

test('instantiateTemplate: mid-line slot substitutes inside a sentence', () => {
  const { content, errors } = instantiateTemplate(
    'Run `<!-- ai-kit:slot:test-cmd -->` before reporting.',
    { 'test-cmd': 'npm test --workspace api' },
  );
  assert.deepEqual(errors, []);
  assert.equal(content, 'Run `npm test --workspace api` before reporting.');
});

test('instantiateTemplate: repeated marker fills every occurrence', () => {
  const { content, errors } = instantiateTemplate(
    '<!-- ai-kit:slot:layer-path -->: edits stay under <!-- ai-kit:slot:layer-path -->.',
    { 'layer-path': 'apps/api' },
  );
  assert.deepEqual(errors, []);
  assert.equal(content, 'apps/api: edits stay under apps/api.');
});

test('instantiateTemplate: marker whitespace variants all match', () => {
  const { content, errors } = instantiateTemplate(
    '<!--ai-kit:slot:a--> <!--  ai-kit:slot:a  -->',
    { a: 'x' },
  );
  assert.deepEqual(errors, []);
  assert.equal(content, 'x x');
});

// ── strict fill ─────────────────────────────────────────────────────────────

test('instantiateTemplate: unfilled slot fails with name and line, content null', () => {
  const { content, errors } = instantiateTemplate(
    'line one\nuses <!-- ai-kit:slot:stack --> here',
    {},
  );
  assert.equal(content, null);
  assert.deepEqual(errors, ['unfilled slot "stack" (line 2)']);
});

test('instantiateTemplate: every unfilled occurrence reports its own line', () => {
  const { errors } = instantiateTemplate(
    '<!-- ai-kit:slot:a -->\n<!-- ai-kit:slot:b -->\n<!-- ai-kit:slot:a -->',
    {},
  );
  assert.deepEqual(errors, [
    'unfilled slot "a" (line 1)',
    'unfilled slot "b" (line 2)',
    'unfilled slot "a" (line 3)',
  ]);
});

test('instantiateTemplate: unused slot value is an error', () => {
  const { content, errors } = instantiateTemplate(
    'no markers here',
    { stack: 'Express' },
  );
  assert.equal(content, null);
  assert.deepEqual(errors, ['slots["stack"] matches no slot marker in the template']);
});

test('instantiateTemplate: invalid value reports once, not also as unfilled', () => {
  const { content, errors } = instantiateTemplate(
    'uses <!-- ai-kit:slot:stack -->',
    { stack: '  ' },
  );
  assert.equal(content, null);
  assert.deepEqual(errors, ['slots["stack"] must be a non-empty string']);
});

test('instantiateTemplate: non-string value rejected', () => {
  const { errors } = instantiateTemplate(
    'limit: <!-- ai-kit:slot:turn-limit -->',
    { 'turn-limit': 30 },
  );
  assert.deepEqual(errors, ['slots["turn-limit"] must be a non-empty string']);
});

test('instantiateTemplate: malformed marker is a template defect', () => {
  const { content, errors } = instantiateTemplate(
    'ok <!-- ai-kit:slot:good -->\nbad <!-- ai-kit:slot:BadName -->',
    { good: 'x' },
  );
  assert.equal(content, null);
  assert.deepEqual(errors, [
    'malformed slot marker <!-- ai-kit:slot:BadName --> (line 2) — slot names must be kebab-case',
  ]);
});

test('instantiateTemplate: bad argument shapes rejected outright', () => {
  assert.deepEqual(instantiateTemplate(42, {}), { content: null, errors: ['template must be a string'] });
  assert.deepEqual(instantiateTemplate('', null), { content: null, errors: ['slots must be an object'] });
  assert.deepEqual(instantiateTemplate('', ['a']), { content: null, errors: ['slots must be an object'] });
});

// ── api-engineer template × A3 blueprint fixture ────────────────────────────

const template = readFileSync(join(TEMPLATES, 'api-engineer.template.md'), 'utf8');
const blueprint = JSON.parse(readFileSync(join(FIXTURES, 'maxi-repo.blueprint.json'), 'utf8'));
const apiEngineer = blueprint.specialists.find((s) => s.name === 'api-engineer');

test('api-engineer template: blueprint fixture entry instantiates clean', () => {
  const { content, errors } = instantiateTemplate(template, slotMapFor(apiEngineer));
  assert.deepEqual(errors, []);
  assert.match(content, /^name: api-engineer$/m);
  assert.match(content, /^tools: Read, Grep, Glob, Edit, Write, Bash$/m);
  assert.match(content, /^model: sonnet$/m);
  assert.match(content, /`npm test --workspace api`/);
  assert.match(content, /^apps\/api\/package\.json$/m);
  assert.ok(!content.includes('ai-kit:slot'), 'no marker text survives instantiation');
});

test('api-engineer template: repeat run is byte-identical', () => {
  const first = instantiateTemplate(template, slotMapFor(apiEngineer));
  const second = instantiateTemplate(template, slotMapFor(apiEngineer));
  assert.deepEqual(first.errors, []);
  assert.equal(first.content, second.content);
});

test('api-engineer template: dropping one blueprint slot fails instantiation', () => {
  const slots = slotMapFor(apiEngineer);
  delete slots['test-cmd'];
  const { content, errors } = instantiateTemplate(template, slots);
  assert.equal(content, null);
  assert.ok(errors.length > 0 && errors.every((m) => m.includes('unfilled slot "test-cmd"')));
});
