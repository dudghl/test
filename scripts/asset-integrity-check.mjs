import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ACTIVE_ROOT = 'assets/characters-v2';
export const EXPRESSIONS = new Set(['default','smile','blush','serious','angry','sad','shock','smug','annoyed','worried','confused','laugh','flustered']);
const APPROVED_CANONICAL_MIGRATIONS = Object.freeze([
  Object.freeze({ sourceKey: 'belian', destinationKey: 'bellian', kind: 'resolved-assets' }),
  Object.freeze({ sourceKey: 'karne', destinationKey: 'carne', kind: 'forward-declaration' }),
  Object.freeze({ sourceKey: 'pria', destinationKey: 'fria', kind: 'forward-declaration' }),
  Object.freeze({ sourceKey: 'mirabel', destinationKey: 'mirabelle', kind: 'byte-preserving-rename' }),
].map((migration) => Object.freeze({
  ...migration,
  sourcePrefix: `/assets/characters-v2/${migration.sourceKey}/`,
  destinationPrefix: `/assets/characters-v2/${migration.destinationKey}/`,
})));

export function normalizeAssetPath(value) {
  if (typeof value !== 'string') throw new Error('asset reference must be a string');
  const slash = value.replaceAll('\\', '/').replace(/^\//, '');
  const normalized = path.posix.normalize(slash);
  if (!normalized.startsWith(`${ACTIVE_ROOT}/`) || normalized.includes('\0') || normalized.includes('..'))
    throw new Error(`asset path escapes active root: ${value}`);
  return normalized;
}

export function collectReferences(value, output = []) {
  if (value === null) return output;
  if (typeof value === 'string') {
    if (value.startsWith('/assets/') || value.startsWith('assets/')) output.push(normalizeAssetPath(value));
    return output;
  }
  if (Array.isArray(value)) for (const item of value) collectReferences(item, output);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) collectReferences(item, output);
  return output;
}

export function collectSchemaReferences(map) {
  const output = [];
  const add = (value) => {
    if (typeof value !== 'string' || !value.startsWith('/assets/')) return;
    try { output.push(normalizeAssetPath(value)); } catch { /* Semantic validation reports the slot-specific error. */ }
  };
  if (!map || typeof map !== 'object' || Array.isArray(map)) return output;
  for (const payload of Object.values(map)) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
    add(payload.default); add(payload.fullbodyDefault);
    if (payload.portrait && typeof payload.portrait === 'object' && !Array.isArray(payload.portrait))
      for (const [expression, value] of Object.entries(payload.portrait)) if (EXPRESSIONS.has(expression)) add(value);
    if (payload.supportAnchors && typeof payload.supportAnchors === 'object' && !Array.isArray(payload.supportAnchors)) for (const value of Object.values(payload.supportAnchors)) add(value);
    if (payload.eventCG && typeof payload.eventCG === 'object' && !Array.isArray(payload.eventCG)) for (const value of Object.values(payload.eventCG)) add(value);
  }
  return output;
}

export function collectSemanticSlots(map) {
  const slots = new Map();
  const add = (slot, value) => { if (typeof value === 'string') try { slots.set(slot, normalizeAssetPath(value)); } catch {} };
  if (!map || typeof map !== 'object' || Array.isArray(map)) return slots;
  for (const [characterKey, payload] of Object.entries(map)) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
    add(`${characterKey}.default`, payload.default); add(`${characterKey}.fullbodyDefault`, payload.fullbodyDefault);
    if (payload.portrait && typeof payload.portrait === 'object' && !Array.isArray(payload.portrait))
      for (const [key, value] of Object.entries(payload.portrait)) if (EXPRESSIONS.has(key)) add(`${characterKey}.portrait.${key}`, value);
    if (payload.supportAnchors && typeof payload.supportAnchors === 'object' && !Array.isArray(payload.supportAnchors))
      for (const [key, value] of Object.entries(payload.supportAnchors)) add(`${characterKey}.supportAnchors.${key}`, value);
    if (payload.eventCG && typeof payload.eventCG === 'object' && !Array.isArray(payload.eventCG))
      for (const [key, value] of Object.entries(payload.eventCG)) add(`${characterKey}.eventCG.${key}`, value);
  }
  return slots;
}

export function validateProtectedStructure(baseMap, candidateMap) {
  const errors = [];
  const nestedFields = ['portrait', 'supportAnchors', 'eventCG'];
  const recognizedFields = ['default', 'fullbodyDefault', ...nestedFields];
  for (const [characterKey, basePayload] of Object.entries(baseMap ?? {})) {
    const candidatePayload = candidateMap?.[characterKey];
    if (!candidatePayload || typeof candidatePayload !== 'object' || Array.isArray(candidatePayload)) {
      errors.push(`protected character payload was removed: ${characterKey}`); continue;
    }
    for (const field of recognizedFields) {
      if (!Object.hasOwn(basePayload, field)) continue;
      if (!Object.hasOwn(candidatePayload, field)) { errors.push(`protected schema field was removed: ${characterKey}.${field}`); continue; }
      if (!nestedFields.includes(field)) continue;
      const baseNested = basePayload[field]; const candidateNested = candidatePayload[field];
      if (!baseNested || typeof baseNested !== 'object' || Array.isArray(baseNested)) continue;
      if (!candidateNested || typeof candidateNested !== 'object' || Array.isArray(candidateNested)) {
        errors.push(`protected schema object changed shape: ${characterKey}.${field}`); continue;
      }
      for (const key of Object.keys(baseNested))
        if (!Object.hasOwn(candidateNested, key)) errors.push(`protected schema field was removed: ${characterKey}.${field}.${key}`);
    }
  }
  return errors;
}

export function validateReferenceOwnership(map) {
  const errors = [];
  if (!map || typeof map !== 'object' || Array.isArray(map)) return ['map payload must be a character-keyed object'];
  for (const [characterKey, payload] of Object.entries(map)) {
    const expectedPrefix = `${ACTIVE_ROOT}/${characterKey}/`;
    for (const reference of collectSchemaReferences({ [characterKey]: payload })) {
      if (!reference.startsWith(expectedPrefix)) errors.push(`character ${characterKey} declares path owned by another character: ${reference}`);
    }
  }
  return errors;
}

function validateSlotReference(value, label, expected, errors) {
  if (value === null || value === undefined) return;
  if (typeof value !== 'string') { errors.push(`${label} must be an asset path or null`); return; }
  if (!value.startsWith('/assets/')) { errors.push(`${label} must be a root-absolute /assets/ reference: ${value}`); return; }
  let normalized;
  try { normalized = normalizeAssetPath(value); }
  catch { errors.push(`${label} has invalid asset reference/root: ${value}`); return; }
  if (expected && normalized !== expected) errors.push(`${label} must resolve to ${expected}, got ${normalized}`);
}

export function validateMapSemantics(map) {
  const errors = [];
  if (!map || typeof map !== 'object' || Array.isArray(map)) return ['map payload must be a character-keyed object'];
  for (const [characterKey, payload] of Object.entries(map)) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) { errors.push(`character ${characterKey} payload must be an object`); continue; }
    const allowedFields = new Set(['default', 'fullbodyDefault', 'portrait', 'supportAnchors', 'eventCG']);
    for (const field of Object.keys(payload)) if (!allowedFields.has(field)) errors.push(`${characterKey} has unknown character payload field: ${field}`);
    const root = `${ACTIVE_ROOT}/${characterKey}`;
    validateSlotReference(payload.default, `${characterKey}.default`, `${root}/portrait/default.webp`, errors);
    validateSlotReference(payload.fullbodyDefault, `${characterKey}.fullbodyDefault`, `${root}/fullbody/default.webp`, errors);
    if (!payload.portrait || typeof payload.portrait !== 'object' || Array.isArray(payload.portrait)) errors.push(`${characterKey}.portrait must be an object`);
    else for (const [expression, value] of Object.entries(payload.portrait)) {
      if (!EXPRESSIONS.has(expression)) { errors.push(`${characterKey}.portrait has unknown expression slot: ${expression}`); continue; }
      validateSlotReference(value, `${characterKey}.portrait.${expression}`, `${root}/portrait/${expression}.webp`, errors);
    }
    if (!payload.supportAnchors || typeof payload.supportAnchors !== 'object' || Array.isArray(payload.supportAnchors)) errors.push(`${characterKey}.supportAnchors must be an object`);
    else for (const [supportKey, value] of Object.entries(payload.supportAnchors))
      validateSlotReference(value, `${characterKey}.supportAnchors.${supportKey}`, `${root}/support/${supportKey}.webp`, errors);
    if (payload.eventCG && typeof payload.eventCG === 'object' && !Array.isArray(payload.eventCG))
      for (const [eventKey, value] of Object.entries(payload.eventCG)) validateSlotReference(value, `${characterKey}.eventCG.${eventKey}`, undefined, errors);
  }
  return errors;
}

export function compareDebt(current, baseline) {
  const known = current.filter((item) => baseline.includes(item));
  const fresh = current.filter((item) => !baseline.includes(item));
  const resolved = baseline.filter((item) => !current.includes(item));
  return { known, fresh, resolved };
}

export function compareBaselineGrowth(candidate, base) {
  return {
    addedMissing: candidate.knownMissingReferences.filter((item) => !base.knownMissingReferences.includes(item)),
    addedUnreferenced: candidate.knownUnreferencedAssets.filter((item) => !base.knownUnreferencedAssets.includes(item)),
  };
}

function transformApprovedCanonicalPayload(value, migration) {
  const { sourcePrefix, destinationPrefix } = migration;
  if (typeof value === 'string') return value.startsWith(sourcePrefix) ? destinationPrefix + value.slice(sourcePrefix.length) : value;
  if (Array.isArray(value)) return value.map((item) => transformApprovedCanonicalPayload(item, migration));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transformApprovedCanonicalPayload(item, migration)]));
  return value;
}

export function assessApprovedCanonicalMigration(baseMap, candidateMap, baseBaseline, candidateBaseline, tracked, changes, parity = true, bytesEqual = () => false) {
  const active = APPROVED_CANONICAL_MIGRATIONS.filter(({ sourceKey }) => Object.hasOwn(baseMap ?? {}, sourceKey));
  if (!active.length) return { approved: false, errors: [], equivalentReferences: new Map(), migrations: [] };
  const errors = [];
  const equivalentReferences = new Map();
  let expectedMissing = [...baseBaseline.knownMissingReferences];
  let expectedUnreferenced = [...baseBaseline.knownUnreferencedAssets];
  for (const migration of active) {
    const { sourceKey, destinationKey, kind } = migration;
    const expectedPayload = transformApprovedCanonicalPayload(baseMap[sourceKey], migration);
    if (Object.hasOwn(candidateMap ?? {}, sourceKey)) errors.push(`approved canonical migration must remove candidate key: ${sourceKey}`);
    if (!Object.hasOwn(candidateMap ?? {}, destinationKey)) errors.push(`approved canonical migration must add candidate key: ${destinationKey}`);
    else if (!mapsEqual(expectedPayload, candidateMap[destinationKey])) errors.push(`approved canonical migration changed protected payload beyond ${sourceKey} -> ${destinationKey}`);

    const sourceReferences = [...new Set(collectSchemaReferences({ [sourceKey]: baseMap[sourceKey] }))].sort();
    const destinationReferences = [...new Set(collectSchemaReferences({ [destinationKey]: expectedPayload }))].sort();
    if (sourceReferences.length !== destinationReferences.length)
      errors.push(`approved canonical migration must preserve every ${sourceKey} semantic asset slot`);
    sourceReferences.forEach((reference, index) => equivalentReferences.set(reference, destinationReferences[index]));
    if (kind === 'resolved-assets') {
      for (const reference of destinationReferences) if (!tracked.includes(reference)) errors.push(`approved canonical migration destination is not a tracked asset: ${reference}`);
      expectedMissing = expectedMissing.filter((reference) => !sourceReferences.includes(reference));
      expectedUnreferenced = expectedUnreferenced.filter((reference) => !destinationReferences.includes(reference));
    } else if (kind === 'forward-declaration') {
      for (const reference of destinationReferences) if (tracked.includes(reference)) errors.push(`approved forward declaration unexpectedly has a physical asset: ${reference}`);
      expectedMissing = expectedMissing.map((reference) => {
        const index = sourceReferences.indexOf(reference);
        return index < 0 ? reference : destinationReferences[index];
      });
    } else {
      for (const [index, sourceReference] of sourceReferences.entries()) {
        const destinationReference = destinationReferences[index];
        const rename = changes.find((change) => change.oldPath === sourceReference && change.path === destinationReference);
        if (!rename || rename.status !== 'R100') errors.push(`approved canonical migration requires an exact Git rename: ${sourceReference} -> ${destinationReference}`);
        else if (!bytesEqual(sourceReference, destinationReference)) errors.push(`approved canonical migration changed image bytes: ${sourceReference} -> ${destinationReference}`);
        if (!tracked.includes(destinationReference)) errors.push(`approved canonical migration destination is not a tracked asset: ${destinationReference}`);
      }
    }
  }
  if (!parity) errors.push('approved canonical migration requires exact JSON/TypeScript parity');
  const allowsRenames = active.every(({ kind }) => kind === 'byte-preserving-rename');
  const expectedRenameCount = allowsRenames
    ? active.reduce((count, { sourceKey }) => count + new Set(collectSchemaReferences({ [sourceKey]: baseMap[sourceKey] })).size, 0)
    : 0;
  if ((!allowsRenames && changes.length) || (allowsRenames && changes.length !== expectedRenameCount))
    errors.push('approved canonical migration has unexpected asset additions, removals, modifications, or renames');
  if (!mapsEqual(candidateBaseline.knownMissingReferences, expectedMissing) || !mapsEqual(candidateBaseline.knownUnreferencedAssets, expectedUnreferenced))
    errors.push('approved canonical migration baseline must change one-for-one with canonical references');

  return {
    approved: errors.length === 0,
    errors,
    equivalentReferences,
    migrations: active,
  };
}

export function assessResolvedUnreferenced(resolved, tracked, references, changes, bytesEqual = () => false) {
  const errors = [];
  const safeRenames = [];
  for (const oldPath of resolved) {
    if (tracked.includes(oldPath)) continue; // It became referenced in place.
    const rename = changes.find((change) => change.status.startsWith('R') && change.oldPath === oldPath);
    if (rename && tracked.includes(rename.path) && references.includes(rename.path) && bytesEqual(oldPath, rename.path)) {
      safeRenames.push(`${oldPath} -> ${rename.path}`);
      continue;
    }
    errors.push(`previously tracked baseline asset was deleted without a byte-preserving referenced replacement: ${oldPath}`);
  }
  return { errors, safeRenames };
}

export function assessAssetChanges(baseTracked, baseReferences, tracked, references, changes, bytesEqual = () => false, baseSlots = new Map(), candidateSlots = new Map(), equivalentReferences = new Map()) {
  const errors = [];
  const safeRenames = new Set();
  for (const change of changes.filter((item) => item.status.startsWith('R'))) {
    const hashIdentical = bytesEqual(change.oldPath, change.path);
    if (change.status !== 'R100' || !hashIdentical) errors.push(`asset rename changed bytes: ${change.oldPath} -> ${change.path} (${change.status})`);
    else if (!references.includes(change.path)) errors.push(`asset rename destination is not referenced: ${change.path}`);
    else {
      const protectedSlots = [...baseSlots].filter(([, value]) => value === change.oldPath).map(([slot]) => slot);
      const movedSlots = protectedSlots.filter((slot) => candidateSlots.get(slot) !== change.path);
      if (baseReferences.includes(change.oldPath) && protectedSlots.length === 0) errors.push(`asset rename has no recoverable protected semantic slot: ${change.oldPath}`);
      else if (movedSlots.length) errors.push(`asset rename changed protected semantic slot(s) ${movedSlots.join(', ')}: ${change.oldPath} -> ${change.path}`);
      else safeRenames.add(change.oldPath);
    }
  }
  for (const oldPath of baseReferences) {
    const equivalent = equivalentReferences.get(oldPath);
    if (!references.includes(oldPath) && !(equivalent && references.includes(equivalent)) && !safeRenames.has(oldPath))
      errors.push(`protected-base asset reference was removed without a verified referenced replacement: ${oldPath}`);
  }
  return { errors, safeRenames: [...safeRenames] };
}

export function assessProtectedUnreferenced(baseKnownUnreferenced, baseTracked, tracked, safeRenames, changes = [], baseMissing = []) {
  const errors = [];
  for (const oldPath of baseKnownUnreferenced.filter((item) => baseTracked.includes(item))) {
    if (tracked.includes(oldPath)) continue;
    const rename = changes.find((item) => item.status.startsWith('R') && item.oldPath === oldPath);
    const sameRelativeRole = rename && oldPath.split('/').slice(3).join('/') === rename.path.split('/').slice(3).join('/');
    if (!safeRenames.includes(oldPath) || !rename || !baseMissing.includes(rename.path) || !sameRelativeRole)
      errors.push(`protected-base known-unreferenced asset was deleted without a semantically equivalent protected-missing replacement: ${oldPath}`);
  }
  return errors;
}

export function parseNameStatus(output) {
  const fields = output.split('\0').filter(Boolean); const changes = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (status.startsWith('R') || status.startsWith('C')) changes.push({ status, oldPath: fields[index++], path: fields[index++] });
    else changes.push({ status, path: fields[index++] });
  }
  return changes;
}

export function findCollisions(paths) {
  const collisions = [];
  for (const [label, key] of [['case-insensitive', (p) => p.toLowerCase()], ['Unicode NFC', (p) => p.normalize('NFC')]]) {
    const groups = new Map();
    for (const item of paths) {
      const normalized = key(item);
      groups.set(normalized, [...(groups.get(normalized) ?? []), item]);
    }
    for (const values of groups.values()) if (new Set(values).size > 1) collisions.push(`${label}: ${values.join(' <> ')}`);
  }
  return collisions;
}

export function validatePaths(paths) {
  const errors = [];
  for (const item of paths) {
    let p;
    try { p = normalizeAssetPath(item); } catch (error) { errors.push(error.message); continue; }
    const parts = p.split('/');
    const key = parts[2];
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key)) errors.push(`invalid character key: ${key}`);
    if (!p.endsWith('.webp')) errors.push(`unsupported active asset extension: ${p}`);
    const tail = parts.slice(3);
    if (tail[0] === 'portrait' && (tail.length !== 2 || !EXPRESSIONS.has(tail[1]?.replace(/\.webp$/, '')))) errors.push(`invalid portrait path: ${p}`);
    else if (tail[0] === 'fullbody' && tail.join('/') !== 'fullbody/default.webp') errors.push(`invalid fullbody path: ${p}`);
    else if (tail[0] === 'support' && (tail.length !== 2 || !/^[a-z0-9]+(?:_[a-z0-9]+)*\.webp$/.test(tail[1]))) errors.push(`invalid support path: ${p}`);
    else if (!['portrait','fullbody','support'].includes(tail[0])) errors.push(`invalid asset layout: ${p}`);
  }
  return errors;
}

export function parseTypeScriptMap(text) {
  const marker = 'export const characterImagesV2 =';
  const start = text.indexOf(marker);
  if (start < 0) throw new Error('TypeScript map export was not found');
  const payloadStart = text.indexOf('{', start + marker.length);
  if (payloadStart < 0) throw new Error('TypeScript map payload is malformed');
  let depth = 0; let quote = ''; let escaped = false; let payloadEnd = -1;
  for (let index = payloadStart; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '{') depth++;
    if (char === '}' && --depth === 0) { payloadEnd = index; break; }
  }
  if (payloadEnd < payloadStart || !/^\s*(?:as const(?:\s|$)|;)/.test(text.slice(payloadEnd + 1))) throw new Error('TypeScript map payload is malformed');
  return JSON.parse(text.slice(payloadStart, payloadEnd + 1));
}

export function mapsEqual(a, b) { try { assert.deepStrictEqual(a, b); return true; } catch { return false; } }

export function legacyViolations(texts) {
  const patterns = [/characters-v2[^"'\s]*\.png\b/i, /raw\.githubusercontent\.com/i, /github\.com\/[^\s"']+\/(?:tree|blob)\//i, /characters-v1\b/i];
  return texts.flatMap((text, index) => patterns.filter((re) => re.test(text)).map((re) => `map ${index + 1}: ${re}`));
}

function validateBaseline(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || !Array.isArray(data.knownMissingReferences) || !Array.isArray(data.knownUnreferencedAssets)) return ['baseline must contain both known-debt arrays'];
  for (const [name, entries] of Object.entries({ knownMissingReferences: data.knownMissingReferences, knownUnreferencedAssets: data.knownUnreferencedAssets })) {
    if (new Set(entries).size !== entries.length) errors.push(`duplicate ${name} entry`);
    for (const entry of entries) try { if (typeof entry !== 'string' || normalizeAssetPath(entry) !== entry) errors.push(`non-normalized ${name}: ${entry}`); } catch (error) { errors.push(error.message); }
  }
  return errors;
}

export function runCheck(repo = process.cwd()) {
  const jsonText = readFileSync(path.join(repo, 'assets/characterImagesV2.json'), 'utf8');
  const tsText = readFileSync(path.join(repo, 'assets/imageMapV2.ts'), 'utf8');
  const baseline = JSON.parse(readFileSync(path.join(repo, 'scripts/asset-integrity-baseline.json'), 'utf8'));
  const jsonMap = JSON.parse(jsonText); const tsMap = parseTypeScriptMap(tsText);
  const tracked = execFileSync('git', ['ls-files', '-z', `${ACTIVE_ROOT}/**`], { cwd: repo }).toString().split('\0').filter(Boolean).sort();
  const references = [...new Set(collectSchemaReferences(jsonMap))].sort();
  const missing = references.filter((p) => !existsSync(path.join(repo, p)));
  const images = tracked.filter((p) => /\.[^/]+$/.test(p));
  const unreferenced = images.filter((p) => !references.includes(p));
  const missingDebt = compareDebt(missing, baseline.knownMissingReferences ?? []);
  const unreferencedDebt = compareDebt(unreferenced, baseline.knownUnreferencedAssets ?? []);
  const diffBase = process.env.ASSET_INTEGRITY_DIFF_BASE ?? 'HEAD';
  const parity = mapsEqual(jsonMap, tsMap);
  let baselineGrowth = { addedMissing: [], addedUnreferenced: [] };
  let baseKnownUnreferenced = [];
  let baseBaseline = baseline;
  let baseHasBaseline = true;
  try { execFileSync('git', ['cat-file', '-e', `${diffBase}:scripts/asset-integrity-baseline.json`], { cwd: repo, stdio: 'ignore' }); }
  catch { baseHasBaseline = false; }
  if (baseHasBaseline) {
    baseBaseline = JSON.parse(execFileSync('git', ['show', `${diffBase}:scripts/asset-integrity-baseline.json`], { cwd: repo }).toString());
    const baseErrors = validateBaseline(baseBaseline);
    if (baseErrors.length) throw new Error(`protected-base baseline is invalid: ${baseErrors.join('; ')}`);
    baselineGrowth = compareBaselineGrowth(baseline, baseBaseline);
    baseKnownUnreferenced = baseBaseline.knownUnreferencedAssets;
  }
  const changeOutput = execFileSync('git', ['diff', '--name-status', '-z', '-M', diffBase, '--', ACTIVE_ROOT], { cwd: repo }).toString();
  const changes = parseNameStatus(changeOutput);
  const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
  const bytesEqual = (oldPath, newPath) => {
    try {
      const oldBytes = execFileSync('git', ['show', `${diffBase}:${oldPath}`], { cwd: repo, encoding: 'buffer', maxBuffer: 100 * 1024 * 1024 });
      return hash(oldBytes) === hash(readFileSync(path.join(repo, newPath)));
    } catch { return false; }
  };
  const resolvedAssets = assessResolvedUnreferenced(unreferencedDebt.resolved, tracked, references, changes, bytesEqual);
  const baseMap = JSON.parse(execFileSync('git', ['show', `${diffBase}:assets/characterImagesV2.json`], { cwd: repo }).toString());
  const baseTsMap = parseTypeScriptMap(execFileSync('git', ['show', `${diffBase}:assets/imageMapV2.ts`], { cwd: repo }).toString());
  const baseReferences = [...new Set([...collectSchemaReferences(baseMap), ...collectSchemaReferences(baseTsMap)])].sort();
  const baseTracked = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', diffBase, '--', ACTIVE_ROOT], { cwd: repo }).toString().split('\0').filter(Boolean);
  const baseSlots = collectSemanticSlots(baseMap); const candidateSlots = collectSemanticSlots(jsonMap);
  const canonicalMigration = assessApprovedCanonicalMigration(baseMap, jsonMap, baseBaseline, baseline, tracked, changes, parity, bytesEqual);
  if (canonicalMigration.approved) {
    const approvedDestinations = new Set(canonicalMigration.equivalentReferences.values());
    baselineGrowth.addedMissing = baselineGrowth.addedMissing.filter((reference) => !approvedDestinations.has(reference));
  }
  const canonicalRenameSources = new Set(canonicalMigration.approved && canonicalMigration.migrations.every(({ kind }) => kind === 'byte-preserving-rename')
    ? canonicalMigration.equivalentReferences.keys() : []);
  const ordinaryChanges = changes.filter((change) => !canonicalRenameSources.has(change.oldPath));
  const assetChanges = assessAssetChanges(baseTracked, baseReferences, tracked, references, ordinaryChanges, bytesEqual, baseSlots, candidateSlots, canonicalMigration.approved ? canonicalMigration.equivalentReferences : new Map());
  const baseMissing = baseReferences.filter((item) => !baseTracked.includes(item));
  const protectedUnreferencedErrors = assessProtectedUnreferenced(baseKnownUnreferenced, baseTracked, tracked, assetChanges.safeRenames, changes, baseMissing);
  const structureJsonMap = canonicalMigration.approved ? { ...jsonMap } : jsonMap;
  const structureTsMap = canonicalMigration.approved ? { ...tsMap } : tsMap;
  if (canonicalMigration.approved) for (const { sourceKey } of canonicalMigration.migrations) {
    structureJsonMap[sourceKey] = baseMap[sourceKey];
    structureTsMap[sourceKey] = baseTsMap[sourceKey];
  }
  const structure = [...validateProtectedStructure(baseMap, structureJsonMap), ...validateProtectedStructure(baseTsMap, structureTsMap)];
  const collisions = findCollisions(tracked);
  const naming = validatePaths(images);
  const legacy = legacyViolations([jsonText, tsText]);
  const ownership = validateReferenceOwnership(jsonMap);
  const semantics = validateMapSemantics(jsonMap);
  const errors = [...validateBaseline(baseline), ...baselineGrowth.addedMissing.map((p)=>`candidate baseline adds a missing reference: ${p}`), ...baselineGrowth.addedUnreferenced.map((p)=>`candidate baseline adds an unreferenced asset: ${p}`), ...missingDebt.fresh.map((p)=>`new missing reference: ${p}`), ...unreferencedDebt.fresh.map((p)=>`new unreferenced asset: ${p}`), ...resolvedAssets.errors, ...canonicalMigration.errors, ...assetChanges.errors, ...protectedUnreferencedErrors, ...structure, ...ownership, ...semantics, ...collisions, ...naming, ...legacy];
  if (!parity) errors.push('JSON and TypeScript map payloads diverge');
  const warnings = [...missingDebt.known.map((p)=>`known missing reference: ${p}`), ...unreferencedDebt.known.map((p)=>`known unreferenced asset: ${p}`), ...missingDebt.resolved.map((p)=>`resolved missing baseline entry can be removed: ${p}`), ...unreferencedDebt.resolved.map((p)=>`resolved unreferenced baseline entry can be removed: ${p}`), ...resolvedAssets.safeRenames.map((p)=>`verified byte-preserving rename: ${p}`)];
  return { ok: errors.length === 0, summary: { trackedImages: images.length, declaredReferences: references.length, missing: missing.length, knownMissing: missingDebt.known.length, newMissing: missingDebt.fresh.length, unreferenced: unreferenced.length, knownUnreferenced: unreferencedDebt.known.length, newUnreferenced: unreferencedDebt.fresh.length, baselineGrowth: baselineGrowth.addedMissing.length + baselineGrowth.addedUnreferenced.length, parity, protectedStructure: structure.length, ownership: ownership.length, semanticSlots: semantics.length, collisions: collisions.length, naming: naming.length, legacy: legacy.length }, warnings, errors };
}

function print(result) {
  console.log(`ASSET_INTEGRITY: ${result.ok ? 'PASS' : 'FAIL'}\n\nSUMMARY:`);
  for (const [key, value] of Object.entries(result.summary)) console.log(`- ${key}: ${value}`);
  console.log('\nWARNINGS:'); console.log(result.warnings.length ? result.warnings.map((x)=>`- ${x}`).join('\n') : '- none');
  console.log('\nERRORS:'); console.log(result.errors.length ? result.errors.map((x)=>`- ${x}`).join('\n') : '- none');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = runCheck(); print(result); process.exitCode = result.ok ? 0 : 1; }
  catch (error) { console.error(`ASSET_INTEGRITY: FAIL\n\nERRORS:\n- ${error.message}`); process.exitCode = 1; }
}
