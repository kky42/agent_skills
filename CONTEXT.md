# Skill Management

## Model

This repository records intent, not third-party content.

- Files under `skills/` are locally owned.
- `thirdparty.json` declares selected upstream skills.
- `npx skills` owns installation, updates, its machine-local ledger, and runtime links.
- Git synchronizes owned content and third-party selection between the MacBook and Macmini.

## Decision

**Thin desired-state repository** (2026-07-12): remove custom mirror materialization, hashes, source-policy caches, review receipts, dependency graphs, and runtime-link management. Keep one minimal third-party selection file and one thin reconciliation command. Agents make add/remove/security decisions and use standard `npx skills`, Git, and SSH operations to execute them.
