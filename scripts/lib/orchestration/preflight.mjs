// preflight.mjs — readiness decision for fcore-fleet-config (fail fast on repos
// with no detectable code layer, before discovery burns a phase on them).
//
// Cheap heuristic only: full authority for "what are the layers" stays with
// repo-analyst/structure-detector. Ambiguity here always resolves to ready —
// this guard blocks only the clearly-empty case, never a repo shape it
// doesn't understand (e.g. non-npm ecosystems get a free pass past the
// test-signal check; discovery decides from there).

const NO_TEST_SPECIFIED_RE = /no test specified/i;

const BLOCKED_MESSAGE = 'orchestration needs at least one code layer with a '
  + 'test command; build your first layer with the fcore baseline, then '
  + 're-run /fcore-fleet-config';

export function hasTestSignal(manifest) {
  const test = manifest?.scripts?.test;
  if (typeof test !== 'string' || test.trim() === '') return false;
  return !NO_TEST_SPECIFIED_RE.test(test);
}

// decidePreflight({ rootManifest, workspaceManifests, testFileHits, otherManifestHits }) →
//   { ready: true, reason: 'ready', layers, evidence }
// | { ready: false, reason: 'no-code-layer' | 'no-test-signal', message }
//
// Rules, in order:
//   1. Root package.json with `workspaces` → ready if any workspace manifest
//      has a test signal, or shallow test-file hits exist.
//   2. Root package.json, single package → ready if it has a test signal, or
//      shallow test-file hits exist.
//   3. No package.json, but another ecosystem's manifest was found
//      (pyproject.toml, go.mod, Cargo.toml, …) → ready; the probe has no
//      test-signal competence there, so defer to discovery.
//   4. Otherwise → blocked: no-code-layer (no manifest at all) or
//      no-test-signal (manifest present, nothing testable found).
export function decidePreflight({
  rootManifest, workspaceManifests = [], testFileHits = false, otherManifestHits = [],
}) {
  if (rootManifest) {
    const isWorkspaceRepo = Array.isArray(rootManifest.workspaces) && rootManifest.workspaces.length > 0;
    if (isWorkspaceRepo) {
      const tested = workspaceManifests.filter(hasTestSignal).length;
      if (tested > 0 || testFileHits) {
        return {
          ready: true,
          reason: 'ready',
          layers: Math.max(tested, 1),
          evidence: tested > 0 ? `${tested} workspace(s) with a test script` : 'test files detected',
        };
      }
      return { ready: false, reason: 'no-test-signal', message: BLOCKED_MESSAGE };
    }
    if (hasTestSignal(rootManifest) || testFileHits) {
      return {
        ready: true,
        reason: 'ready',
        layers: 1,
        evidence: hasTestSignal(rootManifest) ? 'root package.json has a test script' : 'test files detected',
      };
    }
    return { ready: false, reason: 'no-test-signal', message: BLOCKED_MESSAGE };
  }

  if (otherManifestHits.length > 0) {
    return {
      ready: true,
      reason: 'ready',
      layers: otherManifestHits.length,
      evidence: `non-npm manifest(s): ${otherManifestHits.join(', ')}`,
    };
  }

  return { ready: false, reason: 'no-code-layer', message: BLOCKED_MESSAGE };
}

// detectRunMode({ hasDecisions, hasGenerationManifest }) → 'fresh' | 're-run'
// Re-run when EITHER prior orchestration artifact exists — decisions.json
// alone (interview done, generation not yet run) still counts.
export function detectRunMode({ hasDecisions, hasGenerationManifest }) {
  return (hasDecisions || hasGenerationManifest) ? 're-run' : 'fresh';
}
