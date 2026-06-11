// instantiate.mjs — strict inline slot substitution for orchestration
// templates (DD-5, C3).
//
// Same marker vocabulary as adoption (<!-- ai-kit:slot:name -->, kebab-case)
// but a different operation: scripts/lib/template.mjs does line-anchored
// block ROUTING with lenient empty-string fill and stays untouched; this
// module does inline scalar SUBSTITUTION — markers may sit mid-line, inside
// sentences, table cells, or frontmatter values — with STRICT fill:
//   - every marker in the template must have a slot value (unfilled → error)
//   - every slot value must match a marker (unused → error)
//   - any ai-kit:slot comment that is not a well-formed kebab-case marker
//     is a template defect (malformed → error)
// Error-string-array reporting per scripts/lib/manifest.mjs validateShape;
// content is null whenever errors are non-empty — never a partial fill.

export const INLINE_SLOT_RE = /<!--\s*ai-kit:slot:([a-z0-9-]+)\s*-->/g;

// Any HTML comment mentioning ai-kit:slot — superset of INLINE_SLOT_RE used
// to catch malformed markers (bad casing, stray characters) that strict
// matching would silently leave in the output.
const ANY_SLOT_COMMENT_RE = /<!--[^>]*ai-kit:slot[^>]*-->/g;
const WELL_FORMED_RE = /^<!--\s*ai-kit:slot:[a-z0-9-]+\s*-->$/;

const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// template: string with inline slot markers; slots: flat map of kebab-case
// slot name → non-empty string value (the caller derives non-slot blueprint
// fields like turnLimit into string values).
// Returns { content, errors }: content is the fully substituted text iff
// errors is empty, else null.
export function instantiateTemplate(template, slots) {
  if (typeof template !== 'string') return { content: null, errors: ['template must be a string'] };
  if (!isPlainObject(slots)) return { content: null, errors: ['slots must be an object'] };

  const errors = [];
  const e = (m) => errors.push(m);

  for (const [name, value] of Object.entries(slots)) {
    if (!isNonEmptyString(value)) e(`slots["${name}"] must be a non-empty string`);
  }

  for (const m of template.matchAll(ANY_SLOT_COMMENT_RE)) {
    if (!WELL_FORMED_RE.test(m[0])) {
      e(`malformed slot marker ${m[0]} (line ${lineOf(template, m.index)}) — slot names must be kebab-case`);
    }
  }

  const used = new Set();
  const content = template.replace(INLINE_SLOT_RE, (marker, name, offset) => {
    used.add(name);
    // present-but-invalid values already reported above — don't double-report
    // as unfilled; the marker stays put and content is discarded anyway.
    if (Object.hasOwn(slots, name)) {
      return isNonEmptyString(slots[name]) ? slots[name] : marker;
    }
    e(`unfilled slot "${name}" (line ${lineOf(template, offset)})`);
    return marker;
  });

  for (const name of Object.keys(slots)) {
    if (!used.has(name)) e(`slots["${name}"] matches no slot marker in the template`);
  }

  return errors.length ? { content: null, errors } : { content, errors: [] };
}
