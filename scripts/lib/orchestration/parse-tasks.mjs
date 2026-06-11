// parse-tasks.mjs — tasks.md ⇄ structured backlog (A4, DD-3).
//
// tasks.md is the work-intake file in a project (canonical format:
// templates/orchestration/docs/tasks-format.md). The parser is STRICT: it
// accepts exactly the canonical form the renderer emits, so
// renderTasksMd(parseTasksMd(text)) round-trips losslessly and the
// orchestrator (the file's single writer, DD-11) can edit via
// parse → mutate → render without format drift. Any unrecognized line is an
// error — error-string-array style, parse result null on any error.
//
// Section membership encodes status, so tasks carry no checkbox field:
// Backlog renders "[ ]", In Progress "[~]", Done "[x]".

const SECTION_HEADINGS = [
  ['backlog', '## Backlog'],
  ['inProgress', '## In Progress'],
  ['done', '## Done'],
];
const CHECKBOX = { backlog: ' ', inProgress: '~', done: 'x' };

const TASK_RE = /^- \[( |~|x)\] (T-\d{3,}) \| scope: ([^|]+) \| (.+)$/;
const AC_RE = /^ {2}- AC: (.+)$/;
const BLOCKED_RE = /^ {2}- blocked: (.+)$/;
// Trailing annotations on the title line; owner before commit when both.
const ANNOTATION_RE = /^(.*?)(?: \(owner: ([^()]+)\))?(?: \(commit: ([^()]+)\))?$/;

// Returns { doc, errors }: doc is { backlog, inProgress, done } arrays of
// { id, scope, title, owner, commit, ac, blocked } iff errors is empty,
// else null.
export function parseTasksMd(text) {
  if (typeof text !== 'string') return { doc: null, errors: ['tasks.md input must be a string'] };

  const errors = [];
  const e = (m) => errors.push(m);
  const doc = { backlog: [], inProgress: [], done: [] };

  let section = null;       // key into doc, once inside a section
  let task = null;          // current task, target for AC/blocked lines
  let sawTitle = false;
  let headingIdx = 0;       // canonical heading order is fixed

  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const where = `line ${i + 1}`;
    if (line === '') { return; }

    if (line === '# Tasks') {
      if (sawTitle) e(`${where}: duplicate "# Tasks" title`);
      sawTitle = true;
      return;
    }

    if (line.startsWith('## ')) {
      const expected = SECTION_HEADINGS[headingIdx];
      if (!expected || line !== expected[1]) {
        const want = expected ? `"${expected[1]}"` : 'no further section';
        e(`${where}: unexpected heading "${line}" — canonical order expects ${want}`);
        // resync so later sections still parse
        const found = SECTION_HEADINGS.find(([, h]) => h === line);
        if (found) { section = found[0]; headingIdx = SECTION_HEADINGS.findIndex(([k]) => k === found[0]) + 1; }
        return;
      }
      section = expected[0];
      headingIdx += 1;
      task = null;
      return;
    }

    const taskMatch = line.match(TASK_RE);
    if (taskMatch) {
      const [, checkbox, id, scopeRaw, rest] = taskMatch;
      if (!section) { e(`${where}: task before any section heading`); return; }
      if (checkbox !== CHECKBOX[section]) {
        e(`${where}: checkbox "[${checkbox}]" does not match section (expected "[${CHECKBOX[section]}]")`);
      }
      const [, title, owner, commit] = rest.match(ANNOTATION_RE);
      if (title.trim() === '') e(`${where}: task ${id} has an empty title`);
      const scope = scopeRaw.split(',').map((s) => s.trim());
      if (scope.some((s) => s === '')) e(`${where}: task ${id} has an empty scope entry`);
      task = {
        id,
        scope,
        title: title.trim(),
        owner: owner ?? null,
        commit: commit ?? null,
        ac: [],
        blocked: null,
      };
      doc[section].push(task);
      return;
    }

    const acMatch = line.match(AC_RE);
    if (acMatch) {
      if (!task) { e(`${where}: AC line without a preceding task`); return; }
      task.ac.push(acMatch[1]);
      return;
    }

    const blockedMatch = line.match(BLOCKED_RE);
    if (blockedMatch) {
      if (!task) { e(`${where}: blocked line without a preceding task`); return; }
      if (task.blocked !== null) e(`${where}: task ${task.id} has more than one blocked line`);
      task.blocked = blockedMatch[1];
      return;
    }

    e(`${where}: unrecognized line "${line}"`);
  });

  if (!sawTitle) e('missing "# Tasks" title');
  if (headingIdx !== SECTION_HEADINGS.length) {
    e('missing canonical sections — Backlog, In Progress, Done must all be present');
  }

  return errors.length ? { doc: null, errors } : { doc, errors: [] };
}

// Canonical serialization: title, the three sections in fixed order, blank
// line after every heading and before the next, tasks consecutive within a
// section, trailing newline. parseTasksMd accepts exactly this shape.
export function renderTasksMd(doc) {
  const out = ['# Tasks'];
  for (const [key, heading] of SECTION_HEADINGS) {
    out.push('', heading);
    const body = [];
    for (const t of doc[key]) {
      const owner = t.owner ? ` (owner: ${t.owner})` : '';
      const commit = t.commit ? ` (commit: ${t.commit})` : '';
      body.push(`- [${CHECKBOX[key]}] ${t.id} | scope: ${t.scope.join(', ')} | ${t.title}${owner}${commit}`);
      for (const ac of t.ac) body.push(`  - AC: ${ac}`);
      if (t.blocked !== null) body.push(`  - blocked: ${t.blocked}`);
    }
    // empty section = bare heading; the next heading brings its own blank
    if (body.length) out.push('', ...body);
  }
  return out.join('\n') + '\n';
}
