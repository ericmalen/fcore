// Grades dependency-mapper eval runs: evaluates each eval's assertions
// against the run's dependency-report.json, writing grading.json per run.
// Usage: node grade.mjs <iteration-dir>
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const iterDir = process.argv[2] ?? join(here, 'iteration-1');

const show = (v) => JSON.stringify(v);
const edges = (r) => (Array.isArray(r.internalEdges) ? r.internalEdges : []);
const edgeKeys = (r) => edges(r).map((e) => `${e.from}→${e.to}`).sort();
const findEdge = (r, from, to) =>
  edges(r).find((e) => e.from === from && (e.to === to || e.to === to.replace('-', '')));
// externalDeps may be an object keyed by layer or an array of {layer, deps}.
const extFor = (r, layer) => {
  const x = r.externalDeps;
  if (Array.isArray(x)) {
    const hit = x.find((e) => e.layer === layer || e.name === layer);
    return show(hit?.deps ?? hit?.dependencies ?? hit ?? null);
  }
  if (x && typeof x === 'object') return show(x[layer] ?? null);
  return show(x ?? null);
};
const extCount = (r, layer) => {
  const x = r.externalDeps;
  let v = Array.isArray(x)
    ? (x.find((e) => e.layer === layer || e.name === layer) ?? {})
    : (x && typeof x === 'object' ? x[layer] : null);
  if (v && !Array.isArray(v) && typeof v === 'object') v = v.deps ?? v.dependencies ?? Object.keys(v);
  return Array.isArray(v) ? v.length : (v == null ? 0 : 1);
};
const gapsText = (r) => show(r.gaps ?? []);
const orderText = (r) => show(r.ordering ?? null);
const refsText = (r) => show(r.stackRefinements ?? null);

// One checker per assertion, in eval_metadata.json order. Each returns
// { passed, evidence }.
const CHECKS = {
  0: [
    (r) => ({ passed: edgeKeys(r).join() === ['api→shared', 'ui→shared'].sort().join(),
      evidence: `internalEdges=${show(edgeKeys(r))}` }),
    (r) => {
      const bad = edges(r).filter((e) => e.from === 'db' || e.to === 'db' || e.from === 'shared');
      return { passed: bad.length === 0,
        evidence: bad.length ? `invented edges: ${show(bad)}` : 'no db edges, no reversals' };
    },
    (r) => {
      const ok = /react/i.test(extFor(r, 'ui')) && /express/i.test(extFor(r, 'api'))
        && /prisma/i.test(extFor(r, 'db')) && /zod/i.test(extFor(r, 'shared'))
        && ['ui', 'api', 'db', 'shared'].every((l) => extCount(r, l) <= 6);
      return { passed: ok,
        evidence: `ui=${extFor(r, 'ui')}, api=${extFor(r, 'api')}, db=${extFor(r, 'db')}, shared=${extFor(r, 'shared')}` };
    },
    (r) => ({ passed: /shared/.test(orderText(r)) && /(first|before|provider|upstream)/i.test(orderText(r)),
      evidence: `ordering=${orderText(r)}` }),
    (r) => {
      const layerNames = new Set(['ui', 'api', 'db', 'shared']);
      const badRef = edges(r).filter((e) => !layerNames.has(e.from) || !layerNames.has(e.to));
      const gapsEmpty = Array.isArray(r.gaps) && r.gaps.length === 0;
      return { passed: badRef.length === 0 && gapsEmpty,
        evidence: `non-layer-name edges=${show(badRef)}, gaps=${gapsText(r)}` };
    },
  ],
  1: [
    (r) => ({ passed: Array.isArray(r.internalEdges) && r.internalEdges.length === 0,
      evidence: `internalEdges=${show(r.internalEdges)}` }),
    (r) => {
      const t = extFor(r, 'cli');
      const frameworks = /(react|express|prisma|zod|vite|fastify|vitest|lodash|commander|yargs)/i;
      return { passed: (t === 'null' || t === '[]' || /none|zero/i.test(t)) && !frameworks.test(t),
        evidence: `externalDeps.cli=${t}` };
    },
    (r) => {
      const complaining = (r.gaps ?? []).filter((g) => /(no|missing|lacks|without|zero).{0,40}(dependen|edge)/i.test(show(g)));
      return { passed: complaining.length === 0,
        evidence: complaining.length ? `gaps treating absence as a problem: ${show(complaining)}` : `gaps=${gapsText(r)}` };
    },
    (r) => {
      const frameworks = /(react|express|prisma|zod|vite|fastify|vitest)/i;
      return { passed: !frameworks.test(refsText(r)),
        evidence: `stackRefinements=${refsText(r)}` };
    },
  ],
  2: [
    (r) => ({ passed: !!findEdge(r, 'svc', 'core') && !!findEdge(r, 'web', 'core'),
      evidence: `internalEdges=${show(edgeKeys(r))}` }),
    (r) => {
      const e = findEdge(r, 'svc', 'test-kit');
      return { passed: !!e && /dev/i.test(show(e)),
        evidence: e ? `edge=${show(e)}` : 'svc→test-kit edge missing' };
    },
    (r) => {
      const layerNames = new Set(['core', 'svc', 'web', 'test-kit', 'legacy']);
      const bad = edges(r).filter((e) => !layerNames.has(e.from) || !layerNames.has(e.to) || /@edge/.test(`${e.from}${e.to}`));
      return { passed: edges(r).length > 0 && bad.length === 0,
        evidence: bad.length ? `non-layer-name edges: ${show(bad)}` : `all edges use layer names: ${show(edgeKeys(r))}` };
    },
    (r) => {
      const legacyGap = (r.gaps ?? []).filter((g) => /legacy/i.test(show(g)) && /(manifest|package\.json)/i.test(show(g)));
      const legacyEdges = edges(r).filter((e) => e.from === 'legacy' || e.to === 'legacy');
      return { passed: legacyGap.length > 0 && legacyEdges.length === 0,
        evidence: `legacy gaps=${show(legacyGap)}, legacy edges=${show(legacyEdges)}` };
    },
    (r) => ({
      passed: /fastify/i.test(extFor(r, 'svc')) && /react/i.test(extFor(r, 'web'))
        && /zod/i.test(extFor(r, 'core')) && /vitest/i.test(extFor(r, 'test-kit')),
      evidence: `svc=${extFor(r, 'svc')}, web=${extFor(r, 'web')}, core=${extFor(r, 'core')}, test-kit=${extFor(r, 'test-kit')}` }),
    (r) => {
      const t = orderText(r);
      const coreFirst = /core/.test(t) && /(first|before|provider|upstream)/i.test(t);
      const testKitQualified = !/test-?kit/i.test(t) || /dev/i.test(t);
      return { passed: coreFirst && testKitQualified, evidence: `ordering=${t}` };
    },
  ],
};

for (const evalDir of readdirSync(iterDir).filter((d) => d.startsWith('eval-'))) {
  const meta = JSON.parse(readFileSync(join(iterDir, evalDir, 'eval_metadata.json'), 'utf8'));
  for (const config of ['with_skill', 'without_skill', 'old_skill']) {
    const runDir = join(iterDir, evalDir, config);
    if (!existsSync(runDir)) continue;
    const reportPath = join(runDir, 'outputs/dependency-report.json');
    let expectations;
    if (!existsSync(reportPath)) {
      expectations = meta.assertions.map((text) => ({ text, passed: false, evidence: 'dependency-report.json missing' }));
    } else {
      const report = JSON.parse(readFileSync(reportPath, 'utf8'));
      expectations = meta.assertions.map((text, i) => {
        try {
          const { passed, evidence } = CHECKS[meta.eval_id][i](report);
          return { text, passed, evidence };
        } catch (err) {
          return { text, passed: false, evidence: `checker error: ${err.message}` };
        }
      });
    }
    writeFileSync(join(runDir, 'grading.json'), JSON.stringify({ expectations }, null, 2) + '\n');
    const n = expectations.filter((x) => x.passed).length;
    console.log(`${evalDir}/${config}: ${n}/${expectations.length}`);
  }
}
