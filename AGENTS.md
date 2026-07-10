# AGENTS

Operating rules for this repo — the source of truth for the user's global agent skills. `README.md` is the human-facing skill index; execution rules live here.

## Core model

- `skills/**/<name>/SKILL.md` is the skill content. Frontmatter `name` must equal the directory name. Folder layout is organizational only and never implies ownership.
- Every skill is exactly one of:
  - **mirror** — an exact, replaceable copy of one upstream git directory. Upstream is authoritative: never edit a mirror locally, update by whole-directory replace only, and treat local drift as an integrity error. To customize a mirror, reclassify it as owned first.
  - **owned** — this repo is authoritative, whether the content is original or informed by sources. Never merge or apply an upstream tree into an owned skill; review scoped deltas and selectively adapt only in-scope changes.
- `skill-manifest.json` declares sources, explicit ownership, and typed relations: `content-source`, `reference`, `skill-dependency`, `tool-dependency`.
- `skill-lock.json` records mirror sync state and the latest owned-source review receipt. Only `./scripts/skills` writes it.
- Runtime skill dirs (`~/.agents/skills` and `~/.claude/skills`; override with `AGENT_SKILLS_SKILL_TARGETS`) hold flat symlinks into this repo. Never edit skills through runtime links.
- One CLI: `./scripts/skills` with subcommands `apply`, `doctor`, `update`, `verify`, `list`.
- A skill's frontmatter `description` defines when it triggers and is **frozen**: change it only on an explicit user request. If an upstream mirror update changes it, surface the change and get approval rather than patching locally.
- `npx skills add <source> --list` is for discovery only, never for updating.

## Operations

Route every request onto exactly one branch, then run the validation battery before finishing.

### 1. Add a skill

1. Owned: create `skills/<area>/<name>/SKILL.md` (frontmatter `name: <name>`) and add a manifest record with `ownership: "owned"` plus any source/dependency relations.
2. Mirror: add the source and a `mirror` record to the manifest, copy the upstream skill directory to the declared path, commit that import, then run `./scripts/skills update <name> --apply` to make it byte-exact and record the lock baseline.
3. `./scripts/skills apply`, then the validation battery.

### 2. Update a skill

`update <target>` with no clear target: report candidates (`./scripts/skills doctor --remote`) and ask; never update everything implicitly.

Gates for any change: reproduce a real problem through the skill's own workflow before a behavioral fix and re-run it after; verify descriptive claims against primary sources or the installed tool; keep the owned skill's purpose and trigger unchanged; keep diffs minimal and attributable — no drive-by refactors, formatting churn, or new dependencies.

- **Mirror**: `./scripts/skills update <skill>`, review the reported delta (upstream description changes need user approval), then `--apply`. The path must be clean; `--apply` refuses owned skills.
- **Owned**: `./scripts/skills update <skill> --relation <id> --keep-workdir`, diff the exported base/target trees, selectively adapt only in-scope changes, then record a receipt with `--record-review` — it must decide every relevant changed path exactly once (`accepted` needs `localPaths` + note, `skipped` needs a reason). Record the receipt even when everything was skipped, so rejected changes do not recur.
- **Dependency** (`skill-dependency` / `tool-dependency`): update the target per its own ownership or update policy, then `./scripts/skills verify <skill>` — it covers reverse dependents.

Report: target and ownership, reproduction evidence, accepted/skipped changes with reasons, lock movement, residual risks. Never call a controlled/fixture check a live end-to-end test.

### 3. Remove a skill

1. `./scripts/skills list` — check `used by` and update or drop dependents first.
2. Delete the skill directory; remove its manifest record, lock state, and any relations pointing at it; drop unused sources.
3. `./scripts/skills apply` (removes stale runtime links), then the validation battery.

### 4. Doctor

Treat a bare `doctor` message as this operation. Run `./scripts/skills doctor` (add `--remote` when upstream freshness matters — it clones each source once) and relay the report. Doctor is read-only and makes no repairs; propose follow-up operations for anything BROKEN or WARN, and let the user choose.

### 5. Apply

Run `./scripts/skills apply` to (re)link every skill into the runtime dirs and clean stale managed links. It refuses to overwrite unmanaged files; resolve those by hand. ("sync" is the legacy name for this operation.)

## Validation battery

```bash
python3 -m py_compile scripts/skills
python3 -m json.tool skill-manifest.json >/dev/null
python3 -m json.tool skill-lock.json >/dev/null
python3 -m unittest discover -s tests -p 'test_*.py'
./scripts/skills doctor
```
