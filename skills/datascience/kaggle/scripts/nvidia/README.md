# NVIDIA Kaggle helper scripts

This directory vendors selected helper scripts from
[NVIDIA/nvidia-kaggle](https://github.com/NVIDIA/nvidia-kaggle), source commit
`5d9f7de9293fe1baf36dca41036f2f39742e9433`, under its MIT license. See
`LICENSE` in this directory.

The scripts are kept under `./scripts/nvidia/` to avoid shadowing this skill's
native helpers. Local path helpers were adapted to write SQLite/cache state under
`.kaggle-skill/cache/nvidia/` (or `$KAGGLE_SKILL_CACHE_DIR/nvidia/`) instead of
`data/`. A few compatibility and safety patches were applied for this skill,
including Python 3.9 annotation handling, safer dataset-license handling, and
requiring an explicit submission target when kernel metadata lists multiple
competition sources.

Use `./refs/scripts/nvidia.md` for routing, dependencies, and safety notes before
running them.
