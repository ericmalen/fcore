import { join, relative, posix } from 'node:path';
import { readFileSync } from 'node:fs';
import { getScaffoldRoot, getConsumerRoot } from './paths.mjs';
import { loadRegistry } from './registry.mjs';
import { readManifest, writeManifest, addPendingIntegration } from './manifest.mjs';
import { hashFile, copyFile, walkFiles, exists } from './fsutil.mjs';
import { headSha, isDirty } from './git.mjs';
import { lineDiff, render } from './diff.mjs';
import { choice } from './prompt.mjs';
import { log } from './log.mjs';

export async function update(flags, aiKitRootOverride) {
  const aiKitRoot = aiKitRootOverride ?? getScaffoldRoot(import.meta.url);
  const consumerRoot = flags?._consumerRoot ?? getConsumerRoot();
  const registry = loadRegistry(aiKitRoot);
  const manifest = readManifest(consumerRoot, registry.manifestName);

  if (!manifest) {
    log.error('Not initialized. Run `ai-kit init` first.');
    process.exit(1);
  }

  const sha = headSha(aiKitRoot);
  if (!sha) log.warn('Cannot determine ai-kit commit SHA.');
  if (sha && isDirty(aiKitRoot)) {
    log.warn(`ai-kit has uncommitted changes. Content may not match ${sha.slice(0, 7)}.`);
  }

  // Auto-correct legacy manifests that listed a base skill/agent in both
  // `installed.baseSkills` and `installed.skills` (likewise for agents).
  const baseSkillSet = new Set(manifest.installed?.baseSkills ?? []);
  const baseAgentSet = new Set(manifest.installed?.baseAgents ?? []);
  if (manifest.installed) {
    manifest.installed.skills = (manifest.installed.skills ?? []).filter(s => !baseSkillSet.has(s));
    manifest.installed.agents = (manifest.installed.agents ?? []).filter(a => !baseAgentSet.has(a));
  }

  const shippingItems = buildShippingSet(manifest.installed, registry, aiKitRoot);
  const currentSrcRels = new Set(shippingItems.map(i => i.srcRel));

  log.header('Updating ai-kit');

  const stats = { unchanged: 0, updated: 0, restored: 0, localMod: 0, sidecar: 0, removed: 0 };
  const newFiles = {};
  const pendingIntegration = [...(manifest.pendingIntegration ?? [])];

  // Files no longer in ai-kit
  for (const srcRel of Object.keys(manifest.files)) {
    if (!currentSrcRels.has(srcRel)) {
      stats.removed++;
      log.warn(`  No longer in ai-kit (kept): ${manifest.files[srcRel].installedAs}`);
      newFiles[srcRel] = manifest.files[srcRel];
    }
  }

  for (const item of shippingItems) {
    const recorded = manifest.files[item.srcRel];
    const installedAs = recorded?.installedAs ?? item.targetRel ?? item.srcRel;
    const consumerAbs = join(consumerRoot, installedAs);
    const newSourceHash = hashFile(item.srcAbs);

    if (!exists(consumerAbs)) {
      copyFile(item.srcAbs, consumerAbs);
      newFiles[item.srcRel] = {
        ...(recorded ?? {}),
        sourceHash: newSourceHash,
        installedAs,
        role: item.role,
        ...(item.owner ? { owner: item.owner } : {}),
      };
      stats.restored++;
      log.info(`  restored: ${installedAs}`);
      continue;
    }

    if (!recorded) {
      // New file upstream
      copyFile(item.srcAbs, consumerAbs);
      newFiles[item.srcRel] = {
        sourceHash: newSourceHash, installedAs, role: item.role,
        ...(item.owner ? { owner: item.owner } : {}),
      };
      stats.updated++;
      log.dim(`  added: ${installedAs}`);
      continue;
    }

    const currentHash = hashFile(consumerAbs);
    const hasDrift = currentHash !== recorded.sourceHash;
    const upstreamChanged = newSourceHash !== recorded.sourceHash;

    if (!hasDrift) {
      if (upstreamChanged) {
        copyFile(item.srcAbs, consumerAbs);
        newFiles[item.srcRel] = { ...recorded, sourceHash: newSourceHash };
        stats.updated++;
        log.dim(`  updated: ${installedAs}`);
      } else {
        newFiles[item.srcRel] = recorded;
        stats.unchanged++;
      }
    } else {
      // Consumer has local edits
      if (!upstreamChanged) {
        newFiles[item.srcRel] = recorded;
        stats.localMod++;
        log.warn(`  locally modified (no upstream change): ${installedAs}`);
      } else {
        // Both sides changed — genuine conflict
        log.blank();
        log.warn(`  Conflict: ${installedAs}`);
        const consumerText = readFileSync(consumerAbs, 'utf8');
        const newText = readFileSync(item.srcAbs, 'utf8');
        console.log(render(lineDiff(consumerText, newText)));
        log.blank();

        let decision;
        if (flags?.yes) {
          decision = 'sidecar';
          log.info('  --yes: auto-sidecar (upstream version written alongside)');
        } else {
          decision = await choice(
            `  Resolve ${installedAs}?`,
            ['sidecar', 'keep', 'take-upstream']
          );
        }

        if (decision === 'take-upstream') {
          copyFile(item.srcAbs, consumerAbs);
          newFiles[item.srcRel] = { ...recorded, sourceHash: newSourceHash };
          stats.updated++;
          log.info(`  took upstream: ${installedAs}`);
        } else if (decision === 'sidecar') {
          const sidecarPath = installedAs + '.new';
          copyFile(item.srcAbs, join(consumerRoot, sidecarPath));
          newFiles[item.srcRel] = recorded; // original entry unchanged
          pendingIntegration.push({
            managedPath: installedAs,
            sidecarPath,
            reason: "update conflict — upstream change written to .new sidecar",
          });
          stats.sidecar++;
          log.warn(`  sidecar'd: ${sidecarPath}`);
        } else {
          newFiles[item.srcRel] = recorded;
          stats.localMod++;
          log.info(`  kept: ${installedAs}`);
        }
      }
    }
  }

  manifest.files = newFiles;
  manifest.source.commit = sha ?? 'unknown';
  manifest.source.commitShort = sha ? sha.slice(0, 7) : 'unknown';
  manifest.source.updatedAt = new Date().toISOString();
  manifest.pendingIntegration = pendingIntegration;

  writeManifest(consumerRoot, manifest, registry.manifestName);

  log.blank();
  log.success('Update complete');
  if (stats.updated)   log.info(`  updated  : ${stats.updated}`);
  if (stats.restored)  log.info(`  restored : ${stats.restored}`);
  if (stats.unchanged) log.dim (`  unchanged: ${stats.unchanged}`);
  if (stats.localMod)  log.warn(`  locally modified (kept): ${stats.localMod}`);
  if (stats.sidecar)   log.warn(`  conflicts sidecar'd: ${stats.sidecar}`);
  if (stats.removed)   log.warn(`  no longer in ai-kit: ${stats.removed}`);

  if (manifest.pendingIntegration.length > 0) {
    log.blank();
    log.warn(`${manifest.pendingIntegration.length} file(s) need integration — see docs/migration.md`);
  }
}

function buildShippingSet(installed, registry, aiKitRoot) {
  const items = [];

  for (const f of registry.baseFiles()) {
    const srcAbs = join(aiKitRoot, f);
    if (exists(srcAbs)) {
      items.push({ srcRel: f, srcAbs, role: registry.isWiringFile(f) ? 'wiring' : 'base' });
    }
  }

  for (const skillName of (installed.baseSkills ?? registry.baseSkills())) {
    const skillPath = registry.baseSkillPath(skillName);
    const skillAbs = join(aiKitRoot, skillPath);
    if (exists(skillAbs)) {
      for (const absFile of walkFiles(skillAbs)) {
        const srcRel = relative(aiKitRoot, absFile).replace(/\\/g, '/');
        items.push({ srcRel, srcAbs: absFile, role: 'skill', owner: skillName });
      }
    } else {
      log.warn(`Base skill "${skillName}" not found in ai-kit  — skipping.`);
    }
  }

  for (const agentId of (installed.baseAgents ?? registry.baseAgents())) {
    const agentInfo = registry.getAgentInfo(agentId);
    if (!agentInfo) { log.warn(`Base agent "${agentId}" not found in registry — skipping.`); continue; }
    const agentAbs = join(aiKitRoot, agentInfo.path);
    if (exists(agentAbs)) {
      items.push({ srcRel: agentInfo.path, srcAbs: agentAbs, role: 'agent', owner: agentId });
    }
  }

  for (const skillId of (installed.skills ?? [])) {
    const skillInfo = registry.getSkillInfo(skillId);
    if (!skillInfo) { log.warn(`Skill "${skillId}" not found in registry — skipping.`); continue; }
    const skillAbs = join(aiKitRoot, skillInfo.path);
    if (exists(skillAbs)) {
      const installDir = registry.optInSkillInstallDir(skillId);
      for (const absFile of walkFiles(skillAbs)) {
        const srcRel = relative(aiKitRoot, absFile).replace(/\\/g, '/');
        const tailRel = relative(skillAbs, absFile).replace(/\\/g, '/');
        const targetRel = posix.join(installDir, tailRel);
        items.push({ srcRel, srcAbs: absFile, role: 'skill', owner: skillId, targetRel });
      }
    }
  }

  for (const agentId of (installed.agents ?? [])) {
    const agentInfo = registry.getAgentInfo(agentId);
    if (!agentInfo) { log.warn(`Agent "${agentId}" not found in registry — skipping.`); continue; }
    const agentAbs = join(aiKitRoot, agentInfo.path);
    if (exists(agentAbs)) {
      items.push({ srcRel: agentInfo.path, srcAbs: agentAbs, role: 'agent', owner: agentId });
    }
  }

  // Dedupe by srcRel — a base agent may also appear in installed.agents.
  const seen = new Set();
  return items.filter(i => (seen.has(i.srcRel) ? false : (seen.add(i.srcRel), true)));
}
