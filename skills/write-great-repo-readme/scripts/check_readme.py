#!/usr/bin/env python3
"""Check a repository README for common local integrity problems.

The checker does not fetch external URLs or execute README commands. It validates
local structure deterministically and leaves behavioral verification to the skill's
manual validation steps.
"""

from __future__ import annotations

import argparse
import re
import string
from collections import Counter
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import SplitResult, unquote, urlsplit

FENCE_RE = re.compile(r"^\s{0,3}(`{3,}|~{3,})(.*)$")
ATX_HEADING_RE = re.compile(r"^\s{0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$")
SETEXT_HEADING_RE = re.compile(r"^\s{0,3}(=+|-+)[ \t]*$")
REFERENCE_DEFINITION_RE = re.compile(r"^\s{0,3}\[([^]]+)]\s*:\s*(.*)$")
REFERENCE_USE_RE = re.compile(r"(?<!\\)(!?)\[([^]]+)]\[([^]]*)]")
PLACEHOLDER_RE = re.compile(
    r"(?:\b(?:REPLACE_ME|CHANGEME|YOUR_[A-Z0-9_]+)\b|<your[-_ ][^>]+>|\{\{[^}]+}})",
    re.I,
)
SAFE_EXTERNAL_SCHEMES = {"http", "https", "mailto", "tel"}
UNSAFE_SCHEMES = {"file", "javascript", "vbscript"}


@dataclass(frozen=True)
class Finding:
    level: str
    line: int
    message: str


@dataclass(frozen=True)
class Target:
    line: int
    kind: str
    value: str


class ReadmeHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.anchors: set[str] = set()
        self.targets: list[Target] = []

    def collect(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values: dict[str, str] = {}
        for name, value in attrs:
            if value is not None and name not in values:
                values[name] = value
        for name in ("id", "name"):
            if values.get(name):
                self.anchors.add(unquote(values[name]).casefold())
        if tag == "a" and "href" in values:
            self.targets.append(Target(self.getpos()[0], "link", values["href"]))
        elif tag == "img" and "src" in values:
            self.targets.append(Target(self.getpos()[0], "image", values["src"]))

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.collect(tag, attrs)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.collect(tag, attrs)


def github_slug(text: str, seen: Counter[str]) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"[`*_~]", "", text).strip().lower()
    text = re.sub(r"[^\w\- ]", "", text, flags=re.UNICODE)
    slug = re.sub(r"\s+", "-", text)
    count = seen[slug]
    seen[slug] += 1
    return slug if count == 0 else f"{slug}-{count}"


def split_target(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("<") and ">" in raw:
        return raw[1 : raw.index(">")]
    # Markdown permits an optional quoted title after whitespace.
    match = re.match(r"(\S+)(?:\s+[\"'(].*)?$", raw)
    return match.group(1) if match else raw


def normalize_reference_label(label: str) -> str:
    return re.sub(r"\s+", " ", label).strip().casefold()


def markdown_unescape(value: str) -> str:
    unescaped: list[str] = []
    cursor = 0
    while cursor < len(value):
        if cursor + 1 < len(value) and value[cursor] == "\\" and value[cursor + 1] in string.punctuation:
            cursor += 1
        unescaped.append(value[cursor])
        cursor += 1
    return "".join(unescaped)


def code_span_closing(line: str, marker: str, start: int) -> int:
    search = start
    while True:
        candidate = line.find(marker, search)
        if candidate < 0:
            return -1
        before_is_tick = candidate > 0 and line[candidate - 1] == "`"
        after = candidate + len(marker)
        after_is_tick = after < len(line) and line[after] == "`"
        if not before_is_tick and not after_is_tick:
            return candidate
        search = candidate + 1


def mask_markup(line: str, in_comment: bool) -> tuple[str, str, bool]:
    """Return scan and heading views with code spans and comments handled."""
    scan = list(line)
    heading = list(line)
    cursor = 0
    while cursor < len(line):
        if in_comment:
            end = line.find("-->", cursor)
            stop = len(line) if end < 0 else end + 3
            for index in range(cursor, stop):
                scan[index] = " "
                heading[index] = " "
            if end < 0:
                return "".join(scan), "".join(heading), True
            cursor = stop
            in_comment = False
            continue

        if line.startswith("<!--", cursor):
            in_comment = True
            continue

        if line[cursor] != "`":
            cursor += 1
            continue
        run_end = cursor
        while run_end < len(line) and line[run_end] == "`":
            run_end += 1
        marker = line[cursor:run_end]
        closing = code_span_closing(line, marker, run_end)
        if closing < 0:
            cursor = run_end
            continue
        code_end = closing + len(marker)
        for index in range(cursor, code_end):
            scan[index] = " "
        for index in range(cursor, run_end):
            heading[index] = " "
        for index in range(closing, code_end):
            heading[index] = " "
        cursor = code_end
    return "".join(scan), "".join(heading), in_comment


def is_escaped(text: str, index: int) -> bool:
    backslashes = 0
    index -= 1
    while index >= 0 and text[index] == "\\":
        backslashes += 1
        index -= 1
    return backslashes % 2 == 1


def matching_bracket(text: str, opening: int) -> int:
    depth = 1
    for index in range(opening + 1, len(text)):
        if is_escaped(text, index):
            continue
        if text[index] == "[":
            depth += 1
        elif text[index] == "]":
            depth -= 1
            if depth == 0:
                return index
    return -1


def closing_parenthesis(text: str, opening: int) -> int:
    depth = 1
    for index in range(opening + 1, len(text)):
        if is_escaped(text, index):
            continue
        if text[index] == "(":
            depth += 1
        elif text[index] == ")":
            depth -= 1
            if depth == 0:
                return index
    return -1


def inline_targets(line: str, lineno: int) -> list[Target]:
    targets: list[Target] = []
    cursor = 0
    while cursor < len(line):
        opening = line.find("[", cursor)
        if opening < 0:
            break
        if is_escaped(line, opening):
            cursor = opening + 1
            continue
        closing = matching_bracket(line, opening)
        if closing < 0:
            break
        destination_open = closing + 1
        if destination_open >= len(line) or line[destination_open] != "(":
            cursor = closing + 1
            continue
        destination_close = closing_parenthesis(line, destination_open)
        if destination_close < 0:
            cursor = closing + 1
            continue
        image = opening > 0 and line[opening - 1] == "!" and not is_escaped(line, opening - 1)
        raw = line[destination_open + 1 : destination_close]
        targets.append(Target(lineno, "image" if image else "link", split_target(raw)))
        cursor = destination_close + 1
    return targets


def parse_target(value: str) -> SplitResult | None:
    try:
        return urlsplit(value)
    except ValueError:
        return None


def is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def validate_target(
    target: Target,
    readme: Path,
    root: Path,
    anchors: set[str],
) -> list[Finding]:
    if not target.value:
        return [Finding("error", target.line, f"empty {target.kind} target")]

    value = markdown_unescape(target.value)
    parsed = parse_target(value)
    if parsed is None:
        return [Finding("error", target.line, f"invalid {target.kind} target: {target.value}")]

    scheme = parsed.scheme.lower()
    if scheme in UNSAFE_SCHEMES:
        return [Finding("error", target.line, f"unsafe {target.kind} scheme: {scheme}")]
    if scheme == "data":
        if target.kind == "image":
            return []
        return [Finding("error", target.line, "data scheme is allowed only for images")]
    if scheme in SAFE_EXTERNAL_SCHEMES or value.startswith("//"):
        return []
    if scheme:
        return [Finding("warning", target.line, f"link scheme not checked: {scheme}")]

    findings: list[Finding] = []
    points_to_current_readme = not parsed.path and not parsed.netloc
    if parsed.path:
        path_text = unquote(parsed.path)
        try:
            candidate = Path(path_text)
            if candidate.is_absolute():
                return [Finding("error", target.line, f"absolute local target is not portable: {path_text}")]
            resolved = (readme.parent / candidate).resolve()
            if not is_within(resolved, root):
                return [Finding("error", target.line, f"local target escapes repository root: {path_text}")]
            exists = resolved.exists()
        except (OSError, RuntimeError, ValueError):
            return [Finding("error", target.line, "cannot inspect local target")]
        if not exists:
            findings.append(Finding("error", target.line, f"missing local target: {path_text}"))
        else:
            points_to_current_readme = resolved == readme

    if parsed.fragment and points_to_current_readme:
        fragment = unquote(parsed.fragment).casefold()
        if fragment not in anchors:
            findings.append(Finding("warning", target.line, f"internal anchor not found: #{parsed.fragment}"))
    return findings


def check(path: Path, root: Path | None = None) -> list[Finding]:
    findings: list[Finding] = []
    try:
        readme = path.resolve()
        repository_root = (root or path.parent).resolve()
    except (OSError, RuntimeError, ValueError) as error:
        return [Finding("error", 0, f"cannot resolve README or repository root: {error}")]
    if not is_within(readme, repository_root):
        return [Finding("error", 0, f"README is outside repository root: {repository_root}")]
    if not repository_root.is_dir():
        return [Finding("error", 0, f"repository root is not a directory: {repository_root}")]
    if not readme.is_file():
        return [Finding("error", 0, "README is not a regular file")]
    try:
        text = readme.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        return [Finding("error", 0, f"cannot read file: {error}")]

    if not text.strip():
        return [Finding("error", 1, "README is empty")]

    in_fence = False
    fence_char = ""
    fence_len = 0
    in_html_comment = False
    headings: list[tuple[int, int, str]] = []
    targets: list[Target] = []
    html_parser = ReadmeHTMLParser()
    reference_definitions: dict[str, int] = {}
    reference_uses: list[tuple[int, str]] = []
    previous_setext_candidate: tuple[int, str] | None = None
    lines = text.splitlines()

    for lineno, raw_line in enumerate(lines, 1):
        if in_fence:
            fence = FENCE_RE.match(raw_line)
            if fence:
                marker, suffix = fence.groups()
                if marker[0] == fence_char and len(marker) >= fence_len and not suffix.strip():
                    in_fence = False
                    fence_char = ""
                    fence_len = 0
            html_parser.feed("\n")
            continue

        scan_line, heading_line, in_html_comment = mask_markup(raw_line, in_html_comment)
        fence = FENCE_RE.match(scan_line)
        if fence:
            marker, _suffix = fence.groups()
            in_fence = True
            fence_char = marker[0]
            fence_len = len(marker)
            previous_setext_candidate = None
            html_parser.feed("\n")
            continue

        if scan_line.startswith("    ") or scan_line.startswith("\t"):
            previous_setext_candidate = None
            html_parser.feed("\n")
            continue

        html_parser.feed(scan_line + "\n")
        definition = REFERENCE_DEFINITION_RE.match(scan_line)
        if definition:
            label = normalize_reference_label(definition.group(1))
            target_value = split_target(definition.group(2))
            if label in reference_definitions:
                findings.append(Finding("warning", lineno, f"duplicate reference definition: {label}"))
            else:
                reference_definitions[label] = lineno
                targets.append(Target(lineno, "reference", target_value))
        else:
            targets.extend(inline_targets(scan_line, lineno))
            for match in REFERENCE_USE_RE.finditer(scan_line):
                label = normalize_reference_label(match.group(3) or match.group(2))
                reference_uses.append((lineno, label))

        if PLACEHOLDER_RE.search(scan_line):
            findings.append(Finding("warning", lineno, "possible unresolved placeholder"))

        atx = ATX_HEADING_RE.match(heading_line)
        setext = SETEXT_HEADING_RE.match(heading_line)
        if atx:
            title = re.sub(r"[ \t]+#+[ \t]*$", "", atx.group(2) or "").strip()
            headings.append((lineno, len(atx.group(1)), title))
            previous_setext_candidate = None
        elif setext and previous_setext_candidate:
            candidate_line, title = previous_setext_candidate
            headings.append((candidate_line, 1 if setext.group(1).startswith("=") else 2, title))
            previous_setext_candidate = None
        elif heading_line.strip() and not definition:
            previous_setext_candidate = (lineno, heading_line.strip())
        else:
            previous_setext_candidate = None

    html_parser.close()
    targets.extend(html_parser.targets)

    if in_fence:
        findings.append(Finding("error", len(lines), "unclosed fenced code block"))

    for lineno, label in reference_uses:
        if label not in reference_definitions:
            findings.append(Finding("error", lineno, f"missing reference definition: {label}"))

    h1_lines = [lineno for lineno, level, title in headings if level == 1 and title]
    if not h1_lines:
        findings.append(Finding("warning", 1, "no level-1 Markdown heading found"))
    elif len(h1_lines) > 1:
        findings.append(Finding("warning", h1_lines[1], "multiple level-1 headings"))

    slug_counts: Counter[str] = Counter()
    anchors = set(html_parser.anchors)
    normalized_titles: Counter[str] = Counter()
    title_first_line: dict[str, int] = {}
    for lineno, _level, title in headings:
        anchors.add(github_slug(title, slug_counts))
        normalized = re.sub(r"\s+", " ", title.casefold()).strip()
        normalized_titles[normalized] += 1
        title_first_line.setdefault(normalized, lineno)

    for title, count in normalized_titles.items():
        if title and count > 1:
            findings.append(
                Finding("warning", title_first_line[title], f"duplicate heading text appears {count} times: {title!r}")
            )

    for target in targets:
        findings.extend(validate_target(target, readme, repository_root, anchors))

    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("readme", nargs="?", default="README.md", type=Path)
    parser.add_argument(
        "--root",
        type=Path,
        help="repository root allowed for local links (default: README directory)",
    )
    parser.add_argument("--strict", action="store_true", help="treat warnings as failures")
    args = parser.parse_args()

    findings = check(args.readme, args.root)
    for finding in findings:
        location = str(args.readme) if finding.line == 0 else f"{args.readme}:{finding.line}"
        print(f"{finding.level}: {location}: {finding.message}")

    errors = sum(finding.level == "error" for finding in findings)
    warnings = sum(finding.level == "warning" for finding in findings)
    print(f"checked {args.readme}: {errors} error(s), {warnings} warning(s)")
    return 1 if errors or (args.strict and warnings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
