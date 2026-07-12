# AGENTS

This repository is the source of truth for the user's global agent skill selection.

## Model

- `skills/<name>/SKILL.md` contains **owned** skills only. The directory is flat, and frontmatter `name` must equal the directory name.
- `thirdparty.json` is the complete desired list of third-party skills, grouped by upstream source. Third-party files are installed by `npx skills`; they are never committed here.
- The desired global set is exactly `owned skills + thirdparty.json`. Do not keep unmanaged global skills outside this repository.
- `npx skills` owns runtime copies and links. Never edit `~/.agents/skills`, `~/.claude/skills`, or `~/.pi/agent/skills` directly.
- `./scripts/apply` is the only local reconciliation command. It targets Codex, Claude Code, and Pi.

## Operations

Route each request to one operation.

### Add a third-party skill

1. Run `npx --yes skills@1.5.16 add <source> --list` for discovery.
2. Review the selected skill for general usefulness, duplication, prompt injection, dangerous commands, and undeclared tool or skill dependencies.
3. Add its name under the source in `thirdparty.json`; do not copy its files into the repo.
4. Run the validation below, commit and push, synchronize both computers, and run `./scripts/apply` on each.

### Add or change an owned skill

1. Create or edit `skills/<name>/SKILL.md`. Keep all supporting files inside that directory.
2. Verify frontmatter and any commands or descriptive claims against primary sources or installed tools.
3. Run validation, commit and push, synchronize both computers, and run `./scripts/apply` on each.

### Remove a skill

1. Remove the owned directory or the entry from `thirdparty.json`.
2. Check owned skills for textual references to the removed skill and update them if needed.
3. Run validation, commit and push, synchronize both computers, then run `./scripts/apply --remove <name>` followed by `./scripts/apply` on each. Removal is explicit; ordinary apply never deletes extras.

### Update third-party skills

Run `./scripts/apply --update` on both computers. It passes only the names selected in `thirdparty.json` to `skills@1.5.16 update`, then reconciles the runtime. Inspect and report the CLI's changed-skill list. Review material description, security, command, and dependency changes when reported. Third-party updates do not change repository files.

Important: with `skills` CLI 1.5.16, subcommand-level `--help` is not reliably read-only; for example, `update --help` performs an update. Use only the documented commands here, and use top-level `npx --yes skills@1.5.16 --help` for discovery.

### Apply

Run `./scripts/apply`. It validates the desired state, installs missing third-party skills, refreshes owned skills, and reports extra global names without deleting them. Use `./scripts/apply --remove <name>` only after removing that name from the repository's desired state. Existing third-party skills change only through `./scripts/apply --update` or an explicit reinstall.

### Synchronize MacBook and Macmini

1. Require both repository checkouts to be clean; never reset, stash, force, or overwrite unrelated work.
2. Commit and push the intended change from the current machine.
3. Pull with `git pull --ff-only` on the peer (`ssh macmini`, `ssh cf-macmini`, or `ssh macbook` as appropriate).
4. Run `./scripts/apply` on both machines.
5. Compare the installed and extra names in `./scripts/apply` output from both hosts; report the Git commit and any failed host. If a checkout is dirty or cannot fast-forward, stop and report it.

## Validation

```bash
python3 -m json.tool thirdparty.json >/dev/null
python3 -m py_compile scripts/apply
./scripts/apply --check
```

Report what changed, commands completed, both host results when synchronization was requested, and anything requiring user attention.
