from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check_readme.py"
SPEC = importlib.util.spec_from_file_location("check_readme", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"cannot load {SCRIPT}")
check_readme = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = check_readme
SPEC.loader.exec_module(check_readme)


class CheckReadmeTests(unittest.TestCase):
    def check(self, text: str, files: dict[str, str] | None = None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            readme = root / "README.md"
            readme.write_text(text, encoding="utf-8")
            for relative_path, content in (files or {}).items():
                path = root / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
            return check_readme.check(readme)

    def test_accepts_existing_links_and_current_file_fragments(self):
        findings = self.check(
            """# Demo

[Usage](#usage)
[Usage by file](README.md#usage)
[Guide](docs/guide.md)

## Usage
""",
            {"docs/guide.md": "# Guide\n"},
        )
        self.assertEqual([], findings)

    def test_reports_missing_file_and_fragment(self):
        findings = self.check(
            """# Demo

[Missing file](docs/missing.md)
[Missing fragment](README.md#missing)
"""
        )
        messages = {(finding.level, finding.message) for finding in findings}
        self.assertIn(("error", "missing local target: docs/missing.md"), messages)
        self.assertIn(("warning", "internal anchor not found: #missing"), messages)

    def test_accepts_balanced_parentheses_setext_and_explicit_anchors(self):
        findings = self.check(
            """Demo
====

[Guide](docs/foo_(bar).md)
[Usage](#usage)
[Custom](#custom)

Usage
-----

<a id="custom"></a>
""",
            {"docs/foo_(bar).md": "# Guide\n"},
        )
        self.assertEqual([], findings)

    def test_accepts_commonmark_escaped_parentheses(self):
        findings = self.check(
            "# Demo\n\n[Guide](docs/foo\\(bar\\).md)\n",
            {"docs/foo(bar).md": "# Guide\n"},
        )
        self.assertEqual([], findings)

    def test_reports_empty_and_malformed_targets_without_crashing(self):
        findings = self.check(
            """# Demo

[Empty]()
[Malformed](http://[)
"""
        )
        messages = {(finding.level, finding.message) for finding in findings}
        self.assertIn(("error", "empty link target"), messages)
        self.assertIn(("error", "invalid link target: http://["), messages)

    def test_checks_reference_links_and_definitions(self):
        findings = self.check(
            """# Demo

[Guide][guide]
[Undefined][missing]

[guide]: docs/missing.md
"""
        )
        messages = {(finding.level, finding.message) for finding in findings}
        self.assertIn(("error", "missing local target: docs/missing.md"), messages)
        self.assertIn(("error", "missing reference definition: missing"), messages)

    def test_duplicate_headings_get_distinct_github_anchors(self):
        findings = self.check(
            """# Demo

[Second usage](#usage-1)

## Usage
## Usage
"""
        )
        messages = [finding.message for finding in findings]
        self.assertIn("duplicate heading text appears 2 times: 'usage'", messages)
        self.assertNotIn("internal anchor not found: #usage-1", messages)

    def test_ignores_placeholders_and_fence_like_content_inside_code(self):
        findings = self.check(
            """# Demo

```text
YOUR_TOKEN
```not-a-closing-fence
```
"""
        )
        self.assertEqual([], findings)

    def test_html_attributes_are_exact_and_character_references_are_decoded(self):
        findings = self.check(
            """# Demo

<a data-href="docs/missing.md" data-id="decoy"></a>
[Decoy](#decoy)
<a href="java&#x73;cript:alert(1)">Unsafe</a>
"""
        )
        messages = {(finding.level, finding.message) for finding in findings}
        self.assertNotIn(("error", "missing local target: docs/missing.md"), messages)
        self.assertIn(("warning", "internal anchor not found: #decoy"), messages)
        self.assertIn(("error", "unsafe link scheme: javascript"), messages)

    def test_code_span_comment_marker_does_not_hide_following_lines_or_heading_text(self):
        findings = self.check(
            """# Demo

[Use](#use-foo)

## Use `foo`

`<!--`
[Missing](docs/missing.md)
"""
        )
        messages = {(finding.level, finding.message) for finding in findings}
        self.assertNotIn(("warning", "internal anchor not found: #use-foo"), messages)
        self.assertIn(("error", "missing local target: docs/missing.md"), messages)

    def test_ignores_indented_code_inline_code_and_html_comments(self):
        findings = self.check(
            """# Demo

    [Missing](docs/indented.md)

`[Missing](docs/inline.md)`

<!-- [Missing](docs/comment.md) -->
"""
        )
        self.assertEqual([], findings)

    def test_rejects_unsafe_or_nonportable_local_targets(self):
        findings = self.check(
            """# Demo

[Absolute](/etc/passwd)
[Traversal](../outside.md)
[Script](javascript:alert(1))
[File](file:///tmp/example)
![Inline image](data:image/png;base64,AAAA)
[Inline page](data:text/html,hello)
"""
        )
        messages = {(finding.level, finding.message) for finding in findings}
        self.assertIn(("error", "absolute local target is not portable: /etc/passwd"), messages)
        self.assertIn(("error", "local target escapes repository root: ../outside.md"), messages)
        self.assertIn(("error", "unsafe link scheme: javascript"), messages)
        self.assertIn(("error", "unsafe link scheme: file"), messages)
        self.assertIn(("error", "data scheme is allowed only for images"), messages)

    def test_path_errors_become_findings(self):
        too_long = "a" * 5000
        findings = self.check(f"# Demo\n\n[Null](bad%00path)\n[Long]({too_long})\n")
        messages = [finding.message for finding in findings]
        self.assertEqual(2, messages.count("cannot inspect local target"))

    def test_rejects_readme_symlink_outside_repository_before_reading(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root = Path(directory)
            external = Path(outside) / "README.md"
            external.write_text("# External\n", encoding="utf-8")
            linked = root / "README.md"
            linked.symlink_to(external)
            findings = check_readme.check(linked, root)
        self.assertEqual(1, len(findings))
        self.assertIn("README is outside repository root", findings[0].message)

    def test_rejects_symlink_that_escapes_repository_root(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root = Path(directory)
            readme = root / "README.md"
            readme.write_text("# Demo\n\n[Outside](escape.md)\n", encoding="utf-8")
            (Path(outside) / "target.md").write_text("# Outside\n", encoding="utf-8")
            (root / "escape.md").symlink_to(Path(outside) / "target.md")
            findings = check_readme.check(readme)
        self.assertIn(
            "local target escapes repository root: escape.md",
            [finding.message for finding in findings],
        )

    def test_reports_placeholder_outside_code(self):
        findings = self.check("# Demo\n\nToken: YOUR_TOKEN\n")
        self.assertIn("possible unresolved placeholder", [finding.message for finding in findings])

    def test_reports_unclosed_fence_and_external_scheme_outside_allowlist(self):
        findings = self.check(
            """# Demo

[Editor](vscode://example/path)

```text
unfinished
"""
        )
        messages = {(finding.level, finding.message) for finding in findings}
        self.assertIn(("warning", "link scheme not checked: vscode"), messages)
        self.assertIn(("error", "unclosed fenced code block"), messages)

    def test_cli_default_path_and_strict_exit_codes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "README.md").write_text("Plain text\n", encoding="utf-8")
            default = subprocess.run(
                [sys.executable, str(SCRIPT)],
                cwd=root,
                text=True,
                capture_output=True,
                check=False,
            )
            strict = subprocess.run(
                [sys.executable, str(SCRIPT), "--strict"],
                cwd=root,
                text=True,
                capture_output=True,
                check=False,
            )
        self.assertEqual(0, default.returncode)
        self.assertIn("warning: README.md:1: no level-1 Markdown heading found", default.stdout)
        self.assertIn("checked README.md: 0 error(s), 1 warning(s)", default.stdout)
        self.assertEqual(1, strict.returncode)

    def test_cli_errors_return_failure_and_root_can_be_expanded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            docs = root / "docs"
            docs.mkdir()
            (root / "LICENSE").write_text("Example\n", encoding="utf-8")
            (docs / "README.md").write_text("# Demo\n\n[License](../LICENSE)\n", encoding="utf-8")
            restricted = subprocess.run(
                [sys.executable, str(SCRIPT), "docs/README.md"],
                cwd=root,
                text=True,
                capture_output=True,
                check=False,
            )
            expanded = subprocess.run(
                [sys.executable, str(SCRIPT), "docs/README.md", "--root", "."],
                cwd=root,
                text=True,
                capture_output=True,
                check=False,
            )
        self.assertEqual(1, restricted.returncode)
        self.assertIn("local target escapes repository root: ../LICENSE", restricted.stdout)
        self.assertEqual(0, expanded.returncode)
        self.assertIn("checked docs/README.md: 0 error(s), 0 warning(s)", expanded.stdout)


if __name__ == "__main__":
    unittest.main()
