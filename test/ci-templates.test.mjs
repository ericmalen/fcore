import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { npxSpecFromToolRepo } from '../scripts/lib/release.mjs';

const CI = join(import.meta.dirname, '..', 'templates', 'ci');

// Every pinned template (resolves FleetCore at marker.pin). docs-impact.* are
// not pinned — they never fetch FleetCore.
const PINNED_TEMPLATES = [
  'audit-strict.github.yml',
  'audit-strict.ado.yml',
  'baseline-pin-check.github.yml',
  'baseline-pin-check.ado.yml',
  'baseline-upgrade-bot.github.yml',
  'orchestrator-run.github.yml',
  'orchestrator-run.ado.yml',
];

const load = (name) => readFileSync(join(CI, name), 'utf8');

// The one canonical NPX_SPEC snippet — templates must carry it byte-identically
// (they cannot import npxSpecFromToolRepo: nothing is on disk before npx runs).
const SNIPPET_RE = /NPX_SPEC="\$\(node -e '([^\n]+)'\)"/;

test('all pinned templates carry the identical canonical NPX_SPEC snippet', () => {
  const snippets = new Map(PINNED_TEMPLATES.map((name) => {
    const m = load(name).match(SNIPPET_RE);
    assert.ok(m, `${name}: NPX_SPEC snippet present`);
    return [name, m[0]];
  }));
  const unique = new Set(snippets.values());
  assert.equal(unique.size, 1, `snippet drift across templates: ${[...snippets]
    .map(([n, s]) => `${n}=${s.length}ch`).join(', ')}`);
});

test('the snippet agrees with npxSpecFromToolRepo on sample markers', () => {
  const program = load(PINNED_TEMPLATES[0]).match(SNIPPET_RE)[1];
  const cases = [
    { toolRepo: 'https://github.com/ericmalen/fcore', pin: 'v1.4.0' },
    { toolRepo: 'https://github.com/ericmalen/fcore.git', pin: 'v2.0.0' },
    { toolRepo: 'https://dev.azure.com/org/proj/_git/fcore', pin: 'v1.4.0' },
    { toolRepo: 'git@github.com:ericmalen/fcore.git', pin: 'v1.4.0' }, // scp-style ssh
    { toolRepo: 'https://github.com/ericmalen/fcore', standard: '1.2.3' }, // pin fallback
  ];
  for (const c of cases) {
    const root = mkdtempSync(join(tmpdir(), 'ab-ci-'));
    try {
      mkdirSync(join(root, '.claude'), { recursive: true });
      writeFileSync(join(root, '.claude', 'fcore.json'),
        JSON.stringify({ standard: c.standard ?? '1.0.0', toolRepo: c.toolRepo, pin: c.pin }));
      const r = spawnSync(process.execPath, ['-e', program], { cwd: root, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const pin = c.pin ?? `v${c.standard}`;
      assert.equal(r.stdout, npxSpecFromToolRepo(c.toolRepo, pin), `marker ${JSON.stringify(c)}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('pinned templates run npx --yes at the pin; no clone-at-pin remains', () => {
  for (const name of PINNED_TEMPLATES) {
    const text = load(name);
    assert.match(text, /npx --yes "\$NPX_SPEC"/, `${name}: npx --yes at pin`);
    assert.doesNotMatch(text, /git clone --depth 1 --branch/, `${name}: no pinned clone`);
    assert.doesNotMatch(text, /unpinned clone/, `${name}: stale clone wording`);
  }
});

test('GH/ADO pairs stay structurally paired (audit-strict, baseline-pin-check)', () => {
  for (const base of ['audit-strict', 'baseline-pin-check']) {
    const gh = load(`${base}.github.yml`);
    const ado = load(`${base}.ado.yml`);
    const ghCmds = [...gh.matchAll(/npx --yes "\$NPX_SPEC" ([a-z-]+ [^|]*?)(?: \|\||\n)/g)].map((m) => m[1].trim());
    const adoCmds = [...ado.matchAll(/npx --yes "\$NPX_SPEC" ([a-z-]+ [^|]*?)(?: \|\||\n)/g)].map((m) => m[1].trim());
    assert.deepEqual(ghCmds, adoCmds, `${base}: same npx subcommands on both platforms`);
  }
});
