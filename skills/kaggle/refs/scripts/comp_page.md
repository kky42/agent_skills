# `comp_page.py`

Use the CLI for a page list or one page body:

```bash
kaggle competitions pages SLUG --format json
kaggle competitions pages SLUG --page-name evaluation --content --format json
```

Use `comp_page.py` when the task needs aggregated Overview siblings, stable
`meta`/`brief` records, raw PageService payloads, or status/title snapshots for
all competition tabs:

```bash
python ./scripts/comp_page.py \
  --competition SLUG \
  --format json \
  --out PATH
```

The script fetches the public competition tab pages for Overview, Data, Code,
Models, Discussion, Leaderboard, Rules, Team, and Submissions, then writes
structured text with source URLs, HTTP status, titles, and `fetched_at`.

Each section record carries two bodies:

- `markdown` — the page body with internal formatting preserved; outer
  whitespace is trimmed, Overview siblings receive generated headings, and the
  body may contain HTML. `--format md` wraps these bodies in a report.
- `text` — a flattened, whitespace-collapsed plaintext scrape (legacy field).

The Kaggle **Overview tab is composed of several sibling pages** (Description,
What Makes This Different, Getting Started, Evaluation, Timeline, Code
Requirements, Prizes, abstract, ...). The `overview` section aggregates **all**
of them in reading order — do not assume Evaluation/Timeline/Prizes live
elsewhere. `section.page_names` lists every page folded into that section. Only
the Data and Rules tabs own their own dedicated content pages.

For stable intake, consume `schema_version`, `meta`, and `brief`. `brief`
contains the full `overview`, `data`, and `rules` section records. The raw
`competitions.PageService/ListPages` payload is preserved under
`api.pages.data` (all page names + bodies), so nothing is silently dropped if
a host adds a new overview sub-page. Keep raw API payloads because competition
metadata can gain fields over time.

Use CLI docs for file download, notebook listing, submissions, and datasets.
