import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { assessApprovedCanonicalMigration, assessAssetChanges, assessProtectedUnreferenced, assessResolvedUnreferenced, collectReferences, collectSchemaReferences, compareBaselineGrowth, compareDebt, findCollisions, legacyViolations, mapsEqual, validateMapSemantics, validatePaths, validateProtectedStructure, validateReferenceOwnership } from '../asset-integrity-check.mjs';

const bellianPayload = (key) => ({
  default: `/assets/characters-v2/${key}/portrait/default.webp`,
  fullbodyDefault: `/assets/characters-v2/${key}/fullbody/default.webp`,
  portrait: Object.fromEntries(['smile','blush','serious','angry','sad','shock','smug','annoyed','worried','confused','laugh','flustered'].map((expression) => [expression, `/assets/characters-v2/${key}/portrait/${expression}.webp`])),
  supportAnchors: {}, eventCG: {},
});
const bellianMigrationFixture = () => {
  const baseMap = { belian: bellianPayload('belian') };
  const candidateMap = { bellian: bellianPayload('bellian') };
  const source = collectSchemaReferences(baseMap);
  const destination = collectSchemaReferences(candidateMap);
  const unrelatedMissing = 'assets/characters-v2/future/portrait/default.webp';
  const baseBaseline = { knownMissingReferences: [unrelatedMissing, ...source], knownUnreferencedAssets: destination };
  const candidateBaseline = { knownMissingReferences: [unrelatedMissing], knownUnreferencedAssets: [] };
  return { baseMap, candidateMap, baseBaseline, candidateBaseline, tracked: destination };
};
const pendingMigrationFixture = (sourceKey, destinationKey) => {
  const baseMap = { [sourceKey]: bellianPayload(sourceKey) };
  const candidateMap = { [destinationKey]: bellianPayload(destinationKey) };
  const source = collectSchemaReferences(baseMap);
  const destination = collectSchemaReferences(candidateMap);
  const unrelatedMissing = 'assets/characters-v2/future/portrait/default.webp';
  return {
    baseMap, candidateMap, tracked: [],
    baseBaseline: { knownMissingReferences: [unrelatedMissing, ...source], knownUnreferencedAssets: [] },
    candidateBaseline: { knownMissingReferences: [unrelatedMissing, ...destination], knownUnreferencedAssets: [] },
  };
};
const assessPending = (fixture) => assessApprovedCanonicalMigration(
  fixture.baseMap, fixture.candidateMap, fixture.baseBaseline, fixture.candidateBaseline, fixture.tracked, [],
);
const mirabelleMigrationFixture = () => {
  const baseMap = { mirabel: bellianPayload('mirabel') };
  const candidateMap = { mirabelle: bellianPayload('mirabelle') };
  const source = collectSchemaReferences(baseMap);
  const tracked = collectSchemaReferences(candidateMap);
  const changes = source.map((oldPath, index) => ({ status: 'R100', oldPath, path: tracked[index] }));
  const baseline = { knownMissingReferences: ['assets/characters-v2/future/portrait/default.webp'], knownUnreferencedAssets: [] };
  return { baseMap, candidateMap, baseBaseline: structuredClone(baseline), candidateBaseline: structuredClone(baseline), tracked, changes };
};
const assessMirabelle = (fixture, parity = true, bytesEqual = () => true) => assessApprovedCanonicalMigration(
  fixture.baseMap, fixture.candidateMap, fixture.baseBaseline, fixture.candidateBaseline, fixture.tracked, fixture.changes, parity, bytesEqual,
);

test('exact belian to bellian canonical migration passes', () => {
  const fixture = bellianMigrationFixture();
  assert.equal(assessApprovedCanonicalMigration(fixture.baseMap, fixture.candidateMap, fixture.baseBaseline, fixture.candidateBaseline, fixture.tracked, []).approved, true);
});
test('belian migration with one expression removed fails', () => {
  const fixture = bellianMigrationFixture(); delete fixture.candidateMap.bellian.portrait.smile;
  assert.equal(assessApprovedCanonicalMigration(fixture.baseMap, fixture.candidateMap, fixture.baseBaseline, fixture.candidateBaseline, fixture.tracked, []).approved, false);
});
test('belian migration with smile and blush swapped fails', () => {
  const fixture = bellianMigrationFixture();
  [fixture.candidateMap.bellian.portrait.smile, fixture.candidateMap.bellian.portrait.blush] = [fixture.candidateMap.bellian.portrait.blush, fixture.candidateMap.bellian.portrait.smile];
  assert.equal(assessApprovedCanonicalMigration(fixture.baseMap, fixture.candidateMap, fixture.baseBaseline, fixture.candidateBaseline, fixture.tracked, []).approved, false);
});
test('belian migration to unrelated key fails', () => {
  const fixture = bellianMigrationFixture(); fixture.candidateMap = { nemesis: fixture.candidateMap.bellian };
  assert.equal(assessApprovedCanonicalMigration(fixture.baseMap, fixture.candidateMap, fixture.baseBaseline, fixture.candidateBaseline, fixture.tracked, []).approved, false);
});
test('belian and bellian both present fails migration', () => {
  const fixture = bellianMigrationFixture(); fixture.candidateMap.belian = structuredClone(fixture.baseMap.belian);
  assert.equal(assessApprovedCanonicalMigration(fixture.baseMap, fixture.candidateMap, fixture.baseBaseline, fixture.candidateBaseline, fixture.tracked, []).approved, false);
});
test('belian migration to wrong destination root fails', () => {
  const fixture = bellianMigrationFixture(); fixture.candidateMap.bellian.default = '/assets/characters-v2/nemesis/portrait/default.webp';
  assert.equal(assessApprovedCanonicalMigration(fixture.baseMap, fixture.candidateMap, fixture.baseBaseline, fixture.candidateBaseline, fixture.tracked, []).approved, false);
});
test('belian migration with unrelated baseline entry changed fails', () => {
  const fixture = bellianMigrationFixture(); fixture.candidateBaseline.knownMissingReferences = [];
  assert.equal(assessApprovedCanonicalMigration(fixture.baseMap, fixture.candidateMap, fixture.baseBaseline, fixture.candidateBaseline, fixture.tracked, []).approved, false);
});
test('exact Bellian baseline shrink passes', () => {
  const fixture = bellianMigrationFixture();
  assert.deepEqual(assessApprovedCanonicalMigration(fixture.baseMap, fixture.candidateMap, fixture.baseBaseline, fixture.candidateBaseline, fixture.tracked, []).errors, []);
});
test('migrated Bellian has 14 resolved references and no unreferenced assets', () => {
  const repo = new URL('../..', import.meta.url);
  const map = JSON.parse(readFileSync(new URL('../../assets/characterImagesV2.json', import.meta.url), 'utf8'));
  const references = collectSchemaReferences({ bellian: map.bellian });
  const tracked = execFileSync('git', ['ls-files', 'assets/characters-v2/bellian/*.webp', 'assets/characters-v2/bellian/**/*.webp'], { cwd: repo }).toString().trim().split('\n').filter(Boolean);
  assert.equal(references.length, 14); assert.equal(references.every((reference) => existsSync(new URL(`../../${reference}`, import.meta.url))), true);
  assert.deepEqual(tracked.filter((asset) => !references.includes(asset)), []);
});

test('exact karne to carne forward-declaration and baseline migration passes', () => {
  assert.equal(assessPending(pendingMigrationFixture('karne', 'carne')).approved, true);
});
test('karne migration to an unrelated key fails', () => {
  const fixture = pendingMigrationFixture('karne', 'carne'); fixture.candidateMap = { unrelated: fixture.candidateMap.carne };
  assert.equal(assessPending(fixture).approved, false);
});
test('carne migration with an expression removed fails', () => {
  const fixture = pendingMigrationFixture('karne', 'carne'); delete fixture.candidateMap.carne.portrait.smile;
  assert.equal(assessPending(fixture).approved, false);
});
test('carne migration with semantic slots swapped fails', () => {
  const fixture = pendingMigrationFixture('karne', 'carne');
  [fixture.candidateMap.carne.portrait.smile, fixture.candidateMap.carne.portrait.blush] = [fixture.candidateMap.carne.portrait.blush, fixture.candidateMap.carne.portrait.smile];
  assert.equal(assessPending(fixture).approved, false);
});
test('removing old karne baseline debt without the carne equivalent fails', () => {
  const fixture = pendingMigrationFixture('karne', 'carne'); fixture.candidateBaseline.knownMissingReferences.pop();
  assert.equal(assessPending(fixture).approved, false);
});
test('adding carne baseline debt without matching old karne debt fails', () => {
  const fixture = pendingMigrationFixture('karne', 'carne'); fixture.baseBaseline.knownMissingReferences.pop();
  assert.equal(assessPending(fixture).approved, false);
});
test('exact pria to fria forward-declaration and baseline migration passes', () => {
  assert.equal(assessPending(pendingMigrationFixture('pria', 'fria')).approved, true);
});
test('pria migration to an unrelated key fails', () => {
  const fixture = pendingMigrationFixture('pria', 'fria'); fixture.candidateMap = { unrelated: fixture.candidateMap.fria };
  assert.equal(assessPending(fixture).approved, false);
});
test('fria migration with semantic structure changed fails', () => {
  const fixture = pendingMigrationFixture('pria', 'fria'); fixture.candidateMap.fria.supportAnchors = { sitting: '/assets/characters-v2/fria/support/sitting.webp' };
  assert.equal(assessPending(fixture).approved, false);
});
test('fria migration with baseline debt growth fails', () => {
  const fixture = pendingMigrationFixture('pria', 'fria'); fixture.candidateBaseline.knownMissingReferences.push('assets/characters-v2/fria/support/sitting.webp');
  assert.equal(assessPending(fixture).approved, false);
});
test('arbitrary key migrations are not approved', () => {
  assert.equal(assessPending(pendingMigrationFixture('typo', 'canonical')).approved, false);
});
test('exact mirabel to mirabelle metadata and byte-identical folder rename passes', () => {
  assert.equal(assessMirabelle(mirabelleMigrationFixture()).approved, true);
});
test('mirabel metadata rename without physical folder rename fails', () => {
  const fixture = mirabelleMigrationFixture(); fixture.changes = []; fixture.tracked = collectSchemaReferences(fixture.baseMap);
  assert.equal(assessMirabelle(fixture).approved, false);
});
test('mirabel physical rename without metadata update fails', () => {
  const fixture = mirabelleMigrationFixture(); fixture.candidateMap = structuredClone(fixture.baseMap);
  assert.equal(assessMirabelle(fixture).approved, false);
});
test('mirabel rename with changed image bytes fails', () => {
  const fixture = mirabelleMigrationFixture(); const changed = fixture.changes[0].oldPath;
  assert.equal(assessMirabelle(fixture, true, (oldPath) => oldPath !== changed).approved, false);
});
test('mirabel rename with one image missing fails', () => {
  const fixture = mirabelleMigrationFixture(); fixture.tracked.pop(); fixture.changes.pop();
  assert.equal(assessMirabelle(fixture).approved, false);
});
test('mirabel migration to unrelated key fails', () => {
  const fixture = mirabelleMigrationFixture(); fixture.candidateMap = { unrelated: fixture.candidateMap.mirabelle };
  assert.equal(assessMirabelle(fixture).approved, false);
});
test('mirabel and mirabelle both present fails', () => {
  const fixture = mirabelleMigrationFixture(); fixture.candidateMap.mirabel = structuredClone(fixture.baseMap.mirabel);
  assert.equal(assessMirabelle(fixture).approved, false);
});
test('mirabelle migration with one expression removed fails', () => {
  const fixture = mirabelleMigrationFixture(); delete fixture.candidateMap.mirabelle.portrait.smile;
  assert.equal(assessMirabelle(fixture).approved, false);
});
test('mirabelle migration with smile and blush swapped fails', () => {
  const fixture = mirabelleMigrationFixture();
  [fixture.candidateMap.mirabelle.portrait.smile, fixture.candidateMap.mirabelle.portrait.blush] = [fixture.candidateMap.mirabelle.portrait.blush, fixture.candidateMap.mirabelle.portrait.smile];
  assert.equal(assessMirabelle(fixture).approved, false);
});
test('mirabelle migration to wrong destination root fails', () => {
  const fixture = mirabelleMigrationFixture(); fixture.candidateMap.mirabelle.default = '/assets/characters-v2/lucia/portrait/default.webp';
  assert.equal(assessMirabelle(fixture).approved, false);
});
test('mirabelle migration requires no baseline change when there is no related debt', () => {
  const fixture = mirabelleMigrationFixture();
  assert.deepEqual(fixture.candidateBaseline, fixture.baseBaseline); assert.equal(assessMirabelle(fixture).approved, true);
});
test('mirabelle migration still enforces JSON and TypeScript parity', () => {
  assert.equal(assessMirabelle(mirabelleMigrationFixture(), false).approved, false);
});
test('both pending migrations preserve the total missing-debt count', () => {
  const carne = pendingMigrationFixture('karne', 'carne');
  const fria = pendingMigrationFixture('pria', 'fria');
  const fixture = {
    baseMap: { ...carne.baseMap, ...fria.baseMap }, candidateMap: { ...carne.candidateMap, ...fria.candidateMap }, tracked: [],
    baseBaseline: { knownMissingReferences: [...carne.baseBaseline.knownMissingReferences, ...fria.baseBaseline.knownMissingReferences.slice(1)], knownUnreferencedAssets: [] },
    candidateBaseline: { knownMissingReferences: [...carne.candidateBaseline.knownMissingReferences, ...fria.candidateBaseline.knownMissingReferences.slice(1)], knownUnreferencedAssets: [] },
  };
  assert.equal(assessPending(fixture).approved, true);
  assert.equal(fixture.candidateBaseline.knownMissingReferences.length, fixture.baseBaseline.knownMissingReferences.length);
});
test('repository canonical pending identities preserve debt, assets, and protected characters', () => {
  const map = JSON.parse(readFileSync(new URL('../../assets/characterImagesV2.json', import.meta.url), 'utf8'));
  const baseline = JSON.parse(readFileSync(new URL('../asset-integrity-baseline.json', import.meta.url), 'utf8'));
  assert.equal(baseline.knownMissingReferences.length, 148);
  assert.deepEqual(baseline.knownUnreferencedAssets, []);
  for (const key of ['carne', 'fria', 'lucia', 'bellian', 'mirabelle']) assert.equal(Object.hasOwn(map, key), true);
  for (const key of ['karne', 'pria', 'belian', 'mirabel']) assert.equal(Object.hasOwn(map, key), false);
  for (const key of ['carne', 'fria']) {
    assert.equal(existsSync(new URL(`../../assets/characters-v2/${key}`, import.meta.url)), false);
    assert.equal(baseline.knownMissingReferences.some((reference) => reference.startsWith(`assets/characters-v2/${key}/`)), true);
  }
  const mirabelleReferences = collectSchemaReferences({ mirabelle: map.mirabelle });
  assert.equal(mirabelleReferences.length, 14);
  assert.equal(mirabelleReferences.every((reference) => existsSync(new URL(`../../${reference}`, import.meta.url))), true);
});

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
const protectedStructureCharacter = (overrides = {}) => ({
  default: null, fullbodyDefault: '/assets/characters-v2/anastasia/fullbody/default.webp',
  portrait: {}, supportAnchors: {}, eventCG: {}, ...overrides,
});
test('protected explicit null default preserved passes structure validation', () => {
  const base = { anastasia: protectedStructureCharacter() }; const candidate = { anastasia: protectedStructureCharacter() };
  assert.deepEqual(validateProtectedStructure(base, candidate), []);
});
test('protected explicit null default removal fails structure validation', () => {
  const base = { anastasia: protectedStructureCharacter() }; const candidatePayload = protectedStructureCharacter(); delete candidatePayload.default;
  assert.equal(validateProtectedStructure(base, { anastasia: candidatePayload }).length, 1);
});
test('protected empty portrait removal fails structure validation', () => {
  const base = { anastasia: protectedStructureCharacter() }; const candidatePayload = protectedStructureCharacter(); delete candidatePayload.portrait;
  assert.equal(validateProtectedStructure(base, { anastasia: candidatePayload }).length, 1);
});
test('protected empty support and event maps cannot be removed', () => {
  const base = { anastasia: protectedStructureCharacter() }; const candidatePayload = protectedStructureCharacter();
  delete candidatePayload.supportAnchors; delete candidatePayload.eventCG;
  assert.equal(validateProtectedStructure(base, { anastasia: candidatePayload }).length, 2);
});
test('protected expression key removal fails structure validation', () => {
  const smile = '/assets/characters-v2/nemesis/portrait/smile.webp';
  const base = { nemesis: protectedStructureCharacter({ portrait: { smile } }) };
  const candidate = { nemesis: protectedStructureCharacter({ portrait: {} }) };
  assert.equal(validateProtectedStructure(base, candidate).length, 1);
});
test('adding a valid expression key does not fail protected structure', () => {
  const smile = '/assets/characters-v2/nemesis/portrait/smile.webp';
  const base = { nemesis: protectedStructureCharacter({ portrait: {} }) };
  const candidate = { nemesis: protectedStructureCharacter({ portrait: { smile } }) };
  assert.deepEqual(validateProtectedStructure(base, candidate), []);
});
test('synchronized JSON and TS structural corruption still fails', () => {
  const base = { anastasia: protectedStructureCharacter() }; const corruptPayload = protectedStructureCharacter(); delete corruptPayload.default;
  const corruptJson = { anastasia: corruptPayload }; const corruptTs = structuredClone(corruptJson);
  assert.equal(mapsEqual(corruptJson, corruptTs), true); assert.equal(validateProtectedStructure(base, corruptJson).length, 1);
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
test('canonical root-absolute asset slot passes', () => assert.deepEqual(validateMapSemantics({ nemesis: semanticCharacter() }), []));
test('relative canonical-looking asset slot fails', () => assert.equal(validateMapSemantics({ nemesis: semanticCharacter({ default: 'assets/characters-v2/nemesis/portrait/default.webp' }) }).length, 1));
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
