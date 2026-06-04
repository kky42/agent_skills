---
name: kanban-orchestrator
description: Lightweight kanban orchestration for coordinating multiple CLI coding agents through a SQLite task board and tmux workers. Use when the user wants an active agent to split work, spawn Codex, Claude Code, or Pi workers, track asynchronous progress, or manage a small agent kanban without a web UI or daemon.
---

# Kanban Orchestrator

Use this skill when you are the active orchestrator agent. Kanban manages tasks,
runs, worker spawning, harvesting, and review gates. Repo-specific policy,
metrics, rubrics, and promotion rules belong in the repo, not in this skill.

## Quick Start

Use the bundled CLI from the repo you are orchestrating:

```bash
node /Users/kky/dev/agent/agent_hub/skills/orchestration/kanban-orchestrator/scripts/kanban.mjs init
node /Users/kky/dev/agent/agent_hub/skills/orchestration/kanban-orchestrator/scripts/kanban.mjs add "Map the parser module" --body "Find relevant files and risks."
node /Users/kky/dev/agent/agent_hub/skills/orchestration/kanban-orchestrator/scripts/kanban.mjs spawn TASK-1 --agent codex --sandbox workspace-write
node /Users/kky/dev/agent/agent_hub/skills/orchestration/kanban-orchestrator/scripts/kanban.mjs harvest
node /Users/kky/dev/agent/agent_hub/skills/orchestration/kanban-orchestrator/scripts/kanban.mjs accept TASK-1 --note "Verified"
```

State lives in `.kanban/kanban.db`; worker logs and prompts live under
`.kanban/runs/`. The CLI is self-contained: it maps Codex, Claude Code, and Pi
launch flags itself and uses tmux only as the background process runner.

## Lifecycle

```text
backlog -> ready -> running -> worker_done -> accepted/rejected
side exits: blocked, failed, cancelled
```

Worker `done` means finished and awaiting operator review. It is not accepted.
`review`, `done`, and `canceled` remain legacy aliases, but prefer
`worker_done`, `accept`, `reject`, and `cancelled` in docs and new workflows.

## Orchestrator Rules

- Keep the human interface conversational; do not expose a board UI unless asked.
- Use tasks for durable state; use tmux only as process infrastructure.
- Before spawning, write a narrow task with objective, allowed cwd, sandbox,
  expected output, and stop condition.
- Prefer small waves. Scale only when tasks are independent and reviewable.
- Prefer `workspace-write` when workers should call `claim`/`report`; use
  `read-only` only for pure inspection or final-marker-only flows.
- Poll with `status` or `harvest`; inspect logs only when ambiguous.
- Verify worker results yourself before `accept` or `reject`.
- Use `close-stale` and `archive-task` to keep active boards small.
- Prefer `status --active-only` for day-to-day scanning; closed and
  `worker_done` tasks accumulate and make full `status` output noisy.
  Use `close-stale` and `archive-task` after each wave to keep the
  active view compact.
- After a wave with many verified tasks, batch-close them in one pass
  rather than one-at-a-time. Use `close-wave` or batch `accept`/`reject`
  when available.
- When `status` shows tasks as `worker_done` but runs still appear
  `running`, trust task status over run state. Run state can lag after
  transport loss; task status reflects the known outcome.
- Before spawning a worker, verify the worker can write to the kanban DB.
  Fail fast at spawn time with a clear operator hint if DB writes are
  blocked, rather than letting the worker discover it mid-run.
- Prefer `harvest --active-only` or `harvest --wave <name>` for routine
  review. `harvest --all` is for full audits, not day-to-day scanning.

## Worker Contract

Every worker prompt includes the kanban preamble from
[templates/worker-system-prompt.md](templates/worker-system-prompt.md). Workers
should claim and report through the exact absolute `node .../kanban.mjs --db`
commands in their assigned prompt. If DB writes are blocked, they must still
finish with the final marker:

```text
STATUS: done|blocked|failed
SUMMARY: <one paragraph>
CHANGED_FILES: <paths or none>
TESTS: <commands run or not run>
NEXT: <needed follow-up or none>
```

## Reviewing Runs

- A worker's final marker (`STATUS: done|blocked|failed`) is the source of
  truth. Transport errors (reconnects, stream drops) that do not prevent the
  final marker are not worker failures. Distinguish transport noise from
  actual worker contract success.
- When reviewing a run, separate recovered tool errors (worker continued and
  produced a valid marker) from terminal failures. A run that recovers and
  finishes `done` is a success, even if individual tool calls hit transient
  errors.
- If a worker dies before emitting the final marker, inspect the raw run
  directory for results. Harvest should still surface changed-files and
  artifact hints from the event log when the marker is missing.

For command details and design notes, see [REFERENCE.md](REFERENCE.md).
