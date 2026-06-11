#!/usr/bin/env node
// build-fixture — materialize a validation fixture into a real git repo for
// manual Phase 3 runs. Usage: node scripts/build-fixture.mjs <name> <dir>

import { resolve, dirname, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fixtures } from '../test/fixtures/defs.mjs';

const [name, dir] = process.argv.slice(2);
if (!name || !dir) {
  console.error('usage: node scripts/build-fixture.mjs <name> <dir>');
  console.error(`names: ${Object.keys(fixtures).join(' ')}`);
  process.exit(1);
}
const def = fixtures[name];
if (!def) {
  console.error(`unknown fixture "${name}". names: ${Object.keys(fixtures).join(' ')}`);
  process.exit(1);
}
const target = resolve(dir);
if (existsSync(target) && readdirSync(target).length > 0) {
  console.error(`refusing to write into non-empty directory: ${target}`);
  process.exit(1);
}
mkdirSync(target, { recursive: true });
for (const [rel, content] of Object.entries(def.files)) {
  const abs = join(target, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}
const g = (args) => {
  const r = spawnSync('git', args, { cwd: target, encoding: 'utf8' });
  if (r.status !== 0) { console.error(`git ${args.join(' ')} failed: ${r.stderr}`); process.exit(1); }
};
g(['init', '-q', '-b', 'main']);
g(['add', '-A']);
g(['-c', 'user.email=fixture@agent-base', '-c', 'user.name=fixture', 'commit', '-qm', `fixture: ${name}`]);
console.log(`fixture "${name}" → ${target}`);
console.log(`sentinels planted: ${def.sentinels.length}`);
console.log('next: node <agent-base>/scripts/install-setup.mjs ' + target);
