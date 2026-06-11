#!/usr/bin/env node
// docs-consistency.mjs — guards kit docs against vocabulary drift.
//
// Two checks, zero dependencies:
//   1. Banned terms: v1 CLI / dropped-surface vocabulary must not reappear in
//      consumer-facing prose (spec/ is exempt — it DEFINES the dropped
//      surfaces).
//   2. Relative Markdown links resolve to existing files (the kit's own docs
//      are not covered by the R-07 audit, which checks adopted-repo surfaces).
//
// Usage: node scripts/docs-consistency.mjs [--root <dir>] [--json]
// Exit 0 = clean, 1 = findings.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const BANNED_TERMS = [
  "bin/agent-base.mjs",
  "agent-base init",
  "agent-base update",
  "agent-base audit",
  "agent-base.config.json",
  ".agent-base-migration-routing",
  "ai-kit",
  "greenfield",
  "brownfield",
  "adopt-inventory",
  "adopt-plan",
  "adopt-materialize",
  "adopt-verify",
  "ai-kit-adopt",
  "ai-kit-check",
  "ai-kit-orchestrate",
  "kit clone",
  "factory, not the house",
  "/optimize",
  "/migrate",
  "layer-agents",
  "/new-agent",
  ".github/prompts",
  ".prompt.md",
  "sub-agent",
  "the CLI", // v1 had a CLI; v2 distribution is install-setup.mjs
  "new-agent",
  "catalog/", // retired v1 zone (assets live under .claude/ now)
];

// (file, term) pairs that are deliberately allowed.
export const ALLOW = new Set([
  // documents the VS Code BUILT-IN /create-prompt, annotated as out-of-surface (R-54)
  "docs/reference/built-in-reference.md .prompt.md",
  // retired-term glossary — lists banned vocabulary on purpose
  "docs/reference/terminology.md ai-kit",
  "docs/reference/terminology.md greenfield",
  "docs/reference/terminology.md brownfield",
  "docs/reference/terminology.md kit clone",
]);

const SCAN_DIRS = ["docs", "templates", ".claude"];
const SCAN_FILES = ["README.md", "AGENTS.md", "CLAUDE.md"];
const LINK_EXTRA_DIRS = ["spec"]; // link-checked but exempt from banned terms

function isVendored(dir) {
  // a directory carrying an UPSTREAM provenance marker is held to upstream's
  // conventions (see spec/rules.md, vendored exemption) — skip it entirely.
  return existsSync(join(dir, "UPSTREAM"));
}

function* walk(dir, root) {
  if (isVendored(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    const rel = relative(root, p).split(sep).join("/");
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      yield* walk(p, root);
    } else if (
      e.name.endsWith(".md") || e.name.endsWith(".json")
      // consumer-shipped payload beyond md/json: CI templates + gitignore
      || (rel.startsWith("templates/") && (e.name.endsWith(".yml") || rel === "templates/gitignore"))
    ) {
      if (e.name === "settings.local.json") continue; // personal, gitignored
      yield rel;
    }
  }
}

export function collectFiles(root) {
  const files = [];
  for (const d of SCAN_DIRS) if (existsSync(join(root, d))) files.push(...walk(join(root, d), root));
  for (const f of SCAN_FILES) if (existsSync(join(root, f))) files.push(f);
  const linkOnly = [];
  for (const d of LINK_EXTRA_DIRS) if (existsSync(join(root, d))) linkOnly.push(...walk(join(root, d), root));
  return { files, linkOnly };
}

export function checkBannedTerms(root, files) {
  const findings = [];
  for (const rel of files) {
    const lines = readFileSync(join(root, rel), "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const term of BANNED_TERMS) {
        if (line.includes(term) && !ALLOW.has(rel + " " + term)) {
          findings.push({ check: "banned-term", file: rel, line: i + 1, term });
        }
      }
    });
  }
  return findings;
}

const LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;

export function checkLinks(root, files) {
  const findings = [];
  for (const rel of files) {
    if (!rel.endsWith(".md")) continue;
    const text = readFileSync(join(root, rel), "utf8");
    const lines = text.split("\n");
    let inFence = false;
    lines.forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return; }
      if (inFence) return;
      const prose = line.replace(/`[^`]*`/g, ""); // ignore inline-code examples
      for (const m of prose.matchAll(LINK_RE)) {
        let target = m[1];
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        target = target.split("#")[0];
        if (!target) continue;
        const abs = resolve(root, dirname(rel), decodeURIComponent(target));
        if (!existsSync(abs)) {
          findings.push({ check: "broken-link", file: rel, line: i + 1, term: m[1] });
        }
      }
    });
  }
  return findings;
}

export function run(root) {
  const { files, linkOnly } = collectFiles(root);
  return [
    ...checkBannedTerms(root, files),
    ...checkLinks(root, [...files, ...linkOnly]),
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const root = args.includes("--root") ? resolve(args[args.indexOf("--root") + 1]) : process.cwd();
  const findings = run(root);
  if (args.includes("--json")) {
    console.log(JSON.stringify({ root, findings }, null, 2));
  } else {
    for (const f of findings) console.error(`${f.file}:${f.line}: [${f.check}] ${f.term}`);
    console.error(findings.length ? `${findings.length} finding(s)` : "clean");
  }
  process.exit(findings.length ? 1 : 0);
}
