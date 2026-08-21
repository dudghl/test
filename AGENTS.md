# Lumensia asset rules

- The active asset root is `assets/characters-v2`.
- `assets/characterImagesV2.json` and `assets/imageMapV2.ts` must remain logically equivalent. The TypeScript file appears generated; inspect the source-of-truth workflow before changing either payload independently.
- Use `git mv` for tracked renames. Preserve bytes exactly and compare hashes when rename correctness matters. For case-only renames, use a temporary intermediate path. Check for target collisions first, and never silently canonicalize an ambiguous identity.
- Never delete character assets or metadata entries without explicit user approval. Missing or forward-declared assets are not automatically stale.
- Do not infer display-name corrections from filename similarity. Reconcile canonical keys with the Lumensia game repository; ambiguous real-character-name mismatches require review.
- Recognized portraits are `default`, `smile`, `blush`, `serious`, `angry`, `sad`, `shock`, `smug`, `annoyed`, `worried`, `confused`, `laugh`, and `flustered`. Do not require every expression. Metadata declares availability, and an explicit null default is valid.
- Infrastructure and rename-only work must not recompress or re-encode images. Change image bytes only when explicitly requested.
- For every mutation: inspect the final diff; run `node scripts/asset-integrity-check.mjs` and `git diff --check`; inspect `git diff --summary` and `git status --short`; perform a second self-review; fix in-scope blockers and rerun checks. Report `MERGE_GATE`, `RISK`, `TESTS`, `BLOCKERS`, and `MERGE_RECOMMENDATION`. Never auto-merge.
