# `cache.py`

Maintain a project-local Kaggle routine cache and search index.

The default cache root is the current working directory:

```text
.kaggle-skill/cache/
```

Initialize it at the start of a competition repo and keep it out of git:

```bash
python .agents/skills/datascience/kaggle/scripts/cache.py init --write-gitignore
```

Use this cache for daily Kaggle routine work when fresh remote data is not
needed, and refresh it manually when the user asks.

## Refresh

Competition overview/data/rules:

```bash
python .agents/skills/datascience/kaggle/scripts/cache.py refresh competition \
  --competition SLUG
```

Discussion topics, optionally with visible comments:

```bash
python .agents/skills/datascience/kaggle/scripts/cache.py refresh discussions \
  --competition SLUG \
  --sort recent \
  --limit 50 \
  --comments
```

Notebook list snapshots:

```bash
python .agents/skills/datascience/kaggle/scripts/cache.py refresh notebooks \
  --competition SLUG \
  --sort dateRun \
  --sort voteCount \
  --sort scoreDescending \
  --page-size 50 \
  --with-meta
```

One notebook's version/update metadata:

```bash
python .agents/skills/datascience/kaggle/scripts/cache.py refresh notebook-versions \
  --competition SLUG \
  --notebook OWNER/KERNEL
```

Submissions:

```bash
python .agents/skills/datascience/kaggle/scripts/cache.py refresh submissions \
  --competition SLUG \
  --page-size 100
```

Routine all-in-one refresh:

```bash
python .agents/skills/datascience/kaggle/scripts/cache.py refresh all \
  --competition SLUG \
  --comments \
  --with-meta
```

## Search

Search defaults to `index.sqlite` under the cache root:

```bash
python .agents/skills/datascience/kaggle/scripts/cache.py search \
  --competition SLUG \
  "eval update"

python .agents/skills/datascience/kaggle/scripts/cache.py search \
  --competition SLUG \
  --kind discussion \
  "scoring bug"

python .agents/skills/datascience/kaggle/scripts/cache.py status \
  --competition SLUG
```

## Storage Model

`current.json` files are overwritten by refreshes and are the default source for
local search.

Mutable score signals are also written to append-only observations when a
previous non-empty value changes:

- submissions: status/publicScore/privateScore changes
- notebooks: latest/best score snapshot changes

Kaggle CLI submission output may not expose a stable submission id. The cache
therefore creates a local key from `fileName`, `date`, and `description`. This
is enough to detect score/status refreshes such as competition evaluation script
changes that rescore existing submissions.

Notebook version metadata is stored by version when available. Notebook score
signals are treated as observations of the current Kaggle state, not as an
authoritative immutable per-version score history, because Kaggle may expose
latest scores differently from historical version scores.

Competition brief pages and discussion topics/comments do not have a Kaggle
version concept in this skill. Their current cache is overwritten, with
`fetched_at`, source URL, and indexed content preserved for local search.
