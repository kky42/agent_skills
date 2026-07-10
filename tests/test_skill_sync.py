from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SYNC = REPO / "scripts" / "skill-sync"


class SkillSyncTests(unittest.TestCase):
    def test_check_detects_wrong_runtime_link(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        target = root / "runtime"
        environment = dict(os.environ)
        environment["AGENT_SKILLS_SKILL_TARGETS"] = str(target)
        for legacy_name in ("agent_hub-private", "agent_hub_skills"):
            legacy = target / legacy_name
            legacy.mkdir(parents=True)
            (legacy / "sentinel").write_text("keep\n", encoding="utf-8")

        linked = subprocess.run(
            [str(SYNC), "--skills-only"],
            cwd=REPO,
            env=environment,
            text=True,
            capture_output=True,
        )
        self.assertEqual(linked.returncode, 0, linked.stderr)
        for legacy_name in ("agent_hub-private", "agent_hub_skills"):
            self.assertTrue((target / legacy_name / "sentinel").exists())
        checked = subprocess.run(
            [str(SYNC), "--check"],
            cwd=REPO,
            env=environment,
            text=True,
            capture_output=True,
        )
        self.assertEqual(checked.returncode, 0, checked.stderr)

        dangling = target / "deleted-skill"
        dangling.symlink_to(target / "missing-intermediate")
        stale_check = subprocess.run(
            [str(SYNC), "--check"],
            cwd=REPO,
            env=environment,
            text=True,
            capture_output=True,
        )
        self.assertNotEqual(stale_check.returncode, 0)
        self.assertIn("stale runtime skill link", stale_check.stderr)
        cleaned = subprocess.run(
            [str(SYNC), "--skills-only"],
            cwd=REPO,
            env=environment,
            text=True,
            capture_output=True,
        )
        self.assertEqual(cleaned.returncode, 0, cleaned.stderr)
        self.assertFalse(dangling.is_symlink())

        wrong = target / "chatgpt"
        wrong.unlink()
        wrong.symlink_to(root)
        broken = subprocess.run(
            [str(SYNC), "--check"],
            cwd=REPO,
            env=environment,
            text=True,
            capture_output=True,
        )
        self.assertNotEqual(broken.returncode, 0)
        self.assertIn("runtime skill link check failed", broken.stderr)

    def test_empty_target_configuration_is_rejected(self) -> None:
        environment = dict(os.environ)
        environment["AGENT_SKILLS_SKILL_TARGETS"] = os.pathsep
        process = subprocess.run(
            [str(SYNC), "--check"],
            cwd=REPO,
            env=environment,
            text=True,
            capture_output=True,
        )
        self.assertNotEqual(process.returncode, 0)
        self.assertIn("must contain at least one target directory", process.stderr)


if __name__ == "__main__":
    unittest.main()
