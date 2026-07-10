# agent_skills

One place to manage global skills and their tools across Codex, Pi, and Claude Code.

## Model

`skills/` contains every active skill. Folder names organize the repo; they do not determine ownership.

A skill is either:

- **mirror** — an exact copy of one upstream directory. Upstream is authoritative, so updates replace the whole directory.
- **owned** — this repo is authoritative. It may be original or informed by many sources; source changes are reviewed and only relevant parts are selectively adapted.

Owned skills never receive automatic upstream merges.

`skill-manifest.json` records explicit ownership and typed relations:

- content sources;
- references;
- skill dependencies;
- tool dependencies.

`skill-lock.json` records mirror sync state and owned-source review receipts. Every active skill currently has explicit ownership.

## User control panel

In an agent conversation:

- send `doctor` for a concise, read-only health report grouped by ownership and source;
- send `update <skill-or-source>` for an agent-verified update that preserves an owned skill's purpose and default description, has fresh agents reproduce real workflows before and after behavioral fixes, and records selective source decisions.

A bare `update` only lists candidates; it never updates everything implicitly.

## Set Up Or Refresh

```bash
./scripts/skill-sync
./scripts/skill-deps check
```

Runtime entries are flat symlinks into this repo. Targets default to:

```bash
AGENT_SKILLS_SKILL_TARGETS="$HOME/.agents/skills:$HOME/.claude/skills"
```

Useful commands:

```bash
./scripts/skill-sync --skills-only
./scripts/skill-sync --tools-only
./scripts/skill-sync --check
./scripts/skill-deps list
./scripts/skill-deps why chatgpt
./scripts/skill-deps verify opencli-usage  # also checks reverse dependents
```

## Check Updates

For a mirror:

```bash
./scripts/thirdparty-update <skill> --check
./scripts/thirdparty-update <skill> --apply
```

`--apply` only works for an explicitly declared mirror with a clean local path.

For an owned skill:

```bash
./scripts/thirdparty-update <skill> --check --relation <relation-id>
```

Review the source delta, manually adapt only relevant changes, then record accepted and skipped decisions with `--record-review`. The updater refuses `--apply` for owned content.

## Legacy compatibility

`thirdparty-skills.yml` and `thirdparty-lock.json` are retired empty v1 files. Legacy `skill.meta.json` parsing remains available for imports, but active skills use the root manifest. `skills/thirdparty/` is only an organizational directory and does not imply ownership.

See [`AGENTS.md`](AGENTS.md) for the complete operating rules and manifest examples.
