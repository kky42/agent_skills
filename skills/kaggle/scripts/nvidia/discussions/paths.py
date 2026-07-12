"""Project path helpers for Kaggle discussion storage.

Adapted for this local kaggle skill: NVIDIA's original helpers used
``data/discussions.db``. Keep merged helper state under the same project-local
cache root as the rest of this skill so generated files stay out of git.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Allow vendored NVIDIA subpackages to import sibling runtime.py/constants.py.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from runtime import find_project_root

DEFAULT_CACHE_DIR = Path(".kaggle-skill") / "cache"


def cache_root(root: Path | None = None) -> Path:
    configured = Path(os.environ.get("KAGGLE_SKILL_CACHE_DIR") or DEFAULT_CACHE_DIR)
    if configured.is_absolute():
        return configured
    return (root or find_project_root()) / configured


def default_db_path(root: Path | None = None) -> Path:
    return cache_root(root) / "nvidia" / "discussions.db"
