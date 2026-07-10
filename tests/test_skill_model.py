from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from skill_model import ModelError, dependency_graph, load_catalog


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def write_skill(root: Path, name: str, relative: str | None = None) -> Path:
    directory = root / (relative or f"skills/{name}")
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: test\n---\n\n# {name}\n",
        encoding="utf-8",
    )
    return directory


class SkillModelTests(unittest.TestCase):
    def make_root(self) -> Path:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        write_json(root / "skill-lock.json", {"schemaVersion": 1, "skills": {}})
        return root

    def test_required_model_files_cannot_be_implicit(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        write_skill(root, "owned")
        with self.assertRaisesRegex(ModelError, "required model file is missing"):
            load_catalog(root)

    def test_two_ownership_states_and_typed_relations(self) -> None:
        root = self.make_root()
        write_skill(root, "mirror", "skills/vendor/mirror")
        write_skill(root, "owned")
        write_skill(root, "default")
        write_json(
            root / "skill-manifest.json",
            {
                "schemaVersion": 1,
                "sources": {
                    "upstream/example": {
                        "kind": "git",
                        "url": "https://example.invalid/upstream.git",
                    }
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
                                "watch": {
                                    "include": ["**/*.md"],
                                    "localPaths": ["references"],
                                },
                            },
                            {
                                "id": "runtime-skill",
                                "type": "skill-dependency",
                                "skill": "mirror",
                            },
                        ],
                    },
                },
            },
        )

        catalog = load_catalog(root)
        self.assertEqual(catalog.skills["mirror"].ownership, "mirror")
        self.assertEqual(catalog.skills["owned"].ownership, "owned")
        self.assertEqual(catalog.skills["default"].ownership, "owned")
        self.assertFalse(catalog.skills["default"].ownership_explicit)
        dependencies, reverse = dependency_graph(catalog)
        self.assertEqual(dependencies["owned"], {"mirror"})
        self.assertEqual(reverse["mirror"], {"owned"})

    def test_legacy_skill_meta_is_normalized_without_changing_ownership(self) -> None:
        root = self.make_root()
        skill = write_skill(root, "app")
        write_skill(root, "base")
        write_json(root / "skill-manifest.json", {"schemaVersion": 1, "sources": {}, "skills": {}})
        write_json(
            skill / "skill.meta.json",
            {
                "name": "app",
                "kind": "personal",
                "dependsOnSkills": ["base"],
                "dependsOnTools": [
                    {
                        "kind": "npm-global",
                        "package": "example-tool",
                        "version": ">=1",
                        "verify": "example-tool doctor",
                    }
                ],
            },
        )

        catalog = load_catalog(root)
        app = catalog.skills["app"]
        self.assertEqual(app.ownership, "owned")
        self.assertEqual(app.skill_dependencies, ["base"])
        self.assertEqual(app.tool_relations[0]["tool"]["constraint"], ">=1")
        self.assertEqual(app.tool_relations[0]["verify"], [["example-tool", "doctor"]])

    def test_mirror_rejects_relations(self) -> None:
        root = self.make_root()
        write_skill(root, "mirror")
        write_skill(root, "base")
        write_json(
            root / "skill-manifest.json",
            {
                "schemaVersion": 1,
                "sources": {
                    "upstream/example": {
                        "kind": "git",
                        "url": "https://example.invalid/upstream.git",
                    }
                },
                "skills": {
                    "mirror": {
                        "ownership": "mirror",
                        "mirror": {"source": "upstream/example", "path": "skills/mirror"},
                        "relations": [
                            {"id": "base", "type": "skill-dependency", "skill": "base"}
                        ],
                    }
                },
            },
        )
        with self.assertRaisesRegex(ModelError, "mirror skills cannot declare relations"):
            load_catalog(root)

    def test_manifest_shape_rejects_unknown_fields_and_invalid_policy(self) -> None:
        root = self.make_root()
        write_skill(root, "owned")
        write_json(
            root / "skill-manifest.json",
            {
                "$schema": 42,
                "schemaVersion": 1,
                "unknown": "not allowed",
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
            },
        )
        with self.assertRaises(ModelError) as raised:
            load_catalog(root)
        message = str(raised.exception)
        self.assertIn("unknown fields ['unknown']", message)
        self.assertIn("$schema must be a string", message)
        self.assertIn("invalid updatePolicy 'destroy'", message)

    def test_manifest_rejects_null_watch_arrays(self) -> None:
        root = self.make_root()
        write_skill(root, "owned")
        write_json(
            root / "skill-manifest.json",
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
                    }
                },
            },
        )
        with self.assertRaisesRegex(ModelError, "watch.include must be an array"):
            load_catalog(root)

    def test_lock_shape_rejects_incomplete_relation_state(self) -> None:
        root = self.make_root()
        write_skill(root, "owned")
        write_json(
            root / "skill-manifest.json",
            {
                "schemaVersion": 1,
                "sources": {
                    "example/source": {"kind": "git", "url": "https://example.invalid/source.git"}
                },
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
            },
        )
        write_json(
            root / "skill-lock.json",
            {
                "schemaVersion": 1,
                "skills": {"owned": {"relations": {"source": {"lastReviewedCommit": "abcdef0"}}}},
            },
        )
        with self.assertRaisesRegex(ModelError, "missing fields"):
            load_catalog(root)

    def test_lock_rejects_short_commits_bad_dates_and_bad_decision_text(self) -> None:
        root = self.make_root()
        write_skill(root, "owned")
        write_json(
            root / "skill-manifest.json",
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
                            }
                        ],
                    }
                },
            },
        )
        write_json(
            root / "skill-lock.json",
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
                                "reviews": [
                                    {
                                        "fromCommit": None,
                                        "toCommit": "x",
                                        "relationFingerprint": "sha256:abc",
                                        "accepted": [
                                            {
                                                "upstreamPaths": ["SKILL.md"],
                                                "localPaths": ["SKILL.md"],
                                                "note": 3,
                                            }
                                        ],
                                        "skipped": [],
                                        "reviewedAt": "not-a-date",
                                    }
                                ],
                            }
                        }
                    }
                },
            },
        )
        with self.assertRaises(ModelError) as raised:
            load_catalog(root)
        message = str(raised.exception)
        self.assertIn("lastReviewedCommit must be at least 7", message)
        self.assertIn("reviewedAt must be an ISO date-time", message)
        self.assertIn("note must be a non-empty string", message)

    def test_skill_dependency_cycle_is_rejected(self) -> None:
        root = self.make_root()
        write_skill(root, "a")
        write_skill(root, "b")
        write_json(
            root / "skill-manifest.json",
            {
                "schemaVersion": 1,
                "sources": {},
                "skills": {
                    "a": {
                        "ownership": "owned",
                        "relations": [{"id": "b", "type": "skill-dependency", "skill": "b"}],
                    },
                    "b": {
                        "ownership": "owned",
                        "relations": [{"id": "a", "type": "skill-dependency", "skill": "a"}],
                    },
                },
            },
        )
        with self.assertRaisesRegex(ModelError, "skill dependency cycle: a -> b -> a"):
            load_catalog(root)


if __name__ == "__main__":
    unittest.main()
