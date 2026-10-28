import test from 'node:test';
import assert from 'node:assert/strict';
import { hash, readJson, readText } from '../../scripts/lib.mjs';
import { checkHarness, validateRequirements } from '../../scripts/check-harness.mjs';
import { inspectBoundaries } from '../../scripts/check-boundaries.mjs';
import { validateManualReview } from '../../scripts/check-manual.mjs';
import { loadAdapter, validateAdapter } from '../product/load-adapter.mjs';
import { blockedTests } from '../../scripts/check-test-policy.mjs';

const policy = await readJson('harness/boundaries.json');
test('public documents, links, fixture hashes and requirement routes are consistent', async () => {
  assert.deepEqual(await checkHarness(), { documents: 3, fixtures: 10, modelFixtures: 6, bookFixtures: 18, requirements: 69 });
});
test('independent long-text expectation is exactly 100k code points', async () => {
  const source = await readText('fixtures/long-chapter.txt');
  const item = (await readJson('fixtures/manifest.json')).fixtures.find(item => item.id === 'long-chapter');
  assert.equal([...source].length, 100000); assert.equal(item.bodyLength, 100000); assert.equal(hash(source), item.bodySha256);
});
test('unicode fixture keeps combining marks, IVS and ZWJ, not silent NFC normalization', async () => {
  const source = await readText('fixtures/unicode.txt');
  assert.ok(source.includes('か\u3099')); assert.notEqual(source.normalize('NFC'), source);
  assert.ok(source.includes('葛\u{E0100}')); assert.ok(source.includes('👩‍💻'));
});
test('missing product implementation and empty adapters cannot pass', async () => {
  await assert.rejects(loadAdapter('tests/harness/never-implemented.mjs'), /PRODUCT_NOT_IMPLEMENTED/u);
  assert.throws(() => validateAdapter({}), /INVALID_ADAPTER/u);
});
test('focused, skipped, todo and empty tests cannot make a green completion', () => {
  assert.ok(blockedTests('test.skip("regression", () => assert(false));').length);
  assert.ok(blockedTests('test.only("regression", () => assert(false));').length);
  assert.ok(blockedTests('test("regression", { skip: true }, () => assert(false));').length);
  assert.ok(blockedTests('test("regression", () => {});').length);
  assert.deepEqual(blockedTests('test("real", () => assert.equal(1, 1)); const text = "test.skip";'), []);
});
test('forbidden layer import fails even when source syntax is valid', () => {
  const errors = inspectBoundaries([
    { path: 'src/typesetting/engine.ts', source: 'import { panel } from "../ui/panel.js"; export const engine = panel;' },
    { path: 'src/ui/panel.ts', source: 'export const panel = 1;' },
  ], policy);
  assert.ok(errors.some(error => error.includes('cannot depend on ui')));
});
test('pure typesetter cannot read browser globals, filesystem or computed modules', () => {
  const errors = inspectBoundaries([{ path: 'src/typesetting/bad.ts', source: 'import fs from "node:fs"; const x = window.document; const y = fetch("/leak"); import(x); export {x,y,fs};' }], policy);
  assert.ok(errors.some(error => error.includes('node:fs')));
  assert.ok(errors.some(error => error.includes('browser global window')));
  assert.ok(errors.some(error => error.includes('browser global fetch')));
  assert.ok(errors.some(error => error.includes('computed imports')));
});
test('bundled browser modules have an explicit IO boundary and unknown local modules remain rejected', () => {
  assert.deepEqual(inspectBoundaries([{ path: 'src/io/pdf.ts', source: 'export const load = () => import("../vendor/pdf-lib.js");' }], policy), []);
  assert.ok(inspectBoundaries([{ path: 'src/typesetting/pdf.ts', source: 'import "../vendor/pdf-lib.js";' }], policy).some(error => error.includes('cannot import a bundled io module')));
  assert.ok(inspectBoundaries([{ path: 'src/io/unknown.ts', source: 'import "../vendor/unknown.js";' }], policy).some(error => error.includes('unresolved local import')));
});
test('comments, string content, type fields and local parameters do not trigger false global errors', () => {
  assert.deepEqual(inspectBoundaries([{ path: 'src/domain/valid.ts', source: 'interface Project { document: string }; export function echo(document: string) { const text = "window.fetch"; /* window */ return document + text; }' }], policy), []);
});
test('missing, duplicate or unrouted requirements are rejected', () => {
  const valid = { id: 'R-test', phase: 'slice-1', summary: 'test', fixtures: ['basic'], automated: ['product'], manual: ['default-page-quality'] };
  assert.deepEqual(validateRequirements([valid], new Set(['basic'])), []);
  assert.ok(validateRequirements([valid, valid], new Set(['basic'])).some(error => error.includes('Duplicate')));
  assert.ok(validateRequirements([{ ...valid, fixtures: ['missing'] }], new Set(['basic'])).some(error => error.includes('unknown fixture')));
  assert.ok(validateRequirements([{ ...valid, automated: [] }], new Set(['basic'])).length);
});
test('unknown, incomplete and stale visual evidence cannot pass completion', async () => {
  const review = { items: Object.fromEntries(['default-page-quality', 'vertical-glyphs-and-spacing', 'mobile-usability', 'export-appearance', 'local-first'].map(name => [name, { status: 'unknown' }])) };
  assert.ok(validateManualReview(review, 'current-revision').length);
  const valid = { revision: 'current-revision', reviewer: 'QA', environment: 'fixed environment', items: Object.fromEntries(Object.keys(review.items).map(key => [key, { status: 'pass', evidence: 'output/evidence.png' }])) };
  assert.deepEqual(validateManualReview(valid, 'current-revision'), []);
  assert.ok(validateManualReview(valid, 'changed-revision').length);
  assert.ok(validateManualReview({ ...valid, items: {} }, 'current-revision').length);
});
