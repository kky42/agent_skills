# NVIDIA-Derived Helper Scripts

Use these helpers when the native Kaggle CLI docs or local JSON cache scripts do
not cover the operation. They are vendored from
[NVIDIA/nvidia-kaggle](../nvidia-kaggle.md) under `scripts/nvidia/`.

Set a helper path in examples:

```bash
KAGGLE_SKILL_DIR="${KAGGLE_SKILL_DIR:-$HOME/.agents/skills/kaggle}"
NVK="$KAGGLE_SKILL_DIR/scripts/nvidia"
```

## Dependencies And Credentials

Install only when needed. The examples below use `python`; run them inside an
environment with these packages, or prefix the command with this `uv run` form:

```bash
uv run --with httpx --with kaggle --with kagglesdk --with nbformat \
  --with 'pydantic>=2' --with python-dotenv --with rich \
  python "$NVK/<script>.py" ...
```

Credential requirements vary by helper. Internal-API helpers require
`KAGGLE_API_TOKEN` (KGAT bearer token), not just `~/.kaggle/kaggle.json`.
Helpers that call the official Kaggle API or CLI need normal Kaggle CLI
credentials (`~/.kaggle/kaggle.json` or `KAGGLE_USERNAME`/`KAGGLE_KEY`). The
dataset upload helper needs normal CLI credentials, and needs `KAGGLE_API_TOKEN`
only when it must infer the owner because `dataset-metadata.json` has no valid
`id`. See `refs/cli/auth.md`.

```bash
# For internal-API helpers only:
: "${KAGGLE_API_TOKEN:?set KGAT token before running this helper}"

# For official CLI/API helpers:
kaggle config view >/dev/null
```

Discussion/kernel SQLite helpers write to `.kaggle-skill/cache/nvidia/` by
default, or `$KAGGLE_SKILL_CACHE_DIR/nvidia/` when that variable is set.

## Writeups

Use when the user asks for leaderboard solution writeups or top-k writeup
summaries.

```bash
python "$NVK/fetch_leaderboard_writeups.py" <competition-slug-or-leaderboard-url>
python "$NVK/fetch_writeup.py" <writeup-url>
```

The leaderboard helper prints JSON records with rank, team, and writeup URL.
Fetch only the needed writeups, save markdown in the active repo, and cite the
original Kaggle writeup links. Do not retrieve comments unless explicitly needed.

## Research Brief Support

For a competition strategy brief, combine official pages, discussion/notebook
research, writeups, and local validation evidence. Follow
`refs/general/research_brief.md` for citation, score ladder, and plotting rules.

## Discussion SQLite Browser

Use this when a Rich table/query UX is more convenient than the native JSON
cache. The native `disc_list.py`/`disc_get.py` remains preferred when nested
comment structure and preserved raw author metadata are required.

```bash
python "$NVK/discussion_ingest.py" <competition-slug> --max-pages 3 --sort-by hotness
python "$NVK/discussion_query.py" <competition-slug> --search "metric" --limit 20
python "$NVK/discussion_read.py" <discussion-id> --competition-id <competition-slug>
python "$NVK/discussion_db_info.py" <competition-slug>
```

Run ingest before query/read if the cache is empty.

## Kernel SQLite Browser And Score Tools

Use this for Rich notebook/kernel browsing, exact SDK public-score enrichment,
or public-LB historical version archiving.

```bash
python "$NVK/kernel_ingest.py" <competition-slug> --max-pages 3 --sort-by voteCount
python "$NVK/kernel_query.py" <competition-slug> --search "ensemble" --limit 20
python "$NVK/kernel_read.py" "owner/kernel-slug" --competition-id <competition-slug>
python "$NVK/kernel_db_info.py" <competition-slug>

python "$NVK/fetch_top_kernel_scores.py" <competition-slug> --sort descending
python "$NVK/fetch_kernel_score.py" "owner/kernel-slug"
```

Public-LB archive helper:

```bash
python "$NVK/kernel_archive.py" "owner/kernel-slug" --scores-only
python "$NVK/kernel_archive.py" "owner/kernel-slug" <output-dir> \
  --score-direction auto
python "$NVK/kernel_archive.py" "owner/kernel-slug" <output-dir> --version 12
```

Use archive results for research and reproduction. Do not treat public-LB best
version selection as final private-LB model selection.

## Local Kernel Reproduction

When asked to reproduce a public Kaggle notebook locally:

1. Confirm disk space before downloading inputs or outputs.
2. Pull source and metadata:

   ```bash
   kaggle kernels pull <owner/kernel> -p <folder>/working/
   kaggle kernels pull <owner/kernel> -m -p <folder>/tmp/
   ```

3. Use `kernel-metadata.json` as the source of truth for `competition_sources`,
   `dataset_sources`, `model_sources`, and `kernel_sources`.
4. Download only the needed inputs under `<folder>/input/`; use
   `kaggle competitions download`, `kaggle datasets download`,
   `kaggle models instances versions download`, and `kaggle kernels output` as
   appropriate.
5. Scan the notebook for `/kaggle/input/...` paths and create a symlink script
   instead of editing source paths when possible.
6. Write a README with source table, local paths, unresolved inputs, dependency
   hints, GPU/runtime metadata, and file-tree summary.

The native `nb_download.py --source/--all` is still the quickest way to capture a
versioned notebook source/input/output manifest.

## Submission Quota And Code Competition Submission

Quota guard:

```bash
python "$NVK/submission_quota.py" <competition-slug-or-url> \
  --by-user --by-day --as-json
```

If `exhausted` is true, do not submit. Treat unknown quota counts as a warning,
not permission to burn a slot.

Code competition kernel push/submit/poll:

```bash
PYTHONUNBUFFERED=1 python "$NVK/submit_kernel.py" <kernel-folder> \
  --competition <competition-slug> --file submission.csv --message "baseline v1"
PYTHONUNBUFFERED=1 python "$NVK/submit_kernel.py" <pulled-kernel-folder> \
  --competition <competition-slug> --file submission.csv -v <version>
```

Never rerun blindly. If `kernel-metadata.json` contains multiple
`competition_sources`, the helper fails unless `--competition` selects exactly
one target. Read existing logs, confirm the previous process exited, and require
explicit user intent before retrying any action that may consume a submission
slot.

## Dataset Upload Helper

Use when the user wants automated Kaggle dataset metadata handling.

```bash
python "$NVK/upload_dataset.py" <data-folder> \
  --title "My Dataset" --license CC0-1.0 --version-notes "notes"
python "$NVK/upload_dataset.py" <data-folder> --license CC0-1.0 --public
```

New datasets are private unless `--public` is explicitly requested; existing
metadata keeps its current `isPrivate` value unless `--public` or `--private` is
passed. Require an explicit license for newly generated metadata; preserve
existing metadata fields when the local `dataset-metadata.json` already has
them. If collaborators are added, verify metadata after the SDK update because
Kaggle may treat collaborators as a dataset-settings update. Record dataset
slug, command, file manifest/hashes, status, and URL in the active repo.

## Competition Page Helpers

Native `comp_page.py` is broader and preferred. NVIDIA helpers are available for
quick overview/data-description fetches:

```bash
python "$NVK/fetch_competition_info.py" <competition-slug-or-url>
python "$NVK/fetch_dataset_info.py" <competition-slug-or-url>
```

## Safety Notes

- Internal Kaggle endpoints can change. Preserve failing command/output and keep
  retries bounded.
- Public notebooks, scores, votes, and comments are mutable; record `fetched_at`
  and source URLs.
- Label all public artifacts with leakage/rule risk before using them in local
  experiments.
- Do not print or log `KAGGLE_API_TOKEN`.
