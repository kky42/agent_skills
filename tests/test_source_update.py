from __future__ import annotations

import json
import os
import runpy
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
UPDATER = REPO / "scripts" / "thirdparty-update"


def run(command: list[str], cwd: Path) -> str:
    return subprocess.run(command, cwd=cwd, check=True, text=True, capture_output=True).stdout.strip()


def git_init(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    run(["git", "init", "-q", "-b", "main"], path)
    run(["git", "config", "user.email", "tests@example.invalid"], path)
    run(["git", "config", "user.name", "tests"], path)


def git_commit(path: Path, message: str) -> str:
    run(["git", "add", "-A"], path)
    run(["git", "commit", "-q", "-m", message], path)
    return run(["git", "rev-parse", "HEAD"], path)


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def write_skill(path: Path, name: str, body: str) -> None:
    path.mkdir(parents=True, exist_ok=True)
    (path / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: test\n---\n\n{body}\n",
        encoding="utf-8",
    )


class SourceUpdateTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.upstream = self.base / "upstream"
        self.workspace = self.base / "workspace"
        git_init(self.upstream)
        git_init(self.workspace)

    def invoke(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        environment = dict(os.environ)
        environment["AGENT_SKILLS_REPO_ROOT"] = str(self.workspace)
        return subprocess.run(
            [str(UPDATER), *arguments],
            cwd=self.workspace,
            env=environment,
            text=True,
            capture_output=True,
        )

    def base_files(self, manifest: dict) -> None:
        write_json(self.workspace / "skill-manifest.json", manifest)
        write_json(self.workspace / "skill-lock.json", {"schemaVersion": 1, "skills": {}})

    def test_owned_source_is_reported_but_never_applied(self) -> None:
        source_dir = self.upstream / "skills" / "source"
        write_skill(source_dir, "source", "version one")
        git_commit(self.upstream, "first")

        owned_dir = self.workspace / "skills" / "owned"
        write_skill(owned_dir, "owned", "local authority")
        self.base_files(
            {
                "schemaVersion": 1,
                "sources": {
                    "example/source": {
                        "kind": "git",
                        "url": str(self.upstream),
                        "defaultRef": "origin/main",
                    }
                },
                "skills": {
                    "owned": {
                        "ownership": "owned",
                        "relations": [
                            {
                                "id": "upstream-content",
                                "type": "content-source",
                                "source": {"source": "example/source", "path": "skills/source"},
                                "watch": {"include": ["SKILL.md"]},
                            }
                        ],
                    }
                },
            }
        )
        git_commit(self.workspace, "baseline")

        write_skill(source_dir, "source", "version two")
        other_source = self.upstream / "other"
        other_source.mkdir()
        (other_source / "README.md").write_text("separate scope\n", encoding="utf-8")
        second = git_commit(self.upstream, "second")
        checked = self.invoke("owned", "--check", "--format", "json")
        self.assertEqual(checked.returncode, 0, checked.stderr)
        report = json.loads(checked.stdout)
        self.assertEqual(report["ownership"], "owned")
        self.assertEqual(report["sources"][0]["targetCommit"], second)
        self.assertEqual(report["sources"][0]["action"], "selective-adopt")
        self.assertEqual(report["sources"][0]["relevantChanges"][0]["path"], "SKILL.md")

        before = (owned_dir / "SKILL.md").read_text(encoding="utf-8")
        applied = self.invoke("owned", "--apply", "--format", "json")
        self.assertNotEqual(applied.returncode, 0)
        self.assertIn("--apply is forbidden", applied.stdout)
        self.assertEqual((owned_dir / "SKILL.md").read_text(encoding="utf-8"), before)

        empty_payload = self.base / "empty-review.json"
        write_json(empty_payload, {"toCommit": second, "accepted": [], "skipped": []})
        rejected_review = self.invoke(
            "owned",
            "--record-review",
            str(empty_payload),
            "--relation",
            "upstream-content",
            "--format",
            "json",
        )
        self.assertNotEqual(rejected_review.returncode, 0)
        self.assertIn("must decide every relevant changed path", rejected_review.stdout)

        typo_payload = self.base / "typo-review.json"
        write_json(
            typo_payload,
            {
                "toCommit": second,
                "accepted": [
                    {
                        "upstreamPaths": ["SKILL.md"],
                        "localPaths": ["SKILL.md"],
                        "note": "adapted",
                        "typo": "must reject",
                    }
                ],
                "skipped": [],
            },
        )
        typo_review = self.invoke(
            "owned", "--record-review", str(typo_payload), "--relation", "upstream-content", "--format", "json"
        )
        self.assertNotEqual(typo_review.returncode, 0)
        self.assertIn("unknown fields", typo_review.stdout)

        payload = self.base / "review.json"
        write_json(
            payload,
            {
                "toCommit": second,
                "accepted": [
                    {
                        "upstreamPaths": ["SKILL.md"],
                        "localPaths": ["SKILL.md"],
                        "note": "adapted the relevant idea manually",
                    }
                ],
                "skipped": [],
            },
        )
        recorded = self.invoke(
            "owned",
            "--record-review",
            str(payload),
            "--relation",
            "upstream-content",
            "--format",
            "json",
        )
        self.assertEqual(recorded.returncode, 0, recorded.stderr)
        state = json.loads((self.workspace / "skill-lock.json").read_text(encoding="utf-8"))
        relation_state = state["skills"]["owned"]["relations"]["upstream-content"]
        self.assertEqual(relation_state["lastReviewedCommit"], second)
        self.assertEqual(relation_state["reviews"][-1]["accepted"][0]["upstreamPaths"], ["SKILL.md"])

        manifest_path = self.workspace / "skill-manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        relation = manifest["skills"]["owned"]["relations"][0]
        relation["source"]["path"] = "other"
        relation["watch"] = {"include": ["**/*.md"]}
        write_json(manifest_path, manifest)
        scope_check = self.invoke("owned", "--check", "--format", "json")
        self.assertEqual(scope_check.returncode, 0, scope_check.stderr)
        scope_source = json.loads(scope_check.stdout)["sources"][0]
        self.assertTrue(scope_source["scopeChanged"])
        self.assertTrue(scope_source["reviewRequired"])
        self.assertEqual(scope_source["relevantChanges"], [{"status": "added", "path": "README.md"}])

    def test_clean_explicit_mirror_is_replaced(self) -> None:
        source_dir = self.upstream / "skills" / "mirror"
        write_skill(source_dir, "mirror", "version one")
        (source_dir / ".gitattributes").write_text("kept.txt export-ignore\n", encoding="utf-8")
        (source_dir / "kept.txt").write_text("tracked despite export-ignore\n", encoding="utf-8")
        executable = source_dir / "run.sh"
        executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        executable.chmod(0o755)
        os.symlink("kept.txt", source_dir / "kept-link")
        git_commit(self.upstream, "first")

        target_dir = self.workspace / "skills" / "mirror"
        shutil.copytree(source_dir, target_dir, symlinks=True)
        self.base_files(
            {
                "schemaVersion": 1,
                "sources": {
                    "example/source": {
                        "kind": "git",
                        "url": str(self.upstream),
                        "defaultRef": "origin/main",
                    }
                },
                "skills": {
                    "mirror": {
                        "path": "skills/mirror",
                        "ownership": "mirror",
                        "mirror": {"source": "example/source", "path": "skills/mirror"},
                    }
                },
            }
        )
        git_commit(self.workspace, "baseline")

        write_skill(source_dir, "mirror", "version two")
        second = git_commit(self.upstream, "second")
        applied = self.invoke("mirror", "--apply", "--format", "json")
        self.assertEqual(applied.returncode, 0, applied.stderr)
        report = json.loads(applied.stdout)
        self.assertTrue(report["applied"])
        self.assertEqual(report["resolvedCommit"], second)
        self.assertIn("version two", (target_dir / "SKILL.md").read_text(encoding="utf-8"))
        self.assertTrue((target_dir / "kept.txt").exists())
        self.assertTrue((target_dir / "kept-link").is_symlink())
        self.assertTrue((target_dir / "run.sh").stat().st_mode & 0o100)
        lock = json.loads((self.workspace / "skill-lock.json").read_text(encoding="utf-8"))
        self.assertEqual(lock["skills"]["mirror"]["mirror"]["resolvedCommit"], second)

    def test_dirty_but_upstream_exact_mirror_can_record_state_without_replacement(self) -> None:
        source_dir = self.upstream / "skills" / "mirror"
        write_skill(source_dir, "mirror", "version one")
        git_commit(self.upstream, "first")
        target_dir = self.workspace / "skills" / "mirror"
        shutil.copytree(source_dir, target_dir)
        self.base_files(
            {
                "schemaVersion": 1,
                "sources": {
                    "example/source": {
                        "kind": "git",
                        "url": str(self.upstream),
                        "defaultRef": "origin/main",
                    }
                },
                "skills": {
                    "mirror": {
                        "ownership": "mirror",
                        "mirror": {"source": "example/source", "path": "skills/mirror"},
                    }
                },
            }
        )
        git_commit(self.workspace, "baseline")

        write_skill(source_dir, "mirror", "version two")
        second = git_commit(self.upstream, "second")
        write_skill(target_dir, "mirror", "version two")
        applied = self.invoke("mirror", "--apply", "--format", "json")
        self.assertEqual(applied.returncode, 0, applied.stdout)
        state = json.loads((self.workspace / "skill-lock.json").read_text(encoding="utf-8"))
        self.assertEqual(state["skills"]["mirror"]["mirror"]["resolvedCommit"], second)

    def test_dirty_mirror_is_not_replaced(self) -> None:
        source_dir = self.upstream / "skills" / "mirror"
        write_skill(source_dir, "mirror", "version one")
        git_commit(self.upstream, "first")
        target_dir = self.workspace / "skills" / "mirror"
        shutil.copytree(source_dir, target_dir)
        self.base_files(
            {
                "schemaVersion": 1,
                "sources": {
                    "example/source": {
                        "kind": "git",
                        "url": str(self.upstream),
                        "defaultRef": "origin/main",
                    }
                },
                "skills": {
                    "mirror": {
                        "ownership": "mirror",
                        "mirror": {"source": "example/source", "path": "skills/mirror"},
                    }
                },
            }
        )
        (self.workspace / ".gitignore").write_text("skills/mirror/LOCAL.secret\n", encoding="utf-8")
        git_commit(self.workspace, "baseline")
        (target_dir / "LOCAL.secret").write_text("do not overwrite\n", encoding="utf-8")

        applied = self.invoke("mirror", "--apply", "--format", "json")
        self.assertNotEqual(applied.returncode, 0)
        self.assertIn("refusing to replace dirty mirror path", applied.stdout)
        self.assertTrue((target_dir / "LOCAL.secret").exists())

    def test_nested_directory_diff_keeps_full_prefix(self) -> None:
        module = runpy.run_path(str(UPDATER))
        left = self.base / "left"
        right = self.base / "right"
        (left / "a" / "b").mkdir(parents=True)
        (right / "a" / "b").mkdir(parents=True)
        (left / "a" / "b" / "x.txt").write_text("one", encoding="utf-8")
        (right / "a" / "b" / "x.txt").write_text("two", encoding="utf-8")
        self.assertEqual(module["summarize_dir_diff"](left, right), ["- modified a/b/x.txt"])

    def test_folder_hash_encoding_is_unambiguous(self) -> None:
        module = runpy.run_path(str(UPDATER))
        first = {"a": ("file", b"X\0b\0file\0Y")}
        second = {"a": ("file", b"X"), "b": ("file", b"Y")}
        self.assertNotEqual(module["snapshot_hash"](first), module["snapshot_hash"](second))

    def test_directory_swap_rolls_back_when_lock_commit_fails(self) -> None:
        module = runpy.run_path(str(UPDATER))
        old = self.base / "old"
        new = self.base / "new"
        old.mkdir()
        new.mkdir()
        (old / "value").write_text("old", encoding="utf-8")
        (new / "value").write_text("new", encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "lock failed"):
            with module["replaced_directory"](new, old):
                self.assertEqual((old / "value").read_text(encoding="utf-8"), "new")
                raise RuntimeError("lock failed")
        self.assertEqual((old / "value").read_text(encoding="utf-8"), "old")


if __name__ == "__main__":
    unittest.main()
