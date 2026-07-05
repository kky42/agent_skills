# AGENTS

This repo manages global agent skills and skill-owned tools for this user's machines.

`README.md` is for humans. Keep it short and friendly. This file is for agents operating in the repo. Put execution rules here.

## Core Model

- `skills/` is the source of truth for all active skills.
- Personal skills may live in topical folders, e.g. `skills/chatgpt/`.
- Vendored third-party skills live under `skills/thirdparty/<skill>/`.
- `thirdparty-skills.yml` records upstream sources; `thirdparty-lock.json` records last accepted provenance/hash.
- `skill.meta.json` records skill dependencies and tool/plugin dependencies.
- Runtime folders are generated links, not source of truth:
  - Codex/Pi via `~/.agents/skills`
  - Claude Code via `~/.claude/skills`

Runtime layout is flat:

```text
./skills/**/<skill>/SKILL.md -> ~/.agents/skills/<skill>
./skills/**/<skill>/SKILL.md -> ~/.claude/skills/<skill>
```

The target roots come from `AGENT_SKILLS_SKILL_TARGETS`, defaulting to `~/.agents/skills:~/.claude/skills`. The legacy `AGENT_HUB_SKILL_TARGETS` name is still accepted.

## Scripts

Use these user-facing scripts:

```bash
./scripts/skill-sync
./scripts/skill-deps
```

`skill-migrate` is legacy/import-only. Do not use it as the normal update path.

Do not add helper wrappers such as `bootstrap`, `apply-thirdparty`, `skills-bootstrap`, or `skills-apply-thirdparty` unless the user explicitly asks for a larger script surface.

## Set Up Or Refresh This Machine

Run:

```bash
./scripts/skill-sync
./scripts/skill-deps check
```

This validates metadata, links repo skills into runtime folders, and installs declared skill-owned tools/plugins. It does not run `npx skills`.

Useful variants:

```bash
./scripts/skill-sync --skills-only
./scripts/skill-sync --tools-only
./scripts/skill-sync --check
./scripts/skill-deps list
./scripts/skill-deps why <skill>
```

## Add Or Change A Skill

1. Create or edit a directory under `skills/`.
2. Ensure `SKILL.md` frontmatter `name` exactly matches the skill directory name.
3. If it depends on other skills/tools, add `skill.meta.json`.
4. Run:

   ```bash
   ./scripts/skill-deps check
   ./scripts/skill-sync
   ```

Do not edit skills through runtime folders. Runtime entries should be symlinks back into this repo.

## Delete Or Rename A Skill

Before deleting or renaming, check reverse dependencies:

```bash
./scripts/skill-deps why <skill>
```

If anything lists the skill under `used by`, update downstream skills first. `skill-sync --check` must pass before finalizing.

## Third-party Policy

Third-party skills are vendored and reviewed like code.

- Do not use `npx skills` as a blind updater.
- Do not edit runtime-installed third-party folders as source of truth.
- Keep accepted third-party content under `skills/thirdparty/<skill>/`.
- Preserve local patches while applying upstream changes.
- Record upstream source/path/hash in `thirdparty-lock.json`.
- Use `npx skills add <source> --list` only for discovery.

When checking or applying upstream updates:

1. Read `thirdparty-skills.yml` and `thirdparty-lock.json`.
2. Fetch/inspect upstream source in a temp checkout.
3. Diff upstream skill content against `skills/thirdparty/<skill>/`.
4. Apply only desired changes; preserve local modifications.
5. Update `thirdparty-lock.json` provenance/hash.
6. Run `./scripts/skill-deps check` and `./scripts/skill-sync`.
7. Report local patches preserved, upstream changes accepted, and skipped changes.

## Skill-owned Tools

A skill can own tools under its directory, e.g. `skills/chatgpt/tools/opencli-plugin-chatgptx/`.

Declare tools in `skill.meta.json`. `skill-sync` currently knows how to install local OpenCLI plugins:

```json
{
  "dependsOnTools": [
    {
      "kind": "opencli-plugin",
      "name": "chatgptx",
      "path": "tools/opencli-plugin-chatgptx",
      "verify": "opencli chatgptx status -f json"
    }
  ]
}
```

After upgrading a tool package such as OpenCLI, run:

```bash
./scripts/skill-sync --tools-only
opencli chatgptx status -f json
```

## Upstream Source Registry

The sources below are the ground truth for third-party skill discovery. Query each source directly when checking for updates.

| Source | GitHub | Skill discovery | Package |
|---|---|---|---|
| `mattpocock/skills` | https://github.com/mattpocock/skills | `npx skills add mattpocock/skills --list` | — |
| `jackwener/opencli` | https://github.com/jackwener/opencli | `npx skills add jackwener/opencli --list` | `@jackwener/opencli` (npm) |
| `krzysztofdudek/ResearcherSkill` | https://github.com/krzysztofdudek/ResearcherSkill | `npx skills add krzysztofdudek/ResearcherSkill --list` | — |
| `microsoft/playwright-cli` | https://github.com/microsoft/playwright-cli | `npx skills add microsoft/playwright-cli --list` | — |

Add new sources here before adding individual skills to `thirdparty-skills.yml`.

## Validation

After changing scripts or manifests, run:

```bash
bash -n scripts/skill-sync
./scripts/skill-deps check
./scripts/skill-sync --check
```

After changing OpenCLI plugins, also run their verify command, e.g.:

```bash
opencli chatgptx status -f json
```
