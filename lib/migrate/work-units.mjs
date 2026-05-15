// Deterministically enumerates work units from the manifest.
// Produces scope-JSON entries the migrator agent annotates with h2Routing.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { parseFrontmatter } from '../frontmatter.mjs';
import { deriveTargetDirs, isUnscopedApplyTo } from './applyto.mjs';

export function enumerate(manifest, consumerRoot = null) {
  const pending = manifest.pendingIntegration ?? [];
  const unmanaged = manifest.preexistingUnmanaged ?? [];

  // targetDirMap groups all fold sources by their target directory.
  // '' = root AGENTS.md, 'src' = src/AGENTS.md, etc.
  const targetDirMap = new Map();
  const nonFoldUnits = [];
  const leaveAsIsPaths = [];
  // Track paths we've already added to deletions (multi-glob dedup)
  const deletionsSeen = new Set();

  function ensureDir(dir) {
    if (!targetDirMap.has(dir)) {
      targetDirMap.set(dir, {
        sources: [], deletions: [], manifestDelta: [],
        shimInstall: null, shimReplace: null,
      });
    }
    return targetDirMap.get(dir);
  }

  function addDeletion(entry, path) {
    if (!deletionsSeen.has(path)) {
      deletionsSeen.add(path);
      entry.deletions.push(path);
    }
  }

  // ── pendingIntegration ────────────────────────────────────────────────────

  for (const { managedPath, sidecarPath } of pending) {
    if (managedPath === 'CLAUDE.md') {
      const entry = ensureDir('');
      entry.sources.push({ path: managedPath, originType: 'claude-md-fold' });
      entry.shimInstall = { from: sidecarPath, to: 'CLAUDE.md' };
      addDeletion(entry, sidecarPath);
      entry.manifestDelta.push({ kind: 'resolvePending', managedPath });
    } else if (managedPath === 'AGENTS.md') {
      nonFoldUnits.push({
        id: 'agents-md-merge',
        type: 'agents-md-merge',
        target: 'AGENTS.md',
        templateSidecar: sidecarPath,
        deletions: [sidecarPath],
        manifestDelta: [{ kind: 'resolvePending', managedPath }],
        skillOverlapNotes: [],
      });
    } else if (managedPath === '.claude/settings.json') {
      nonFoldUnits.push({
        id: 'claude-settings', type: 'json-merge',
        mergeStrategy: 'deny-union-allow-keep-hooks-merge',
        target: '.claude/settings.json',
        sources: [managedPath, sidecarPath],
        deletions: [sidecarPath],
        manifestDelta: [{ kind: 'resolvePending', managedPath }],
        skillOverlapNotes: [],
      });
    } else if (managedPath === '.vscode/settings.json') {
      nonFoldUnits.push({
        id: 'vscode-settings', type: 'json-merge',
        mergeStrategy: 'aikit-wins-on-conflict',
        target: '.vscode/settings.json',
        sources: [managedPath, sidecarPath],
        deletions: [sidecarPath],
        manifestDelta: [{ kind: 'resolvePending', managedPath }],
        skillOverlapNotes: [],
      });
    } else if (managedPath === '.github/copilot-instructions.md') {
      const entry = ensureDir('');
      entry.sources.push({ path: managedPath, originType: 'copilot-instructions-fold' });
      addDeletion(entry, sidecarPath);
      entry.manifestDelta.push({ kind: 'resolvePending', managedPath });
    } else if (isInstructionsFile(managedPath)) {
      const { dirs, unscoped } = dirsForInstructions(managedPath, consumerRoot);
      for (const dir of dirs) {
        const entry = ensureDir(dir);
        const src = { path: managedPath, originType: 'instructions-fold' };
        if (unscoped && dir === '') src.unscoped = true;
        entry.sources.push(src);
        addDeletion(entry, sidecarPath);
        entry.manifestDelta.push({ kind: 'resolvePending', managedPath });
      }
    }
    // Other managed paths: fall through (unknown, leave for user to handle)
  }

  // ── preexistingUnmanaged ──────────────────────────────────────────────────

  // Group .github/skills/<name>/ files so we emit one work-unit per skill,
  // not per file. Same for .github/agents/<name>.agent.md (one per agent).
  const githubSkillFiles = new Map(); // skillName → string[]
  const githubAgentFiles = [];
  const githubPromptFiles = []; // .github/prompts/** swept (no managed target today)

  for (const p of unmanaged) {
    if (isInstructionsFile(p)) {
      const { dirs, unscoped } = dirsForInstructions(p, consumerRoot);
      for (const dir of dirs) {
        const entry = ensureDir(dir);
        const src = { path: p, originType: 'instructions-fold' };
        if (unscoped && dir === '') src.unscoped = true;
        entry.sources.push(src);
        addDeletion(entry, p);
        entry.manifestDelta.push({ kind: 'resolveUnmanaged', path: p });
      }
    } else if (p === '.github/copilot-instructions.md') {
      const entry = ensureDir('');
      entry.sources.push({ path: p, originType: 'copilot-instructions-fold' });
      addDeletion(entry, p);
      entry.manifestDelta.push({ kind: 'resolveUnmanaged', path: p });
    } else if (isGithubSkillFile(p)) {
      const skillName = p.split('/')[2];
      if (!githubSkillFiles.has(skillName)) githubSkillFiles.set(skillName, []);
      githubSkillFiles.get(skillName).push(p);
    } else if (isGithubAgentFile(p)) {
      githubAgentFiles.push(p);
    } else if (isGithubPromptsFile(p)) {
      githubPromptFiles.push(p);
    } else if (isNestedClaude(p)) {
      const dir = posixDir(p);
      const entry = ensureDir(dir);
      entry.sources.push({ path: p, originType: 'claude-md-fold' });
      // shimReplace rewrites this CLAUDE.md to the @AGENTS.md shim
      if (!entry.shimReplace) {
        entry.shimReplace = { path: p, content: '@AGENTS.md\n' };
      }
      entry.manifestDelta.push({ kind: 'resolveUnmanaged', path: p });
    } else if (isNestedAgents(p)) {
      // Target AGENTS.md already exists; register dir so a unit is emitted.
      // CLAUDE.md shim will be added in post-processing if needed.
      ensureDir(posixDir(p));
    } else {
      leaveAsIsPaths.push(p);
    }
  }

  // ── Post-process target dirs → emit fold units ────────────────────────────

  const foldUnits = [];

  for (const [dir, entry] of targetDirMap) {
    if (dir === '' && entry.sources.length === 0) continue; // no root fold sources

    const targetPath = dir ? `${dir}/AGENTS.md` : 'AGENTS.md';

    // Nested targets need an installNested manifest delta
    if (dir) entry.manifestDelta.push({ kind: 'installNested', path: targetPath });

    // Ensure a CLAUDE.md shim exists in the nested dir if none already planned
    if (dir && !entry.shimReplace) {
      const claudePath = `${dir}/CLAUDE.md`;
      const hasClaudeSource = entry.sources.some(s => s.path === claudePath);
      // Create shim only when we're not already replacing it via a source file
      if (!hasClaudeSource) {
        entry.shimReplace = { path: claudePath, content: '@AGENTS.md\n' };
      }
    }

    const id = dir
      ? `nested-agents-md-${dir.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').toLowerCase()}`
      : 'root-agents-md';

    const unit = {
      id,
      type: 'markdown-fold',
      target: targetPath,
      sources: entry.sources.map(s => {
        const out = { path: s.path, originType: s.originType };
        if (s.unscoped) out.unscoped = true;
        return out;
      }),
      deletions: entry.deletions,
      manifestDelta: entry.manifestDelta,
      skillOverlapNotes: [],
    };
    if (entry.shimInstall) unit.shimInstall = entry.shimInstall;
    if (entry.shimReplace) unit.shimReplace = entry.shimReplace;

    foldUnits.push(unit);
  }

  // Root first, then nested alphabetical
  foldUnits.sort((a, b) => {
    if (a.id === 'root-agents-md') return -1;
    if (b.id === 'root-agents-md') return 1;
    return a.id.localeCompare(b.id);
  });

  // ── .github/skills/* and .github/agents/* routes ──────────────────────────

  const githubUnits = [];

  for (const [skillName, files] of githubSkillFiles) {
    const targetDir = `.claude/skills/${skillName}`;
    const hasCollision = consumerRoot
      ? existsSync(join(consumerRoot, targetDir))
      : false;
    const fileMappings = files.map(src => ({
      src,
      dst: `${targetDir}/${src.slice(`.github/skills/${skillName}/`.length)}`,
    }));
    githubUnits.push({
      id: `github-skill-${skillName}`,
      type: 'github-skill-route',
      skillName,
      source: `.github/skills/${skillName}`,
      target: targetDir,
      files: fileMappings,
      hasCollision,
      // Non-collision: delete every source file + the now-empty leaf dir.
      // rmdirSync silently skips non-empty dirs in apply-exec.
      deletions: hasCollision ? [] : [...files, `.github/skills/${skillName}`],
      manifestDelta: hasCollision
        ? []
        : files.map(p => ({ kind: 'resolveUnmanaged', path: p })),
      skillOverlapNotes: [],
    });
  }

  for (const p of githubAgentFiles) {
    const name = basename(p).replace(/\.agent\.md$/, '');
    const target = `.claude/agents/${name}.agent.md`;
    const hasCollision = consumerRoot
      ? existsSync(join(consumerRoot, target))
      : false;
    githubUnits.push({
      id: `github-agent-${name}`,
      type: 'github-agent-route',
      agentName: name,
      source: p,
      target,
      files: [{ src: p, dst: target }],
      hasCollision,
      deletions: hasCollision ? [] : [p],
      manifestDelta: hasCollision ? [] : [{ kind: 'resolveUnmanaged', path: p }],
      skillOverlapNotes: [],
    });
  }

  githubUnits.sort((a, b) => a.id.localeCompare(b.id));

  // ── .github/prompts/* sweep + top-level parent dir cleanup ───────────────
  //
  // Copilot prompts have no managed target in ai-kit today; sweep them.
  // Parent dirs (.github/{agents,skills,prompts}) are added last so apply-exec
  // tries to rmdir them after all their contents are gone. rmdirSync silently
  // skips non-empty dirs — strays in leaveAsIsPaths (e.g. README.md) get
  // surfaced by the post-migrate audit instead.
  const cleanupDeletions = [];
  const cleanupManifestDelta = [];
  for (const p of githubPromptFiles) {
    cleanupDeletions.push(p);
    cleanupManifestDelta.push({ kind: 'resolveUnmanaged', path: p });
  }

  const githubParentDirsSeen = new Set();
  for (const p of unmanaged) {
    if (p.startsWith('.github/agents/')) githubParentDirsSeen.add('.github/agents');
    else if (p.startsWith('.github/skills/')) githubParentDirsSeen.add('.github/skills');
    else if (p.startsWith('.github/prompts/')) githubParentDirsSeen.add('.github/prompts');
  }
  // Order: skill leaf dirs already in github-skill-route deletions; parents last.
  for (const dir of ['.github/agents', '.github/skills', '.github/prompts']) {
    if (githubParentDirsSeen.has(dir)) cleanupDeletions.push(dir);
  }

  const cleanupUnits = cleanupDeletions.length > 0
    ? [{
        id: 'github-tree-cleanup',
        type: 'github-tree-cleanup',
        deletions: cleanupDeletions,
        manifestDelta: cleanupManifestDelta,
        skillOverlapNotes: [],
        paths: githubPromptFiles.slice(),
      }]
    : [];

  // ── Leave-as-is review unit ───────────────────────────────────────────────

  // Collision sources stay in place — surface them as leave-as-is so the
  // user knows manual resolution is needed.
  for (const u of githubUnits) {
    if (u.hasCollision) {
      for (const { src } of u.files) leaveAsIsPaths.push(src);
    }
  }

  const leaveUnit = leaveAsIsPaths.length > 0
    ? [{ id: 'review-unmanaged', type: 'leave-as-is', paths: leaveAsIsPaths, deletions: [], manifestDelta: [] }]
    : [];

  return [...foldUnits, ...nonFoldUnits, ...githubUnits, ...leaveUnit, ...cleanupUnits];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isInstructionsFile(p) {
  return p.startsWith('.github/instructions/') && p.endsWith('.instructions.md');
}

function isGithubSkillFile(p) {
  // Expect `.github/skills/<name>/<...>` — name + at least one descendant
  return p.startsWith('.github/skills/') && p.split('/').length >= 4;
}

function isGithubAgentFile(p) {
  return p.startsWith('.github/agents/') && p.endsWith('.agent.md');
}

function isGithubPromptsFile(p) {
  return p.startsWith('.github/prompts/') && p.split('/').length >= 3;
}

function isNestedClaude(p) {
  return p !== 'CLAUDE.md' && basename(p) === 'CLAUDE.md';
}

function isNestedAgents(p) {
  return p !== 'AGENTS.md' && basename(p) === 'AGENTS.md';
}

function posixDir(relPath) {
  return dirname(relPath).replace(/\\/g, '/');
}

// Read applyTo frontmatter from the instructions file; default to root on any
// error. Returns { dirs, unscoped } — `unscoped` is true when applyTo is
// absent/empty or every glob resolves to repo root, which the preflight uses
// to surface cross-cutting instruction files in their own section.
function dirsForInstructions(relPath, consumerRoot) {
  if (consumerRoot) {
    try {
      const raw = readFileSync(join(consumerRoot, relPath), 'utf8');
      const { frontmatter } = parseFrontmatter(raw);
      const dirs = deriveTargetDirs(frontmatter.applyTo);
      if (dirs) return { dirs, unscoped: isUnscopedApplyTo(frontmatter.applyTo) };
    } catch {}
  }
  return { dirs: [''], unscoped: true };
}
