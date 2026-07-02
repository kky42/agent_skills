# `comp_page.py`

Fetch competition page sections that the Kaggle CLI does not expose.

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

- `markdown` — the original page source markdown (tables, code fences, lists
  preserved). Prefer this when reconstructing clean `.md` files. `--format md`
  emits this.
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
