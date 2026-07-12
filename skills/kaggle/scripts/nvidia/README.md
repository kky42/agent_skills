# NVIDIA Kaggle helper scripts

This directory started from selected helper scripts at
[NVIDIA/nvidia-kaggle](https://github.com/NVIDIA/nvidia-kaggle) commit
`5d9f7de9293fe1baf36dca41036f2f39742e9433` and was selectively reviewed through
`9a9333817802fef8a81c3e999bef219edf05e789`, under its MIT license. See `LICENSE`
in this directory and `../../refs/nvidia-kaggle.md` for accepted/skipped scope.

The scripts are kept under `./scripts/nvidia/` to avoid shadowing this skill's
native helpers. Local path helpers were adapted to write SQLite/cache state under
`.kaggle-skill/cache/nvidia/` (or `$KAGGLE_SKILL_CACHE_DIR/nvidia/`) instead of
`data/`. A few compatibility and safety patches were applied for this skill,
including Python 3.9 compatibility, safer dataset-license handling, explicit
submission targeting, and nonzero exits for submission/evaluation failures.

Use `./refs/scripts/nvidia.md` for routing, dependencies, and safety notes before
running them.
