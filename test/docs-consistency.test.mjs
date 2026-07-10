import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { run } from "../scripts/docs-consistency.mjs";

const BASE_ROOT = fileURLToPath(new URL("..", import.meta.url));

test("FleetCore docs are consistent (no broken links)", () => {
  const findings = run(BASE_ROOT);
  assert.deepEqual(findings, []);
});

test("gate catches a seeded broken link; resolving links pass", () => {
  const root = mkdtempSync(join(tmpdir(), "dc-seed-"));
  try {
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "other.md"), "target\n");
    writeFileSync(
      join(root, "docs", "guide.md"),
      "See [the plan](./missing.md) and [a real file](./other.md).\n"
    );
    const findings = run(root);
    assert.deepEqual(findings.map((f) => ({ check: f.check, term: f.term })), [
      { check: "broken-link", term: "./missing.md" },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("vendored (UPSTREAM) content is exempt", () => {
  const root = mkdtempSync(join(tmpdir(), "dc-exempt-"));
  try {
    mkdirSync(join(root, ".claude", "skills", "vendored"), { recursive: true });
    writeFileSync(join(root, ".claude", "skills", "vendored", "UPSTREAM"), "pinned");
    writeFileSync(join(root, ".claude", "skills", "vendored", "SKILL.md"), "[gone](./nope.md)\n");
    assert.deepEqual(run(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gate catches broken anchors (same-file and cross-file); valid anchors pass", () => {
  const root = mkdtempSync(join(tmpdir(), "dc-anchor-"));
  try {
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "target.md"), "# Deep Dive\n");
    writeFileSync(
      join(root, "docs", "guide.md"),
      [
        "# Guide",
        "",
        "## Section One",
        "",
        "[ok-self](#section-one) [bad-self](#missing)",
        "[ok-cross](./target.md#deep-dive) [bad-cross](./target.md#gone)",
      ].join("\n") + "\n"
    );
    const findings = run(root).map((f) => ({ check: f.check, term: f.term }));
    assert.deepEqual(findings, [
      { check: "broken-anchor", term: "#missing" },
      { check: "broken-anchor", term: "./target.md#gone" },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("anchor resolution: duplicate/punctuated headings, explicit id, non-md target", () => {
  const root = mkdtempSync(join(tmpdir(), "dc-anchor-ok-"));
  try {
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "data.json"), "{}\n");
    writeFileSync(
      join(root, "docs", "x.md"),
      [
        "# R-07 · References resolve", // → r-07--references-resolve
        "",
        "## Dup",
        "## Dup", // second occurrence → dup-1
        "",
        '<a id="manual"></a>',
        "",
        "[a](#r-07--references-resolve) [b](#dup) [c](#dup-1) [d](#manual)",
        "[j](./data.json#/anything)", // non-md target: fragment not checked
      ].join("\n") + "\n"
    );
    assert.deepEqual(run(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("links inside code fences and inline code are ignored", () => {
  const root = mkdtempSync(join(tmpdir(), "dc-fence-"));
  try {
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "x.md"),
      "```\n[example](./not-checked.md)\n```\n\nUse `[link](./also-not.md)` as syntax.\n");
    assert.deepEqual(run(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
