# Current skill inventory

Current explicit ownership after the 2026-07-10 migration.

## Summary

| Type | Count |
|---|---:|
| Mirror | 28 |
| Owned | 5 |
| Active | 33 |
| Deleted in this migration | 4 |

## Mirror by source

### `mattpocock/skills` — 21

Resolved at `89d370d181e7397c1cf4e9da47391dd26cd416b1` during migration.

- `ask-matt`
- `code-review`
- `codebase-design`
- `diagnosing-bugs`
- `domain-modeling`
- `grill-with-docs`
- `grilling`
- `handoff`
- `implement`
- `improve-codebase-architecture`
- `prototype`
- `research`
- `resolving-merge-conflicts`
- `setup-matt-pocock-skills`
- `tdd`
- `teach`
- `to-spec`
- `to-tickets`
- `triage`
- `wayfinder`
- `writing-great-skills`

`grill-me` was deleted by explicit user decision. Because `ask-matt` remains an exact mirror, its upstream text still mentions `/grill-me`; this known dangling route cannot be patched locally without changing `ask-matt` to owned or fixing upstream.

### `jackwener/opencli` — 4

Resolved at `6129bb3953d5eebd8dd67f96802b320c723f50ca`.

- `opencli-adapter-author`
- `opencli-autofix`
- `opencli-usage`
- `smart-search`

Under the current mirror invariant, their former local skill/tool relations were removed with the owned classification. `@jackwener/opencli` remains installed, but these mirrors no longer make `skill-sync` responsible for installing or version-checking it.

### `microsoft/playwright-cli` — 1

Resolved at `793cfb32572733cbcb401e6f28d05a7a914ce408`.

- `playwright-cli`

The global `@playwright/cli` package was updated with the mirror and is verified through the owned `chatgpt` relation.

### `krzysztofdudek/ResearcherSkill` — 1

Resolved at `003f15ddcdad6da91c62a75f36097101e6afbbdb`.

- `researcher`

### `kky42/pievo` — 1

Resolved from `origin/main` at `730ffecd7278b07b27b2da0c91c9920391be60f3`.

- `pievo`

The previous local customization and obsolete reference directory were discarded. The separate maintenance loop bundle remains paused until it is redesigned for the current Pievo CLI contract.

## Owned by source

### Local-authoritative, no external content source — 3

- `agent-prompt-engineering`
- `chatgpt`
  - skill dependency: `playwright-cli`
  - tool dependencies: `@playwright/cli`, local ChatGPT helper scripts
- `plan-refiner`

### `earendil-works/pi-mono` selective sources — 1

- `pi-extension-dev`

`pi-extension-dev` was rewritten against the current extension/package/SDK/session/compaction docs and its source review was recorded.

### Multi-source Kaggle — 1

- `kaggle`
  - content source: `NVIDIA/nvidia-kaggle:skills/nvidia-kaggle-skill`
  - reference: `Kaggle/kaggle-cli:src/kaggle`
  - skill dependency: `playwright-cli`
  - tool dependency: Kaggle CLI

Both Kaggle source relations remain review debt and require a dedicated selective-adoption pass.

## Deleted

- `grill-me` — redundant Matt Pocock alias; upstream `ask-matt` still mentions it.
- `browseruse` — local skill and metadata removed; runtime links removed.
- `pi-agent-e2e` — removed by explicit user decision; its fresh-process guidance is no longer a separate skill.
- `pi-soul` — removed by explicit user decision.

## Compatibility state

- All 33 active skills have explicit ownership.
- All 28 mirrors have resolved mirror lock state.
- Legacy v1 source and lock files are empty.
- Strict skill/tool dependency verification passes.
- Remaining source-review debt: `kaggle` (2 relations).
