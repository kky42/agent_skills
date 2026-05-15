#!/usr/bin/env python3
"""List Kaggle notebooks with stable JSON output and optional metadata snapshots."""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import http.client
import json
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from io import StringIO
from pathlib import Path
from typing import Any


SORTS = {
    "hotness",
    "commentCount",
    "dateCreated",
    "dateRun",
    "relevance",
    "scoreAscending",
    "scoreDescending",
    "viewCount",
    "voteCount",
}


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


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


def parse_csv(output: str) -> list[dict[str, str]]:
    lines = [line for line in output.splitlines() if line and not line.startswith("Warning:")]
    if not lines:
        return []
    return list(csv.DictReader(StringIO("\n".join(lines))))


def run_query(args: argparse.Namespace, sort: str) -> dict[str, Any]:
    cmd = [
        "kaggle",
        "kernels",
        "list",
        "--page-size",
        str(args.page_size),
        "--sort-by",
        sort,
        "--csv",
    ]
    if args.competition:
        cmd.extend(["--competition", args.competition])
    if args.dataset:
        cmd.extend(["--dataset", args.dataset])
    if args.user:
        cmd.extend(["--user", args.user])
    if args.search:
        cmd.extend(["--search", args.search])
    if args.language:
        cmd.extend(["--language", args.language])
    if args.kernel_type:
        cmd.extend(["--kernel-type", args.kernel_type])
    proc = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
    rows = parse_csv(proc.stdout)
    return {
        "sort_by": sort,
        "command": cmd,
        "returncode": proc.returncode,
        "raw_output": proc.stdout,
        "items": [normalize_row(row) for row in rows],
    }


def normalize_author(name: str | None, raw: dict[str, Any] | None = None) -> dict[str, Any]:
    raw = raw or {}
    profile_url = raw.get("profileUrl") or raw.get("url")
    if isinstance(profile_url, str) and profile_url.startswith("/"):
        profile_url = "https://www.kaggle.com" + profile_url
    return {
        "id": raw.get("id") or raw.get("userId"),
        "user_name": raw.get("userName"),
        "display_name": raw.get("displayName") or raw.get("name") or name,
        "profile_url": profile_url,
        "thumbnail_url": raw.get("thumbnailUrl"),
        "tier": raw.get("performanceTier") or raw.get("tier"),
        "raw": raw or None,
    }


def normalize_row(row: dict[str, str]) -> dict[str, Any]:
    votes: int | None = None
    try:
        votes = int(row.get("totalVotes") or "")
    except ValueError:
        pass
    return {
        "ref": row.get("ref"),
        "url": f"https://www.kaggle.com/code/{row.get('ref')}" if row.get("ref") else None,
        "title": row.get("title"),
        "author": row.get("author"),
        "author_identity": normalize_author(row.get("author")),
        "last_run_time": row.get("lastRunTime"),
        "total_votes": votes,
        "raw": row,
    }


def snapshot(ref: str, timeout: float) -> dict[str, Any]:
    owner, slug = ref.split("/", 1)
    status, data, error = api_get(
        "kernels.LegacyKernelsService/GetKernelViewModel",
        {"authorUserName": owner, "kernelSlug": slug, "kernelVersionId": 0},
        timeout,
    )
    if not isinstance(data, dict):
        return {"status": status, "error": error}
    kernel = data.get("kernel") or {}
    run = data.get("kernelRun") or {}
    best = data.get("bestSubmissionScore") or {}
    submission = data.get("submission") or {}
    return {
        "status": status,
        "error": error,
        "kernel_id": kernel.get("id"),
        "current_run_id": kernel.get("currentRunId") or run.get("id"),
        "current_version": data.get("currentVersionNumber") or run.get("kernelVersionNumber"),
        "version_count": data.get("totalVersionCount"),
        "latest_lb_score": submission.get("scoreFormatted") or best.get("scoreFormatted") or kernel.get("bestPublicScore"),
        "best_lb_score": best.get("scoreFormatted") or kernel.get("bestPublicScore"),
        "best_lb_score_version": best.get("kernelVersionNumber"),
        "last_evaluated_at": run.get("dateEvaluated"),
        "author_identity": normalize_author(None, kernel.get("author") if isinstance(kernel.get("author"), dict) else None),
        "raw": data,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--competition")
    parser.add_argument("--dataset")
    parser.add_argument("--user")
    parser.add_argument("--search")
    parser.add_argument("--sort", action="append", choices=sorted(SORTS), default=[])
    parser.add_argument("--page-size", type=int, default=20)
    parser.add_argument("--language")
    parser.add_argument("--kernel-type")
    parser.add_argument("--with-meta", action="store_true")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    sorts = args.sort or ["hotness"]
    record = {
        "schema_version": "kaggle.notebook_list.v1",
        "fetched_at": now_iso(),
        "query": {
            "competition": args.competition,
            "dataset": args.dataset,
            "user": args.user,
            "search": args.search,
            "sorts": sorts,
            "page_size": args.page_size,
            "language": args.language,
            "kernel_type": args.kernel_type,
        },
        "results": [],
    }
    for sort in sorts:
        result = run_query(args, sort)
        if args.with_meta:
            for item in result["items"]:
                if item.get("ref"):
                    meta = snapshot(item["ref"], args.timeout)
                    item["snapshot"] = meta
                    if meta.get("author_identity", {}).get("id"):
                        item["author_identity"] = meta["author_identity"]
                    time.sleep(0.2)
        record["results"].append(result)
    output = json.dumps(record, indent=2, sort_keys=True, default=str) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(output, encoding="utf-8")
    else:
        sys.stdout.write(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
