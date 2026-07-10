#!/usr/bin/env python3
"""Load and validate the agent_skills ownership and relation model.

This module is the single seam for skill discovery, v2 ownership metadata, and
legacy metadata adapters. Callers should not infer ownership from directory
names or from presence in thirdparty-skills.yml.
"""
from __future__ import annotations

import json
import re
import shlex
from collections import defaultdict
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any

MANIFEST_NAME = "skill-manifest.json"
LOCK_NAME = "skill-lock.json"
LEGACY_MANIFEST_NAME = "thirdparty-skills.yml"
LEGACY_LOCK_NAME = "thirdparty-lock.json"
RELATION_TYPES = {
    "content-source",
    "skill-dependency",
    "tool-dependency",
    "reference",
}
OWNERSHIP_TYPES = {"mirror", "owned"}
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")


class ModelError(Exception):
    """Raised when the normalized skill model is invalid."""


@dataclass
class SkillRecord:
    name: str
    path: Path
    relative_path: str
    ownership: str
    ownership_explicit: bool
    mirror: dict[str, Any] | None
    relations: list[dict[str, Any]]
    legacy_source: bool = False
    metadata_path: Path | None = None

    @property
    def skill_dependencies(self) -> list[str]:
        return [
            relation["skill"]
            for relation in self.relations
            if relation.get("type") == "skill-dependency" and relation.get("skill")
        ]

    @property
    def tool_relations(self) -> list[dict[str, Any]]:
        return [
            relation
            for relation in self.relations
            if relation.get("type") == "tool-dependency"
        ]

    @property
    def source_relations(self) -> list[dict[str, Any]]:
        return [
            relation
            for relation in self.relations
            if relation.get("type") in {"content-source", "reference"}
        ]


@dataclass
class Catalog:
    root: Path
    sources: dict[str, dict[str, Any]]
    skills: dict[str, SkillRecord]
    manifest: dict[str, Any]
    lock: dict[str, Any]
    legacy_manifest: dict[str, dict[str, Any]]
    legacy_lock: dict[str, Any]

    @property
    def explicit_ownership_count(self) -> int:
        return sum(record.ownership_explicit for record in self.skills.values())

    @property
    def legacy_source_count(self) -> int:
        return sum(record.legacy_source for record in self.skills.values())


def clean_scalar(value: str) -> Any:
    value = value.strip()
    if " #" in value:
        value = value.split(" #", 1)[0].rstrip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]
    lowered = value.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    return value


def frontmatter_name(skill_md: Path) -> str | None:
    lines = skill_md.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    for line in lines[1:]:
        if line.strip() == "---":
            return None
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        if key.strip() == "name":
            result = clean_scalar(value)
            return str(result) if result else None
    return None


def load_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return deepcopy(default)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ModelError(f"{path}: invalid JSON: {error}") from error
    if not isinstance(value, dict):
        raise ModelError(f"{path}: expected a JSON object")
    return value


def load_legacy_manifest(path: Path) -> dict[str, dict[str, Any]]:
    """Read the deliberately frozen, shallow thirdparty-skills.yml format."""
    if not path.exists():
        return {}
    skills: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    current_list_key: str | None = None
    for line_no, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped == "skills:":
            current = None
            current_list_key = None
            continue
        if stripped.startswith("- "):
            item = stripped[2:].strip()
            if ":" in item:
                key, value = item.split(":", 1)
                if key.strip() == "skill":
                    current = {"skill": clean_scalar(value)}
                    skills.append(current)
                    current_list_key = None
                    continue
            if current is None or current_list_key is None:
                raise ModelError(f"{path}:{line_no}: list item without a list key")
            current.setdefault(current_list_key, []).append(clean_scalar(item))
            continue
        if current is None or ":" not in stripped:
            raise ModelError(f"{path}:{line_no}: expected key: value in a skill entry")
        key, value = stripped.split(":", 1)
        key = key.strip()
        if value.strip():
            current[key] = clean_scalar(value)
            current_list_key = None
        else:
            current[key] = []
            current_list_key = key
    return {
        str(item["skill"]): item
        for item in skills
        if isinstance(item, dict) and item.get("skill")
    }


def discover_skills(root: Path) -> dict[str, Path]:
    skills_root = root / "skills"
    discovered: dict[str, Path] = {}
    if not skills_root.exists():
        return discovered
    for skill_md in sorted(skills_root.rglob("SKILL.md")):
        name = skill_md.parent.name
        if name in discovered:
            raise ModelError(
                f"duplicate skill name: {name}\n  {discovered[name]}\n  {skill_md.parent}"
            )
        declared = frontmatter_name(skill_md)
        if declared is None:
            raise ModelError(f"{skill_md}: missing frontmatter name")
        if declared != name:
            raise ModelError(
                f"{skill_md}: frontmatter name {declared!r} does not match directory name {name!r}"
            )
        discovered[name] = skill_md.parent.resolve()
    return discovered


def _derive_git_url(source: str) -> str | None:
    if re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", source):
        return f"https://github.com/{source}.git"
    return None


def _legacy_source_relation(
    name: str,
    manifest_entry: dict[str, Any],
    lock_entry: dict[str, Any],
) -> dict[str, Any] | None:
    source = manifest_entry.get("source") or lock_entry.get("source")
    if not source:
        return None
    skill_path = lock_entry.get("skillPath") or f"skills/{name}/SKILL.md"
    source_path = PurePosixPath(str(skill_path)).parent.as_posix()
    return {
        "id": "legacy-upstream",
        "type": "content-source",
        "source": {"source": str(source), "path": source_path},
        "watch": {"include": ["**"]},
        "origin": LEGACY_MANIFEST_NAME,
        "legacy": True,
    }


def _relation_id(prefix: str, value: Any) -> str:
    slug = re.sub(r"[^A-Za-z0-9._:-]+", "-", str(value)).strip("-") or "unknown"
    return f"{prefix}:{slug}"


def _relation_key(relation: dict[str, Any]) -> tuple[Any, ...]:
    relation_type = relation.get("type")
    if relation_type == "skill-dependency":
        return relation_type, relation.get("skill")
    if relation_type == "tool-dependency":
        tool = relation.get("tool") or {}
        return relation_type, tool.get("kind"), tool.get("name") or tool.get("package") or tool.get("path")
    return relation_type, relation.get("id")


def _legacy_meta_relations(name: str, skill_dir: Path) -> tuple[list[dict[str, Any]], Path | None]:
    path = skill_dir / "skill.meta.json"
    if not path.exists():
        return [], None
    meta = load_json(path, {})
    if meta.get("name") and meta.get("name") != name:
        raise ModelError(f"{path}: name must be {name!r}")
    relations: list[dict[str, Any]] = []
    dependencies = meta.get("dependsOnSkills") or []
    if not isinstance(dependencies, list):
        raise ModelError(f"{path}: dependsOnSkills must be an array")
    for dependency in dependencies:
        relations.append(
            {
                "id": _relation_id("skill", dependency),
                "type": "skill-dependency",
                "skill": dependency,
                "origin": "skill.meta.json",
                "legacy": True,
            }
        )
    tools = meta.get("dependsOnTools") or []
    if not isinstance(tools, list):
        raise ModelError(f"{path}: dependsOnTools must be an array")
    for index, raw_tool in enumerate(tools):
        if not isinstance(raw_tool, dict):
            raise ModelError(f"{path}: dependsOnTools[{index}] must be an object")
        tool = {key: value for key, value in raw_tool.items() if key not in {"verify", "version"}}
        if raw_tool.get("version"):
            tool["constraint"] = raw_tool["version"]
        label = tool.get("name") or tool.get("package") or tool.get("path") or str(index)
        relation: dict[str, Any] = {
            "id": _relation_id("tool", label),
            "type": "tool-dependency",
            "tool": tool,
            "updatePolicy": "compatible" if raw_tool.get("version") else "manual",
            "origin": "skill.meta.json",
            "legacy": True,
        }
        if raw_tool.get("verify"):
            verify = raw_tool["verify"]
            if not isinstance(verify, str):
                raise ModelError(f"{path}: tool verify must be a command string")
            command = shlex.split(verify)
            if not command:
                raise ModelError(f"{path}: tool verify command cannot be empty")
            relation["verify"] = [command]
        relations.append(relation)
    return relations, path


def load_catalog(root: Path | str | None = None, *, validate: bool = True) -> Catalog:
    if root is None:
        root = Path(__file__).resolve().parents[1]
    root = Path(root).resolve()
    manifest_path = root / MANIFEST_NAME
    lock_path = root / LOCK_NAME
    if not manifest_path.exists():
        raise ModelError(f"required model file is missing: {manifest_path}")
    if not lock_path.exists():
        raise ModelError(f"required model file is missing: {lock_path}")
    manifest = load_json(
        manifest_path,
        {"schemaVersion": 1, "sources": {}, "skills": {}},
    )
    lock = load_json(lock_path, {"schemaVersion": 1, "skills": {}})
    legacy_manifest = load_legacy_manifest(root / LEGACY_MANIFEST_NAME)
    legacy_lock = load_json(root / LEGACY_LOCK_NAME, {"skills": {}})
    discovered = discover_skills(root)

    raw_sources = manifest.get("sources") or {}
    if not isinstance(raw_sources, dict):
        raise ModelError(f"{root / MANIFEST_NAME}: sources must be an object")
    sources = deepcopy(raw_sources)
    legacy_lock_skills = legacy_lock.get("skills") or {}
    for source_name in {
        str(entry.get("source"))
        for entry in legacy_manifest.values()
        if entry.get("source")
    }:
        if source_name in sources:
            continue
        source_url = None
        for lock_entry in legacy_lock_skills.values():
            if lock_entry.get("source") == source_name and lock_entry.get("sourceUrl"):
                source_url = lock_entry["sourceUrl"]
                break
        source_url = source_url or _derive_git_url(source_name)
        if source_url:
            sources[source_name] = {
                "kind": "git",
                "url": source_url,
                "defaultRef": "origin/HEAD",
                "legacy": True,
            }

    raw_skill_entries = manifest.get("skills") or {}
    if not isinstance(raw_skill_entries, dict):
        raise ModelError(f"{root / MANIFEST_NAME}: skills must be an object")

    skills: dict[str, SkillRecord] = {}
    for name, path in sorted(discovered.items()):
        explicit = name in raw_skill_entries
        raw_entry = raw_skill_entries.get(name) or {}
        if not isinstance(raw_entry, dict):
            raise ModelError(f"{root / MANIFEST_NAME}: skills.{name} must be an object")
        ownership = raw_entry.get("ownership", "owned")
        mirror = deepcopy(raw_entry.get("mirror"))
        raw_relations = raw_entry.get("relations") or []
        if not isinstance(raw_relations, list):
            raise ModelError(f"{root / MANIFEST_NAME}: skills.{name}.relations must be an array")
        relations = []
        for relation in raw_relations:
            if not isinstance(relation, dict):
                raise ModelError(f"{root / MANIFEST_NAME}: skills.{name}.relations entries must be objects")
            normalized = deepcopy(relation)
            normalized["origin"] = MANIFEST_NAME
            relations.append(normalized)

        legacy_source = name in legacy_manifest
        if not explicit and legacy_source:
            legacy_relation = _legacy_source_relation(
                name,
                legacy_manifest[name],
                legacy_lock_skills.get(name) or {},
            )
            if legacy_relation:
                relations.append(legacy_relation)

        meta_relations, metadata_path = _legacy_meta_relations(name, path)
        existing_keys = {_relation_key(relation) for relation in relations}
        for relation in meta_relations:
            if _relation_key(relation) not in existing_keys:
                relations.append(relation)
                existing_keys.add(_relation_key(relation))

        relative_path = path.relative_to(root).as_posix()
        skills[name] = SkillRecord(
            name=name,
            path=path,
            relative_path=relative_path,
            ownership=str(ownership),
            ownership_explicit=explicit,
            mirror=mirror,
            relations=relations,
            legacy_source=legacy_source,
            metadata_path=metadata_path,
        )

    catalog = Catalog(
        root=root,
        sources=sources,
        skills=skills,
        manifest=manifest,
        lock=lock,
        legacy_manifest=legacy_manifest,
        legacy_lock=legacy_lock,
    )
    if validate:
        errors = validate_catalog(catalog)
        if errors:
            raise ModelError("skill model validation failed:\n- " + "\n- ".join(errors))
    return catalog


def _valid_relative_path(value: Any, *, allow_glob: bool = False) -> bool:
    if not isinstance(value, str) or not value or value.startswith("/"):
        return False
    path = PurePosixPath(value)
    if ".." in path.parts:
        return False
    if not allow_glob and value in {".", ""}:
        return False
    return True


def _validate_source_locator(
    locator: Any,
    *,
    catalog: Catalog,
    label: str,
) -> list[str]:
    errors = []
    if not isinstance(locator, dict):
        return [f"{label}: source locator must be an object"]
    unknown = set(locator) - {"source", "path", "ref"}
    if unknown:
        errors.append(f"{label}: unknown source locator fields {sorted(unknown)}")
    source = locator.get("source")
    if source not in catalog.sources:
        errors.append(f"{label}: unknown source {source!r}")
    if not _valid_relative_path(locator.get("path")):
        errors.append(f"{label}: source path must be a safe relative directory")
    if locator.get("ref") is not None and (
        not isinstance(locator.get("ref"), str) or not locator.get("ref")
    ):
        errors.append(f"{label}: source ref must be a non-empty string")
    return errors


def _unknown_fields(value: dict[str, Any], allowed: set[str], label: str) -> list[str]:
    unknown = set(value) - allowed
    return [f"{label}: unknown fields {sorted(unknown)}"] if unknown else []


def _valid_datetime(value: Any) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def _valid_verify(value: Any) -> bool:
    return isinstance(value, list) and all(
        isinstance(command, list)
        and bool(command)
        and all(isinstance(argument, str) for argument in command)
        for command in value
    )


def _validate_manifest_shape(manifest: dict[str, Any]) -> list[str]:
    errors = _unknown_fields(
        manifest,
        {"$schema", "schemaVersion", "sources", "skills"},
        MANIFEST_NAME,
    )
    if "$schema" in manifest and not isinstance(manifest["$schema"], str):
        errors.append(f"{MANIFEST_NAME}: $schema must be a string")
    sources = manifest.get("sources")
    skills = manifest.get("skills")
    if not isinstance(sources, dict):
        errors.append(f"{MANIFEST_NAME}: sources must be an object")
        sources = {}
    if not isinstance(skills, dict):
        errors.append(f"{MANIFEST_NAME}: skills must be an object")
        skills = {}
    for source_id, source in sources.items():
        label = f"{MANIFEST_NAME} source {source_id!r}"
        if not isinstance(source, dict):
            errors.append(f"{label}: expected an object")
            continue
        errors.extend(_unknown_fields(source, {"kind", "url", "defaultRef"}, label))
        if source.get("kind") != "git":
            errors.append(f"{label}: kind must be 'git'")
        if not isinstance(source.get("url"), str) or not source.get("url"):
            errors.append(f"{label}: url is required")
        if source.get("defaultRef") is not None and (
            not isinstance(source.get("defaultRef"), str) or not source.get("defaultRef")
        ):
            errors.append(f"{label}: defaultRef must be a non-empty string")
    for name, skill in skills.items():
        label = f"{MANIFEST_NAME} skill {name!r}"
        if not isinstance(skill, dict):
            errors.append(f"{label}: expected an object")
            continue
        ownership = skill.get("ownership")
        if ownership not in OWNERSHIP_TYPES:
            errors.append(f"{label}: explicit ownership must be mirror or owned")
            continue
        allowed = {"path", "ownership", "mirror"} if ownership == "mirror" else {"path", "ownership", "relations"}
        errors.extend(_unknown_fields(skill, allowed, label))
        if skill.get("path") is not None and not _valid_relative_path(skill.get("path")):
            errors.append(f"{label}: path must be a safe relative path")
        if ownership == "mirror":
            if not isinstance(skill.get("mirror"), dict):
                errors.append(f"{label}: mirror source is required")
            continue
        relations = skill.get("relations", [])
        if not isinstance(relations, list):
            errors.append(f"{label}: relations must be an array")
            continue
        for index, relation in enumerate(relations):
            relation_label = f"{label} relation[{index}]"
            if not isinstance(relation, dict):
                errors.append(f"{relation_label}: expected an object")
                continue
            relation_type = relation.get("type")
            if relation_type in {"content-source", "reference"}:
                errors.extend(_unknown_fields(relation, {"id", "type", "source", "watch"}, relation_label))
                watch = relation.get("watch")
                if watch is not None:
                    if not isinstance(watch, dict):
                        errors.append(f"{relation_label}: watch must be an object")
                    else:
                        errors.extend(_unknown_fields(watch, {"include", "exclude", "localPaths", "localConcerns"}, f"{relation_label} watch"))
                        for path_key in ("include", "exclude", "localPaths"):
                            if path_key not in watch:
                                continue
                            paths = watch[path_key]
                            if not isinstance(paths, list):
                                errors.append(f"{relation_label}: watch.{path_key} must be an array")
                            elif not all(isinstance(path, str) for path in paths):
                                errors.append(f"{relation_label}: watch.{path_key} must contain strings")
                            elif len(paths) != len(set(paths)):
                                errors.append(f"{relation_label}: watch.{path_key} must be unique")
                        concerns = watch.get("localConcerns", [])
                        if not isinstance(concerns, list):
                            errors.append(f"{relation_label}: watch.localConcerns must be an array")
                        else:
                            for concern_index, concern in enumerate(concerns):
                                concern_label = f"{relation_label} watch.localConcerns[{concern_index}]"
                                if not isinstance(concern, dict):
                                    errors.append(f"{concern_label}: expected an object")
                                    continue
                                errors.extend(_unknown_fields(concern, {"id", "description"}, concern_label))
                                if not all(isinstance(concern.get(key), str) and concern.get(key) for key in ("id", "description")):
                                    errors.append(f"{concern_label}: id and description are required")
            elif relation_type == "skill-dependency":
                errors.extend(_unknown_fields(relation, {"id", "type", "skill", "verify"}, relation_label))
                if relation.get("verify") is not None and not _valid_verify(relation.get("verify")):
                    errors.append(f"{relation_label}: verify must be an array of argv arrays")
            elif relation_type == "tool-dependency":
                errors.extend(_unknown_fields(relation, {"id", "type", "tool", "updatePolicy", "verify"}, relation_label))
                if relation.get("updatePolicy") is not None and relation.get("updatePolicy") not in {"manual", "compatible", "latest", "pinned"}:
                    errors.append(f"{relation_label}: invalid updatePolicy {relation.get('updatePolicy')!r}")
                if relation.get("verify") is not None and not _valid_verify(relation.get("verify")):
                    errors.append(f"{relation_label}: verify must be an array of argv arrays")
    return errors


def _validate_lock_shape(lock: dict[str, Any]) -> list[str]:
    errors = _unknown_fields(lock, {"$schema", "schemaVersion", "skills"}, LOCK_NAME)
    if "$schema" in lock and not isinstance(lock["$schema"], str):
        errors.append(f"{LOCK_NAME}: $schema must be a string")
    skills = lock.get("skills")
    if not isinstance(skills, dict):
        errors.append(f"{LOCK_NAME}: skills must be an object")
        return errors
    for name, state in skills.items():
        label = f"{LOCK_NAME} skill {name!r}"
        if not isinstance(state, dict):
            errors.append(f"{label}: state must be an object")
            continue
        errors.extend(_unknown_fields(state, {"mirror", "relations"}, label))
        mirror = state.get("mirror")
        if mirror is not None:
            if not isinstance(mirror, dict):
                errors.append(f"{label}: mirror state must be an object")
            else:
                required = {"resolvedCommit", "sourcePath", "upstreamHash", "materializedHash", "syncedAt"}
                errors.extend(_unknown_fields(mirror, required, f"{label} mirror"))
                missing = sorted(required - set(mirror))
                if missing:
                    errors.append(f"{label} mirror: missing fields {missing}")
                for key in required:
                    if key in mirror and (not isinstance(mirror[key], str) or not mirror[key]):
                        errors.append(f"{label} mirror: {key} must be a non-empty string")
                if isinstance(mirror.get("resolvedCommit"), str) and len(mirror["resolvedCommit"]) < 7:
                    errors.append(f"{label} mirror: resolvedCommit must be at least 7 characters")
                if "syncedAt" in mirror and not _valid_datetime(mirror.get("syncedAt")):
                    errors.append(f"{label} mirror: syncedAt must be an ISO date-time")
                for key in ("upstreamHash", "materializedHash"):
                    if key in mirror and not str(mirror[key]).startswith("sha256:"):
                        errors.append(f"{label} mirror: {key} must be sha256")
        relations = state.get("relations", {})
        if not isinstance(relations, dict):
            errors.append(f"{label}: relations state must be an object")
            continue
        for relation_id, relation_state in relations.items():
            relation_label = f"{label} relation {relation_id!r}"
            if not isinstance(relation_state, dict):
                errors.append(f"{relation_label}: state must be an object")
                continue
            required = {"relationFingerprint", "sourceId", "sourcePath", "sourceRef", "lastReviewedCommit", "reviewedAt", "reviews"}
            errors.extend(_unknown_fields(relation_state, required, relation_label))
            missing = sorted(required - set(relation_state))
            if missing:
                errors.append(f"{relation_label}: missing fields {missing}")
            if not str(relation_state.get("relationFingerprint", "")).startswith("sha256:"):
                errors.append(f"{relation_label}: relationFingerprint must be sha256")
            for key in required - {"reviews"}:
                if key in relation_state and (
                    not isinstance(relation_state[key], str) or not relation_state[key]
                ):
                    errors.append(f"{relation_label}: {key} must be a non-empty string")
            if isinstance(relation_state.get("lastReviewedCommit"), str) and len(relation_state["lastReviewedCommit"]) < 7:
                errors.append(f"{relation_label}: lastReviewedCommit must be at least 7 characters")
            if "reviewedAt" in relation_state and not _valid_datetime(relation_state.get("reviewedAt")):
                errors.append(f"{relation_label}: reviewedAt must be an ISO date-time")
            reviews = relation_state.get("reviews")
            if not isinstance(reviews, list):
                errors.append(f"{relation_label}: reviews must be an array")
                continue
            for index, review in enumerate(reviews):
                review_label = f"{relation_label} reviews[{index}]"
                if not isinstance(review, dict):
                    errors.append(f"{review_label}: expected an object")
                    continue
                allowed = {"fromCommit", "toCommit", "relationFingerprint", "accepted", "skipped", "note", "reviewedAt"}
                required_review = {"fromCommit", "toCommit", "relationFingerprint", "accepted", "skipped", "reviewedAt"}
                errors.extend(_unknown_fields(review, allowed, review_label))
                missing_review = sorted(required_review - set(review))
                if missing_review:
                    errors.append(f"{review_label}: missing fields {missing_review}")
                if review.get("fromCommit") is not None and not isinstance(review.get("fromCommit"), str):
                    errors.append(f"{review_label}: fromCommit must be a string or null")
                for key in ("toCommit", "reviewedAt", "relationFingerprint"):
                    if key in review and (not isinstance(review[key], str) or not review[key]):
                        errors.append(f"{review_label}: {key} must be a non-empty string")
                if isinstance(review.get("toCommit"), str) and len(review["toCommit"]) < 7:
                    errors.append(f"{review_label}: toCommit must be at least 7 characters")
                if "reviewedAt" in review and not _valid_datetime(review.get("reviewedAt")):
                    errors.append(f"{review_label}: reviewedAt must be an ISO date-time")
                if review.get("note") is not None and not isinstance(review.get("note"), str):
                    errors.append(f"{review_label}: note must be a string")
                for decision_type, required_fields in (
                    ("accepted", {"upstreamPaths", "localPaths", "note"}),
                    ("skipped", {"upstreamPaths", "reason"}),
                ):
                    decisions = review.get(decision_type)
                    if not isinstance(decisions, list):
                        errors.append(f"{review_label}: {decision_type} must be an array")
                        continue
                    for decision_index, decision in enumerate(decisions):
                        decision_label = f"{review_label} {decision_type}[{decision_index}]"
                        if not isinstance(decision, dict):
                            errors.append(f"{decision_label}: expected an object")
                            continue
                        errors.extend(_unknown_fields(decision, required_fields, decision_label))
                        missing_decision = sorted(required_fields - set(decision))
                        if missing_decision:
                            errors.append(f"{decision_label}: missing fields {missing_decision}")
                        paths = decision.get("upstreamPaths")
                        if not isinstance(paths, list) or not paths or any(
                            not _valid_relative_path(path) for path in paths
                        ):
                            errors.append(f"{decision_label}: upstreamPaths must contain safe paths")
                        elif len(paths) != len(set(paths)):
                            errors.append(f"{decision_label}: upstreamPaths must be unique")
                        if decision_type == "accepted":
                            local_paths = decision.get("localPaths")
                            if not isinstance(local_paths, list) or not local_paths or any(
                                not _valid_relative_path(path) for path in local_paths
                            ):
                                errors.append(f"{decision_label}: localPaths must contain safe paths")
                            elif len(local_paths) != len(set(local_paths)):
                                errors.append(f"{decision_label}: localPaths must be unique")
                            if not isinstance(decision.get("note"), str) or not decision.get("note"):
                                errors.append(f"{decision_label}: note must be a non-empty string")
                        elif not isinstance(decision.get("reason"), str) or not decision.get("reason"):
                            errors.append(f"{decision_label}: reason must be a non-empty string")
    return errors


def _cycle_errors(skills: dict[str, SkillRecord]) -> list[str]:
    state: dict[str, int] = {}
    stack: list[str] = []
    errors: list[str] = []

    def visit(name: str) -> None:
        status = state.get(name, 0)
        if status == 2:
            return
        if status == 1:
            start = stack.index(name)
            errors.append("skill dependency cycle: " + " -> ".join(stack[start:] + [name]))
            return
        state[name] = 1
        stack.append(name)
        for dependency in skills[name].skill_dependencies:
            if dependency in skills:
                visit(dependency)
        stack.pop()
        state[name] = 2

    for name in sorted(skills):
        visit(name)
    return errors


def validate_catalog(catalog: Catalog) -> list[str]:
    errors: list[str] = []
    manifest = catalog.manifest
    lock = catalog.lock
    errors.extend(_validate_manifest_shape(manifest))
    errors.extend(_validate_lock_shape(lock))
    if manifest.get("schemaVersion") != 1:
        errors.append(f"{MANIFEST_NAME}: schemaVersion must be 1")
    if lock.get("schemaVersion") != 1:
        errors.append(f"{LOCK_NAME}: schemaVersion must be 1")

    raw_manifest_skills = manifest.get("skills") or {}
    for name in sorted(raw_manifest_skills):
        if name not in catalog.skills:
            errors.append(f"{MANIFEST_NAME}: unknown skill entry {name!r}")

    for source_id, source in sorted(catalog.sources.items()):
        if not isinstance(source, dict):
            errors.append(f"source {source_id!r}: expected an object")
            continue
        if source.get("kind") != "git":
            errors.append(f"source {source_id!r}: kind must be 'git'")
        if not isinstance(source.get("url"), str) or not source.get("url"):
            errors.append(f"source {source_id!r}: url is required")

    for name, record in sorted(catalog.skills.items()):
        label = f"skill {name!r}"
        if record.ownership not in OWNERSHIP_TYPES:
            errors.append(f"{label}: ownership must be mirror or owned")
            continue
        raw_entry = raw_manifest_skills.get(name) or {}
        declared_path = raw_entry.get("path")
        if declared_path is not None:
            if not _valid_relative_path(declared_path):
                errors.append(f"{label}: path must be a safe repo-relative path")
            elif declared_path != record.relative_path:
                errors.append(
                    f"{label}: manifest path {declared_path!r} does not match {record.relative_path!r}"
                )

        if record.ownership == "mirror":
            if record.mirror is None:
                errors.append(f"{label}: mirror ownership requires mirror source")
            else:
                errors.extend(
                    _validate_source_locator(
                        record.mirror,
                        catalog=catalog,
                        label=f"{label} mirror",
                    )
                )
            if record.relations:
                errors.append(f"{label}: mirror skills cannot declare relations or skill.meta.json")
        else:
            if record.mirror is not None:
                errors.append(f"{label}: owned skills cannot declare mirror source")

        relation_ids: set[str] = set()
        for relation in record.relations:
            relation_id = relation.get("id")
            relation_label = f"{label} relation {relation_id!r}"
            if not isinstance(relation_id, str) or not ID_RE.fullmatch(relation_id):
                errors.append(f"{relation_label}: invalid relation id")
            elif relation_id in relation_ids:
                errors.append(f"{label}: duplicate relation id {relation_id!r}")
            relation_ids.add(relation_id)
            relation_type = relation.get("type")
            if relation_type not in RELATION_TYPES:
                errors.append(f"{relation_label}: unknown type {relation_type!r}")
                continue
            if relation_type in {"content-source", "reference"}:
                errors.extend(
                    _validate_source_locator(
                        relation.get("source"),
                        catalog=catalog,
                        label=relation_label,
                    )
                )
                watch = relation.get("watch") or {}
                if not isinstance(watch, dict):
                    errors.append(f"{relation_label}: watch must be an object")
                else:
                    for key in ("include", "exclude", "localPaths"):
                        values = watch.get(key) or []
                        if not isinstance(values, list) or any(
                            not _valid_relative_path(value, allow_glob=True) for value in values
                        ):
                            errors.append(f"{relation_label}: watch.{key} must contain safe relative patterns")
            elif relation_type == "skill-dependency":
                dependency = relation.get("skill")
                if dependency not in catalog.skills:
                    errors.append(f"{relation_label}: missing skill dependency {dependency!r}")
                if relation.get("verify") is not None and not _valid_verify(relation.get("verify")):
                    errors.append(f"{relation_label}: verify must be an array of argv arrays")
            elif relation_type == "tool-dependency":
                tool = relation.get("tool")
                if not isinstance(tool, dict) or not tool.get("kind"):
                    errors.append(f"{relation_label}: tool.kind is required")
                    continue
                if relation.get("updatePolicy") is not None and relation.get("updatePolicy") not in {"manual", "compatible", "latest", "pinned"}:
                    errors.append(f"{relation_label}: invalid updatePolicy {relation.get('updatePolicy')!r}")
                if relation.get("verify") is not None and not _valid_verify(relation.get("verify")):
                    errors.append(f"{relation_label}: verify must be an array of argv arrays")
                if tool.get("kind") == "opencli-plugin":
                    relative = tool.get("path")
                    plugin_name = tool.get("name")
                    if not relative or not plugin_name or not _valid_relative_path(relative):
                        errors.append(f"{relation_label}: opencli-plugin requires name and safe path")
                    else:
                        plugin_path = (record.path / relative).resolve()
                        try:
                            plugin_path.relative_to(record.path.resolve())
                        except ValueError:
                            errors.append(f"{relation_label}: tool path escapes the skill directory")
                        else:
                            if not plugin_path.exists():
                                errors.append(f"{relation_label}: missing plugin path {plugin_path}")
                            elif not (plugin_path / "opencli-plugin.json").exists():
                                errors.append(f"{relation_label}: missing opencli-plugin.json in {plugin_path}")

    errors.extend(_cycle_errors(catalog.skills))

    lock_skills = lock.get("skills") or {}
    if not isinstance(lock_skills, dict):
        errors.append(f"{LOCK_NAME}: skills must be an object")
        return errors
    for name, state in sorted(lock_skills.items()):
        if name not in catalog.skills:
            errors.append(f"{LOCK_NAME}: unknown skill state {name!r}")
            continue
        if not isinstance(state, dict):
            errors.append(f"{LOCK_NAME}: skill {name!r} state must be an object")
            continue
        record = catalog.skills[name]
        if state.get("mirror") is not None and record.ownership != "mirror":
            errors.append(f"{LOCK_NAME}: owned skill {name!r} cannot have mirror state")
        relation_states = state.get("relations") or {}
        if record.ownership == "mirror" and relation_states:
            errors.append(f"{LOCK_NAME}: mirror skill {name!r} cannot have relation review state")
        valid_relation_ids = {relation.get("id") for relation in record.source_relations}
        if not isinstance(relation_states, dict):
            errors.append(f"{LOCK_NAME}: skill {name!r} relations state must be an object")
        else:
            for relation_id in relation_states:
                if relation_id not in valid_relation_ids:
                    errors.append(
                        f"{LOCK_NAME}: skill {name!r} has state for unknown source relation {relation_id!r}"
                    )
    return errors


def dependency_graph(catalog: Catalog) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    dependencies = {
        name: set(record.skill_dependencies)
        for name, record in catalog.skills.items()
    }
    reverse: dict[str, set[str]] = defaultdict(set)
    for name, names in dependencies.items():
        for dependency in names:
            reverse[dependency].add(name)
    return dependencies, reverse


def catalog_summary(catalog: Catalog) -> dict[str, Any]:
    ownership = {kind: 0 for kind in sorted(OWNERSHIP_TYPES)}
    relation_types = {kind: 0 for kind in sorted(RELATION_TYPES)}
    for record in catalog.skills.values():
        ownership[record.ownership] += 1
        for relation in record.relations:
            relation_type = relation.get("type")
            if relation_type in relation_types:
                relation_types[relation_type] += 1
    return {
        "skills": len(catalog.skills),
        "ownership": ownership,
        "explicitOwnership": catalog.explicit_ownership_count,
        "legacySourceRecords": catalog.legacy_source_count,
        "relations": relation_types,
    }
