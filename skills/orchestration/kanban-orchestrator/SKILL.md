---
name: kanban-orchestrator
description: Lightweight kanban orchestration for coordinating multiple CLI coding agents through a SQLite task board and tmux workers. Use when the user wants an active agent to split work, spawn Codex, Claude Code, or Pi workers, track asynchronous progress, or manage a small agent kanban without a web UI or daemon.
---

# Kanban Orchestrator

Use this skill when you are the active orchestrator agent. The human talks to
you; workers run asynchronously and report through the local kanban database.

## Quick Start

Use the bundled CLI from the repo you are orchestrating:

```bash
node /Users/kky/dev/agent/agent_hub/skills/orchestration/kanban-orchestrator/scripts/kanban.mjs init
node /Users/kky/dev/agent/agent_hub/skills/orchestration/kanban-orchestrator/scripts/kanban.mjs add "Map the parser module" --body "Find relevant files and risks."
node /Users/kky/dev/agent/agent_hub/skills/orchestration/kanban-orchestrator/scripts/kanban.mjs spawn TASK-1 --agent codex --sandbox read-only
node /Users/kky/dev/agent/agent_hub/skills/orchestration/kanban-orchestrator/scripts/kanban.mjs status
node /Users/kky/dev/agent/agent_hub/skills/orchestration/kanban-orchestrator/scripts/kanban.mjs harvest
node /Users/kky/dev/agent/agent_hub/skills/orchestration/kanban-orchestrator/scripts/kanban.mjs review TASK-1 --note "Verified"
node /Users/kky/dev/agent/agent_hub/skills/orchestration/kanban-orchestrator/scripts/kanban.mjs done TASK-1 --note "Accepted"
```

State lives in `.kanban/kanban.db`; worker logs and prompts live under
`.kanban/runs/`. The CLI is self-contained: it maps Codex, Claude Code, and Pi
launch flags itself and uses tmux only as the background process runner.

## Orchestrator Rules

- Keep the human interface conversational. Do not require the user to operate a
  board UI.
- Use tasks for durable state; use tmux only as execution infrastructure.
- Before spawning, write a narrow task with objective, allowed cwd, sandbox,
  expected output, and stop condition.
- Prefer `read-only` for mapping/review and `workspace-write` only for scoped
  implementation work. Read-only workers can inspect the board with `show`, but
  `claim`/`report` may be blocked; the final marker is the durable fallback.
- Spawn small waves first. For v1, 1-3 workers is usually enough.
- Poll with `status` or `harvest`; inspect logs only when a run is blocked,
  failed, stale, or ambiguous.
- Treat worker `done` as `review`. Mark tasks `done` only after you verify or
  explicitly accept the result.
- Use `steer RUN-ID --message "..." --replace` for noninteractive workers that
  need new instructions. Plain `steer` records a note but does not reach a live
  one-shot worker.
- Verify worker results yourself before integrating or reporting completion.
- Close stale or unneeded tmux sessions once harvested.

## Worker Contract

Every worker prompt includes the kanban preamble from
[templates/worker-system-prompt.md](templates/worker-system-prompt.md). Workers
should claim and report through the exact absolute `node .../kanban.mjs --db`
commands in their assigned prompt. If sandbox policy blocks DB writes, they
must still finish with:

```text
STATUS: done|blocked|failed
SUMMARY: <one paragraph>
CHANGED_FILES: <paths or none>
TESTS: <commands run or not run>
NEXT: <needed follow-up or none>
```

For command details and design notes, see [REFERENCE.md](REFERENCE.md).
