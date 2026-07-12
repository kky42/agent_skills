# Submit

Use the Kaggle CLI directly for submissions and feedback.

```bash
kaggle competitions submit -c SLUG -f SUBMISSION_FILE -m "MESSAGE"
kaggle competitions submissions -c SLUG --page-size 20 --csv
kaggle competitions leaderboard SLUG --show --csv
```

Before a real submit, stage the file to the exact basename expected by the
competition when that name is known (often `submission.csv` or `submission.zip`).
Some Kaggle flows can upload bytes from a differently named file and then fail
at CreateSubmission with a generic 400. Record the staged path and SHA256.

For code competitions, submit a kernel output when appropriate:

```bash
kaggle competitions submit -c SLUG -k OWNER/KERNEL -v VERSION -m "MESSAGE"
kaggle competitions submit -c SLUG -k OWNER/KERNEL -v VERSION -f OUTPUT_FILE -m "MESSAGE"
```

Before spending a slot, use the NVIDIA-derived quota helper when proactive
quota visibility is useful:

```bash
python ./scripts/nvidia/submission_quota.py SLUG \
  --by-user --by-day --as-json
```

`--by-user` uses the Kaggle SDK submission records rather than only the CLI CSV,
so counts still depend on what the authenticated account can see.

After submitting, poll `submissions` until the row reaches a terminal state or
the error is clear. Parse statuses defensively: rows may look like
`SubmissionStatus.COMPLETE` or `SubmissionStatus.ERROR`, error rows can appear
above successful rows, and score fields may be blank while judging or after an
error. If the submissions command fails, surface stderr/stdout and return a
nonzero status; do not treat it as "no submissions". Record submission file
path, message, timestamp, status, public score, and any error text in the active
repo.

If `kaggle competitions submit` prints only a generic `400 Client Error`, call
the same endpoint through the installed Kaggle SDK and print the response body.
The body often includes the actionable `FAILED_PRECONDITION`, such as a
disallowed notebook accelerator or a missing expected output file. Use the
existing authenticated Kaggle CLI environment:

```python
from kaggle.api.kaggle_api_extended import KaggleApi
from kagglesdk.competitions.types.competition_api_service import (
    ApiCreateCodeSubmissionRequest,
)
from requests.exceptions import HTTPError

api = KaggleApi()
api.authenticate()
with api.build_kaggle_client() as client:
    req = ApiCreateCodeSubmissionRequest()
    req.competition_name = "SLUG"
    req._kernel_owner = "OWNER"
    req.kernel_slug = "KERNEL"
    req.kernel_version = VERSION
    req.file_name = "OUTPUT_FILE"
    req.submission_description = "MESSAGE"
    try:
        print(client.competitions.competition_api_client.create_code_submission(req))
    except HTTPError as err:
        if err.response is not None:
            print(err.response.status_code)
            print(err.response.text)
        raise
```

For long-running code-competition kernel push/submit/poll workflows, use
`./refs/scripts/nvidia.md`, pass `--competition` when metadata contains multiple
competition sources, and never rerun blindly; each successful submit can spend a
daily slot.

For public leaderboard forensics, inspect a team's public submissions when the
team id is visible from `leaderboard --show`:

```bash
kaggle competitions team-submissions TEAM_ID --csv
```

For regular competitions this reports the public leaderboard submission; for
simulation competitions it reports active public submissions. The CLI and SDK can
list submission metadata but may not expose teammate artifact downloads. If an
authorized browser UI shows a downloadable submission file that the CLI cannot
fetch, use `../browser/submission-artifacts.md`.

Record every submission in a ledger. Keep a single ledger for full-bundle
submissions and separate per-task records for task probes. Include source,
command, timestamp, artifact path, and feedback for every entry.

When a competition may have changed its evaluation script, refresh the local
cache with `./scripts/cache.py refresh submissions`. Treat the current
`publicScore` returned by Kaggle as mutable for historical submissions; the
cache records score/status changes as observations instead of assuming old
submission rows are immutable.

`kaggle competitions submit` can return 403 even when read-only endpoints
(like `competitions list` and `submissions`) work normally. Distinguish
account/competition visibility from upload-specific rejection. Record upload
failures without assuming authentication is fully broken.
