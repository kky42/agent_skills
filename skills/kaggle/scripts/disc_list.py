#!/usr/bin/env python3
"""List Kaggle competition discussion topics from page data."""

from __future__ import annotations

import argparse
import datetime as dt
import html
import http.client
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


SORT_QUERY = {
    "recent": "recent",
    "votes": "votes",
    "comments": "comments",
    "hot": "hotness",
}


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
        return value.lower() in {"true", "yes", "official", "pinned", "host"}
    return bool(value)


def clean_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", value)).split())
    return text or None


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
        "tier": clean_text(pick(user, ("tier", "performanceTier"))),
        "type": clean_text(author_type),
        "raw": user or None,
    }


def normalize_topic(obj: dict[str, Any], competition: str) -> dict[str, Any] | None:
    title = clean_text(pick(obj, ("title", "name", "topicTitle", "forumTopicTitle")))
    topic_id = pick(obj, ("id", "topicId", "forumTopicId", "forumTopicIdNullable"))
    url = pick(obj, ("url", "topicUrl", "forumTopicUrl"))
    if not title:
        return None
    if not topic_id and isinstance(url, str):
        match = re.search(r"/discussion/(\d+)", url)
        topic_id = match.group(1) if match else None
    signal_keys = {k.lower() for k in obj}
    if not topic_id and not any(k in signal_keys for k in {"votecount", "commentcount", "totalmessages", "lastcommentdate", "lastactivitydate"}):
        return None
    if isinstance(url, str) and url.startswith("/"):
        url = "https://www.kaggle.com" + url
    if not url and topic_id:
        url = f"https://www.kaggle.com/competitions/{competition}/discussion/{topic_id}"
    author_obj = pick(obj, ("author", "authorUser", "owner", "user", "createdBy"))
    author_type = clean_text(pick(obj, ("authorType", "lastCommenterType")))
    author = normalize_user(
        author_obj,
        pick(obj, ("authorDisplayName", "authorUserDisplayName", "authorName", "ownerName", "userName")),
        author_type,
    )
    official = author_type in {"HOST", "ADMIN", "host", "admin"} or as_bool(pick(obj, ("isOfficial", "official", "isHost", "host"))) or bool(
        isinstance(author_obj, dict) and as_bool(pick(author_obj, ("isHost", "isCompetitionHost", "isKaggle")))
    )
    pinned = as_bool(pick(obj, ("isPinned", "pinned", "sticky", "isSticky")))
    return {
        "id": str(topic_id) if topic_id is not None else None,
        "url": url,
        "title": title,
        "author": author.get("display_name") or author.get("user_name"),
        "author_identity": author,
        "votes": as_int(pick(obj, ("voteCount", "votes", "totalVotes", "score"))),
        "comments": as_int(pick(obj, ("commentCount", "comments", "replyCount", "totalMessages", "messageCount"))),
        "last_activity": clean_text(pick(obj, ("lastCommentPostDate", "lastCommentDate", "lastActivityDate", "lastMessageTime", "updatedAt", "postDate"))),
        "official": official,
        "pinned": pinned,
        "raw": obj,
    }


def fallback_topics(source: str, competition: str) -> list[dict[str, Any]]:
    topics: list[dict[str, Any]] = []
    pattern = rf"/competitions/{re.escape(competition)}/discussion/(\d+)[^\"'<> ]*"
    for match in re.finditer(pattern, source):
        topic_id = match.group(1)
        topics.append({
            "id": topic_id,
            "url": f"https://www.kaggle.com/competitions/{competition}/discussion/{topic_id}",
            "title": None,
            "author": None,
            "votes": None,
            "comments": None,
            "last_activity": None,
            "official": False,
            "pinned": False,
        })
    return topics


def sort_topics(topics: list[dict[str, Any]], sort: str) -> list[dict[str, Any]]:
    if sort == "votes":
        return sorted(topics, key=lambda x: x.get("votes") or 0, reverse=True)
    if sort == "comments":
        return sorted(topics, key=lambda x: x.get("comments") or 0, reverse=True)
    if sort == "hot":
        return sorted(topics, key=lambda x: (x.get("pinned") is True, x.get("votes") or 0, x.get("comments") or 0), reverse=True)
    return topics


def competition_forum_id(competition: str, timeout: float) -> tuple[int | None, dict[str, Any]]:
    status, data, error = api_get(
        "competitions.CompetitionService/GetCompetition",
        {"competitionName": competition},
        timeout,
    )
    meta = {"status": status, "error": error}
    if isinstance(data, dict):
        meta["competition"] = data
        forum_id = data.get("forumId")
        if isinstance(forum_id, int):
            return forum_id, meta
    return None, meta


def topics_from_api(competition: str, forum_id: int, timeout: float) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    status, data, error = api_get(
        "discussions.DiscussionsService/GetTopicListByForumId",
        {"forumId": forum_id},
        timeout,
    )
    meta = {"status": status, "error": error, "forum_id": forum_id}
    topics: list[dict[str, Any]] = []
    if isinstance(data, dict) and isinstance(data.get("topics"), list):
        for obj in data["topics"]:
            if isinstance(obj, dict):
                topic = normalize_topic(obj, competition)
                if topic:
                    topics.append(topic)
        if data.get("count") is not None:
            meta["count"] = data.get("count")
    return topics, meta


def render_md(record: dict[str, Any]) -> str:
    lines = [f"# Kaggle Discussions: {record['competition']}", "", f"Fetched: {record['fetched_at']}", f"Sort: {record['sort']}", ""]
    for item in record["topics"]:
        title = item.get("title") or item.get("id") or "topic"
        flags = ", ".join(flag for flag in ("official" if item.get("official") else "", "pinned" if item.get("pinned") else "") if flag)
        suffix = f" ({flags})" if flags else ""
        lines.append(f"- {title}{suffix}: {item.get('url')}")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--competition", required=True)
    parser.add_argument("--sort", choices=sorted(SORT_QUERY), default="recent")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--format", choices=["json", "md"], default="json")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args()

    query = urllib.parse.urlencode({"sort": SORT_QUERY[args.sort]})
    url = f"https://www.kaggle.com/competitions/{args.competition}/discussion?{query}"
    forum_id, competition_api = competition_forum_id(args.competition, args.timeout)
    topics: list[dict[str, Any]] = []
    seen: set[str] = set()
    topic_api: dict[str, Any] = {}
    status: int | None = None
    error: str | None = None
    if forum_id is not None:
        topics, topic_api = topics_from_api(args.competition, forum_id, args.timeout)
    if not topics:
        status, source, error = fetch(url, args.timeout)
        for block in json_blocks(source):
            for obj in flatten_dicts(block):
                topic = normalize_topic(obj, args.competition)
                if not topic:
                    continue
                key = topic.get("id") or topic.get("url") or topic.get("title")
                if key and key not in seen:
                    seen.add(key)
                    topics.append(topic)
        if not topics:
            for topic in fallback_topics(source, args.competition):
                key = topic.get("id") or topic.get("url")
                if key and key not in seen:
                    seen.add(key)
                    topics.append(topic)
    else:
        deduped = []
        for topic in topics:
            key = topic.get("id") or topic.get("url") or topic.get("title")
            if key and key not in seen:
                seen.add(key)
                deduped.append(topic)
        topics = deduped
    topics = sort_topics(topics, args.sort)[: args.limit]
    record = {
        "schema_version": "kaggle.discussion_list.v1",
        "competition": args.competition,
        "source_url": url,
        "status": status,
        "error": error,
        "api": {
            "competition": competition_api,
            "topics": topic_api,
        },
        "sort": args.sort,
        "fetched_at": now_iso(),
        "topics": topics,
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
