// template — shared template-instantiation helpers for materialize + build-starter.
//
// Slot markers (<!-- agent-base:slot:NAME -->) are replaced with routed content.
// A section may also be marked optional (<!-- agent-base:optional -->): a level-2
// (## ) section whose slot(s) receive NO content is removed entirely — heading
// through the line before the next ## heading (or EOF). This is what keeps a
// starter AGENTS.md from shipping empty skeleton headings.

export const SLOT_RE = /^[ \t]*<!--\s*agent-base:slot:([a-z0-9-]+)\s*-->[ \t]*\r?\n?/gm;
export const OPTIONAL_RE = /^[ \t]*<!--\s*agent-base:optional\s*-->[ \t]*\r?\n?/gm;

const H2_RE = /^##[ \t]/;
const SLOT_NAME_RE = /<!--\s*agent-base:slot:([a-z0-9-]+)\s*-->/;
const OPTIONAL_LINE_RE = /<!--\s*agent-base:optional\s*-->/;

// Remove every optional ## section whose slots are all absent from filledSlots.
// Operates on template bytes only (Agent Base-owned), before slot replacement. Splits
// on "\n" and rejoins on "\n" — line endings are preserved exactly.
export function stripEmptyOptionalSections(text, filledSlots) {
  const lines = text.split('\n');
  const starts = [];
  for (let i = 0; i < lines.length; i++) if (H2_RE.test(lines[i])) starts.push(i);
  if (starts.length === 0) return text;

  const remove = new Set();
  for (let s = 0; s < starts.length; s++) {
    const start = starts[s];
    const end = s + 1 < starts.length ? starts[s + 1] : lines.length;
    let hasOptional = false;
    const slots = [];
    for (let i = start; i < end; i++) {
      if (OPTIONAL_LINE_RE.test(lines[i])) hasOptional = true;
      const m = lines[i].match(SLOT_NAME_RE);
      if (m) slots.push(m[1]);
    }
    if (!hasOptional) continue;
    const anyFilled = slots.some((n) => filledSlots.has(n));
    if (!anyFilled) for (let i = start; i < end; i++) remove.add(i);
  }
  if (remove.size === 0) return text;
  return lines.filter((_, i) => !remove.has(i)).join('\n');
}

// Full instantiation for a structured template:
//   filledSlots → strip empty optional sections
//   replace remaining slot markers with content (or '' for unfilled mandatory)
//   drop any leftover optional markers from kept sections
// resolve(name) returns the content for a slot, or undefined.
export function instantiate(template, resolve = () => undefined) {
  const filled = new Set();
  // a slot is "filled" iff resolve returns a non-undefined value
  for (const m of template.matchAll(SLOT_RE)) {
    if (resolve(m[1]) !== undefined) filled.add(m[1]);
  }
  let out = stripEmptyOptionalSections(template, filled);
  out = out.replace(SLOT_RE, (_m, name) => resolve(name) ?? '');
  out = out.replace(OPTIONAL_RE, '');
  return out;
}
