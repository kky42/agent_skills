# Datasets

Use the Kaggle CLI directly for dataset create/version/status.

```bash
kaggle datasets init -p DATASET_DIR
kaggle datasets create -p DATASET_DIR --dir-mode zip
kaggle datasets version -p DATASET_DIR -m "VERSION NOTES" --dir-mode zip
kaggle datasets status OWNER/DATASET
kaggle datasets status OWNER/DATASET --format json
```

Use `--public` only when the objective calls for a public dataset. Use
`--delete-old-versions` only when older versions are intentionally disposable.

Prefer `--format json` when an automation needs the current version number or
machine-readable status.

Record dataset slug, command, message, file manifest, hashes, status, and
creation/version time in the active repo.
