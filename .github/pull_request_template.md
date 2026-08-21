## Asset safety checklist

- [ ] `node scripts/asset-integrity-check.mjs` passes; JSON/TypeScript parity is preserved.
- [ ] There are no new missing references, unreferenced assets, or case/Unicode collisions.
- [ ] Renames used `git mv`, and rename-only binary hashes were preserved.
- [ ] No asset or metadata deletion occurred without explicit approval.
- [ ] Cross-repository character-name/key impact is noted where relevant.
- [ ] This pull request will not be auto-merged.
