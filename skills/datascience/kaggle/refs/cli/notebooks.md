# Notebooks

Use the Kaggle CLI directly for ordinary notebook listing, source pulls,
outputs, and publishing notebook code.

```bash
kaggle kernels list --competition SLUG --page-size N --sort-by hotness --csv
kaggle kernels list --competition SLUG --page-size N --sort-by dateRun --csv
kaggle kernels list --competition SLUG --page-size N --sort-by voteCount --csv
kaggle kernels list --competition SLUG --page-size N --sort-by commentCount --csv
kaggle kernels list --competition SLUG --page-size N --sort-by scoreDescending --csv
kaggle kernels pull OWNER/KERNEL -p PATH -m
kaggle kernels pull OWNER/KERNEL/VERSION -p PATH -m
kaggle kernels output OWNER/KERNEL -p PATH -o
kaggle kernels output OWNER/KERNEL/VERSION -p PATH -o
kaggle kernels init -p NOTEBOOK_DIR
kaggle kernels push -p NOTEBOOK_DIR
kaggle kernels status OWNER/KERNEL
kaggle kernels logs OWNER/KERNEL
```

`scoreDescending` sorts by current notebook score, but the CSV output may omit
the score value. Cross-check visible score signals in the notebook title, page
metadata, oEmbed, output logs, or notebook text.

Use `OWNER/KERNEL/VERSION` when a specific notebook version matters. Otherwise
the CLI uses the latest accessible version. Use `kaggle kernels logs` to capture
run logs for provenance or failed notebook runs; add `--follow` only while
actively monitoring a running kernel.

Top-voted notebooks:

```bash
kaggle kernels list --competition SLUG --page-size N --sort-by voteCount --csv
```

Use `scripts/nb_flags.py` only when official or pinned page signals are needed,
because those are not reliably exposed in CLI notebook listing.

Use `scripts/nb_versions.py` when version history or per-version public score
tracking is needed; the CLI does not expose complete version/LB history.

Use `scripts/nb_list.py` for stable search/sort output and optional metadata
snapshots. Use `scripts/nb_download.py` for versioned source/input/output
downloads.

If `kaggle kernels pull OWNER/KERNEL` returns `403 Permission 'kernels.get' was
denied`, inspect the notebook page for `scriptVersionId` and try:

```bash
curl -L -A 'Mozilla/5.0' \
  "https://www.kaggle.com/kernels/scriptcontent/SCRIPT_VERSION_ID/download" \
  -o notebook.ipynb
```

For notebook inputs, parse `metadata.kaggle.dataSources` from the pulled
notebook, then download referenced datasets with:

```bash
kaggle datasets download OWNER/DATASET -p PATH
```

Notebook scores, votes, comments, and outputs are mutable. Record `fetched_at`,
slug, current metadata, pulled path, and output hashes.
