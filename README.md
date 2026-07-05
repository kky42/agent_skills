# agent_skills

One place to manage global skills, their local patches, and skill-owned tools across Codex, Pi, and Claude Code.

![agent_skills skill flow](assets/intro.png)

## What Lives Here

- `skills/` is the canonical source for all active skills.
  - Personal skills live in topical folders such as `skills/chatgpt/` and `skills/browseruse/`.
  - Vendored third-party skills live in `skills/thirdparty/<skill>/`.
- `skill.meta.json` records skill dependencies and tool/plugin dependencies.
- `thirdparty-skills.yml` records upstream third-party sources to review.
- `thirdparty-lock.json` records the last vendored provenance/hash from upstream installs.
- `scripts/` links skills, checks dependency graphs, and installs skill-owned tools.

## Use It

```bash
./scripts/skill-sync
./scripts/skill-deps check
```

`skill-sync` is safe to run repeatedly. It:

1. validates `SKILL.md` names and `skill.meta.json` dependencies;
2. links every repo skill into runtime folders such as `~/.agents/skills` and `~/.claude/skills`;
3. installs declared skill-owned tools when a skill explicitly lists them in `skill.meta.json`.

It does **not** run `npx skills` or blindly overwrite third-party skills from upstream.

## Daily Workflow

Add/edit/remove skills under `skills/`, then run:

```bash
./scripts/skill-sync
```

Edits to linked skills are visible immediately because runtime folders point back to this repo. Run `skill-sync` after adding, removing, or renaming skill folders, or after adding a tool dependency.

Useful commands:

```bash
./scripts/skill-sync --skills-only       # links skills, skips tools
./scripts/skill-sync --tools-only        # installs declared tools only
./scripts/skill-sync --check             # validates without mutating
./scripts/skill-deps list                # dependency graph summary
./scripts/skill-deps why chatgpt         # reverse deps and tool deps
./scripts/thirdparty-update pievo --check # base/ours/theirs update report
```

Skill target folders are configured with `AGENT_SKILLS_SKILL_TARGETS`. The legacy `AGENT_HUB_SKILL_TARGETS` name is still accepted. Default:

```bash
AGENT_SKILLS_SKILL_TARGETS="$HOME/.agents/skills:$HOME/.claude/skills"
```

## Third-party Skill Updates

Third-party skills are vendored and reviewed like code. Do not use `npx skills add` as an automatic updater.

Update flow:

1. Use `thirdparty-skills.yml` and `thirdparty-lock.json` to identify upstream source/path/hash.
2. Run a guarded check:

   ```bash
   ./scripts/thirdparty-update <skill> --check
   ```

3. If the report is clear, apply:

   ```bash
   ./scripts/thirdparty-update <skill> --apply
   ```

4. If the script reports ambiguity, missing base, moved/renamed/split skill, or merge conflicts, stop and have an agent review the temp workdir/diff.
5. Run:

   ```bash
   ./scripts/skill-deps check
   ./scripts/skill-sync
   git diff
   ```

Use `npx skills add <source> --list` only for discovery, not for updating this repo.

## Skill-owned Tools

A skill can own helper code under its directory. Tool code does not need to be globally installed unless the skill declares it in `skill.meta.json`.

Example of a local helper script used directly by a skill:

```text
skills/chatgpt/
  SKILL.md
  skill.meta.json
  scripts/deep-research-extract-current.js
```

Example of an installable tool declaration, for skills that need one:

```json
{
  "name": "example-skill",
  "dependsOnTools": [
    {
      "kind": "opencli-plugin",
      "name": "example-plugin",
      "path": "tools/opencli-plugin-example",
      "verify": "opencli example-plugin status -f json"
    }
  ]
}
```

`skill-sync` installs declared local OpenCLI plugins with `opencli plugin install file://...`. Local plugins are symlinked by OpenCLI, so source edits are reflected immediately; rerun `skill-sync` after changing plugin metadata or moving paths.

`skills/chatgpt` is intentionally Playwright-only now. It does not declare or install an OpenCLI plugin.

## Dependency Safety

Before deleting or renaming a skill, check reverse dependencies:

```bash
./scripts/skill-deps why opencli-usage
```

If another skill depends on it, update that downstream skill first. `skill-sync --check` fails when metadata references a missing upstream skill or missing tool path.

## Across Machines

Commit and push repo changes after changing `skills/`, `skill.meta.json`, tool code, or third-party provenance. On another machine:

```bash
git pull
./scripts/skill-sync
./scripts/skill-deps check
```
