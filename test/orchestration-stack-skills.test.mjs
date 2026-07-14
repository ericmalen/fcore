import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchStackSkills } from '../scripts/lib/orchestration/stack-skills.mjs';

const profile = (stacks) => ({
  layers: stacks.map((stack, i) => ({ name: `layer-${i}`, path: '.', stack })),
});

const catalog = (skills) => ({ schemaVersion: 1, skills });

test('matchStackSkills: a layer stack containing the evidence keyword matches', () => {
  const p = profile(['React + TypeScript + Vite']);
  const c = catalog({ 'react-patterns': { stackEvidence: ['react'] } });
  assert.deepEqual(matchStackSkills(p, c), ['react-patterns']);
});

test('matchStackSkills: matching is case-insensitive', () => {
  const p = profile(['REACT + TypeScript']);
  const c = catalog({ 'react-patterns': { stackEvidence: ['React'] } });
  assert.deepEqual(matchStackSkills(p, c), ['react-patterns']);
});

test('matchStackSkills: no evidence hit → no match', () => {
  const p = profile(['Express + TypeScript']);
  const c = catalog({ 'react-patterns': { stackEvidence: ['react'] } });
  assert.deepEqual(matchStackSkills(p, c), []);
});

test('matchStackSkills: notEvidence excludes a match on the SAME layer (React Native vs React)', () => {
  const p = profile(['React Native + Expo']);
  const c = catalog({ 'react-patterns': { stackEvidence: ['react'], notEvidence: ['react native', 'expo'] } });
  assert.deepEqual(matchStackSkills(p, c), []);
});

test('matchStackSkills: notEvidence on one layer does not suppress a genuine match on another', () => {
  const p = profile(['React + TypeScript + Vite', 'React Native + Expo']);
  const c = catalog({ 'react-patterns': { stackEvidence: ['react'], notEvidence: ['react native', 'expo'] } });
  assert.deepEqual(matchStackSkills(p, c), ['react-patterns']);
});

test('matchStackSkills: multiple catalog entries, sorted output, dedup across layers', () => {
  const p = profile(['ASP.NET Core Web API', 'ASP.NET Core Web API (xUnit)']);
  const c = catalog({
    'csharp-testing': { stackEvidence: ['xunit'] },
    'dotnet-patterns': { stackEvidence: ['asp.net', '.net'] },
  });
  assert.deepEqual(matchStackSkills(p, c), ['csharp-testing', 'dotnet-patterns']);
});

test('matchStackSkills: empty catalog or empty profile layers → no matches', () => {
  assert.deepEqual(matchStackSkills(profile(['React']), catalog({})), []);
  assert.deepEqual(matchStackSkills({ layers: [] }, catalog({ x: { stackEvidence: ['react'] } })), []);
});

test('matchStackSkills: missing stackEvidence/notEvidence on an entry is treated as empty', () => {
  const p = profile(['React']);
  const c = catalog({ 'no-evidence': {} });
  assert.deepEqual(matchStackSkills(p, c), []);
});

test('matchStackSkills: boundary matching — react does not match preact/reactstrap/reactive', () => {
  const c = catalog({ 'react-patterns': { stackEvidence: ['react'] } });
  assert.deepEqual(matchStackSkills(profile(['Preact + TypeScript']), c), []);
  assert.deepEqual(matchStackSkills(profile(['Bootstrap via reactstrap']), c), []);
  assert.deepEqual(matchStackSkills(profile(['Reactive programming with RxJS']), c), []);
  assert.deepEqual(matchStackSkills(profile(['reaction-diffusion simulator']), c), []);
});

test('matchStackSkills: boundary matching — react still matches React Native (then notEvidence excludes)', () => {
  const evidenceOnly = catalog({ 'react-patterns': { stackEvidence: ['react'] } });
  assert.deepEqual(matchStackSkills(profile(['React Native + Expo']), evidenceOnly), ['react-patterns']);
  const withNot = catalog({ 'react-patterns': { stackEvidence: ['react'], notEvidence: ['react native', 'expo'] } });
  assert.deepEqual(matchStackSkills(profile(['React Native + Expo']), withNot), []);
});

test('matchStackSkills: boundary matching — .net matches ASP.NET Core but not internet', () => {
  const c = catalog({ 'dotnet-patterns': { stackEvidence: ['.net'] } });
  assert.deepEqual(matchStackSkills(profile(['ASP.NET Core Web API']), c), ['dotnet-patterns']);
  assert.deepEqual(matchStackSkills(profile(['internet-of-things gateway']), c), []);
});
