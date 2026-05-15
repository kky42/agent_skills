# `disc_list.py`

List competition discussion topics with filters that Kaggle CLI does not
provide.

```bash
python .agents/skills/datascience/kaggle/scripts/disc_list.py \
  --competition SLUG \
  --sort votes \
  --limit 20 \
  --format json \
  --out PATH
```

Supported sorts: `recent`, `votes`, `comments`, `hot`.

The script writes `schema_version`, topic URL/id, title, author, `author_identity`
with user id/user name/profile URL when visible, votes, comments, last activity,
official flag, pinned flag, raw topic payload, and `fetched_at`.
