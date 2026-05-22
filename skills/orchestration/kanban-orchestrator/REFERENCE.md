# Kanban Orchestrator Reference

This skill is a generic carrier for agent orchestration. The active agent is the
orchestrator. There is no daemon and no human-facing UI in v1.

## Model

```text
human chat
  -> active orchestrator agent
    -> kanban.mjs
      -> .kanban/kanban.db
      -> tmux worker runner
        -> codex / claude / pi workers
```

SQLite is the board. tmux is only the process runner. The orchestrator makes
scheduling and acceptance decisions.

## Concepts

- **Task**: durable unit of work with title/body/status/priority/events.
- **Run**: one worker attempt for a task, with prompt/logs/session metadata.
- **Worker completion**: worker reports `STATUS: done` or `report --status done`.
- **Operator acceptance**: orchestrator verifies the result and runs `accept`.

## Statuses

- `backlog`: captured but not ready.
- `ready`: eligible to spawn.
- `running`: active worker or active local work.
- `worker_done`: worker finished; operator must inspect.
- `blocked`: needs input or dependency.
- `failed`: unrecoverable failure or contract failure.
- `accepted`: operator verified and kept.
- `rejected`: operator verified and discarded.
- `cancelled`: intentionally stopped.

Legacy aliases remain for compatibility: `review -> worker_done`,
`done -> accepted`, `canceled -> cancelled`. `archived_at` is metadata, not a
lifecycle state.

## CLI Surface

Examples use `kanban` as shorthand for
`node /Users/kky/dev/agent/agent_hub/skills/orchestration/kanban-orchestrator/scripts/kanban.mjs`.
Worker prompts always include the absolute command and `--db` path.

```bash
kanban init
kanban add TITLE [--body TEXT] [--status ready] [--priority N]
kanban list [--status ready] [--include-archived]
kanban show TASK-1
kanban claim TASK-1 [--run RUN-1] [--assignee codex] [--note TEXT]
kanban report TASK-1 --status done|blocked|failed --summary TEXT [--run RUN-1]
kanban update TASK-1 [--status running] [--note TEXT] [--assignee codex]
kanban block TASK-1 --reason TEXT
kanban accept TASK-1 --note TEXT
kanban reject TASK-1 --reason TEXT
kanban fail TASK-1 --reason TEXT
kanban cancel TASK-1 [--reason TEXT]
kanban status
kanban runs [--status STATUS]
kanban spawn TASK-1 --agent codex --sandbox workspace-write [--quiet]
kanban spawn-many --file wave.jsonl [--quiet]
kanban harvest [--task TASK-1|--run RUN-1|--all]
kanban steer RUN-1 --message TEXT [--replace]
kanban close RUN-1
kanban close-stale [--older-than 2h]
kanban archive-task TASK-1 [--note TEXT]
```

## Worker Prompt And Harvest

`spawn` writes a composed prompt under `.kanban/runs/`, launches a structured
worker runner inside tmux, and records the run row. The prompt includes:

1. the kanban worker preamble,
2. assigned task/run/cwd/sandbox metadata,
3. exact absolute lifecycle commands,
4. task title/body and optional extra prompt.

Workers should call `claim` when they begin and `report` before final answer.
`report --status done` moves the task to `worker_done`. If DB writes fail, the
required final marker is harvested from the worker log. A `done` marker missing
`SUMMARY`, `CHANGED_FILES`, `TESTS`, or `NEXT` is a contract failure, not
success.

Board inspection commands (`show`, `list`, `status`, `runs`) open SQLite in
read-only mode and do not initialize or mutate the database, so read-only
workers can inspect their assigned task.

## Worker Runner

Default worker sandbox is `workspace-write`:

```text
codex:  model gpt-5.5, reasoning low
claude: model deepseek-v4-flash[1m], reasoning low
pi:     model deepseek/deepseek-v4-flash, reasoning low
```

Agent-specific CLI/event parsing lives under `scripts/lib/agents/`. The runner
sets writable cache/temp paths inside the worker cwd:

```text
UV_CACHE_DIR=<cwd>/.kanban/cache/uv
XDG_CACHE_HOME=<cwd>/.kanban/cache/xdg
TMPDIR=<cwd>/.kanban/tmp
```

Claude `workspace-write` maps to `bypassPermissions` because `acceptEdits`
still denies shell commands needed for `claim`/`report`. Keep spawned tasks
narrow.

## Batch Waves

`spawn-many` accepts JSONL. One object per line:

```json
{"task":"TASK-1","agent":"codex","cwd":"/repo","sandbox":"workspace-write","tag":"wave-task1","prompt_file":"task.md"}
```

It prints per-task JSON summaries and continues after individual spawn errors.

## Reliability Notes

- Task/run ids are allocated with SQLite `BEGIN IMMEDIATE` to avoid parallel id
  races.
- `spawn` preflights cwd, tmux, agent binary, prompt file, and run-dir
  writability before inserting a run.
- `status` before `init` returns JSON with `initialized:false`.
- Use `close-stale` for abandoned tmux runs and `archive-task` to hide reviewed
  tasks without changing their final state.
- Do not manually edit `kanban.db`; use the script so events remain consistent.
