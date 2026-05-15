# Submit

Use the Kaggle CLI directly for submissions and feedback.

```bash
kaggle competitions submit -c SLUG -f SUBMISSION_FILE -m "MESSAGE"
kaggle competitions submissions -c SLUG --page-size 20 --csv
```

For code competitions, submit a kernel output when appropriate:

```bash
kaggle competitions submit -c SLUG -k OWNER/KERNEL -v VERSION -m "MESSAGE"
```

After submitting, poll `submissions` until the row reaches a terminal state or
the error is clear. Record submission file path, message, timestamp, status,
public score, and any error text in the active repo.

When a competition may have changed its evaluation script, refresh the local
cache with `scripts/cache.py refresh submissions`. Treat the current
`publicScore` returned by Kaggle as mutable for historical submissions; the
cache records score/status changes as observations instead of assuming old
submission rows are immutable.
