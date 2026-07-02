# NVIDIA nvidia-kaggle Resource

Upstream: <https://github.com/NVIDIA/nvidia-kaggle>

This repository is a useful external Kaggle-skill reference. Review it when
refreshing this skill, especially for helper scripts around writeups, public
kernel scoring/version archives, discussion/kernel SQLite browsing, dataset
uploads, and code-competition submission polling.

Merged snapshot:

- Source commit: `5d9f7de9293fe1baf36dca41036f2f39742e9433`
- Vendored helper location: `./scripts/nvidia/`
- License: MIT, with copyright notice as stated in upstream `LICENSE`:
  `Copyright (c) 2026 nvidia-kaggle maintainers`; see `./scripts/nvidia/LICENSE`

## Future Update Flow

1. Clone or fetch the upstream repository.
2. Compare `skills/nvidia-kaggle-skill/` with this local skill.
3. Prefer merging reusable workflow guidance into `./refs/` and keep
   competition-specific behavior out of the skill.
4. Keep NVIDIA-derived executable helpers under `./scripts/nvidia/` unless they
   are rewritten to match the native `.kaggle-skill/cache/` JSON workflow.
5. Preserve MIT attribution when copying substantial code or docs.
6. Re-check dependency and credential assumptions; upstream helpers commonly use
   `KAGGLE_API_TOKEN`, `httpx`, `kaggle`, `kagglesdk`, `pydantic`,
   `python-dotenv`, `nbformat`, and `rich`.
7. Validate with syntax/compile checks and a dry `--help` run where imports allow
   it before syncing runtime skill folders.

## Integration Boundary

The local skill keeps private-leaderboard discipline as the top-level rule. Any
NVIDIA helper that ranks public kernels by public LB is a research/reproduction
tool, not final submission-selection authority.
