// tracker-sync.mjs — pure sync-plan core for the tasks.md ⇄ tracker bridge
// (F3, DD-14). Zero IO: adapters (tracker-ado.mjs, tracker-gh.mjs) normalize
// raw tracker items into the contract below and apply the computed plan; this
// module only decides WHAT to sync.
//
// Normalization contract (the only tracker shape this module ever sees):
//   { externalId: "AB#123" | "#45" | "owner/repo#45",
//     title: string, state: "intake" | "active" | "done", url: string|null }
//
// Direction (DD-14): tracker is intake, tasks.md is canonical execution
// state. Imports flow tracker → Backlog; status flows tasks.md → tracker.
// Conflicts are reported, never auto-resolved.

// tasks.md section → normalized tracker state.
const SECTION_STATE = { backlog: 'intake', inProgress: 'active', done: 'done' };

// Normalized state → platform state vocabulary. ADO varies by process
// template (config ado.stateMap, default "basic"); GitHub is structural
// (open/closed + in-progress / blocked labels, encoded in tracker-gh.mjs).
export const DEFAULT_STATE_MAPS = {
  ado: {
    basic: { intake: 'To Do', active: 'Doing', done: 'Done' },
    agile: { intake: 'New', active: 'Active', done: 'Closed' },
  },
};

// Comment pushed alongside a status update — derived from the task line so
// repeated computation is deterministic.
function statusComment(task, to) {
  if (to === 'active' && task.owner) return `owner: ${task.owner}`;
  if (to === 'done' && task.commit) return `commit: ${task.commit}`;
  if (to === 'intake' && task.blocked) return `blocked: ${task.blocked}`;
  return null;
}

// computeSyncPlan(tasksDoc, trackerItems, platform) → sync plan
// (validateSyncPlan shape). tasksDoc is the parsed form from parseTasksMd;
// trackerItems are normalized items; items with state null (adapter could
// not map the raw state) are skipped here — the CLI reports them.
export function computeSyncPlan(tasksDoc, trackerItems, platform) {
  const imports = [];
  const statusUpdates = [];
  const conflicts = [];
  const prunes = [];

  const items = trackerItems.filter((it) => it.state !== null);
  const itemsById = new Map(items.map((it) => [it.externalId, it]));

  // Index ref-carrying tasks; duplicate refs are a conflict, first one wins.
  const taskByRef = new Map();
  for (const section of ['backlog', 'inProgress', 'done']) {
    for (const task of tasksDoc[section]) {
      if (task.ref === null) continue;
      const prev = taskByRef.get(task.ref);
      if (prev) {
        conflicts.push({
          kind: 'duplicate-ref',
          detail: `ref "${task.ref}" appears on ${prev.task.id} and ${task.id}`,
        });
        continue;
      }
      taskByRef.set(task.ref, { task, state: SECTION_STATE[section] });
    }
  }

  // tracker → tasks.md: unmatched intake items become Backlog imports.
  // Unmatched active/done items are not ours — worked outside the backlog.
  for (const item of items) {
    if (item.state === 'intake' && !taskByRef.has(item.externalId)) {
      imports.push({ externalId: item.externalId, title: item.title, url: item.url ?? null });
    }
  }

  // tasks.md → tracker: push the task's state wherever it differs. A Done
  // task the tracker ALREADY confirms `done` (no push needed) is pruned here
  // — Done is a transient holding area for ref'd tasks awaiting sync, and the
  // handoff log's completion entry is the permanent record, not this line.
  // A Done task that still needs a push to reach `done` is NOT pruned here —
  // this core is pure/pre-push, so it cannot know the push will succeed; the
  // CLI prunes those only after actually confirming the push (DD-14).
  for (const [ref, { task, state }] of taskByRef) {
    const item = itemsById.get(ref);
    if (!item) {
      conflicts.push({
        kind: 'missing-tracker-item',
        detail: `${task.id} refs "${ref}" but the tracker has no such item`,
      });
      continue;
    }
    if (item.state === state) {
      if (state === 'done') prunes.push(task.id);
      continue;
    }
    if (item.state === 'done' && state !== 'done') {
      // Tracker says finished, backlog says not — a human closed it out of
      // band or the task regressed; never silently reopen or close.
      conflicts.push({
        kind: 'tracker-done-task-open',
        detail: `"${ref}" is done in the tracker but ${task.id} is still ${state === 'intake' ? 'in Backlog' : 'In Progress'}`,
      });
      continue;
    }
    statusUpdates.push({
      taskId: task.id,
      externalId: ref,
      to: state,
      comment: statusComment(task, state),
    });
  }

  return { platform, imports, statusUpdates, conflicts, prunes };
}

// applyImports(tasksDoc, imports) → new doc with one Backlog task per import:
// next free T-### id, sentinel scope "triage", a ref line, and a blocked line
// so the orchestrator can never dispatch it before a human scopes it
// (tasks-format.md § Tracker imports). Input doc is not mutated.
export function applyImports(tasksDoc, imports) {
  const doc = {
    backlog: tasksDoc.backlog.map((t) => ({ ...t })),
    inProgress: tasksDoc.inProgress.map((t) => ({ ...t })),
    done: tasksDoc.done.map((t) => ({ ...t })),
  };
  let next = 1 + Math.max(
    0,
    ...[...doc.backlog, ...doc.inProgress, ...doc.done].map((t) => Number(t.id.slice(2))),
  );
  for (const item of imports) {
    doc.backlog.push({
      id: `T-${String(next++).padStart(3, '0')}`,
      scope: ['triage'],
      title: item.title,
      owner: null,
      commit: null,
      ref: item.externalId,
      ac: [],
      blocked: `needs human scoping (imported from ${item.externalId})`,
    });
  }
  return doc;
}

// applyPrunes(tasksDoc, taskIds) → new doc with the given Done task ids
// removed. Done is a transient holding area for ref'd tasks awaiting tracker
// sync (tasks-format.md); the handoff log's completion entry is the
// permanent record, so pruning here loses no history. Input doc is not
// mutated.
export function applyPrunes(tasksDoc, taskIds) {
  const prune = new Set(taskIds);
  return {
    backlog: tasksDoc.backlog.map((t) => ({ ...t })),
    inProgress: tasksDoc.inProgress.map((t) => ({ ...t })),
    done: tasksDoc.done.filter((t) => !prune.has(t.id)).map((t) => ({ ...t })),
  };
}

// Human-readable dry-run report (the CLI default output).
export function renderSyncReport(plan) {
  const out = [`tracker-sync plan (${plan.platform})`];
  out.push('', `imports → Backlog: ${plan.imports.length}`);
  for (const i of plan.imports) out.push(`  + ${i.externalId} "${i.title}"`);
  out.push('', `status updates → tracker: ${plan.statusUpdates.length}`);
  for (const u of plan.statusUpdates) {
    out.push(`  ~ ${u.externalId} → ${u.to} (${u.taskId}${u.comment ? `; ${u.comment}` : ''})`);
  }
  out.push('', `prunes → tasks.md Done: ${plan.prunes.length}`);
  for (const id of plan.prunes) out.push(`  - ${id}`);
  out.push('', `conflicts (human resolution): ${plan.conflicts.length}`);
  for (const c of plan.conflicts) out.push(`  ! [${c.kind}] ${c.detail}`);
  return out.join('\n') + '\n';
}
