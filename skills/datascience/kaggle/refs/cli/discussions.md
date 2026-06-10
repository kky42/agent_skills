# Discussions

Use the Kaggle CLI directly for ordinary discussion browsing before falling
back to scripts or a browser.

Competition topics:

```bash
kaggle competitions topics list SLUG --page 1 --csv
kaggle competitions topics show SLUG TOPIC_ID
kaggle competitions topic-messages SLUG TOPIC_ID --sort-by top --page-size -1 --csv
```

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

Use `scripts/disc_list.py` or `scripts/disc_get.py` when the task needs pinned
or official flags, preserved raw payloads, durable author identity fields, or a
stable JSON artifact for cache/search.

Use OpenCLI browser fallback only for write operations or UI-only actions such
as posting topics, replying, editing, voting, bookmarking, or notebook comments.
