import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { run } from "../scripts/docs-consistency.mjs";

const KIT_ROOT = fileURLToPath(new URL("..", import.meta.url));

test("kit docs are consistent (no banned terms, no broken links)", () => {
  const findings = run(KIT_ROOT);
  assert.deepEqual(findings, []);
});

test("gate catches a seeded banned term and a seeded broken link", () => {
  const root = mkdtempSync(join(tmpdir(), "dc-seed-"));
  try {
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(
      join(root, "docs", "guide.md"),
      "Run `agent-base init` to start.\n\nSee [the plan](./missing.md).\n"
    );
    const findings = run(root);
    const checks = findings.map((f) => f.check).sort();
    assert.deepEqual(checks, ["banned-term", "broken-link"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("vendored (UPSTREAM) content is exempt", () => {
  const root = mkdtempSync(join(tmpdir(), "dc-exempt-"));
  try {
    mkdirSync(join(root, ".claude", "skills", "vendored"), { recursive: true });
    writeFileSync(join(root, ".claude", "skills", "vendored", "UPSTREAM"), "pinned");
    writeFileSync(join(root, ".claude", "skills", "vendored", "SKILL.md"), "uses sub-agent wording\n");
    assert.deepEqual(run(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("consumer-shipped templates beyond md/json are scanned (ci yml + gitignore)", () => {
  const root = mkdtempSync(join(tmpdir(), "dc-tpl-"));
  try {
    mkdirSync(join(root, "templates", "ci"), { recursive: true });
    writeFileSync(join(root, "templates", "ci", "gate.yml"), "# wire up bin/agent-base.mjs here\n");
    writeFileSync(join(root, "templates", "gitignore"), ".agent-base-migration-routing\n");
    const findings = run(root);
    const terms = findings.map((f) => f.term).sort();
    assert.deepEqual(terms, [".agent-base-migration-routing", "bin/agent-base.mjs"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("near-variant v1 vocabulary is banned (the CLI / new-agent / catalog/)", () => {
  const root = mkdtempSync(join(tmpdir(), "dc-var-"));
  try {
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "x.md"),
      "Ask the CLI to do it.\nUse new-agent to scaffold.\nLives in catalog/ now.\n");
    const findings = run(root);
    const terms = findings.map((f) => f.term).sort();
    assert.deepEqual(terms, ["catalog/", "new-agent", "the CLI"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
