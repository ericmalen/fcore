import { join, relative, posix } from 'node:path';
import { getScaffoldRoot, getConsumerRoot } from './paths.mjs';
import { loadRegistry } from './registry.mjs';
import { readManifest, writeManifest, buildManifest, addFileEntry, addPendingIntegration, addPreexistingUnmanaged } from './manifest.mjs';
import { hashFile, copyFile, walkFiles, exists } from './fsutil.mjs';
import { headSha, isDirty, isGitRepo } from './git.mjs';
import { scan, resolveTarget, findPreexistingUnmanaged } from './brownfield.mjs';
import { confirm, multiSelect } from './prompt.mjs';
import { log } from './log.mjs';
import { detectAiTools } from './tools.mjs';

// Resolve opt-in skill selection. Returns deduped list of skill IDs.
// `--skills <a,b>` accepts both individual IDs and category names (categories expand
// to all skills in that folder). Interactive flow uses a 2-step picker: pick categories,
// then optionally drill into individual skills via an "(advanced)" item.
async function selectOptInSkills(flags, registry) {
  const allSkills = registry.optInSkills();
  if (allSkills.length === 0) return [];

  const categoryNames = registry.categoryNames();

  if (flags.skills) {
    const tokens = flags.skills.split(',').map(s => s.trim()).filter(Boolean);
    const ids = new Set();
    for (const token of tokens) {
      if (registry.hasSkill(token)) {
        ids.add(token);
      } else if (categoryNames.has(token)) {
        for (const skill of registry.getSkillsByCategory(token)) ids.add(skill.id);
      } else {
        const cats = [...categoryNames].join(', ');
        const skillIds = allSkills.map(s => s.id).join(', ');
        log.error(`Unknown skill or category: "${token}".`);
        log.error(`  Categories: ${cats}`);
        log.error(`  Skill IDs:  ${skillIds}`);
        process.exit(1);
      }
    }
    return [...ids];
  }

  if (!process.stdin.isTTY || flags.yes) {
    const cats = [...categoryNames].join(', ');
    log.info(`Installing base only. Re-run with --skills <category-or-id,...>`);
    log.info(`  Categories: ${cats}`);
    return [];
  }

  // Interactive 2-step picker
  const ADVANCED = '__advanced__';
  const categoryChoices = registry.optInSkillCategories().map(c => ({
    id: c.category,
    description: `${c.skills.length} skill${c.skills.length === 1 ? '' : 's'}`,
  }));
  categoryChoices.push({ id: ADVANCED, description: 'pick individual skills' });

  const pickedCategories = await multiSelect('Select skill categories', categoryChoices);
  const wantAdvanced = pickedCategories.includes(ADVANCED);
  const fromCategories = new Set();
  for (const cat of pickedCategories) {
    if (cat === ADVANCED) continue;
    for (const skill of registry.getSkillsByCategory(cat) ?? []) fromCategories.add(skill.id);
  }

  let fromIndividual = [];
  if (wantAdvanced) {
    const remaining = allSkills.filter(s => !fromCategories.has(s.id));
    if (remaining.length > 0) {
      fromIndividual = await multiSelect('Select individual skills', remaining);
    }
  }

  return [...new Set([...fromCategories, ...fromIndividual])];
}

export async function init(flags, aiKitRootOverride) {
  const aiKitRoot = aiKitRootOverride ?? getScaffoldRoot(import.meta.url);
  const consumerRoot = flags._consumerRoot ?? getConsumerRoot();
  const registry = loadRegistry(aiKitRoot);

  log.blank(); // top margin — output never butts against the shell prompt

  // Guard: already initialized
  const existing = readManifest(consumerRoot, registry.manifestName);
  if (existing && !flags.force) {
    log.info(`Already initialized (mode: ${existing.mode}, commit: ${existing.source.commitShort})`);
    log.info('Use `ai-kit update` to pull latest changes.');
    log.info('Use --force to re-initialize.');
    log.blank();
    return;
  }

  // Consumer git check
  if (!isGitRepo(consumerRoot)) {
    log.warn('  This directory is not a git repo — files will not be version-controlled.');
    if (process.stdin.isTTY && !flags.yes) {
      const ok = await confirm('Continue?');
      if (!ok) { log.info('Aborted.'); log.blank(); return; }
    }
  }

  // Scaffold SHA + dirty check
  const sha = headSha(aiKitRoot);
  if (!sha) log.warn('  Cannot determine ai-kit commit SHA — source.commit will be "unknown".');
  if (sha && isDirty(aiKitRoot)) {
    log.warn(`  Scaffold has uncommitted changes — installed files may not match ${sha.slice(0, 7)}.`);
  }

  // Skill selection — accepts category names and individual IDs (mixed)
  const selectedSkills = await selectOptInSkills(flags, registry);

  // Agent selection
  let selectedAgents = [];
  if (flags.agents) {
    selectedAgents = flags.agents.split(',').map(s => s.trim()).filter(Boolean);
    for (const a of selectedAgents) {
      if (!registry.hasAgent(a)) {
        log.error(`Unknown agent: "${a}". Available: ${registry.optInAgents().map(x => x.id).join(', ')}`);
        process.exit(1);
      }
    }
  } else if (process.stdin.isTTY && !flags.yes && registry.optInAgents().length > 0) {
    selectedAgents = await multiSelect('Select opt-in agents', registry.optInAgents());
  }

  // Brownfield scan (mode is recorded in the manifest; not narrated here)
  const scanResult = scan(consumerRoot, registry);
  const mode = scanResult.isBrownfield ? 'brownfield' : 'greenfield';

  // Build shipping set
  const shippingItems = [];

  for (const f of registry.baseFiles()) {
    shippingItems.push({
      srcRel: f,
      srcAbs: join(aiKitRoot, f),
      role: registry.isWiringFile(f) ? 'wiring' : 'base',
    });
  }

  for (const skillName of registry.baseSkills()) {
    const skillAbs = join(aiKitRoot, registry.baseSkillPath(skillName));
    for (const absFile of walkFiles(skillAbs)) {
      const srcRel = relative(aiKitRoot, absFile).replace(/\\/g, '/');
      shippingItems.push({ srcRel, srcAbs: absFile, role: 'skill', owner: skillName });
    }
  }

  for (const skillId of selectedSkills) {
    if (registry.baseSkills().includes(skillId)) continue; // already shipped as base
    const skillInfo = registry.getSkillInfo(skillId);
    const skillAbs = join(aiKitRoot, skillInfo.path);
    const installDir = registry.optInSkillInstallDir(skillId);
    for (const absFile of walkFiles(skillAbs)) {
      const srcRel = relative(aiKitRoot, absFile).replace(/\\/g, '/');
      const tailRel = relative(skillAbs, absFile).replace(/\\/g, '/');
      const targetRel = posix.join(installDir, tailRel);
      shippingItems.push({ srcRel, srcAbs: absFile, role: 'skill', owner: skillId, targetRel });
    }
  }

  for (const agentId of registry.baseAgents()) {
    const agentInfo = registry.getAgentInfo(agentId);
    shippingItems.push({
      srcRel: agentInfo.path,
      srcAbs: join(aiKitRoot, agentInfo.path),
      role: 'agent',
      owner: agentId,
    });
  }

  for (const agentId of selectedAgents) {
    if (registry.baseAgents().includes(agentId)) continue; // already shipped as base
    const agentInfo = registry.getAgentInfo(agentId);
    shippingItems.push({
      srcRel: agentInfo.path,
      srcAbs: join(aiKitRoot, agentInfo.path),
      role: 'agent',
      owner: agentId,
    });
  }

  // Build manifest skeleton — filter base entries out of opt-in arrays so the
  // same id never appears in both `installed.baseSkills` and `installed.skills`
  // (or the equivalent for agents).
  const baseSkillSet = new Set(registry.baseSkills());
  const baseAgentSet = new Set(registry.baseAgents());
  const manifest = buildManifest({
    sourceRepo: registry.sourceRepo,
    commit: sha,
    localPath: aiKitRoot,
    mode,
    installedBaseSkills: registry.baseSkills(),
    installedBaseAgents: registry.baseAgents(),
    installedSkills: selectedSkills.filter(s => !baseSkillSet.has(s)),
    installedAgents: selectedAgents.filter(a => !baseAgentSet.has(a)),
  });

  // Copy loop
  const shippedTargets = new Set();

  for (const item of shippingItems) {
    const baseTargetRel = item.targetRel ?? item.srcRel;
    const targetRel = resolveTarget(baseTargetRel, scanResult.isBrownfield, consumerRoot);
    const targetAbs = join(consumerRoot, targetRel);
    const isSidecar = targetRel !== baseTargetRel;

    copyFile(item.srcAbs, targetAbs);
    shippedTargets.add(targetRel);

    addFileEntry(manifest, item.srcRel, {
      sourceHash: hashFile(item.srcAbs),
      installedAs: targetRel,
      role: item.role,
      owner: item.owner,
      sidecar: isSidecar || undefined,
    });

    if (isSidecar) {
      addPendingIntegration(manifest, {
        managedPath: baseTargetRel,
        sidecarPath: targetRel,
        reason: 'consumer file already present',
      });
    }
  }

  // Preexisting unmanaged (brownfield only)
  if (scanResult.isBrownfield) {
    const pendingPaths = new Set(manifest.pendingIntegration.map(p => p.managedPath));
    const knownPaths = new Set([...shippedTargets, ...pendingPaths]);
    const unmanaged = findPreexistingUnmanaged(consumerRoot, knownPaths);
    for (const p of unmanaged) addPreexistingUnmanaged(manifest, p);
  }

  writeManifest(consumerRoot, manifest, registry.manifestName);

  // Summary — "label rail": every line is `<2-space margin><label padded to
  // LABEL_W><content>`. Multi-value rows repeat with a blank label so content
  // stays in one column.
  const LABEL_W = 12;
  const field = (label, value) => log.info(`${String(label).padEnd(LABEL_W)}${value}`);
  const pending = manifest.pendingIntegration;
  const unmanaged = manifest.preexistingUnmanaged;

  log.blank();
  log.success(`  ai-kit installed — ${shippedTargets.size} files`);

  if (selectedSkills.length || selectedAgents.length) {
    log.blank();
    if (selectedSkills.length) field('Skills', selectedSkills.join(', '));
    if (selectedAgents.length) field('Agents', selectedAgents.join(', '));
  }

  if (pending.length > 0) {
    log.blank();
    const w = Math.max(...pending.map(p => p.managedPath.length));
    pending.forEach((p, i) => {
      field(i === 0 ? 'Set aside' : '', `${p.managedPath.padEnd(w)}  →  ${p.sidecarPath}`);
    });
  }

  if (unmanaged.length > 0) {
    log.blank();
    unmanaged.forEach((u, i) => field(i === 0 ? 'Unmanaged' : '', u));
  }

  log.blank();
  if (pending.length > 0) {
    const tools = detectAiTools();
    field('Next', 'resolve brownfield sidecars — run /migrate in your AI tool');
    if (tools.claude) {
      log.dim('Detected Claude Code → run `claude` then type /migrate');
    }
    if (tools.copilot) {
      log.dim('Detected GitHub Copilot → open Copilot Chat then type /migrate');
    }
    if (!tools.claude && !tools.copilot) {
      log.dim('Install Claude Code or GitHub Copilot, then run /migrate');
    }
    log.dim('Then run /optimize to fix any convention violations found after migration.');
  } else {
    field('Next', 'fill in the TODO sections of AGENTS.md');
  }
  log.blank();
}
