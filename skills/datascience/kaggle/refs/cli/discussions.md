# Discussions

Use the Kaggle CLI directly for ordinary discussion *browsing* (listing topics,
a quick look at a thread). To **fetch a full discussion** — all content plus the
complete comment tree with reply nesting and author names — use
`./scripts/disc_get.py` (see `./refs/scripts/disc_get.md`); no single CLI command
returns all three together.

Competition topics:

```bash
kaggle competitions topics list SLUG --page 1 --csv
kaggle competitions topics show SLUG TOPIC_ID
```

CLI trade-offs for reading a single thread:

- Default `topics show` renders a nested reply tree with author names, but may
  truncate long comments.
- `topics show -q --format json` returns full comment bodies but flattens the
  tree, may omit some authors, and does not include the opening-post body.
- `./scripts/disc_get.py` returns the opening post, full bodies, reply nesting,
  and available author names in one artifact. Prefer it for archival work.

`topic-messages` is a deprecated compatibility alias; the official docs say it
will be removed. Do not build new workflows around it. When writing JSON from paginated CLI commands, use
`-q` so a next-page notice is not appended after the JSON document.

General forum topics:

```bash
kaggle forums list --csv
kaggle forums topics list getting-started --sort-by hot --page-size 20 --csv
kaggle forums topics show getting-started TOPIC_ID
```

Dataset topics:

```bash
kaggle datasets topics list OWNER/DATASET --sort-by recent --page-size 20 --csv
kaggle datasets topics show OWNER/DATASET TOPIC_ID
```

Model and benchmark topic commands follow the same `topics list/show` shape.

Use `./scripts/disc_list.py` for a topic list with pinned/official flags,
preserved raw payloads, and durable author identity fields. Use
`./scripts/disc_get.py` to fetch a single thread in full (nested comments + author
names) as a stable JSON/MD artifact for cache/search.

Use OpenCLI browser fallback only for write operations or UI-only actions such
as posting topics, replying, editing, voting, bookmarking, or notebook comments.
