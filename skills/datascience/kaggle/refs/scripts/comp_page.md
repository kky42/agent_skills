# `comp_page.py`

Fetch competition page sections that the Kaggle CLI does not expose.

```bash
python .agents/skills/datascience/kaggle/scripts/comp_page.py \
  --competition SLUG \
  --format json \
  --out PATH
```

The script fetches the public competition tab pages for Overview, Data, Code,
Models, Discussion, Leaderboard, Rules, Team, and Submissions, then writes
structured text with source URLs, HTTP status, titles, and `fetched_at`.

For stable intake, consume `schema_version`, `meta`, and `brief`. `brief`
contains the full `overview`, `data`, and `rules` section records. Keep raw API
payloads because competition metadata can gain fields over time.

Use CLI docs for file download, notebook listing, submissions, and datasets.
