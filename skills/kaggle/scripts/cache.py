#!/usr/bin/env python3
"""Local Kaggle routine cache and search.

The cache is intentionally competition-repo local by default:
  .kaggle-skill/cache/

It keeps current JSON files for daily use, plus small observation histories for
mutable signals such as submission scores and notebook latest/best scores.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
from io import StringIO
from pathlib import Path
from typing import Any


SKILL_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = SKILL_DIR / "scripts"
DEFAULT_CACHE_DIR = Path(".kaggle-skill") / "cache"


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def cache_dir(args: argparse.Namespace) -> Path:
    return Path(args.cache_dir or os.environ.get("KAGGLE_SKILL_CACHE_DIR") or DEFAULT_CACHE_DIR)


def warn_gitignore(path: Path) -> None:
    if not (Path.cwd() / ".git").exists():
        return
    rel = os.path.relpath(path, Path.cwd())
    proc = subprocess.run(["git", "check-ignore", "-q", rel], check=False)
    if proc.returncode != 0:
        print(
            f"warning: cache path {rel} is not ignored by git; add .kaggle-skill/cache/ to .gitignore",
            file=sys.stderr,
        )


def ensure_gitignore(path: Path) -> None:
    gitignore = Path(".gitignore")
    line = ".kaggle-skill/cache/"
    existing = gitignore.read_text(encoding="utf-8").splitlines() if gitignore.exists() else []
    if line not in existing:
        with gitignore.open("a", encoding="utf-8") as f:
            if existing and existing[-1]:
                f.write("\n")
            f.write(line + "\n")
    print(f"ensured {line} in {gitignore}")


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "__", value.strip()).strip("_") or "item"


def sha_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha_obj(obj: Any) -> str:
    return sha_text(json.dumps(obj, sort_keys=True, ensure_ascii=True, default=str))


def read_json(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=True, default=str) + "\n", encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.rstrip() + "\n", encoding="utf-8")


def db_path(root: Path) -> Path:
    return root / "index.sqlite"


def connect(root: Path) -> sqlite3.Connection:
    root.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path(root))
    conn.execute(
        """
        create table if not exists documents (
          id text primary key,
          kind text not null,
          competition text,
          ref text,
          version text,
          title text,
          path text,
          url text,
          fetched_at text,
          updated_at text,
          content_sha256 text,
          meta_json text
        )
        """
    )
    conn.execute(
        """
        create table if not exists observations (
          id integer primary key autoincrement,
          kind text not null,
          competition text,
          ref text,
          observed_at text not null,
          event text not null,
          previous_json text,
          current_json text,
          source_json text
        )
        """
    )
    try:
        conn.execute(
            """
            create virtual table if not exists documents_fts
            using fts5(doc_id unindexed, title, content, kind unindexed, competition unindexed, ref unindexed)
            """
        )
    except sqlite3.OperationalError:
        pass
    conn.commit()
    return conn


def upsert_doc(
    root: Path,
    *,
    doc_id: str,
    kind: str,
    competition: str | None,
    ref: str | None,
    title: str | None,
    content: str,
    path: Path,
    url: str | None = None,
    version: str | None = None,
    fetched_at: str | None = None,
    meta: dict[str, Any] | None = None,
) -> None:
    conn = connect(root)
    updated_at = now_iso()
    fetched_at = fetched_at or updated_at
    content_hash = sha_text(content)
    conn.execute(
        """
        insert into documents
          (id, kind, competition, ref, version, title, path, url, fetched_at, updated_at, content_sha256, meta_json)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          kind=excluded.kind,
          competition=excluded.competition,
          ref=excluded.ref,
          version=excluded.version,
          title=excluded.title,
          path=excluded.path,
          url=excluded.url,
          fetched_at=excluded.fetched_at,
          updated_at=excluded.updated_at,
          content_sha256=excluded.content_sha256,
          meta_json=excluded.meta_json
        """,
        (
            doc_id,
            kind,
            competition,
            ref,
            version,
            title,
            str(path),
            url,
            fetched_at,
            updated_at,
            content_hash,
            json.dumps(meta or {}, sort_keys=True, ensure_ascii=True, default=str),
        ),
    )
    try:
        conn.execute("delete from documents_fts where doc_id = ?", (doc_id,))
        conn.execute(
            "insert into documents_fts(doc_id, title, content, kind, competition, ref) values (?, ?, ?, ?, ?, ?)",
            (doc_id, title or "", content, kind, competition or "", ref or ""),
        )
    except sqlite3.OperationalError:
        pass
    conn.commit()
    conn.close()


def append_observation(root: Path, competition: str | None, item: dict[str, Any]) -> None:
    item = {"observed_at": now_iso(), **item}
    rel = Path("observations.jsonl") if not competition else Path("competitions") / competition / "observations.jsonl"
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(item, sort_keys=True, ensure_ascii=True, default=str) + "\n")
    conn = connect(root)
    conn.execute(
        """
        insert into observations(kind, competition, ref, observed_at, event, previous_json, current_json, source_json)
        values (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            item.get("kind"),
            competition,
            item.get("ref"),
            item.get("observed_at"),
            item.get("event"),
            json.dumps(item.get("previous"), sort_keys=True, ensure_ascii=True, default=str),
            json.dumps(item.get("current"), sort_keys=True, ensure_ascii=True, default=str),
            json.dumps(item.get("source"), sort_keys=True, ensure_ascii=True, default=str),
        ),
    )
    conn.commit()
    conn.close()


def run_json_script(script: str, args: list[str], root: Path, retries: int = 2) -> dict[str, Any]:
    tmp_dir = root / "_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix=safe_name(script) + "_", suffix=".json", dir=tmp_dir, delete=False) as f:
        out = Path(f.name)
    cmd = [sys.executable, str(SCRIPTS_DIR / script), *args, "--out", str(out)]
    last: subprocess.CompletedProcess[str] | None = None
    for attempt in range(retries + 1):
        last = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
        if last.returncode == 0 and out.exists():
            data = read_json(out)
            if isinstance(data, dict):
                try:
                    out.unlink()
                except OSError:
                    pass
                return data
        if attempt < retries:
            continue
    output = last.stdout if last else ""
    raise RuntimeError(f"{script} failed: {output[-4000:]}")


def parse_kaggle_csv(output: str) -> list[dict[str, str]]:
    lines = [line for line in output.splitlines() if line and not line.startswith("Warning:")]
    if not lines:
        return []
    return list(csv.DictReader(StringIO("\n".join(lines))))


def text_from_sections(record: dict[str, Any], names: list[str]) -> str:
    parts: list[str] = []
    for name in names:
        section = (record.get("sections") or {}).get(name) or {}
        if section.get("text"):
            parts.extend([f"# {name}", str(section["text"])])
    return "\n\n".join(parts)


def refresh_competition(args: argparse.Namespace) -> None:
    root = cache_dir(args)
    warn_gitignore(root)
    slug = args.competition
    record = run_json_script("comp_page.py", ["--competition", slug, "--format", "json"], root)
    base = root / "competitions" / slug / "brief"
    write_json(base / "current.json", record)
    for name in ("overview", "data", "rules"):
        text = ((record.get("sections") or {}).get(name) or {}).get("text") or ""
        write_text(base / f"{name}.md", text)
    content = text_from_sections(record, ["overview", "data", "rules"])
    title = ((record.get("meta") or {}).get("title")) or slug
    upsert_doc(
        root,
        doc_id=f"competition_brief:{slug}",
        kind="competition_brief",
        competition=slug,
        ref=slug,
        title=title,
        content=content,
        path=base / "current.json",
        url=f"https://www.kaggle.com/competitions/{slug}/overview",
        fetched_at=record.get("fetched_at"),
        meta={"content_sha256": sha_text(content)},
    )
    print(f"cached competition brief: {slug}")


def topic_text(topic: dict[str, Any]) -> str:
    return "\n".join(
        str(x)
        for x in [
            topic.get("title"),
            topic.get("author"),
            topic.get("author_type"),
            "official" if topic.get("official") else "",
            "pinned" if topic.get("pinned") else "",
        ]
        if x
    )


def refresh_discussions(args: argparse.Namespace) -> None:
    root = cache_dir(args)
    warn_gitignore(root)
    slug = args.competition
    record = run_json_script(
        "disc_list.py",
        ["--competition", slug, "--sort", args.sort, "--limit", str(args.limit), "--format", "json"],
        root,
    )
    base = root / "competitions" / slug / "discussions"
    write_json(base / f"topics.current.{args.sort}.json", record)
    write_json(base / "topics.current.json", record)
    for topic in record.get("topics", []):
        topic_id = str(topic.get("id") or safe_name(topic.get("title") or "topic"))
        topic_path = base / "topics" / f"{topic_id}.json"
        existing = read_json(topic_path)
        merged = {**(existing or {}), **topic, "fetched_at": record.get("fetched_at")}
        write_json(topic_path, merged)
        upsert_doc(
            root,
            doc_id=f"discussion:{slug}:{topic_id}",
            kind="discussion",
            competition=slug,
            ref=topic_id,
            title=topic.get("title"),
            content=topic_text(topic),
            path=topic_path,
            url=topic.get("url"),
            fetched_at=record.get("fetched_at"),
            meta={"votes": topic.get("votes"), "comments": topic.get("comments"), "official": topic.get("official")},
        )
    if args.comments:
        for topic in record.get("topics", []):
            topic_id = topic.get("id")
            if not topic_id:
                continue
            detail = run_json_script(
                "disc_get.py",
                ["--competition", slug, "--topic-id", str(topic_id), "--format", "json"],
                root,
            )
            detail_path = base / "topics" / f"{topic_id}.json"
            write_json(detail_path, detail)
            content_parts = [detail.get("title") or ""]

            def append_comment_text(comment: dict[str, Any]) -> None:
                body = comment.get("content") or comment.get("body") or ""
                content_parts.append(f"{comment.get('author') or ''}: {body}")
                for reply in comment.get("replies") or []:
                    if isinstance(reply, dict):
                        append_comment_text(reply)

            for comment in detail.get("comments", []):
                if isinstance(comment, dict):
                    append_comment_text(comment)
            if detail.get("visible_text"):
                content_parts.append(str(detail["visible_text"]))
            upsert_doc(
                root,
                doc_id=f"discussion_thread:{slug}:{topic_id}",
                kind="discussion_thread",
                competition=slug,
                ref=str(topic_id),
                title=detail.get("title"),
                content="\n".join(content_parts),
                path=detail_path,
                url=detail.get("source_url"),
                fetched_at=detail.get("fetched_at"),
                meta={"comments": len(detail.get("comments", []))},
            )
    print(f"cached discussions: {slug} sort={args.sort} topics={len(record.get('topics', []))}")


def snapshot_score(snapshot: dict[str, Any] | None) -> dict[str, Any]:
    snapshot = snapshot or {}
    return {
        "current_version": snapshot.get("current_version"),
        "version_count": snapshot.get("version_count"),
        "latest_lb_score": snapshot.get("latest_lb_score"),
        "best_lb_score": snapshot.get("best_lb_score"),
        "best_lb_score_version": snapshot.get("best_lb_score_version"),
        "last_evaluated_at": snapshot.get("last_evaluated_at"),
    }


def refresh_notebooks(args: argparse.Namespace) -> None:
    root = cache_dir(args)
    warn_gitignore(root)
    slug = args.competition
    cmd_args = ["--competition", slug, "--page-size", str(args.page_size)]
    for sort in args.sort:
        cmd_args.extend(["--sort", sort])
    if args.search:
        cmd_args.extend(["--search", args.search])
    if args.with_meta:
        cmd_args.append("--with-meta")
    record = run_json_script("nb_list.py", cmd_args, root)
    base = root / "competitions" / slug / "notebooks"
    query_hash = sha_obj(record.get("query", {}))[:12]
    write_json(base / f"list.current.{query_hash}.json", record)
    write_json(base / "list.current.json", record)
    seen = 0
    for result in record.get("results", []):
        for item in result.get("items", []):
            ref = item.get("ref")
            if not ref:
                continue
            seen += 1
            nb_dir = base / safe_name(ref)
            current_path = nb_dir / "current.json"
            previous = read_json(current_path)
            current = {**item, "fetched_at": record.get("fetched_at"), "sort_by": result.get("sort_by")}
            write_json(current_path, current)
            prev_score = snapshot_score((previous or {}).get("snapshot") if isinstance(previous, dict) else None)
            cur_score = snapshot_score(item.get("snapshot") if isinstance(item.get("snapshot"), dict) else None)
            prev_has_score = any(v not in (None, "") for v in prev_score.values())
            cur_has_score = any(v not in (None, "") for v in cur_score.values())
            if previous and prev_has_score and cur_has_score and prev_score != cur_score:
                append_observation(
                    root,
                    slug,
                    {
                        "kind": "notebook_score_observation",
                        "event": "notebook_score_changed",
                        "ref": ref,
                        "previous": prev_score,
                        "current": cur_score,
                        "source": {"script": "nb_list.py", "sort_by": result.get("sort_by")},
                    },
                )
            score_text = json.dumps(cur_score, sort_keys=True) if cur_has_score else ""
            content = "\n".join(str(x) for x in [item.get("title"), item.get("author"), ref, score_text] if x)
            upsert_doc(
                root,
                doc_id=f"notebook:{slug}:{ref}",
                kind="notebook",
                competition=slug,
                ref=ref,
                title=item.get("title"),
                content=content,
                path=current_path,
                url=item.get("url"),
                fetched_at=record.get("fetched_at"),
                meta={"sort_by": result.get("sort_by"), "votes": item.get("total_votes"), "snapshot": item.get("snapshot")},
            )
    print(f"cached notebooks: {slug} items={seen}")


def refresh_notebook_versions(args: argparse.Namespace) -> None:
    root = cache_dir(args)
    warn_gitignore(root)
    ref = args.notebook.strip().strip("/")
    record = run_json_script("nb_versions.py", ["--notebook", ref], root)
    comp = args.competition
    base = root / ("competitions" if comp else "notebooks")
    nb_dir = (base / comp / "notebooks" / safe_name(ref)) if comp else (base / safe_name(ref))
    current_path = nb_dir / "versions.current.json"
    previous = read_json(current_path)
    write_json(current_path, record)
    for version in record.get("version_history", []):
        version_number = version.get("version")
        if version_number is None:
            continue
        write_json(nb_dir / "versions" / f"v{int(version_number):06d}.json", version)
    prev_score = snapshot_score((previous or {}).get("snapshot") if isinstance(previous, dict) else None)
    cur_score = snapshot_score(record.get("snapshot") if isinstance(record.get("snapshot"), dict) else None)
    prev_has_score = any(v not in (None, "") for v in prev_score.values())
    cur_has_score = any(v not in (None, "") for v in cur_score.values())
    if previous and prev_has_score and cur_has_score and prev_score != cur_score:
        append_observation(
            root,
            comp,
            {
                "kind": "notebook_score_observation",
                "event": "notebook_score_changed",
                "ref": ref,
                "previous": prev_score,
                "current": cur_score,
                "source": {"script": "nb_versions.py"},
            },
        )
    content = json.dumps({"snapshot": record.get("snapshot"), "score_claims": record.get("score_claims")}, sort_keys=True)
    upsert_doc(
        root,
        doc_id=f"notebook_versions:{comp or '-'}:{ref}",
        kind="notebook_versions",
        competition=comp,
        ref=ref,
        title=ref,
        content=content,
        path=current_path,
        url=record.get("url"),
        fetched_at=record.get("fetched_at"),
        meta={"snapshot": record.get("snapshot")},
    )
    print(f"cached notebook versions: {ref}")


def submission_key(row: dict[str, str]) -> str:
    stable = {k: row.get(k, "") for k in ("fileName", "date", "description")}
    return sha_obj(stable)[:16]


def submission_mutable(row: dict[str, str]) -> dict[str, str]:
    return {k: row.get(k, "") for k in ("status", "publicScore", "privateScore")}


def refresh_submissions(args: argparse.Namespace) -> None:
    root = cache_dir(args)
    warn_gitignore(root)
    slug = args.competition
    cmd = ["kaggle", "competitions", "submissions", "-c", slug, "--page-size", str(args.page_size), "--csv"]
    proc = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
    if proc.returncode != 0:
        safe_output = json.dumps(proc.stdout[-4000:], ensure_ascii=True)
        print(
            f"submissions refresh failed (exit {proc.returncode}); output={safe_output}",
            file=sys.stderr,
        )
        raise SystemExit(proc.returncode or 1)
    rows = parse_kaggle_csv(proc.stdout)
    fetched_at = now_iso()
    base = root / "competitions" / slug / "submissions"
    current = {
        "schema_version": "kaggle.submissions_cache.v1",
        "competition": slug,
        "fetched_at": fetched_at,
        "command": cmd,
        "returncode": proc.returncode,
        "raw_output": proc.stdout,
        "submissions": rows,
    }
    write_json(base / "current.json", current)
    changed = 0
    for row in rows:
        key = submission_key(row)
        path = base / "submissions" / f"{key}.json"
        previous = read_json(path)
        enriched = {"local_key": key, "competition": slug, "fetched_at": fetched_at, **row}
        write_json(path, enriched)
        if isinstance(previous, dict):
            prev = submission_mutable(previous)
            cur = submission_mutable(row)
            if prev != cur:
                changed += 1
                append_observation(
                    root,
                    slug,
                    {
                        "kind": "submission_score_observation",
                        "event": "submission_meta_changed",
                        "ref": key,
                        "previous": prev,
                        "current": cur,
                        "source": {"command": cmd, "fileName": row.get("fileName"), "date": row.get("date")},
                    },
                )
        content = "\n".join(str(x) for x in [row.get("description"), row.get("status"), row.get("publicScore"), row.get("privateScore")] if x)
        upsert_doc(
            root,
            doc_id=f"submission:{slug}:{key}",
            kind="submission",
            competition=slug,
            ref=key,
            title=row.get("description") or row.get("fileName"),
            content=content,
            path=path,
            fetched_at=fetched_at,
            meta={"fileName": row.get("fileName"), "date": row.get("date"), "score": row.get("publicScore")},
        )
    print(f"cached submissions: {slug} rows={len(rows)} changed={changed}")


def refresh_all(args: argparse.Namespace) -> None:
    refresh_competition(args)
    for sort in args.discussion_sort:
        args.sort = sort
        refresh_discussions(args)
    args.sort = args.notebook_sort
    refresh_notebooks(args)
    refresh_submissions(args)


def like_search(conn: sqlite3.Connection, query: str, args: argparse.Namespace) -> list[sqlite3.Row]:
    terms = [f"%{part.lower()}%" for part in query.split() if part]
    where = []
    params: list[Any] = []
    if args.competition:
        where.append("competition = ?")
        params.append(args.competition)
    if args.kind:
        where.append("kind = ?")
        params.append(args.kind)
    for term in terms:
        where.append("(lower(title) like ? or lower(meta_json) like ?)")
        params.extend([term, term])
    sql = "select * from documents"
    if where:
        sql += " where " + " and ".join(where)
    sql += " order by updated_at desc limit ?"
    params.append(args.limit)
    return list(conn.execute(sql, params))


def search_cache(args: argparse.Namespace) -> None:
    root = cache_dir(args)
    if not db_path(root).exists():
        print(f"cache index not found at {db_path(root)}; run cache.py init or refresh first", file=sys.stderr)
        return
    conn = connect(root)
    conn.row_factory = sqlite3.Row
    rows: list[sqlite3.Row]
    try:
        where = ["documents_fts match ?"]
        params: list[Any] = [args.query]
        if args.competition:
            where.append("d.competition = ?")
            params.append(args.competition)
        if args.kind:
            where.append("d.kind = ?")
            params.append(args.kind)
        sql = f"""
            select d.*, snippet(documents_fts, 2, '[', ']', '...', 16) as snippet
            from documents_fts
            join documents d on d.id = documents_fts.doc_id
            where {' and '.join(where)}
            order by bm25(documents_fts)
            limit ?
        """
        params.append(args.limit)
        rows = list(conn.execute(sql, params))
    except sqlite3.OperationalError:
        rows = like_search(conn, args.query, args)
    for row in rows:
        snippet = row["snippet"] if "snippet" in row.keys() else ""
        print(
            json.dumps(
                {
                    "kind": row["kind"],
                    "competition": row["competition"],
                    "ref": row["ref"],
                    "title": row["title"],
                    "path": row["path"],
                    "url": row["url"],
                    "updated_at": row["updated_at"],
                    "snippet": snippet,
                },
                ensure_ascii=False,
            )
        )
    conn.close()


def status(args: argparse.Namespace) -> None:
    root = cache_dir(args)
    if not db_path(root).exists():
        print(f"cache index not found at {db_path(root)}; run cache.py init or refresh first", file=sys.stderr)
        return
    conn = connect(root)
    conn.row_factory = sqlite3.Row
    where = "where competition = ?" if args.competition else ""
    params = [args.competition] if args.competition else []
    for row in conn.execute(
        f"select kind, count(*) as n, max(updated_at) as latest from documents {where} group by kind order by kind",
        params,
    ):
        print(f"{row['kind']}\t{row['n']}\t{row['latest']}")
    conn.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    init_p = sub.add_parser("init", help="Create cache directory and optionally update .gitignore")
    init_p.add_argument("--cache-dir")
    init_p.add_argument("--write-gitignore", action="store_true")

    search_p = sub.add_parser("search", help="Search local cache")
    search_p.add_argument("query")
    search_p.add_argument("--cache-dir")
    search_p.add_argument("--competition")
    search_p.add_argument("--kind")
    search_p.add_argument("--limit", type=int, default=20)

    status_p = sub.add_parser("status", help="Show cached document counts")
    status_p.add_argument("--cache-dir")
    status_p.add_argument("--competition")

    refresh = sub.add_parser("refresh", help="Refresh cache from Kaggle")
    refresh.add_argument("--cache-dir")
    refresh_sub = refresh.add_subparsers(dest="target", required=True)

    comp = refresh_sub.add_parser("competition")
    comp.add_argument("--competition", required=True)

    disc = refresh_sub.add_parser("discussions")
    disc.add_argument("--competition", required=True)
    disc.add_argument("--sort", choices=["recent", "votes", "comments", "hot"], default="recent")
    disc.add_argument("--limit", type=int, default=30)
    disc.add_argument("--comments", action="store_true")

    nb = refresh_sub.add_parser("notebooks")
    nb.add_argument("--competition", required=True)
    nb.add_argument("--sort", action="append", choices=sorted({"hotness", "commentCount", "dateCreated", "dateRun", "relevance", "scoreAscending", "scoreDescending", "viewCount", "voteCount"}), default=[])
    nb.add_argument("--page-size", type=int, default=30)
    nb.add_argument("--search")
    nb.add_argument("--with-meta", action="store_true")

    nbv = refresh_sub.add_parser("notebook-versions")
    nbv.add_argument("--notebook", required=True)
    nbv.add_argument("--competition")

    subm = refresh_sub.add_parser("submissions")
    subm.add_argument("--competition", required=True)
    subm.add_argument("--page-size", type=int, default=100)

    all_p = refresh_sub.add_parser("all")
    all_p.add_argument("--competition", required=True)
    all_p.add_argument("--discussion-sort", action="append", choices=["recent", "votes", "comments", "hot"], default=["recent", "votes"])
    all_p.add_argument("--comments", action="store_true")
    all_p.add_argument("--limit", type=int, default=30)
    all_p.add_argument("--notebook-sort", action="append", choices=sorted({"hotness", "commentCount", "dateCreated", "dateRun", "relevance", "scoreAscending", "scoreDescending", "viewCount", "voteCount"}), default=["dateRun", "voteCount", "scoreDescending"])
    all_p.add_argument("--page-size", type=int, default=30)
    all_p.add_argument("--search")
    all_p.add_argument("--with-meta", action="store_true")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    root = cache_dir(args)
    if args.command == "init":
        root.mkdir(parents=True, exist_ok=True)
        connect(root).close()
        if args.write_gitignore:
            ensure_gitignore(root)
        else:
            warn_gitignore(root)
        print(f"cache: {root}")
        return 0
    if args.command == "search":
        search_cache(args)
        return 0
    if args.command == "status":
        status(args)
        return 0
    if args.command == "refresh":
        if args.target == "competition":
            refresh_competition(args)
        elif args.target == "discussions":
            refresh_discussions(args)
        elif args.target == "notebooks":
            if not args.sort:
                args.sort = ["dateRun"]
            refresh_notebooks(args)
        elif args.target == "notebook-versions":
            refresh_notebook_versions(args)
        elif args.target == "submissions":
            refresh_submissions(args)
        elif args.target == "all":
            refresh_all(args)
        return 0
    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
