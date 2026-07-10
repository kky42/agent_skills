from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SKILL_DEPS = REPO / "scripts" / "skill-deps"


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def write_skill(root: Path, name: str) -> None:
    directory = root / "skills" / name
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: test\n---\n\n# {name}\n",
        encoding="utf-8",
    )


class SkillDependencyVerificationTests(unittest.TestCase):
    def test_verify_dependency_includes_reverse_dependents(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        write_skill(root, "base")
        write_skill(root, "app")
        write_json(root / "skill-lock.json", {"schemaVersion": 1, "skills": {}})
        write_json(
            root / "skill-manifest.json",
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
                                "verify": [[sys.executable, "-c", "print('compatible')"]],
                            }
                        ],
                    }
                },
            },
        )
        environment = dict(os.environ)
        environment["AGENT_SKILLS_REPO_ROOT"] = str(root)
        process = subprocess.run(
            [str(SKILL_DEPS), "verify", "base", "--format", "json"],
            env=environment,
            text=True,
            capture_output=True,
        )
        self.assertEqual(process.returncode, 0, process.stderr)
        report = json.loads(process.stdout)
        self.assertEqual(report["affectedSkills"], ["app", "base"])
        self.assertEqual(report["checks"][0]["skill"], "app")
        self.assertTrue(report["checks"][0]["ok"])

        manifest = json.loads((root / "skill-manifest.json").read_text(encoding="utf-8"))
        del manifest["skills"]["app"]["relations"][0]["verify"]
        write_json(root / "skill-manifest.json", manifest)
        strict = subprocess.run(
            [str(SKILL_DEPS), "verify", "base", "--strict", "--format", "json"],
            env=environment,
            text=True,
            capture_output=True,
        )
        self.assertNotEqual(strict.returncode, 0)
        strict_report = json.loads(strict.stdout)
        self.assertEqual(strict_report["uncheckedRelations"][0]["skill"], "app")


if __name__ == "__main__":
    unittest.main()
