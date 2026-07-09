import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DECISION_ENUMS } from '../scripts/lib/orchestration/schemas.mjs';

// B5 acceptance: every decisions-doc field is reachable by at least one
// question. The bank lives in prose, so the gate is mechanical coverage:
// each field name and each enum value must appear in the SKILL.md table.
const skill = readFileSync(
  join(import.meta.dirname, '..', '.claude', 'skills', 'interview-guide', 'SKILL.md'),
  'utf8',
);

test('interview-guide: every decisions-doc field has a question', () => {
  for (const field of Object.keys(DECISION_ENUMS)) {
    assert.ok(skill.includes(`\`${field}\``), `field ${field} missing from question bank`);
  }
});

test('interview-guide: every enum value is a reachable answer', () => {
  for (const [field, values] of Object.entries(DECISION_ENUMS)) {
    for (const value of values) {
      assert.ok(skill.includes(`\`${value}\``), `${field} value "${value}" unreachable by any answer`);
    }
  }
});

// B3 re-run reuse: the guide must document that an existing decisions.json
// wins over the "Ask when" column, including the "always asked" fields.
test('interview-guide: documents the re-run reuse rule and partitionDecisionReuse', () => {
  assert.match(skill, /Re-run reuse/);
  assert.match(skill, /partitionDecisionReuse/);
  assert.match(skill, /not a policy reset/);
});
