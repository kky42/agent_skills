# `disc_get.py`

Fetch one discussion page and its visible comments with preserved raw metadata.
Use `refs/cli/discussions.md` first for ordinary discussion browsing.

```bash
python .agents/skills/datascience/kaggle/scripts/disc_get.py \
  --url "https://www.kaggle.com/competitions/SLUG/discussion/TOPIC_ID" \
  --format json \
  --out PATH
```

Alternatively pass `--competition SLUG --topic-id TOPIC_ID`.

The script first fetches topic metadata from Kaggle's JSON endpoint, then tries
to extract visible comment data from page JSON/HTML. It preserves topic/comment
`author_identity` with user id/user name/profile URL when visible. Comment
bodies may require an authenticated browser session if Kaggle does not expose
them in the fetched page.
