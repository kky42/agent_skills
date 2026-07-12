#!/usr/bin/env python3
"""Aggregate Kaggle competition pages, metadata, raw payloads, and tab status."""

from __future__ import annotations

import argparse
import datetime as dt
import html
from html.parser import HTMLParser
import http.client
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


SECTIONS = {
    "overview": "",
    "data": "data",
    "code": "code",
    "models": "models",
    "discussion": "discussion",
    "leaderboard": "leaderboard",
    "rules": "rules",
    "team": "team",
    "submissions": "submissions",
}


class TextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "svg", "noscript"}:
            self.skip += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "svg", "noscript"} and self.skip:
            self.skip -= 1

    def handle_data(self, data: str) -> None:
        if not self.skip:
            text = " ".join(data.split())
            if text:
                self.parts.append(text)


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def fetch(url: str, timeout: float) -> tuple[int | None, str, str | None]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 kaggle-skill/1.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            try:
                body = resp.read()
            except http.client.IncompleteRead as exc:
                return resp.status, exc.partial.decode("utf-8", errors="replace"), str(exc)
            return resp.status, body.decode("utf-8", errors="replace"), None
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return exc.code, body, str(exc)
    except urllib.error.URLError as exc:
        return None, "", str(exc)


def api_get(path: str, params: dict[str, Any], timeout: float) -> tuple[int | None, dict[str, Any] | None, str | None]:
    url = "https://www.kaggle.com/api/i/" + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 kaggle-skill/1.0",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            try:
                body = resp.read().decode("utf-8", errors="replace")
            except http.client.IncompleteRead as exc:
                body = exc.partial.decode("utf-8", errors="replace")
                try:
                    return resp.status, json.loads(body), str(exc)
                except json.JSONDecodeError:
                    return resp.status, None, str(exc)
            return resp.status, json.loads(body), None
    except urllib.error.HTTPError as exc:
        return exc.code, None, exc.read().decode("utf-8", errors="replace") or str(exc)
    except (urllib.error.URLError, json.JSONDecodeError) as exc:
        return None, None, str(exc)


def visible_text(source: str) -> str:
    parser = TextParser()
    parser.feed(source)
    return dedupe_join(parser.parts)


def page_title(source: str) -> str | None:
    match = re.search(r"<title[^>]*>(.*?)</title>", source, flags=re.I | re.S)
    if not match:
        return None
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", match.group(1))).split())


def json_blocks(source: str) -> list[Any]:
    blocks: list[Any] = []
    for match in re.finditer(r"<script[^>]+type=[\"']application/json[\"'][^>]*>(.*?)</script>", source, re.I | re.S):
        raw = html.unescape(match.group(1)).strip()
        if raw:
            try:
                blocks.append(json.loads(raw))
            except json.JSONDecodeError:
                pass
    for match in re.finditer(r"<script[^>]+id=[\"']__NEXT_DATA__[\"'][^>]*>(.*?)</script>", source, re.I | re.S):
        raw = html.unescape(match.group(1)).strip()
        if raw:
            try:
                blocks.append(json.loads(raw))
            except json.JSONDecodeError:
                pass
    return blocks


def iter_strings(value: Any) -> list[str]:
    found: list[str] = []
    if isinstance(value, str):
        text = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", value)).split())
        if len(text) >= 24 and not text.startswith(("http://", "https://")):
            found.append(text)
    elif isinstance(value, dict):
        for item in value.values():
            found.extend(iter_strings(item))
    elif isinstance(value, list):
        for item in value:
            found.extend(iter_strings(item))
    return found


def dedupe_join(parts: list[str], max_chars: int = 12000) -> str:
    seen: set[str] = set()
    out: list[str] = []
    size = 0
    for part in parts:
        text = " ".join(part.split())
        key = text.lower()
        if not text or key in seen:
            continue
        seen.add(key)
        if size + len(text) + 1 > max_chars:
            break
        out.append(text)
        size += len(text) + 1
    return "\n".join(out)


def section_url(slug: str, suffix: str) -> str:
    base = f"https://www.kaggle.com/competitions/{slug}"
    return f"{base}/{suffix}" if suffix else base


def text_from_competition(meta: dict[str, Any]) -> str:
    fields = [
        ("Title", meta.get("title")),
        ("Brief", meta.get("briefDescription")),
        ("Enabled", meta.get("dateEnabled")),
        ("Deadline", meta.get("deadline")),
        ("Host organization id", meta.get("organizationId")),
        ("Metric", (meta.get("evaluationAlgorithm") or {}).get("name") if isinstance(meta.get("evaluationAlgorithm"), dict) else None),
        ("Required submission file", meta.get("requiredSubmissionFilename")),
        ("Max daily submissions", meta.get("maxDailySubmissions")),
        ("Scored submissions", meta.get("numScoredSubmissions")),
        ("Teams", meta.get("totalTeams")),
        ("Competitors", meta.get("totalCompetitors")),
        ("Total submissions", meta.get("totalSubmissions")),
        ("Rules required", meta.get("rulesRequired")),
    ]
    return "\n".join(f"{name}: {value}" for name, value in fields if value not in (None, ""))


SECTION_ALIASES = {
    "overview": ("overview", "description", "summary"),
    "data": ("data", "data-description"),
    "rules": ("rule", "rules"),
    "leaderboard": ("leaderboard",),
    "submissions": ("submission", "submissions"),
    "team": ("team", "teams"),
    "code": ("code", "kernel", "notebook"),
    "models": ("model", "models"),
    "discussion": ("discussion", "forum"),
}

# Reading order for the sibling pages that make up the Overview tab. Names are
# matched as case-insensitive substrings; unknown pages sort after these in
# their original API order.
OVERVIEW_PAGE_ORDER = (
    "abstract",
    "subtitle",
    "description",
    "what makes this different",
    "getting started",
    "evaluation",
    "timeline",
    "code requirements",
    "prizes",
    "citation",
    "acknowledg",
    "frequently asked",
    "faq",
)


def page_for_section(section: str, pages: list[dict[str, Any]]) -> dict[str, Any] | None:
    needles = SECTION_ALIASES.get(section, (section,))
    for page in pages:
        name = str(page.get("name") or "").lower()
        if any(needle in name for needle in needles):
            return page
    return None


def overview_pages(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return every page belonging to the Overview tab, in reading order.

    The Kaggle Overview tab is composed of several sibling pages (Description,
    What Makes This Different, Getting Started, Evaluation, Timeline, Code
    Requirements, Prizes, abstract, ...). Only the Data and Rules tabs own
    dedicated content pages, so we exclude those two and treat everything else
    as Overview content. (Pages like "Code Requirements" deliberately stay in
    Overview even though their name brushes against other section aliases.)
    """
    exclude_ids: set[Any] = set()
    for section in ("data", "rules"):
        page = page_for_section(section, pages)
        if page and page.get("id") is not None:
            exclude_ids.add(page["id"])
    selected = [p for p in pages if p.get("id") not in exclude_ids]

    def order_key(page: dict[str, Any]) -> int:
        name = str(page.get("name") or "").lower()
        for index, needle in enumerate(OVERVIEW_PAGE_ORDER):
            if needle in name:
                return index
        return len(OVERVIEW_PAGE_ORDER)

    return sorted(selected, key=order_key)


def pages_to_markdown(section_pages: list[dict[str, Any]], with_headers: bool) -> str:
    """Join page bodies while preserving their internal formatting.

    Outer whitespace is trimmed. Kaggle content is often Markdown but may contain
    HTML; multi-page sections receive a generated ``## <page name>`` header.
    """
    parts: list[str] = []
    for page in section_pages:
        content = str(page.get("content") or "").strip()
        if not content:
            continue
        name = str(page.get("name") or "").strip()
        if with_headers and name:
            parts.append(f"## {name}\n\n{content}")
        else:
            parts.append(content)
    return "\n\n".join(parts)


def render_md(record: dict[str, Any]) -> str:
    lines = [f"# Kaggle Competition Page: {record['competition']}", "", f"Fetched: {record['fetched_at']}", ""]
    for name, section in record["sections"].items():
        lines.extend([f"## {name.title()}", "", f"URL: {section['url']}", f"Status: {section['status']}", ""])
        if section.get("title"):
            lines.extend([f"Title: {section['title']}", ""])
        if section.get("error"):
            lines.extend([f"Error: {section['error']}", ""])
        # Prefer the preserved page body; fall back to the flat text scrape.
        lines.extend([section.get("markdown") or section.get("text") or "", ""])
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--competition", required=True, help="Competition slug, e.g. titanic")
    parser.add_argument("--format", choices=["json", "md"], default="json")
    parser.add_argument("--out", type=Path, help="Output path; stdout when omitted")
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args()

    record: dict[str, Any] = {
        "schema_version": "kaggle.competition_page.v1",
        "competition": args.competition,
        "fetched_at": now_iso(),
        "api": {},
        "meta": {},
        "brief": {},
        "sections": {},
    }
    comp_status, comp_meta, comp_error = api_get(
        "competitions.CompetitionService/GetCompetition",
        {"competitionName": args.competition},
        args.timeout,
    )
    record["api"]["competition"] = {"status": comp_status, "error": comp_error, "data": comp_meta}
    if isinstance(comp_meta, dict):
        metric = comp_meta.get("evaluationAlgorithm") or {}
        record["meta"] = {
            "id": comp_meta.get("id"),
            "title": comp_meta.get("title"),
            "competition_slug": comp_meta.get("competitionName") or args.competition,
            "brief_description": comp_meta.get("briefDescription"),
            "deadline": comp_meta.get("deadline"),
            "metric": metric.get("name") if isinstance(metric, dict) else None,
            "is_max": metric.get("isMax") if isinstance(metric, dict) else None,
            "required_submission_file": comp_meta.get("requiredSubmissionFilename"),
            "forum_id": comp_meta.get("forumId"),
            "host": {
                "id": comp_meta.get("organizationId") or comp_meta.get("createdByUserId"),
                "name": comp_meta.get("hostName") or (comp_meta.get("organization") or {}).get("name") if isinstance(comp_meta.get("organization"), dict) else comp_meta.get("hostName"),
                "raw": comp_meta.get("organization") if isinstance(comp_meta.get("organization"), dict) else None,
            },
            "raw": comp_meta,
        }
    pages: list[dict[str, Any]] = []
    if comp_meta and comp_meta.get("id") is not None:
        pages_status, pages_meta, pages_error = api_get(
            "competitions.PageService/ListPages",
            {"competitionId": comp_meta["id"]},
            args.timeout,
        )
        # Keep the raw ListPages payload: the Overview tab spans several pages
        # and dropping it silently loses Evaluation/Timeline/Prizes content.
        record["api"]["pages"] = {"status": pages_status, "error": pages_error, "data": pages_meta}
        if isinstance(pages_meta, dict) and isinstance(pages_meta.get("pages"), list):
            pages = pages_meta["pages"]
    for name, suffix in SECTIONS.items():
        url = section_url(args.competition, suffix)
        status, source, error = fetch(url, args.timeout)
        text_parts = [visible_text(source)]
        for block in json_blocks(source):
            text_parts.extend(iter_strings(block))
        # Overview aggregates all of its sibling pages; every other section maps
        # to at most one page.
        if name == "overview":
            section_pages = overview_pages(pages)
        else:
            page = page_for_section(name, pages)
            section_pages = [page] if page else []
        primary = section_pages[0] if section_pages else None
        markdown = pages_to_markdown(section_pages, with_headers=(name == "overview"))
        if markdown:
            text_parts.insert(0, markdown)
        if name == "overview" and comp_meta:
            text_parts.insert(0, text_from_competition(comp_meta))
        record["sections"][name] = {
            "url": url,
            "status": status,
            "title": page_title(source),
            "error": error,
            "page_id": primary.get("id") if primary else None,
            "page_name": primary.get("name") if primary else None,
            "page_names": [p.get("name") for p in section_pages],
            "markdown": markdown,
            "text": dedupe_join(text_parts),
        }
    record["brief"] = {
        "overview": record["sections"].get("overview"),
        "data": record["sections"].get("data"),
        "rules": record["sections"].get("rules"),
    }

    output = render_md(record) if args.format == "md" else json.dumps(record, indent=2, sort_keys=True) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(output, encoding="utf-8")
    else:
        sys.stdout.write(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
