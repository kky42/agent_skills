#!/usr/bin/env python3
"""Download Kaggle notebook source, inputs, and outputs for a specific version."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import http.client
import json
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Any


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def normalize_ref(ref: str) -> str:
    ref = ref.strip().strip("/")
    if ref.startswith("https://www.kaggle.com/"):
        ref = ref.removeprefix("https://www.kaggle.com/")
    if ref.startswith("code/"):
        ref = ref.removeprefix("code/")
    return ref


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


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


def download_url(url: str, out: Path, timeout: float) -> dict[str, Any]:
    out.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 kaggle-skill/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            out.write_bytes(resp.read())
            return {"status": resp.status, "url": url, "path": str(out), "sha256": sha256(out), "bytes": out.stat().st_size}
    except urllib.error.HTTPError as exc:
        return {"status": exc.code, "url": url, "path": str(out), "error": exc.read().decode("utf-8", errors="replace") or str(exc)}
    except urllib.error.URLError as exc:
        return {"status": None, "url": url, "path": str(out), "error": str(exc)}


def get_view(ref: str, version: int | None, timeout: float) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    owner, slug = ref.split("/", 1)
    params: dict[str, Any] = {"authorUserName": owner, "kernelSlug": slug, "kernelVersionId": 0}
    if version is not None:
        params["versionNumber"] = version
    status, data, error = api_get("kernels.LegacyKernelsService/GetKernelViewModel", params, timeout)
    meta = {"status": status, "error": error, "params": params}
    return data if isinstance(data, dict) else None, meta


def source_path(out_dir: Path, ref: str, version: int) -> Path:
    owner, slug = ref.split("/", 1)
    return out_dir / "source" / f"{owner}__{slug}__v{version}.ipynb"


def output_path(out_dir: Path, ref: str, version: int) -> Path:
    owner, slug = ref.split("/", 1)
    return out_dir / "output" / f"{owner}__{slug}__v{version}__output.zip"


def extract_input_sources(notebook_path: Path) -> list[dict[str, Any]]:
    try:
        nb = json.loads(notebook_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    return list(((nb.get("metadata") or {}).get("kaggle") or {}).get("dataSources") or [])


def dataset_ref(source: dict[str, Any]) -> str | None:
    owner = source.get("ownerSlug")
    slug = source.get("datasetSlug")
    if owner and slug:
        return f"{owner}/{slug}"
    return None


def download_dataset(ref: str, out_dir: Path) -> dict[str, Any]:
    target = out_dir / "input" / ref.replace("/", "__")
    target.mkdir(parents=True, exist_ok=True)
    cmd = ["kaggle", "datasets", "download", ref, "-p", str(target)]
    proc = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
    files = []
    for path in sorted(target.glob("*")):
        if path.is_file():
            files.append({"path": str(path), "sha256": sha256(path), "bytes": path.stat().st_size})
    return {"ref": ref, "command": cmd, "returncode": proc.returncode, "output": proc.stdout, "files": files}


def zip_manifest(path: Path) -> dict[str, Any] | None:
    if not path.exists() or not zipfile.is_zipfile(path):
        return None
    with zipfile.ZipFile(path) as zf:
        names = [name for name in sorted(zf.namelist()) if not name.endswith("/")]
    return {"file_count": len(names), "files": names[:1000]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--notebook", required=True, help="OWNER/KERNEL or Kaggle code URL")
    parser.add_argument("--version", type=int, help="Notebook version number; latest when omitted")
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--source", action="store_true", help="Download notebook source")
    parser.add_argument("--inputs", action="store_true", help="Download notebook Kaggle dataset inputs")
    parser.add_argument("--output", action="store_true", help="Download notebook output zip")
    parser.add_argument("--all", action="store_true", help="Download source, inputs, and output")
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()

    ref = normalize_ref(args.notebook)
    view, view_meta = get_view(ref, args.version, args.timeout)
    record: dict[str, Any] = {
        "schema_version": "kaggle.notebook_download.v1",
        "notebook": ref,
        "requested_version": args.version,
        "fetched_at": now_iso(),
        "view": view_meta,
        "artifacts": {"source": None, "inputs": [], "output": None},
    }
    if not view:
        output = json.dumps(record, indent=2, sort_keys=True, default=str) + "\n"
        if args.manifest:
            args.manifest.parent.mkdir(parents=True, exist_ok=True)
            args.manifest.write_text(output, encoding="utf-8")
        else:
            sys.stdout.write(output)
        return 1

    run = view.get("kernelRun") or {}
    version = int(run.get("kernelVersionNumber") or view.get("currentVersionNumber") or args.version or 0)
    run_id = run.get("id")
    record["version"] = version
    record["kernel_run_id"] = run_id
    record["title"] = run.get("title") or (view.get("kernel") or {}).get("title")
    record["status"] = run.get("status")
    record["evaluated_at"] = run.get("dateEvaluated")
    do_source = args.all or args.source or args.inputs
    do_inputs = args.all or args.inputs
    do_output = args.all or args.output

    nb_path: Path | None = None
    if do_source and run_id:
        nb_path = source_path(args.out_dir, ref, version)
        source_url = f"https://www.kaggle.com/kernels/scriptcontent/{run_id}/download"
        record["artifacts"]["source"] = download_url(source_url, nb_path, args.timeout)
    if do_inputs:
        sources = extract_input_sources(nb_path) if nb_path else []
        record["input_sources"] = sources
        for source in sources:
            ref_or_none = dataset_ref(source)
            if ref_or_none:
                record["artifacts"]["inputs"].append(download_dataset(ref_or_none, args.out_dir))
            else:
                record["artifacts"]["inputs"].append({"source": source, "error": "unsupported input source"})
    if do_output and run_id:
        out_path = output_path(args.out_dir, ref, version)
        output_url = f"https://www.kaggle.com/code/svzip/{run_id}"
        item = download_url(output_url, out_path, args.timeout)
        item["zip_manifest"] = zip_manifest(out_path)
        record["artifacts"]["output"] = item

    output = json.dumps(record, indent=2, sort_keys=True, default=str) + "\n"
    manifest = args.manifest or (args.out_dir / "manifest.json")
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(output, encoding="utf-8")
    sys.stdout.write(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
