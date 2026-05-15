#!/usr/bin/env python3
"""Detect Kaggle notebook official/pinned page signals."""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def fetch(url: str, timeout: float) -> tuple[int | None, str, str | None]:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 kaggle-skill/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace"), None
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace"), str(exc)
    except urllib.error.URLError as exc:
        return None, "", str(exc)


def json_blocks(source: str) -> list[Any]:
    blocks: list[Any] = []
    for pattern in (
        r"<script[^>]+type=[\"']application/json[\"'][^>]*>(.*?)</script>",
        r"<script[^>]+id=[\"']__NEXT_DATA__[\"'][^>]*>(.*?)</script>",
    ):
        for match in re.finditer(pattern, source, re.I | re.S):
            raw = html.unescape(match.group(1)).strip()
            try:
                blocks.append(json.loads(raw))
            except json.JSONDecodeError:
                pass
    return blocks


def flatten_dicts(value: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if isinstance(value, dict):
        found.append(value)
        for item in value.values():
            found.extend(flatten_dicts(item))
    elif isinstance(value, list):
        for item in value:
            found.extend(flatten_dicts(item))
    return found


def pick(obj: dict[str, Any], names: tuple[str, ...]) -> Any:
    lower = {k.lower(): v for k, v in obj.items()}
    for name in names:
        if name in obj:
            return obj[name]
        if name.lower() in lower:
            return lower[name.lower()]
    return None


def as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in {"true", "yes", "official", "pinned", "staff", "featured"}
    return bool(value)


def clean_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", value)).split())
    return text or None


def normalize_ref(ref: str) -> str:
    ref = ref.strip().strip("/")
    if ref.startswith("https://www.kaggle.com/"):
        ref = ref.removeprefix("https://www.kaggle.com/")
    if ref.startswith("code/"):
        ref = ref.removeprefix("code/")
    return ref


def notebook_url(ref: str) -> str:
    return f"https://www.kaggle.com/code/{normalize_ref(ref)}"


def discover_refs(source: str, limit: int) -> list[str]:
    refs: list[str] = []
    seen: set[str] = set()
    for match in re.finditer(r"(?:/code/|https://www\.kaggle\.com/code/)([A-Za-z0-9_-]+/[A-Za-z0-9_-]+)", source):
        ref = match.group(1)
        if ref not in seen:
            seen.add(ref)
            refs.append(ref)
            if len(refs) >= limit:
                break
    return refs


def flags_from_source(source: str) -> dict[str, Any]:
    lower = source.lower()
    data = {
        "official": any(token in lower for token in ("official notebook", "official solution", "competition host", "host notebook")),
        "pinned": any(token in lower for token in ("pinned", "featured")),
        "featured": "featured" in lower,
        "title": None,
    }
    title = re.search(r"<title[^>]*>(.*?)</title>", source, re.I | re.S)
    if title:
        data["title"] = clean_text(title.group(1))
    for block in json_blocks(source):
        for obj in flatten_dicts(block):
            data["official"] = data["official"] or as_bool(pick(obj, ("isOfficial", "official", "isCompetitionHost", "isHost")))
            data["pinned"] = data["pinned"] or as_bool(pick(obj, ("isPinned", "pinned", "isSticky", "sticky")))
            data["featured"] = data["featured"] or as_bool(pick(obj, ("isFeatured", "featured")))
            data["title"] = data["title"] or clean_text(pick(obj, ("title", "kernelTitle", "scriptTitle", "name")))
    return data


def scan_competition(competition: str, limit: int, timeout: float) -> list[str]:
    url = f"https://www.kaggle.com/competitions/{competition}/code"
    _status, source, _error = fetch(url, timeout)
    return discover_refs(source, limit)


def render_md(record: dict[str, Any]) -> str:
    lines = [f"# Kaggle Notebook Flags", "", f"Fetched: {record['fetched_at']}", ""]
    for ref, item in record["notebooks"].items():
        flags = ", ".join(flag for flag in ("official" if item.get("official") else "", "pinned" if item.get("pinned") else "", "featured" if item.get("featured") else "") if flag)
        suffix = f" ({flags})" if flags else ""
        lines.append(f"- {ref}{suffix}: {item.get('url')}")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--competition", help="Competition slug used for Code page discovery when --notebook is omitted")
    parser.add_argument("--notebook", action="append", default=[], help="Notebook ref OWNER/KERNEL; may repeat")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--format", choices=["json", "md"], default="json")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args()

    refs = [normalize_ref(ref) for ref in args.notebook]
    if not refs:
        if not args.competition:
            raise SystemExit("Provide --notebook or --competition")
        refs = scan_competition(args.competition, args.limit, args.timeout)
    record = {
        "competition": args.competition,
        "fetched_at": now_iso(),
        "notebooks": {},
    }
    for ref in refs[: args.limit]:
        url = notebook_url(ref)
        status, source, error = fetch(url, args.timeout)
        item = flags_from_source(source)
        item.update({"url": url, "status": status, "error": error})
        record["notebooks"][ref] = item
    output = render_md(record) if args.format == "md" else json.dumps(record, indent=2, sort_keys=True) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(output, encoding="utf-8")
    else:
        sys.stdout.write(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
