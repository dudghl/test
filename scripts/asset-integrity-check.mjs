import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ACTIVE_ROOT = 'assets/characters-v2';
export const EXPRESSIONS = new Set(['default','smile','blush','serious','angry','sad','shock','smug','annoyed','worried','confused','laugh','flustered']);

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

export function compareDebt(current, baseline) {
  const known = current.filter((item) => baseline.includes(item));
  const fresh = current.filter((item) => !baseline.includes(item));
  const resolved = baseline.filter((item) => !current.includes(item));
  return { known, fresh, resolved };
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
  const references = [...new Set(collectReferences(jsonMap))].sort();
  const missing = references.filter((p) => !existsSync(path.join(repo, p)));
  const images = tracked.filter((p) => /\.[^/]+$/.test(p));
  const unreferenced = images.filter((p) => !references.includes(p));
  const missingDebt = compareDebt(missing, baseline.knownMissingReferences ?? []);
  const unreferencedDebt = compareDebt(unreferenced, baseline.knownUnreferencedAssets ?? []);
  const diffBase = process.env.ASSET_INTEGRITY_DIFF_BASE ?? 'HEAD';
  const changeOutput = execFileSync('git', ['diff', '--name-status', '-z', '-M', diffBase, '--', ACTIVE_ROOT], { cwd: repo }).toString();
  const changes = parseNameStatus(changeOutput);
  const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
  const resolvedAssets = assessResolvedUnreferenced(unreferencedDebt.resolved, tracked, references, changes, (oldPath, newPath) => {
    try {
      const oldBytes = execFileSync('git', ['show', `${diffBase}:${oldPath}`], { cwd: repo, encoding: 'buffer', maxBuffer: 100 * 1024 * 1024 });
      return hash(oldBytes) === hash(readFileSync(path.join(repo, newPath)));
    } catch { return false; }
  });
  const collisions = findCollisions(tracked);
  const naming = validatePaths(images);
  const legacy = legacyViolations([jsonText, tsText]);
  const parity = mapsEqual(jsonMap, tsMap);
  const errors = [...validateBaseline(baseline), ...missingDebt.fresh.map((p)=>`new missing reference: ${p}`), ...unreferencedDebt.fresh.map((p)=>`new unreferenced asset: ${p}`), ...resolvedAssets.errors, ...collisions, ...naming, ...legacy];
  if (!parity) errors.push('JSON and TypeScript map payloads diverge');
  const warnings = [...missingDebt.known.map((p)=>`known missing reference: ${p}`), ...unreferencedDebt.known.map((p)=>`known unreferenced asset: ${p}`), ...missingDebt.resolved.map((p)=>`resolved missing baseline entry can be removed: ${p}`), ...unreferencedDebt.resolved.map((p)=>`resolved unreferenced baseline entry can be removed: ${p}`), ...resolvedAssets.safeRenames.map((p)=>`verified byte-preserving rename: ${p}`)];
  return { ok: errors.length === 0, summary: { trackedImages: images.length, declaredReferences: references.length, missing: missing.length, knownMissing: missingDebt.known.length, newMissing: missingDebt.fresh.length, unreferenced: unreferenced.length, knownUnreferenced: unreferencedDebt.known.length, newUnreferenced: unreferencedDebt.fresh.length, parity, collisions: collisions.length, naming: naming.length, legacy: legacy.length }, warnings, errors };
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
