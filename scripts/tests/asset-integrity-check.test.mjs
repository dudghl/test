import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { assessAssetChanges, assessProtectedUnreferenced, assessResolvedUnreferenced, collectReferences, collectSchemaReferences, compareBaselineGrowth, compareDebt, findCollisions, legacyViolations, mapsEqual, validateMapSemantics, validatePaths, validateReferenceOwnership } from '../asset-integrity-check.mjs';

test('known missing debt is tolerated', () => assert.deepEqual(compareDebt(['assets/characters-v2/a/portrait/default.webp'], ['assets/characters-v2/a/portrait/default.webp']).fresh, []));
test('new missing debt fails comparison', () => assert.equal(compareDebt(['assets/characters-v2/a/portrait/default.webp'], []).fresh.length, 1));
test('resolved missing baseline entry passes and is reported', () => assert.equal(compareDebt([], ['assets/characters-v2/a/portrait/default.webp']).resolved.length, 1));
test('known unreferenced debt is tolerated', () => assert.deepEqual(compareDebt(['assets/characters-v2/a/fullbody/default.webp'], ['assets/characters-v2/a/fullbody/default.webp']).fresh, []));
test('new unreferenced debt fails comparison', () => assert.equal(compareDebt(['assets/characters-v2/a/fullbody/default.webp'], []).fresh.length, 1));
test('resolved baseline unreferenced entry passes when it becomes referenced in place', () => {
  const path = 'assets/characters-v2/a/fullbody/default.webp';
  assert.deepEqual(assessResolvedUnreferenced([path], [path], [path], []).errors, []);
});
test('safe byte-preserving rename to a referenced path passes', () => {
  const oldPath = 'assets/characters-v2/bellian/portrait/default.webp';
  const newPath = 'assets/characters-v2/belian/portrait/default.webp';
  const result = assessResolvedUnreferenced([oldPath], [newPath], [newPath], [{ status: 'R100', oldPath, path: newPath }], () => true);
  assert.deepEqual(result.errors, []); assert.equal(result.safeRenames.length, 1);
});
test('actual deletion without replacement fails', () => {
  const path = 'assets/characters-v2/bellian/portrait/default.webp';
  assert.equal(assessResolvedUnreferenced([path], [], [], [{ status: 'D', path }]).errors.length, 1);
});
test('swapping nemesis and delpirem payloads fails character ownership', () => {
  const map = {
    nemesis: { default: '/assets/characters-v2/delpirem/portrait/default.webp' },
    delpirem: { default: '/assets/characters-v2/nemesis/portrait/default.webp' },
  };
  assert.equal(validateReferenceOwnership(map).length, 2);
});
test('same-PR missing debt and baseline addition still fails baseline growth', () => {
  const path = 'assets/characters-v2/nemesis/portrait/deleted.webp';
  const base = { knownMissingReferences: [], knownUnreferencedAssets: [] };
  const candidate = { knownMissingReferences: [path], knownUnreferencedAssets: [] };
  assert.deepEqual(compareDebt([path], candidate.knownMissingReferences).fresh, []);
  assert.deepEqual(compareBaselineGrowth(candidate, base).addedMissing, [path]);
});
test('same-PR deletion and unreferenced baseline addition still fails baseline growth', () => {
  const path = 'assets/characters-v2/nemesis/portrait/deleted.webp';
  const base = { knownMissingReferences: [], knownUnreferencedAssets: [] };
  const candidate = { knownMissingReferences: [], knownUnreferencedAssets: [path] };
  assert.deepEqual(compareBaselineGrowth(candidate, base).addedUnreferenced, [path]);
});
test('referenced asset and both map references deleted fails', () => {
  const oldPath = 'assets/characters-v2/nemesis/portrait/default.webp';
  assert.equal(assessAssetChanges([oldPath], [oldPath], [], [], [{ status: 'D', path: oldPath }]).errors.length, 1);
});
test('metadata-only removal leaving a tracked asset fails', () => {
  const oldPath = 'assets/characters-v2/nemesis/portrait/default.webp';
  assert.equal(assessAssetChanges([oldPath], [oldPath], [oldPath], [], []).errors.length, 1);
});
test('protected-base missing forward-declared reference removal fails', () => {
  const path = 'assets/characters-v2/future/portrait/default.webp';
  assert.equal(assessAssetChanges([], [path], [], [], []).errors.length, 1);
});
test('protected-base existing reference removal fails', () => {
  const path = 'assets/characters-v2/nemesis/portrait/default.webp';
  assert.equal(assessAssetChanges([path], [path], [path], [], []).errors.length, 1);
});
test('unchanged protected-base missing reference is tolerated', () => {
  const path = 'assets/characters-v2/future/portrait/default.webp';
  assert.deepEqual(assessAssetChanges([], [path], [], [path], []).errors, []);
});
test('ordinary referenced byte-identical rename passes', () => {
  const oldPath = 'assets/characters-v2/nemesis/support/event_old.webp'; const path = 'assets/characters-v2/nemesis/support/event_new.webp';
  const baseSlots = new Map([['nemesis.eventCG.intro', oldPath]]); const candidateSlots = new Map([['nemesis.eventCG.intro', path]]);
  assert.deepEqual(assessAssetChanges([oldPath], [oldPath], [path], [path], [{ status: 'R100', oldPath, path }], () => true, baseSlots, candidateSlots).errors, []);
});
test('ordinary referenced rename with changed bytes fails', () => {
  const oldPath = 'assets/characters-v2/nemesis/portrait/default.webp'; const path = 'assets/characters-v2/nemesis/portrait/smile.webp';
  assert.equal(assessAssetChanges([oldPath], [oldPath], [path], [path], [{ status: 'R099', oldPath, path }], () => false).errors.length > 0, true);
});
test('rename to an unreferenced destination fails', () => {
  const oldPath = 'assets/characters-v2/nemesis/portrait/default.webp'; const path = 'assets/characters-v2/nemesis/portrait/smile.webp';
  assert.equal(assessAssetChanges([oldPath], [oldPath], [path], [], [{ status: 'R100', oldPath, path }], () => true).errors.length > 0, true);
});
test('protected known-unreferenced asset and candidate baseline entry deletion fails', () => {
  const path = 'assets/characters-v2/bellian/portrait/default.webp';
  assert.equal(assessProtectedUnreferenced([path], [path], [], []).length, 1);
});
test('protected known-unreferenced asset remaining tracked passes', () => {
  const path = 'assets/characters-v2/bellian/portrait/default.webp';
  assert.deepEqual(assessProtectedUnreferenced([path], [path], [path], []), []);
});
test('protected known-unreferenced verified canonical rename passes', () => {
  const path = 'assets/characters-v2/bellian/portrait/default.webp'; const destination = 'assets/characters-v2/belian/portrait/default.webp';
  assert.deepEqual(assessProtectedUnreferenced([path], [path], [destination], [path], [{ status: 'R100', oldPath: path, path: destination }], [destination]), []);
});
test('referenced default to smile rename with metadata migration fails', () => {
  const oldPath = 'assets/characters-v2/artemis/portrait/default.webp'; const path = 'assets/characters-v2/artemis/portrait/smile.webp';
  const baseSlots = new Map([['artemis.default', oldPath]]); const candidateSlots = new Map([['artemis.portrait.smile', path]]);
  assert.equal(assessAssetChanges([oldPath], [oldPath], [path], [path], [{ status: 'R100', oldPath, path }], () => true, baseSlots, candidateSlots).errors.length > 0, true);
});
test('referenced smile to blush rename fails semantic slot preservation', () => {
  const oldPath = 'assets/characters-v2/nemesis/portrait/smile.webp'; const path = 'assets/characters-v2/nemesis/portrait/blush.webp';
  const baseSlots = new Map([['nemesis.portrait.smile', oldPath]]); const candidateSlots = new Map([['nemesis.portrait.blush', path]]);
  assert.equal(assessAssetChanges([oldPath], [oldPath], [path], [path], [{ status: 'R100', oldPath, path }], () => true, baseSlots, candidateSlots).errors.length > 0, true);
});
test('same-slot byte-identical event path rename passes', () => {
  const oldPath = 'assets/characters-v2/nemesis/support/event_old.webp'; const path = 'assets/characters-v2/nemesis/support/event_new.webp';
  const baseSlots = new Map([['nemesis.eventCG.intro', oldPath]]); const candidateSlots = new Map([['nemesis.eventCG.intro', path]]);
  assert.deepEqual(assessAssetChanges([oldPath], [oldPath], [path], [path], [{ status: 'R100', oldPath, path }], () => true, baseSlots, candidateSlots).errors, []);
});
test('bellian canonical cleanup resolves protected missing equivalent path', () => {
  const oldPath = 'assets/characters-v2/bellian/portrait/smile.webp'; const path = 'assets/characters-v2/belian/portrait/smile.webp';
  const changes = [{ status: 'R100', oldPath, path }]; const asset = assessAssetChanges([oldPath], [path], [path], [path], changes, () => true);
  assert.deepEqual(asset.errors, []); assert.deepEqual(assessProtectedUnreferenced([oldPath], [oldPath], [path], asset.safeRenames, changes, [path]), []);
});
test('bellian rename to unrelated character path fails protected replacement policy', () => {
  const oldPath = 'assets/characters-v2/bellian/portrait/smile.webp'; const path = 'assets/characters-v2/nemesis/portrait/smile.webp';
  const changes = [{ status: 'R100', oldPath, path }];
  assert.equal(assessProtectedUnreferenced([oldPath], [oldPath], [path], [oldPath], changes, []).length, 1);
});
test('workflow is PR-only and uses only the PR base SHA', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/asset-integrity.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^\s*pull_request:\s*$/m); assert.doesNotMatch(workflow, /workflow_dispatch/);
  assert.match(workflow, /github\.event\.pull_request\.base\.sha/); assert.doesNotMatch(workflow, /HEAD\^|github\.sha|\|\|/);
  assert.match(workflow, /git diff --check "\$ASSET_INTEGRITY_DIFF_BASE\.\.\.HEAD"/);
  assert.doesNotMatch(workflow, /^\s*run: git diff --check\s*$/m);
});
const semanticCharacter = (overrides = {}) => ({
  default: '/assets/characters-v2/nemesis/portrait/default.webp',
  fullbodyDefault: '/assets/characters-v2/nemesis/fullbody/default.webp',
  portrait: { smile: '/assets/characters-v2/nemesis/portrait/smile.webp', blush: '/assets/characters-v2/nemesis/portrait/blush.webp' },
  supportAnchors: { front_3q: '/assets/characters-v2/nemesis/support/front_3q.webp' }, eventCG: {}, ...overrides,
});
test('smile and blush semantic slot swap fails', () => {
  const character = semanticCharacter({ portrait: { smile: '/assets/characters-v2/nemesis/portrait/blush.webp', blush: '/assets/characters-v2/nemesis/portrait/smile.webp' } });
  assert.equal(validateMapSemantics({ nemesis: character }).length, 2);
});
test('correct semantic expression paths pass', () => assert.deepEqual(validateMapSemantics({ nemesis: semanticCharacter() }), []));
test('portrait smile in the canonical schema slot is collected and passes', () => {
  const map = { nemesis: semanticCharacter() };
  assert.equal(validateMapSemantics(map).length, 0); assert.equal(collectSchemaReferences(map).includes('assets/characters-v2/nemesis/portrait/smile.webp'), true);
});
test('asset path moved to unknown top-level smileAsset fails and is not collected', () => {
  const path = '/assets/characters-v2/nemesis/portrait/smile.webp';
  const map = { nemesis: semanticCharacter({ portrait: {}, smileAsset: path }) };
  assert.equal(validateMapSemantics(map).length, 1); assert.equal(collectSchemaReferences(map).includes(path.slice(1)), false);
});
test('unknown nested portrait asset-bearing field fails', () => {
  const character = semanticCharacter({ portrait: { smileAsset: '/assets/characters-v2/nemesis/portrait/smile.webp' } });
  const map = { nemesis: character };
  assert.equal(validateMapSemantics(map).length, 1); assert.deepEqual(collectSchemaReferences(map), [
    'assets/characters-v2/nemesis/portrait/default.webp', 'assets/characters-v2/nemesis/fullbody/default.webp',
    'assets/characters-v2/nemesis/support/front_3q.webp',
  ]);
});
test('canonical non-reference structure remains allowed', () => {
  assert.deepEqual(validateMapSemantics({ nemesis: semanticCharacter({ eventCG: {} }) }), []);
});
test('explicit null semantic default passes', () => assert.deepEqual(validateMapSemantics({ nemesis: semanticCharacter({ default: null }) }), []));
test('empty semantic expression map passes', () => assert.deepEqual(validateMapSemantics({ nemesis: semanticCharacter({ portrait: {} }) }), []));
test('incorrect fullbody slot path fails', () => assert.equal(validateMapSemantics({ nemesis: semanticCharacter({ fullbodyDefault: '/assets/characters-v2/nemesis/portrait/default.webp' }) }).length, 1));
test('incorrect support key path fails', () => assert.equal(validateMapSemantics({ nemesis: semanticCharacter({ supportAnchors: { front_3q: '/assets/characters-v2/nemesis/support/back_3q.webp' } }) }).length, 1));
test('/asset path in an asset slot fails', () => assert.equal(validateMapSemantics({ nemesis: semanticCharacter({ default: '/asset/characters-v2/nemesis/portrait/default.webp' }) }).length, 1));
test('malformed root in an asset slot fails', () => assert.equal(validateMapSemantics({ nemesis: semanticCharacter({ default: '/characters-v2/nemesis/portrait/default.webp' }) }).length, 1));
test('canonical root-relative asset slot passes', () => assert.deepEqual(validateMapSemantics({ nemesis: semanticCharacter() }), []));
test('external URL in an asset slot fails', () => assert.equal(validateMapSemantics({ nemesis: semanticCharacter({ default: 'https://example.com/default.webp' }) }).length, 1));
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
