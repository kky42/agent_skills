# agent_skills

A small source-of-truth repository for global agent skills on the MacBook and Macmini.

- [`skills/`](skills/) contains only locally owned skills.
- [`thirdparty.json`](thirdparty.json) lists selected third-party skills by source; their files are installed and updated by [`skills`](https://skills.sh/), not committed here.
- [`scripts/apply`](scripts/apply) installs the desired set into Codex, Claude Code, and Pi. It refreshes owned skills, installs third-party skills only when missing, and leaves deletion explicit.

## Apply

```bash
./scripts/apply --check        # validate desired state without changing runtime skills
./scripts/apply                # install missing third-party and refresh owned
./scripts/apply --update       # update selected third-party skills, then apply
./scripts/apply --remove NAME  # explicitly remove a name no longer in desired state
```

The script pins the tested installer as `skills@1.5.16`. Override only when intentionally testing a newer release:

```bash
AGENT_SKILLS_NPX_PACKAGE=skills@<version> ./scripts/apply
```

## Maintenance

```bash
npx --yes skills@1.5.16 add <source> --list       # discover source skills
./scripts/apply --update                           # update selected third-party skills
npx --yes skills@1.5.16 list --global --json      # inspect global state
```

To add or remove a third-party skill, edit `thirdparty.json` and apply on both computers. To add, edit, or remove an owned skill, change `skills/<name>/` and apply on both computers. Full operating rules are in [`AGENTS.md`](AGENTS.md).

## Scheduled updates

[`pievo/agent-skills-update.yaml`](pievo/agent-skills-update.yaml) runs the project workflow [`.pi/workflows/agent-skills-update.js`](.pi/workflows/agent-skills-update.js) daily at 07:00 Asia/Shanghai. It updates only selected third-party skills, synchronizes Macmini and MacBook, and reports upstream source inventory additions or removals without changing `thirdparty.json`.

> With `skills` CLI 1.5.16, subcommand-level `--help` is not reliably read-only; `update --help`, for example, performs an update. Use top-level `npx --yes skills@1.5.16 --help` instead.
