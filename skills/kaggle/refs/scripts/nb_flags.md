# `nb_flags.py`

Detect notebook official/pinned signals that ordinary `kaggle kernels list`
does not reliably expose.

```bash
python ./scripts/nb_flags.py \
  --competition SLUG \
  --notebook OWNER/KERNEL \
  --format json \
  --out PATH
```

If no `--notebook` is supplied, the script scans the competition Code page and
reports notebook-like slugs it can see, up to `--limit`.

Use the Kaggle CLI for normal notebook listing, pulling, and output download.
