# Kanban Orchestrator Reference

This skill is a lightweight carrier for agent orchestration. The active agent is
the orchestrator. There is no daemon and no human-facing UI in v1.

## Model

```text
human chat
  -> active orchestrator agent
    -> kanban.mjs scripts
      -> .kanban/kanban.db
      -> built-in tmux worker runner
        -> codex / claude / pi workers
```

SQLite is the board. tmux is only the process runner. The orchestrator makes
scheduling decisions when it checks state.

## Statuses

- `backlog`: captured but not ready to run.
- `ready`: eligible for a worker.
- `running`: has an active run or is actively being worked.
- `blocked`: needs human input or another task.
- `review`: worker says work is ready but the orchestrator has not verified it.
- `done`: verified or accepted.
- `failed`: run failed or task cannot be completed as written.
- `canceled`: intentionally stopped.

## CLI Surface

Examples use `kanban` as shorthand for
`node /Users/kky/dev/agent/agent_hub/skills/orchestration/kanban-orchestrator/scripts/kanban.mjs`.
Worker prompts always include the absolute command and `--db` path.

```bash
kanban init
kanban add TITLE [--body TEXT] [--status ready] [--priority N]
kanban list [--status ready]
kanban show TASK-1
kanban claim TASK-1 [--run RUN-1] [--assignee codex] [--note "Started"]
kanban report TASK-1 --status done|blocked|failed --summary TEXT [--run RUN-1]
kanban update TASK-1 [--status running] [--note TEXT] [--assignee codex]
kanban block TASK-1 --reason TEXT
kanban done TASK-1 --note TEXT
kanban fail TASK-1 --reason TEXT
kanban status
kanban spawn TASK-1 --agent codex --sandbox read-only
kanban summary
kanban harvest
kanban steer RUN-1 --message TEXT [--replace]
kanban close RUN-1
```

`spawn` writes a composed prompt under `.kanban/runs/`, launches a built-in
structured worker runner inside tmux, and records the run row. The prompt is:

1. the kanban worker preamble,
2. the assigned task context,
3. the exact absolute `node .../kanban.mjs --db ...` lifecycle commands,
4. the task body and optional extra prompt.

Workers should call `claim` when they begin and `report` before their final
answer. A worker `report --status done` moves the task to `review`; the
orchestrator verifies and then marks `done`. If sandbox policy blocks DB writes,
the worker's required final marker is harvested from the run log instead.
Board inspection commands (`show`, `list`, `status`, `runs`) open SQLite in
read-only mode and do not initialize or mutate the database, so strict
read-only workers can still inspect their assigned task.

Claude Code and Pi also receive the worker contract through native
`--append-system-prompt`. Codex does not expose a stable equivalent in the local
CLI help, so the contract is composed into the prompt file for Codex.

`steer` is honest about noninteractive workers. Without `--replace`, it records
a task event for the orchestrator. With `--replace`, it closes the active run
and starts a replacement worker with the steering message included.

## Default Worker Config

Use explicit low reasoning for smoke tests or cheap waves:

```text
codex:  model gpt-5.5, reasoning low
claude: model deepseek-v4-flash[1m], reasoning low
pi:     model deepseek/deepseek-v4-flash, reasoning low
```

The built-in runner maps `reasoning` to Codex reasoning effort, Claude
`--effort`, and Pi `--thinking`.

Claude `workspace-write` maps to `bypassPermissions` because `acceptEdits`
still denies the Bash command needed for `claim`/`report`. Keep Claude worker
tasks tightly scoped and prefer `read-only` plus final-marker harvest for pure
inspection.

## Typical Flow

1. `init` in the repo root.
2. Add 1-8 tasks from the user's goal.
3. Spawn a small wave of independent tasks.
4. Answer the user from `status`.
5. Use `harvest` to fold worker reports, final markers, and session ids into
   SQLite.
6. Verify results locally.
7. Move tasks to `done`, `review`, `blocked`, or retry.

## Persistent Files

```text
.kanban/
  kanban.db
  runs/
    <run-name>.prompt.md
    <run-name>.json
    <run-name>.json.raw.jsonl
    <run-name>.json.runner.log
```

Do not manually edit `kanban.db`. Use the script so events remain consistent.
