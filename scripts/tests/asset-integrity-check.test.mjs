import assert from 'node:assert/strict';
import test from 'node:test';
import { collectReferences, compareDebt, findCollisions, legacyViolations, mapsEqual, validatePaths } from '../asset-integrity-check.mjs';

test('known missing debt is tolerated', () => assert.deepEqual(compareDebt(['assets/characters-v2/a/portrait/default.webp'], ['assets/characters-v2/a/portrait/default.webp']).fresh, []));
test('new missing debt fails comparison', () => assert.equal(compareDebt(['assets/characters-v2/a/portrait/default.webp'], []).fresh.length, 1));
test('resolved missing baseline entry passes and is reported', () => assert.equal(compareDebt([], ['assets/characters-v2/a/portrait/default.webp']).resolved.length, 1));
test('known unreferenced debt is tolerated', () => assert.deepEqual(compareDebt(['assets/characters-v2/a/fullbody/default.webp'], ['assets/characters-v2/a/fullbody/default.webp']).fresh, []));
test('new unreferenced debt fails comparison', () => assert.equal(compareDebt(['assets/characters-v2/a/fullbody/default.webp'], []).fresh.length, 1));
test('map parity mismatch fails', () => assert.equal(mapsEqual({ a: 1 }, { a: 2 }), false));
test('case-insensitive collision is found', () => assert.equal(findCollisions(['a/B.webp', 'a/b.webp']).length, 1));
test('Unicode-normalized collision is found', () => assert.equal(findCollisions(['a/caf\u00e9.webp', 'a/cafe\u0301.webp']).length, 1));
test('invalid portrait expression fails', () => assert.equal(validatePaths(['assets/characters-v2/a/portrait/grin.webp']).length, 1));
test('explicit null default is valid and ignored', () => assert.deepEqual(collectReferences({ default: null }), []));
test('empty expression map is valid', () => assert.deepEqual(collectReferences({ portrait: {} }), []));
test('unsupported and legacy active paths fail', () => {
  assert.equal(validatePaths(['assets/characters-v2/a/portrait/default.png']).length > 0, true);
  assert.equal(legacyViolations(['"/assets/characters-v2/a/portrait/default.png"']).length, 1);
});
