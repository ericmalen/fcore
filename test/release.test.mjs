import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  compareSemver, parseSemver, tagToSemver, latestCompatibleTag, npxSpecFromToolRepo,
  validateToolRepo, listRemoteTags, shallowCloneAt,
} from '../scripts/lib/release.mjs';

test('parseSemver accepts plain and v-prefixed versions', () => {
  assert.deepEqual(parseSemver('1.4.0'), { major: 1, minor: 4, patch: 0, prerelease: '', build: '', raw: '1.4.0' });
  assert.equal(tagToSemver('v1.4.0')?.raw, '1.4.0');
  assert.equal(parseSemver('abc'), null);
});

test('compareSemver orders releases', () => {
  assert.equal(compareSemver('1.3.0', '1.4.0'), -1);
  assert.equal(compareSemver('2.0.0', '1.9.9'), 1);
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
});

test('npxSpecFromToolRepo maps toolRepo URLs to npm package specs', () => {
  assert.equal(
    npxSpecFromToolRepo('https://github.com/ericmalen/fcore', 'v1.4.0'),
    'github:ericmalen/fcore#v1.4.0',
  );
  assert.equal(
    npxSpecFromToolRepo('https://github.com/ericmalen/fcore.git', 'v1.4.0'),
    'github:ericmalen/fcore#v1.4.0',
  );
  assert.equal(
    npxSpecFromToolRepo('git+https://github.com/ericmalen/fcore', 'v1.4.0'),
    'github:ericmalen/fcore#v1.4.0',
  );
  assert.equal(
    npxSpecFromToolRepo('https://dev.azure.com/org/proj/_git/fcore', 'v1.4.0'),
    'git+https://dev.azure.com/org/proj/_git/fcore#v1.4.0',
  );
  assert.equal(
    npxSpecFromToolRepo('git@github.com:ericmalen/fcore.git', 'v1.4.0'),
    'git+ssh://git@github.com/ericmalen/fcore.git#v1.4.0',
  );
  assert.equal(
    npxSpecFromToolRepo('https://github.com/ericmalen/fcore/', null),
    'github:ericmalen/fcore',
  );
});

test('validateToolRepo accepts the supported transport forms', () => {
  const ok = [
    'https://github.com/ericmalen/fcore',
    'git+https://github.com/ericmalen/fcore.git',
    'ssh://git@github.com/ericmalen/fcore.git',
    'git+ssh://git@github.com/ericmalen/fcore.git',
    'git@github.com:ericmalen/fcore.git',
    'file:///tmp/fcore',
    '/tmp/fcore', // absolute path (tests/dev flows)
  ];
  for (const url of ok) assert.equal(validateToolRepo(url), url, url);
});

test('validateToolRepo rejects injection vectors and malformed values', () => {
  const bad = [
    'ext::sh -c "touch /tmp/pwned"', // transport-helper syntax
    'fd::17', // transport-helper syntax
    '--upload-pack=touch /tmp/pwned', // leading dash parsed as a git option
    '-origin', // leading dash
    'relative/path/to/repo', // relative path
    './fcore', // relative path
    'https://example.com/\x00repo', // control character
    '', // empty
    42, // non-string
  ];
  for (const url of bad) {
    assert.throws(() => validateToolRepo(url), /toolRepo/, String(url));
  }
});

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
}

function seedFixtureRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'release-fixture-'));
  git(repo, 'init', '-q');
  git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  git(repo, 'tag', 'v1.0.0');
  return repo;
}

test('listRemoteTags and shallowCloneAt work against a local fixture repo', () => {
  const repo = seedFixtureRepo();
  const dest = join(mkdtempSync(join(tmpdir(), 'release-clone-')), 'co');
  try {
    const tags = listRemoteTags(repo);
    assert.deepEqual(tags.map((t) => t.tag), ['v1.0.0']);

    shallowCloneAt(repo, 'v1.0.0', dest);
    assert.ok(existsSync(join(dest, '.git')));
  } finally {
    for (const d of [repo, join(dest, '..')]) rmSync(d, { recursive: true, force: true });
  }
});

test('listRemoteTags and shallowCloneAt refuse a malicious toolRepo without spawning git', () => {
  assert.throws(() => listRemoteTags('ext::sh -c "touch /tmp/pwned"'), /toolRepo/);
  assert.throws(() => listRemoteTags('--upload-pack=touch /tmp/pwned'), /toolRepo/);
  assert.throws(() => shallowCloneAt('ext::sh -c "touch /tmp/pwned"', 'v1.0.0', '/tmp/x'), /toolRepo/);
  assert.throws(() => shallowCloneAt('--upload-pack=touch /tmp/pwned', 'v1.0.0', '/tmp/x'), /toolRepo/);
});

test('latestCompatibleTag stays on same major by default', () => {
  const tags = [
    { tag: 'v2.0.0', semver: parseSemver('2.0.0') },
    { tag: 'v1.4.0', semver: parseSemver('1.4.0') },
    { tag: 'v1.3.0', semver: parseSemver('1.3.0') },
  ];
  assert.equal(latestCompatibleTag(tags, 'v1.3.0'), 'v1.4.0');
  assert.equal(latestCompatibleTag(tags, 'v1.3.0', { allowMajor: true }), 'v2.0.0');
});

test('compareSemver orders prerelease identifiers per SemVer §11', () => {
  assert.equal(compareSemver('1.0.0-rc.9', '1.0.0-rc.10'), -1);
  assert.equal(compareSemver('1.0.0-2', '1.0.0-11'), -1);
  assert.equal(compareSemver('1.0.0-alpha', '1.0.0-alpha.1'), -1);
  assert.equal(compareSemver('1.0.0-1', '1.0.0-alpha'), -1); // numeric < alphanumeric
  assert.equal(compareSemver('1.0.0-rc.1', '1.0.0'), -1);
  assert.equal(compareSemver('1.0.0-rc.2', '1.0.0-rc.2'), 0);
});

test('parseSemver rejects leading zeros in the version core', () => {
  assert.equal(parseSemver('01.2.3'), null);
  assert.equal(parseSemver('1.02.3'), null);
  assert.equal(parseSemver('1.2.03'), null);
  assert.equal(parseSemver('0.2.3')?.raw, '0.2.3');
  assert.equal(parseSemver('10.20.30')?.raw, '10.20.30');
});
