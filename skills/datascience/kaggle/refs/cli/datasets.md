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

Use the NVIDIA-derived upload helper only when automated metadata preservation,
collaborators, or sanitized create/version flow is useful. It preserves an
existing `dataset-metadata.json` identity/privacy by default and requires
`--license` only when generating metadata without an existing license:

```bash
python "$HOME/.agents/skills/kaggle/scripts/nvidia/upload_dataset.py" DATASET_DIR \
  --title "My Dataset" --license CC0-1.0 --version-notes "notes"
```

Record dataset slug, command, message, file manifest, hashes, status, and
creation/version time in the active repo.
