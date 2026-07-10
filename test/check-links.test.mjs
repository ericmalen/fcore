import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { checkLinks } from '../.claude/skills/docs-manager/scripts/check-links.mjs';

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'aikit-links-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

test('check-links: resolving links pass, broken relative link is reported', () => {
  const repo = makeRepo({
    'README.md': '[ok](docs/how-to/a.md) and [bad](docs/missing.md)\n',
    'docs/how-to/a.md': '# H\n\n[up](../../README.md) [ext](https://x.example) [anchor](#h)\n',
  });
  try {
    const f = checkLinks(repo);
    assert.equal(f.length, 1, JSON.stringify(f));
    assert.equal(f[0].file, 'README.md');
    assert.equal(f[0].target, 'docs/missing.md');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('check-links: external URLs and inline-code paths are skipped', () => {
  const repo = makeRepo({
    'README.md': 'code `[x](nope.md)` and [real](sub/r.md)\n',
    'sub/r.md': 'ok\n',
  });
  try {
    assert.deepEqual(checkLinks(repo), []);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('check-links: broken anchors (same-file and cross-file) are reported, valid ones pass', () => {
  const repo = makeRepo({
    'README.md': [
      '# Title',
      '',
      '## Section One',
      '',
      '[self-ok](#section-one) [self-bad](#section-two)',
      '[cross-ok](docs/g.md#deep-dive) [cross-bad](docs/g.md#nope)',
    ].join('\n') + '\n',
    'docs/g.md': '# Deep Dive\n',
  });
  try {
    const anchors = checkLinks(repo).filter((x) => x.anchor).map((x) => x.target).sort();
    assert.deepEqual(anchors, ['#section-two', 'docs/g.md#nope']);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('check-links: duplicate/punctuated headings, explicit id, and non-md targets resolve', () => {
  const repo = makeRepo({
    'README.md': [
      '# R-07 · References resolve', // → r-07--references-resolve
      '',
      '## Dup',
      '## Dup',                       // second occurrence → dup-1
      '',
      '<a id="manual"></a>',
      '',
      '[a](#r-07--references-resolve) [b](#dup) [c](#dup-1) [d](#manual)',
      '[json](data.json#/whatever)',  // non-md target: fragment not checked
    ].join('\n') + '\n',
    'data.json': '{}\n',
  });
  try {
    assert.deepEqual(checkLinks(repo), []);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
