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
CLI = REPO / "scripts" / "skills"


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


def write_skill(path: Path, name: str, body: str = "body") -> Path:
    path.mkdir(parents=True, exist_ok=True)
    (path / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: test\n---\n\n{body}\n",
        encoding="utf-8",
    )
    return path


class Fixture(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.root = self.base / "workspace"
        self.root.mkdir()

    def base_files(self, manifest: dict, lock: dict | None = None, source_mirrors: dict | None = None) -> None:
        write_json(self.root / "skill-manifest.json", manifest)
        write_json(self.root / "skill-lock.json", lock or {"schemaVersion": 1, "skills": {}})
        if source_mirrors is None:
            policies = {}
            for name, entry in manifest.get("skills", {}).items():
                mirror = entry.get("mirror") if isinstance(entry, dict) else None
                if not mirror:
                    continue
                policies[mirror["source"]] = {
                    "mode": "skill",
                    "policy": "Explicit fixture skill.",
                    "resolvedCommit": "0" * 40,
                    "decisions": [{"name": name, "path": mirror["path"], "decision": "include", "reason": "fixture", "treeHash": "sha256:" + "0" * 64}],
                }
            source_mirrors = {"schemaVersion": 1, "sources": policies}
        write_json(self.root / "source-mirrors.json", source_mirrors)

    def invoke(self, *arguments: str, env: dict | None = None) -> subprocess.CompletedProcess[str]:
        environment = dict(os.environ)
        environment["AGENT_SKILLS_REPO_ROOT"] = str(self.root)
        environment.update(env or {})
        return subprocess.run(
            [str(CLI), *arguments],
            cwd=self.root,
            env=environment,
            text=True,
            capture_output=True,
        )


class ModelValidationTests(Fixture):
    def load(self):
        module = runpy.run_path(str(CLI))
        return module, module["load_catalog"]

    def test_required_model_files_cannot_be_implicit(self) -> None:
        module, load_catalog = self.load()
        write_skill(self.root / "skills" / "owned", "owned")
        with self.assertRaisesRegex(module["CliError"], "required model file is missing"):
            load_catalog(self.root)

    def test_two_ownership_states_and_typed_relations(self) -> None:
        module, load_catalog = self.load()
        write_skill(self.root / "skills" / "vendor" / "mirror", "mirror")
        write_skill(self.root / "skills" / "owned", "owned")
        write_skill(self.root / "skills" / "default", "default")
        self.base_files(
            {
                "schemaVersion": 1,
                "sources": {
                    "upstream/example": {"kind": "git", "url": "https://example.invalid/upstream.git"}
                },
                "skills": {
                    "mirror": {
                        "path": "skills/vendor/mirror",
                        "ownership": "mirror",
                        "mirror": {"source": "upstream/example", "path": "skills/mirror"},
                    },
                    "owned": {
                        "ownership": "owned",
                        "relations": [
                            {
                                "id": "source-notes",
                                "type": "content-source",
                                "source": {"source": "upstream/example", "path": "docs"},
                                "watch": {"include": ["**/*.md"], "localPaths": ["references"]},
                            },
                            {"id": "runtime-skill", "type": "skill-dependency", "skill": "mirror"},
                        ],
                    },
                },
            }
        )
        catalog = load_catalog(self.root)
        self.assertEqual(catalog.skills["mirror"].ownership, "mirror")
        self.assertEqual(catalog.skills["owned"].ownership, "owned")
        self.assertEqual(catalog.skills["default"].ownership, "owned")
        self.assertFalse(catalog.skills["default"].ownership_explicit)
        dependencies, reverse = module["dependency_graph"](catalog)
        self.assertEqual(dependencies["owned"], {"mirror"})
        self.assertEqual(reverse["mirror"], {"owned"})

    def test_source_and_skill_mirror_modes_are_orthogonal_to_ownership(self) -> None:
        module, load_catalog = self.load()
        write_skill(self.root / "skills" / "source-selected", "source-selected")
        write_skill(self.root / "skills" / "skill-selected", "skill-selected")
        manifest = {
            "schemaVersion": 1,
            "sources": {
                "example/source": {"kind": "git", "url": "https://example.invalid/source.git"},
                "example/skill": {"kind": "git", "url": "https://example.invalid/skill.git"},
            },
            "skills": {
                "source-selected": {"ownership": "mirror", "mirror": {"source": "example/source", "path": "skills/source-selected"}},
                "skill-selected": {"ownership": "mirror", "mirror": {"source": "example/skill", "path": "skills/skill-selected"}},
            },
        }
        policies = {
            "schemaVersion": 1,
            "sources": {
                "example/source": {
                    "mode": "source",
                    "policy": "Include stable, general-purpose skills.",
                    "resolvedCommit": "a" * 40,
                    "decisions": [{"name": "source-selected", "path": "skills/source-selected", "decision": "include", "reason": "stable and general", "treeHash": "sha256:" + "0" * 64}],
                },
                "example/skill": {
                    "mode": "skill",
                    "policy": "Track only the explicitly selected skill.",
                    "resolvedCommit": "b" * 40,
                    "decisions": [{"name": "skill-selected", "path": "skills/skill-selected", "decision": "include", "reason": "explicit selection", "treeHash": "sha256:" + "1" * 64}],
                },
            },
        }
        self.base_files(manifest, source_mirrors=policies)
        catalog = load_catalog(self.root)
        self.assertEqual(catalog.mirror_modes["source-selected"], "source")
        self.assertEqual(catalog.mirror_modes["skill-selected"], "skill")
        listed = self.invoke("list", "--format", "json")
        self.assertEqual(listed.returncode, 0, listed.stderr)
        rows = {row["name"]: row for row in json.loads(listed.stdout)["skills"]}
        self.assertEqual(rows["source-selected"]["mirrorMode"], "source")
        self.assertEqual(rows["skill-selected"]["mirrorMode"], "skill")

    def test_source_policy_cache_validation_and_report(self) -> None:
        module, load_catalog = self.load()
        write_skill(self.root / "skills" / "mirror", "mirror")
        manifest = {
            "schemaVersion": 1,
            "sources": {"example/source": {"kind": "git", "url": "https://example.invalid/source.git"}},
            "skills": {"mirror": {"ownership": "mirror", "mirror": {"source": "example/source", "path": "skills/mirror"}}},
        }
        invalid = {"schemaVersion": 1, "sources": {"example/source": {"mode": "automatic", "policy": "x", "decisions": []}}}
        self.base_files(manifest, source_mirrors=invalid)
        with self.assertRaisesRegex(module["CliError"], "mode must be source or skill"):
            load_catalog(self.root)

        valid = {"schemaVersion": 1, "sources": {"example/source": {"mode": "source", "policy": "Agent decides.", "resolvedCommit": "a" * 40, "decisions": [{"name": "mirror", "path": "skills/mirror", "decision": "include", "reason": "selected", "treeHash": "sha256:" + "0" * 64}, {"name": "later", "path": "skills/later", "decision": "defer", "reason": "in progress"}]}}}
        self.base_files(manifest, source_mirrors=valid)
        report = self.invoke("source", "report", "example/source", "--format", "json")
        self.assertEqual(report.returncode, 0, report.stderr)
        data = json.loads(report.stdout)
        self.assertEqual(data["sources"][0]["mode"], "source")
        self.assertEqual(data["sources"][0]["counts"], {"defer": 1, "exclude": 0, "include": 1})

    def test_source_cache_rejects_malformed_hashes_duplicates_and_missing_include_hash(self) -> None:
        module, load_catalog = self.load()
        write_skill(self.root / "skills" / "mirror", "mirror")
        manifest = {"schemaVersion": 1, "sources": {"example/source": {"kind": "git", "url": "https://example.invalid/source.git"}}, "skills": {"mirror": {"ownership": "mirror", "mirror": {"source": "example/source", "path": "skills/mirror"}}}}
        policies = {"schemaVersion": 1, "sources": {"example/source": {"mode": "source", "policy": "Agent decides.", "resolvedCommit": "abcdef0", "decisions": [
            {"name": "mirror", "path": "skills/mirror", "decision": "include", "reason": "selected"},
            {"name": "other", "path": "skills/mirror", "decision": "exclude", "reason": "duplicate path", "treeHash": "sha256:no"},
        ]}}}
        self.base_files(manifest, source_mirrors=policies)
        with self.assertRaises(module["CliError"]) as raised:
            load_catalog(self.root)
        message = str(raised.exception)
        self.assertIn("resolvedCommit must be a 40-hex git SHA-1", message)
        self.assertIn("path must be unique", message)
        self.assertIn("included decision requires treeHash", message)
        self.assertIn("treeHash must be sha256 plus 64 hex", message)

    def test_source_report_surfaces_inventory_coverage_without_making_decisions(self) -> None:
        write_skill(self.root / "skills" / "mirror", "mirror")
        upstream = self.base / "upstream-report"
        git_init(upstream)
        write_skill(upstream / "skills" / "mirror", "mirror")
        write_skill(upstream / "skills" / "new", "new")
        commit = git_commit(upstream, "inventory")
        inventory = self.base / "inventory.json"
        policies = {"schemaVersion": 1, "sources": {"example/source": {"mode": "source", "policy": "Agent decides.", "resolvedCommit": commit, "decisions": [{"name": "mirror", "path": "skills/mirror", "decision": "include", "reason": "selected", "treeHash": "sha256:" + "0" * 64}]}}}
        manifest = {"schemaVersion": 1, "sources": {"example/source": {"kind": "git", "url": str(upstream), "defaultRef": "origin/main"}}, "skills": {"mirror": {"ownership": "mirror", "mirror": {"source": "example/source", "path": "skills/mirror"}}}}
        self.base_files(manifest, source_mirrors=policies)
        discovered = self.invoke("source", "inventory", "example/source", "--format", "json")
        self.assertEqual(discovered.returncode, 0, discovered.stderr)
        inventory.write_text(discovered.stdout + "\n", encoding="utf-8")
        report = self.invoke("source", "report", "example/source", "--inventory", str(inventory), "--format", "json")
        self.assertEqual(report.returncode, 0, report.stderr)
        coverage = json.loads(report.stdout)["sources"][0]["coverage"]
        self.assertEqual(coverage["missingDecisions"], [{"name": "new", "path": "skills/new"}])
        self.assertEqual(coverage["extraDecisions"], [])
        self.assertEqual(len(coverage["treeHashMismatches"]), 1)
        self.assertEqual(coverage["treeHashMismatches"][0]["path"], "skills/mirror")

    def test_skill_mode_report_ignores_siblings_but_reports_selected_removal(self) -> None:
        write_skill(self.root / "skills" / "selected", "selected")
        upstream = self.base / "upstream-skill-mode"
        git_init(upstream)
        write_skill(upstream / "skills" / "selected", "selected")
        write_skill(upstream / "skills" / "sibling", "sibling")
        commit = git_commit(upstream, "inventory")
        manifest = {"schemaVersion": 1, "sources": {"example/source": {"kind": "git", "url": str(upstream), "defaultRef": "origin/main"}}, "skills": {"selected": {"ownership": "mirror", "mirror": {"source": "example/source", "path": "skills/selected"}}}}
        policies = {"schemaVersion": 1, "sources": {"example/source": {"mode": "skill", "policy": "Track selected only.", "resolvedCommit": commit, "decisions": [{"name": "selected", "path": "skills/selected", "decision": "include", "reason": "selected", "treeHash": "sha256:" + "0" * 64}]}}}
        self.base_files(manifest, source_mirrors=policies)
        result = self.invoke("source", "inventory", "example/source", "--format", "json")
        inventory = self.base / "skill-inventory.json"
        inventory.write_text(result.stdout, encoding="utf-8")
        report = self.invoke("source", "report", "example/source", "--inventory", str(inventory), "--format", "json")
        coverage = json.loads(report.stdout)["sources"][0]["coverage"]
        self.assertEqual(coverage["missingDecisions"], [])
        self.assertEqual(coverage["extraDecisions"], [])
        self.assertEqual(len(coverage["treeHashMismatches"]), 1)

        payload = json.loads(inventory.read_text(encoding="utf-8"))
        payload["skills"] = [skill for skill in payload["skills"] if skill["name"] == "sibling"]
        write_json(inventory, payload)
        removed = self.invoke("source", "report", "example/source", "--inventory", str(inventory), "--format", "json")
        coverage = json.loads(removed.stdout)["sources"][0]["coverage"]
        self.assertEqual(coverage["missingDecisions"], [])
        self.assertEqual(coverage["extraDecisions"], [{"name": "selected", "path": "skills/selected"}])
        self.assertEqual(coverage["treeHashMismatches"], [])

    def test_source_inventory_preserves_odd_valid_git_paths(self) -> None:
        upstream = self.base / "upstream-odd-path"
        git_init(upstream)
        write_skill(upstream / "skills" / "odd\nparent" / "normal-skill", "normal-skill")
        git_commit(upstream, "odd path")
        self.base_files({"schemaVersion": 1, "sources": {"example/source": {"kind": "git", "url": str(upstream), "defaultRef": "origin/main"}}, "skills": {}})
        result = self.invoke("source", "inventory", "example/source", "--format", "json")
        self.assertEqual(result.returncode, 0, result.stderr)
        inventory = json.loads(result.stdout)
        self.assertEqual(inventory["skills"][0]["path"], "skills/odd\nparent/normal-skill")

    def test_source_inventory_rejects_root_and_symlink_skill_files(self) -> None:
        upstream = self.base / "upstream-unsafe"
        git_init(upstream)
        (upstream / "SKILL.md").write_text("---\nname: root\ndescription: test\n---\n", encoding="utf-8")
        git_commit(upstream, "root")
        self.base_files({"schemaVersion": 1, "sources": {"example/source": {"kind": "git", "url": str(upstream), "defaultRef": "origin/main"}}, "skills": {}})
        root = self.invoke("source", "inventory", "example/source", "--format", "json")
        self.assertNotEqual(root.returncode, 0)
        self.assertIn("root-level SKILL.md is not supported", root.stdout)

        (upstream / "SKILL.md").unlink()
        target = upstream / "TARGET.md"
        target.write_text("---\nname: linked\ndescription: test\n---\n", encoding="utf-8")
        linked = upstream / "skills" / "linked"
        linked.mkdir(parents=True)
        os.symlink("../../TARGET.md", linked / "SKILL.md")
        git_commit(upstream, "symlink")
        symlink = self.invoke("source", "inventory", "example/source", "--format", "json")
        self.assertNotEqual(symlink.returncode, 0)
        self.assertIn("SKILL.md must be a regular file", symlink.stdout)

    def test_mirror_rejects_relations(self) -> None:
        module, load_catalog = self.load()
        write_skill(self.root / "skills" / "mirror", "mirror")
        write_skill(self.root / "skills" / "base", "base")
        self.base_files(
            {
                "schemaVersion": 1,
                "sources": {
                    "upstream/example": {"kind": "git", "url": "https://example.invalid/upstream.git"}
                },
                "skills": {
                    "mirror": {
                        "ownership": "mirror",
                        "mirror": {"source": "upstream/example", "path": "skills/mirror"},
                        "relations": [{"id": "base", "type": "skill-dependency", "skill": "base"}],
                    }
                },
            }
        )
        with self.assertRaisesRegex(module["CliError"], "mirror skills cannot declare relations"):
            load_catalog(self.root)

    def test_manifest_rejects_unknown_fields_and_invalid_policy(self) -> None:
        module, load_catalog = self.load()
        write_skill(self.root / "skills" / "owned", "owned")
        self.base_files(
            {
                "$schema": "retired",
                "schemaVersion": 1,
                "sources": {},
                "skills": {
                    "owned": {
                        "ownership": "owned",
                        "relations": [
                            {
                                "id": "tool",
                                "type": "tool-dependency",
                                "tool": {"kind": "npm-global", "package": "example"},
                                "updatePolicy": "destroy",
                            }
                        ],
                    }
                },
            }
        )
        with self.assertRaises(module["CliError"]) as raised:
            load_catalog(self.root)
        message = str(raised.exception)
        self.assertIn("unknown fields ['$schema']", message)
        self.assertIn("invalid updatePolicy 'destroy'", message)

    def test_manifest_rejects_null_watch_arrays_and_non_list_relations(self) -> None:
        module, load_catalog = self.load()
        write_skill(self.root / "skills" / "owned", "owned")
        write_skill(self.root / "skills" / "other", "other")
        self.base_files(
            {
                "schemaVersion": 1,
                "sources": {"example/source": {"kind": "git", "url": "https://example.invalid/source.git"}},
                "skills": {
                    "owned": {
                        "ownership": "owned",
                        "relations": [
                            {
                                "id": "source",
                                "type": "content-source",
                                "source": {"source": "example/source", "path": "skills/source"},
                                "watch": {"include": None},
                            }
                        ],
                    },
                    "other": {"ownership": "owned", "relations": None},
                },
            }
        )
        with self.assertRaises(module["CliError"]) as raised:
            load_catalog(self.root)
        message = str(raised.exception)
        self.assertIn("watch.include must be an array", message)
        self.assertIn("relations must be an array", message)

    def test_lock_rejects_incomplete_or_malformed_receipt_state(self) -> None:
        module, load_catalog = self.load()
        write_skill(self.root / "skills" / "owned", "owned")
        manifest = {
            "schemaVersion": 1,
            "sources": {"example/source": {"kind": "git", "url": "https://example.invalid/source.git"}},
            "skills": {
                "owned": {
                    "ownership": "owned",
                    "relations": [
                        {
                            "id": "source",
                            "type": "content-source",
                            "source": {"source": "example/source", "path": "skills/source"},
                        }
                    ],
                }
            },
        }
        self.base_files(
            manifest,
            {"schemaVersion": 1, "skills": {"owned": {"relations": {"source": {"lastReviewedCommit": "abcdef0"}}}}},
        )
        with self.assertRaisesRegex(module["CliError"], "missing fields"):
            load_catalog(self.root)

        self.base_files(
            manifest,
            {
                "schemaVersion": 1,
                "skills": {
                    "owned": {
                        "relations": {
                            "source": {
                                "relationFingerprint": "sha256:abc",
                                "sourceId": "example/source",
                                "sourcePath": "skills/source",
                                "sourceRef": "origin/main",
                                "lastReviewedCommit": "x",
                                "reviewedAt": "not-a-date",
                                "accepted": [
                                    {"upstreamPaths": ["SKILL.md"], "localPaths": ["SKILL.md"], "note": 3}
                                ],
                                "skipped": [],
                            }
                        }
                    }
                },
            },
        )
        with self.assertRaises(module["CliError"]) as raised:
            load_catalog(self.root)
        message = str(raised.exception)
        self.assertIn("lastReviewedCommit must be a 40-hex git SHA-1", message)
        self.assertIn("reviewedAt must be an ISO date-time", message)
        self.assertIn("note must be a non-empty string", message)

    def test_skill_dependency_cycle_is_rejected(self) -> None:
        module, load_catalog = self.load()
        write_skill(self.root / "skills" / "a", "a")
        write_skill(self.root / "skills" / "b", "b")
        self.base_files(
            {
                "schemaVersion": 1,
                "sources": {},
                "skills": {
                    "a": {"ownership": "owned", "relations": [{"id": "b", "type": "skill-dependency", "skill": "b"}]},
                    "b": {"ownership": "owned", "relations": [{"id": "a", "type": "skill-dependency", "skill": "a"}]},
                },
            }
        )
        with self.assertRaisesRegex(module["CliError"], "skill dependency cycle: a -> b -> a"):
            load_catalog(self.root)


class UpdateTests(Fixture):
    def setUp(self) -> None:
        super().setUp()
        self.upstream = self.base / "upstream"
        git_init(self.upstream)
        git_init(self.root)

    def manifest_for(self, skill_entry: dict) -> dict:
        return {
            "schemaVersion": 1,
            "sources": {
                "example/source": {
                    "kind": "git",
                    "url": str(self.upstream),
                    "defaultRef": "origin/main",
                }
            },
            "skills": skill_entry,
        }

    def test_owned_source_is_reported_but_never_applied(self) -> None:
        source_dir = write_skill(self.upstream / "skills" / "source", "source", "version one")
        git_commit(self.upstream, "first")
        owned_dir = write_skill(self.root / "skills" / "owned", "owned", "local authority")
        self.base_files(
            self.manifest_for(
                {
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
                }
            )
        )
        git_commit(self.root, "baseline")

        write_skill(source_dir, "source", "version two")
        other = self.upstream / "other"
        other.mkdir()
        (other / "README.md").write_text("separate scope\n", encoding="utf-8")
        second = git_commit(self.upstream, "second")

        checked = self.invoke("update", "owned", "--format", "json")
        self.assertEqual(checked.returncode, 0, checked.stderr)
        report = json.loads(checked.stdout)
        self.assertEqual(report["ownership"], "owned")
        self.assertEqual(report["sources"][0]["targetCommit"], second)
        self.assertEqual(report["sources"][0]["action"], "selective-adopt")
        self.assertEqual(report["sources"][0]["relevantChanges"][0]["path"], "SKILL.md")

        before = (owned_dir / "SKILL.md").read_text(encoding="utf-8")
        applied = self.invoke("update", "owned", "--apply", "--format", "json")
        self.assertNotEqual(applied.returncode, 0)
        self.assertIn("--apply is forbidden", applied.stdout)
        self.assertEqual((owned_dir / "SKILL.md").read_text(encoding="utf-8"), before)

        empty_payload = self.base / "empty-review.json"
        write_json(empty_payload, {"toCommit": second, "accepted": [], "skipped": []})
        rejected = self.invoke(
            "update", "owned", "--record-review", str(empty_payload),
            "--relation", "upstream-content", "--format", "json",
        )
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn("must decide every relevant changed path", rejected.stdout)

        typo_payload = self.base / "typo-review.json"
        write_json(
            typo_payload,
            {
                "toCommit": second,
                "accepted": [
                    {"upstreamPaths": ["SKILL.md"], "localPaths": ["SKILL.md"], "note": "adapted", "typo": "no"}
                ],
                "skipped": [],
            },
        )
        typo = self.invoke(
            "update", "owned", "--record-review", str(typo_payload),
            "--relation", "upstream-content", "--format", "json",
        )
        self.assertNotEqual(typo.returncode, 0)
        self.assertIn("unknown fields", typo.stdout)

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
            "update", "owned", "--record-review", str(payload),
            "--relation", "upstream-content", "--format", "json",
        )
        self.assertEqual(recorded.returncode, 0, recorded.stderr)
        state = json.loads((self.root / "skill-lock.json").read_text(encoding="utf-8"))
        receipt = state["skills"]["owned"]["relations"]["upstream-content"]
        self.assertEqual(receipt["lastReviewedCommit"], second)
        self.assertEqual(receipt["accepted"][0]["upstreamPaths"], ["SKILL.md"])
        self.assertNotIn("reviews", receipt)

        manifest_path = self.root / "skill-manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        relation = manifest["skills"]["owned"]["relations"][0]
        relation["source"]["path"] = "other"
        relation["watch"] = {"include": ["**/*.md"]}
        write_json(manifest_path, manifest)
        scope_check = self.invoke("update", "owned", "--format", "json")
        self.assertEqual(scope_check.returncode, 0, scope_check.stderr)
        scope_source = json.loads(scope_check.stdout)["sources"][0]
        self.assertTrue(scope_source["scopeChanged"])
        self.assertTrue(scope_source["reviewRequired"])
        self.assertEqual(scope_source["relevantChanges"], [{"status": "added", "path": "README.md"}])

    def test_clean_explicit_mirror_is_replaced_byte_exactly(self) -> None:
        source_dir = write_skill(self.upstream / "skills" / "mirror", "mirror", "version one")
        (source_dir / ".gitattributes").write_text("kept.txt export-ignore\n", encoding="utf-8")
        (source_dir / "kept.txt").write_text("tracked despite export-ignore\n", encoding="utf-8")
        executable = source_dir / "run.sh"
        executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        executable.chmod(0o755)
        os.symlink("kept.txt", source_dir / "kept-link")
        git_commit(self.upstream, "first")

        target_dir = self.root / "skills" / "mirror"
        shutil.copytree(source_dir, target_dir, symlinks=True)
        self.base_files(
            self.manifest_for(
                {
                    "mirror": {
                        "path": "skills/mirror",
                        "ownership": "mirror",
                        "mirror": {"source": "example/source", "path": "skills/mirror"},
                    }
                }
            )
        )
        git_commit(self.root, "baseline")

        write_skill(source_dir, "mirror", "version two")
        second = git_commit(self.upstream, "second")
        applied = self.invoke("update", "mirror", "--apply", "--format", "json")
        self.assertEqual(applied.returncode, 0, applied.stderr)
        report = json.loads(applied.stdout)
        self.assertTrue(report["applied"])
        self.assertEqual(report["resolvedCommit"], second)
        self.assertIn("version two", (target_dir / "SKILL.md").read_text(encoding="utf-8"))
        self.assertTrue((target_dir / "kept.txt").exists())
        self.assertTrue((target_dir / "kept-link").is_symlink())
        self.assertTrue((target_dir / "run.sh").stat().st_mode & 0o100)
        lock = json.loads((self.root / "skill-lock.json").read_text(encoding="utf-8"))
        self.assertEqual(lock["skills"]["mirror"]["mirror"]["resolvedCommit"], second)
        self.assertTrue(lock["skills"]["mirror"]["mirror"]["treeHash"].startswith("sha256:"))

    def test_dirty_but_upstream_exact_mirror_records_state_without_replacement(self) -> None:
        source_dir = write_skill(self.upstream / "skills" / "mirror", "mirror", "version one")
        git_commit(self.upstream, "first")
        target_dir = self.root / "skills" / "mirror"
        shutil.copytree(source_dir, target_dir)
        self.base_files(
            self.manifest_for(
                {"mirror": {"ownership": "mirror", "mirror": {"source": "example/source", "path": "skills/mirror"}}}
            )
        )
        git_commit(self.root, "baseline")

        write_skill(source_dir, "mirror", "version two")
        second = git_commit(self.upstream, "second")
        write_skill(target_dir, "mirror", "version two")
        applied = self.invoke("update", "mirror", "--apply", "--format", "json")
        self.assertEqual(applied.returncode, 0, applied.stdout)
        state = json.loads((self.root / "skill-lock.json").read_text(encoding="utf-8"))
        self.assertEqual(state["skills"]["mirror"]["mirror"]["resolvedCommit"], second)

    def test_dirty_mirror_is_not_replaced(self) -> None:
        source_dir = write_skill(self.upstream / "skills" / "mirror", "mirror", "version one")
        git_commit(self.upstream, "first")
        target_dir = self.root / "skills" / "mirror"
        shutil.copytree(source_dir, target_dir)
        self.base_files(
            self.manifest_for(
                {"mirror": {"ownership": "mirror", "mirror": {"source": "example/source", "path": "skills/mirror"}}}
            )
        )
        (self.root / ".gitignore").write_text("skills/mirror/LOCAL.secret\n", encoding="utf-8")
        git_commit(self.root, "baseline")
        (target_dir / "LOCAL.secret").write_text("do not overwrite\n", encoding="utf-8")

        applied = self.invoke("update", "mirror", "--apply", "--format", "json")
        self.assertNotEqual(applied.returncode, 0)
        self.assertIn("refusing to replace dirty mirror path", applied.stdout)
        self.assertTrue((target_dir / "LOCAL.secret").exists())


class WorkflowContractTests(unittest.TestCase):
    def test_malformed_normalization_and_blocked_candidate_cleanup_contract(self) -> None:
        runtime = Path("/Users/kky/dev/pi/pi-flow/dist/runtime.js")
        if not runtime.exists():
            self.skipTest("pi-flow runtime is not available")
        script = f"""
const {{ readFileSync }} = require('node:fs');
(async () => {{
const {{ runWorkflow, ConcurrencyLimiter }} = await import({json.dumps(runtime.as_uri())});
const source = readFileSync({json.dumps(str(REPO / '.pi/workflows/agent-skills-mirrors.js'))}, 'utf8');
const detail = (path) => ({{candidate_worktree:path,base_commit:'a'.repeat(40),candidate_commit:'a'.repeat(40),primary_head:'b'.repeat(40),origin_main:'a'.repeat(40),primary_clean:false,added_skills:[],removed_skills:[],updated_skills:[],rejected_updates:[],excluded_skills:[],deferred_skills:[],dependency_changes:[],validation:[],deployment:{{committed:false,pushed:false,macmini:'not-run',macbook:'not-run',cleanup:'not-confirmed'}},warnings:['blocked'],human_actions:['inspect']}});
async function execute(kind) {{
  const calls=[]; const path='/tmp/agent-skills-mirrors-worktrees/candidate-1'; const runMode=kind==='identity'?'live':'audit';
  const result=await runWorkflow(source, {{cwd:{json.dumps(str(REPO))}, limiter:new ConcurrencyLimiter(2), replayEnabled:false, args:{{mode:runMode}}, runAgent:async(call)=>{{
    calls.push({{label:call.label,type:call.subagentType}});
    if (call.label==='mirror-candidate') {{
      if (kind==='malformed') return {{unexpected:true}};
      if (kind==='unsafe') return {{status:'blocked',message:'bad path',data:detail('/tmp/agent-skills-mirrors-worktrees/bad path')}};
      const value=detail(path); value.primary_clean=kind==='identity';
      return {{status:kind==='identity'?'complete':'blocked',message:'candidate',data:value}};
    }}
    if (call.label==='mirror-review') return {{approved:true,message:'approved',findings:[],candidate_worktree:path,base_commit:'a'.repeat(40),candidate_commit:'a'.repeat(40)}};
    if (call.label==='mirror-finalizer') {{ const value=detail(path); value.primary_clean=true; value.candidate_commit='c'.repeat(40); return {{status:'complete',message:'wrong identity',data:value}}; }}
    if (call.label.endsWith('-verify')) return {{registered:true,clean:true,path,message:'verified'}};
    if (call.label.endsWith('-remove')) return {{cleaned:true,path,message:'removed'}};
    throw new Error('unexpected call '+call.label);
  }}}});
  return {{value:result.result,calls,agentCount:result.agentCount}};
}}
console.log(JSON.stringify({{malformed:await execute('malformed'),blocked:await execute('blocked'),unsafe:await execute('unsafe'),identity:await execute('identity')}}));
}})().catch((error) => {{ console.error(error); process.exit(1); }});
"""
        process = subprocess.run(["node", "-e", script], text=True, capture_output=True)
        self.assertEqual(process.returncode, 0, process.stderr)
        output = json.loads(process.stdout)
        malformed = output["malformed"]
        self.assertEqual(malformed["agentCount"], 1)
        self.assertEqual(malformed["value"]["status"], "blocked")
        self.assertEqual(set(malformed["value"]), {"status", "message", "data"})
        blocked = output["blocked"]
        self.assertEqual(blocked["agentCount"], 3)
        self.assertEqual(blocked["value"]["data"]["deployment"]["cleanup"], "removed")
        self.assertEqual(set(blocked["value"]), {"status", "message", "data"})
        unsafe = output["unsafe"]
        self.assertEqual(unsafe["agentCount"], 1)
        self.assertEqual(unsafe["value"]["data"]["candidate_worktree"], "")
        self.assertEqual(unsafe["value"]["data"]["deployment"]["cleanup"], "not-confirmed")
        identity = output["identity"]
        self.assertEqual(identity["agentCount"], 5)
        self.assertEqual(identity["value"]["status"], "blocked")
        self.assertEqual(identity["value"]["data"]["candidate_commit"], "a" * 40)
        self.assertEqual(identity["value"]["data"]["deployment"]["cleanup"], "removed")
        self.assertEqual(set(identity["value"]), {"status", "message", "data"})
        self.assertTrue(all(call["type"] == "daily-driver" for case in output.values() for call in case["calls"]), output)


class HelperTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.module = runpy.run_path(str(CLI))

    def test_nested_directory_diff_keeps_full_prefix(self) -> None:
        left = self.base / "left"
        right = self.base / "right"
        (left / "a" / "b").mkdir(parents=True)
        (right / "a" / "b").mkdir(parents=True)
        (left / "a" / "b" / "x.txt").write_text("one", encoding="utf-8")
        (right / "a" / "b" / "x.txt").write_text("two", encoding="utf-8")
        self.assertEqual(
            self.module["directory_diff"](left, right),
            [{"status": "modified", "path": "a/b/x.txt"}],
        )

    def test_folder_hash_encoding_is_unambiguous(self) -> None:
        first = {"a": ("file", b"X\0b\0file\0Y")}
        second = {"a": ("file", b"X"), "b": ("file", b"Y")}
        self.assertNotEqual(self.module["snapshot_hash"](first), self.module["snapshot_hash"](second))

    def test_directory_swap_rolls_back_when_lock_commit_fails(self) -> None:
        old = self.base / "old"
        new = self.base / "new"
        old.mkdir()
        new.mkdir()
        (old / "value").write_text("old", encoding="utf-8")
        (new / "value").write_text("new", encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "lock failed"):
            with self.module["replaced_directory"](new, old):
                self.assertEqual((old / "value").read_text(encoding="utf-8"), "new")
                raise RuntimeError("lock failed")
        self.assertEqual((old / "value").read_text(encoding="utf-8"), "old")

    def test_glob_star_does_not_cross_directories(self) -> None:
        glob_regex = self.module["glob_regex"]
        self.assertTrue(glob_regex("*.md").fullmatch("SKILL.md"))
        self.assertFalse(glob_regex("*.md").fullmatch("docs/SKILL.md"))
        self.assertTrue(glob_regex("**/*.md").fullmatch("docs/deep/SKILL.md"))
        self.assertTrue(glob_regex("refs/**").fullmatch("refs/a/b.txt"))


class ApplyAndDoctorTests(Fixture):
    def setUp(self) -> None:
        super().setUp()
        git_init(self.root)
        write_skill(self.root / "skills" / "alpha", "alpha")
        write_skill(self.root / "skills" / "beta", "beta")
        self.base_files(
            {
                "schemaVersion": 1,
                "sources": {},
                "skills": {"alpha": {"ownership": "owned"}, "beta": {"ownership": "owned"}},
            }
        )
        git_commit(self.root, "baseline")
        self.target = self.base / "runtime"
        self.env = {"AGENT_SKILLS_SKILL_TARGETS": str(self.target)}

    def test_apply_links_and_doctor_detects_problems(self) -> None:
        foreign = self.target / "foreign-dir"
        foreign.mkdir(parents=True)
        (foreign / "sentinel").write_text("keep\n", encoding="utf-8")

        applied = self.invoke("apply", env=self.env)
        self.assertEqual(applied.returncode, 0, applied.stderr)
        self.assertTrue((self.target / "alpha").is_symlink())
        self.assertTrue((self.target / "foreign-dir" / "sentinel").exists())

        healthy = self.invoke("doctor", env=self.env)
        self.assertEqual(healthy.returncode, 0, healthy.stdout)
        self.assertIn("runtime links: ok", healthy.stdout)

        dangling = self.target / "deleted-skill"
        dangling.symlink_to(self.target / "missing-intermediate")
        stale = self.invoke("doctor", env=self.env)
        self.assertNotEqual(stale.returncode, 0)
        self.assertIn("stale runtime skill link", stale.stdout)

        cleaned = self.invoke("apply", env=self.env)
        self.assertEqual(cleaned.returncode, 0, cleaned.stderr)
        self.assertFalse(dangling.is_symlink())

        wrong = self.target / "alpha"
        wrong.unlink()
        wrong.symlink_to(self.base)
        broken = self.invoke("doctor", env=self.env)
        self.assertNotEqual(broken.returncode, 0)
        self.assertIn("expected", broken.stdout)

    def test_empty_target_configuration_is_rejected(self) -> None:
        process = self.invoke("apply", env={"AGENT_SKILLS_SKILL_TARGETS": os.pathsep})
        self.assertNotEqual(process.returncode, 0)
        self.assertIn("must contain at least one target directory", process.stderr)


class VerifyTests(Fixture):
    def test_verify_includes_reverse_dependents_and_reports_unchecked(self) -> None:
        import sys as _sys

        write_skill(self.root / "skills" / "base", "base")
        write_skill(self.root / "skills" / "app", "app")
        self.base_files(
            {
                "schemaVersion": 1,
                "sources": {},
                "skills": {
                    "app": {
                        "ownership": "owned",
                        "relations": [
                            {
                                "id": "base-runtime",
                                "type": "skill-dependency",
                                "skill": "base",
                                "verify": [[_sys.executable, "-c", "print('compatible')"]],
                            }
                        ],
                    }
                },
            }
        )
        process = self.invoke("verify", "base", "--format", "json")
        self.assertEqual(process.returncode, 0, process.stderr)
        report = json.loads(process.stdout)
        self.assertEqual(report["affectedSkills"], ["app", "base"])
        self.assertEqual(report["checks"][0]["skill"], "app")
        self.assertTrue(report["checks"][0]["ok"])

        manifest = json.loads((self.root / "skill-manifest.json").read_text(encoding="utf-8"))
        del manifest["skills"]["app"]["relations"][0]["verify"]
        write_json(self.root / "skill-manifest.json", manifest)
        unchecked = self.invoke("verify", "base", "--format", "json")
        self.assertEqual(unchecked.returncode, 0, unchecked.stderr)
        report = json.loads(unchecked.stdout)
        self.assertEqual(report["uncheckedRelations"][0]["skill"], "app")


if __name__ == "__main__":
    unittest.main()
