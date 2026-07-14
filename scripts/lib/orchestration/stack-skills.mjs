// stack-skills.mjs — matches a repo profile's layer stacks against the
// vendored stack-skill catalog (templates/stack-skills/catalog.json). Pure:
// no filesystem or network access, callers pass in the parsed profile and
// catalog. Mirrors blueprint-generator's verifier-agent selection rule —
// evidence and exclusion are checked against the SAME layer's stack string,
// not pooled across the whole profile, so a `react` layer still matches
// react-only skills even when a sibling layer is React Native.

const normalize = (s) => (s ?? '').toLowerCase();

// Boundary match, not substring: keyword `react` must hit "React 19" and
// "React Native" but never "preact", "reactstrap", or "reactive". An
// alphanumeric keyword edge must not butt against another alphanumeric in
// the stack; a non-alphanumeric edge (the dot in `.net`) is its own
// boundary — so `.net` matches "ASP.NET Core" but not "internet".
// Multi-word keywords work unchanged; `notEvidence` stays necessary for
// keyword-level collisions boundaries can't solve (`react` IS a token of
// "react native").
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasKeyword = (stack, kw) => {
  const before = /^[a-z0-9]/.test(kw) ? '(?<![a-z0-9])' : '';
  const after = /[a-z0-9]$/.test(kw) ? '(?![a-z0-9])' : '';
  return new RegExp(`${before}${escapeRe(kw)}${after}`).test(stack);
};

// profile: validated repo-profile.json shape. catalog: validated
// templates/stack-skills/catalog.json shape ({ skills: { name: {
// stackEvidence, notEvidence } } }). Returns catalog skill names, sorted,
// whose stackEvidence hits at least one layer's stack (case-insensitive
// boundary match) with no notEvidence keyword in that same layer's stack.
export function matchStackSkills(profile, catalog) {
  const layers = profile?.layers ?? [];
  const matched = [];
  for (const [name, meta] of Object.entries(catalog?.skills ?? {})) {
    const evidence = (meta?.stackEvidence ?? []).map(normalize);
    const notEvidence = (meta?.notEvidence ?? []).map(normalize);
    const layerMatches = layers.some((layer) => {
      const stack = normalize(layer?.stack);
      const hasEvidence = evidence.some((kw) => kw && hasKeyword(stack, kw));
      const hasExclusion = notEvidence.some((kw) => kw && hasKeyword(stack, kw));
      return hasEvidence && !hasExclusion;
    });
    if (layerMatches) matched.push(name);
  }
  return matched.sort();
}
