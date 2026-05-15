#!/usr/bin/env python3
"""Fetch one Kaggle discussion page and its visible comments."""

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
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 kaggle-skill/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            try:
                return resp.status, resp.read().decode("utf-8", errors="replace"), None
            except http.client.IncompleteRead as exc:
                return resp.status, exc.partial.decode("utf-8", errors="replace"), str(exc)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace"), str(exc)
    except urllib.error.URLError as exc:
        return None, "", str(exc)


def api_get(path: str, params: dict[str, Any], timeout: float) -> tuple[int | None, dict[str, Any] | None, str | None]:
    url = "https://www.kaggle.com/api/i/" + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 kaggle-skill/1.0", "Accept": "application/json"})
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


def clean_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", value)).split())
    return text or None


def page_title(source: str) -> str | None:
    match = re.search(r"<title[^>]*>(.*?)</title>", source, flags=re.I | re.S)
    return clean_text(match.group(1)) if match else None


def visible_text(source: str) -> str:
    parser = TextParser()
    parser.feed(source)
    return "\n".join(parser.parts)


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


def as_int(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        match = re.search(r"-?\d+", value.replace(",", ""))
        if match:
            return int(match.group(0))
    return None


def as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in {"true", "yes", "official", "host", "staff"}
    return bool(value)


def normalize_user(obj: Any, fallback_name: Any = None, author_type: Any = None) -> dict[str, Any]:
    user = obj if isinstance(obj, dict) else {}
    profile_url = pick(user, ("profileUrl", "url"))
    if isinstance(profile_url, str) and profile_url.startswith("/"):
        profile_url = "https://www.kaggle.com" + profile_url
    user_name = clean_text(pick(user, ("userName", "slug")))
    if not user_name and isinstance(profile_url, str):
        user_name = profile_url.rstrip("/").split("/")[-1]
    return {
        "id": pick(user, ("id", "userId")),
        "user_name": user_name,
        "display_name": clean_text(pick(user, ("displayName", "name"))) or clean_text(fallback_name),
        "profile_url": profile_url,
        "thumbnail_url": pick(user, ("thumbnailUrl", "avatarUrl")),
        "tier": clean_text(pick(user, ("tier", "performanceTier")),
        ),
        "type": clean_text(author_type),
        "raw": user or None,
    }


def normalize_comment(obj: dict[str, Any]) -> dict[str, Any] | None:
    body = clean_text(pick(obj, ("body", "content", "message", "text", "html", "markdown", "contentMarkdown")))
    if not body or len(body) < 2:
        return None
    author_obj = pick(obj, ("author", "owner", "user", "createdBy"))
    author_type = clean_text(pick(obj, ("authorType", "lastCommenterType")))
    author = normalize_user(author_obj, pick(obj, ("authorDisplayName", "authorName", "ownerName", "userName")), author_type)
    official = author_type in {"HOST", "ADMIN", "host", "admin"} or as_bool(pick(obj, ("isOfficial", "official", "isHost", "host"))) or bool(
        isinstance(author_obj, dict) and as_bool(pick(author_obj, ("isHost", "isCompetitionHost", "isKaggle")))
    )
    return {
        "id": pick(obj, ("id", "commentId", "messageId")),
        "author": author.get("display_name") or author.get("user_name"),
        "author_identity": author,
        "created_at": clean_text(pick(obj, ("createdAt", "dateCreated", "postedAt", "creationDate"))),
        "updated_at": clean_text(pick(obj, ("updatedAt", "lastModified", "editedAt"))),
        "votes": as_int(pick(obj, ("voteCount", "votes", "score", "totalVotes"))),
        "official": official,
        "body": body,
        "raw": obj,
    }


def normalize_topic(obj: dict[str, Any]) -> dict[str, Any]:
    topic = obj.get("forumTopic") if isinstance(obj.get("forumTopic"), dict) else obj
    author_obj = topic.get("authorUser") if isinstance(topic.get("authorUser"), dict) else {}
    title = clean_text(topic.get("name") or topic.get("title"))
    author_type = clean_text(topic.get("authorType"))
    author = normalize_user(author_obj, topic.get("authorUserDisplayName") or topic.get("authorUserName"), author_type)
    raw_url = topic.get("url") or topic.get("topicUrl")
    url = "https://www.kaggle.com" + raw_url if isinstance(raw_url, str) and raw_url.startswith("/") else raw_url
    return {
        "id": topic.get("id"),
        "url": url,
        "title": title,
        "author": author.get("display_name") or author.get("user_name"),
        "author_identity": author,
        "author_type": author_type,
        "votes": as_int(topic.get("totalVotes") or topic.get("votes") or topic.get("voteCount")),
        "comments": as_int(topic.get("totalMessages") or topic.get("commentCount")),
        "post_date": clean_text(topic.get("postDate")),
        "official": author_type in {"HOST", "ADMIN", "host", "admin"} or as_bool(topic.get("isOfficial")),
        "pinned": as_bool(topic.get("isStickied") or topic.get("isSticky") or topic.get("isPinned")),
        "first_message_id": topic.get("firstMessageId") or topic.get("firstForumMessageId"),
        "raw": topic,
    }


def merge_topic(base: dict[str, Any] | None, extra: dict[str, Any]) -> dict[str, Any]:
    if base is None:
        return extra
    merged = dict(base)
    for key, value in extra.items():
        if value not in (None, "", False):
            merged[key] = value
    merged["official"] = bool(base.get("official") or extra.get("official"))
    merged["pinned"] = bool(base.get("pinned") or extra.get("pinned"))
    return merged


def topic_from_competition_list(competition: str, topic_id: str, timeout: float) -> dict[str, Any] | None:
    _status, comp, _error = api_get(
        "competitions.CompetitionService/GetCompetition",
        {"competitionName": competition},
        timeout,
    )
    if not isinstance(comp, dict) or comp.get("forumId") is None:
        return None
    _status, data, _error = api_get(
        "discussions.DiscussionsService/GetTopicListByForumId",
        {"forumId": comp["forumId"]},
        timeout,
    )
    if not isinstance(data, dict) or not isinstance(data.get("topics"), list):
        return None
    for item in data["topics"]:
        if isinstance(item, dict) and str(item.get("id")) == str(topic_id):
            return normalize_topic(item)
    return None


def discussion_url(args: argparse.Namespace) -> str:
    if args.url:
        return args.url
    if not args.competition or not args.topic_id:
        raise SystemExit("Provide --url or both --competition and --topic-id")
    return f"https://www.kaggle.com/competitions/{args.competition}/discussion/{args.topic_id}"


def topic_id_from_url(url: str) -> str | None:
    match = re.search(r"/discussion/(\d+)", url)
    return match.group(1) if match else None


def render_md(record: dict[str, Any]) -> str:
    lines = [f"# {record.get('title') or 'Kaggle Discussion'}", "", f"URL: {record['source_url']}", f"Fetched: {record['fetched_at']}", ""]
    for idx, item in enumerate(record["comments"], start=1):
        flags = " official" if item.get("official") else ""
        author = item.get("author") or "unknown"
        lines.extend([f"## Comment {idx}: {author}{flags}", "", item.get("body") or "", ""])
    if not record["comments"] and record.get("visible_text"):
        lines.extend(["## Visible Text", "", record["visible_text"]])
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url")
    parser.add_argument("--competition")
    parser.add_argument("--topic-id")
    parser.add_argument("--format", choices=["json", "md"], default="json")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args()

    url = discussion_url(args)
    topic_id = args.topic_id or topic_id_from_url(url)
    api_meta: dict[str, Any] = {}
    topic: dict[str, Any] | None = None
    if topic_id:
        topic_status, topic_data, topic_error = api_get(
            "discussions.DiscussionsService/GetForumTopicById",
            {"forumTopicId": topic_id},
            args.timeout,
        )
        api_meta["topic"] = {"status": topic_status, "error": topic_error}
        if isinstance(topic_data, dict) and isinstance(topic_data.get("forumTopic"), dict):
            topic = normalize_topic(topic_data["forumTopic"])
    if topic_id and args.competition:
        list_topic = topic_from_competition_list(args.competition, topic_id, args.timeout)
        if list_topic:
            topic = merge_topic(topic, list_topic)
    status, source, error = fetch(url, args.timeout)
    comments: list[dict[str, Any]] = []
    seen: set[tuple[str | None, str | None]] = set()
    for block in json_blocks(source):
        for obj in flatten_dicts(block):
            comment = normalize_comment(obj)
            if not comment:
                continue
            key = (str(comment.get("id")), comment.get("body"))
            if key not in seen:
                seen.add(key)
                comments.append(comment)
    record = {
        "schema_version": "kaggle.discussion_thread.v1",
        "source_url": url,
        "status": status,
        "error": error,
        "api": api_meta,
        "topic": topic,
        "title": (topic or {}).get("title") or page_title(source),
        "fetched_at": now_iso(),
        "comments": comments,
        "visible_text": visible_text(source)[:12000] if not comments else None,
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
