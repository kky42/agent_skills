---
name: pievo
description: Operate Pievo: set up, inspect, manage, and diagnose recurring or scheduled pi-flow workflows (loops) that survive restarts.
---

# Operating pievo

Pievo runs named pi-flow workflows on a cadence. A **loop** is one named workflow + cadence; every accepted **run** is recorded durably in an append-only ledger. Reach for pievo when work must repeat or survive restarts; do one-off work directly. Speak its language: *loop* (not job/task), *remove* (not delete), a run is *accepted* (not launched).

## Contract

- Every command prints exactly one JSON envelope. Judge success by `ok` and `diagnostics`; the payload is `data`. Exit codes: 0 ok, 1 expected failure, 2 usage error, 70 internal.
- **Acceptance, then observe.** Run-starting commands return at acceptance, not completion: `loop run` gives `data.run_id`, `loop start` gives `data.accepted_run_id`. Keep that ID and poll `pievo run show <run-id>` for the outcome — poll to a terminal state only when the user wants completion proven, otherwise once after a few seconds. There is no `--wait` flag.
- Mutations need the daemon; reads answer without it (warning `daemon_unreachable_stale_read`). If a mutation fails, check `pievo daemon status` and `pievo doctor`, then `pievo daemon start` (retry `--port 0` if the port is busy).
- A successful mutation may still warn `materialization_failed`: the ledger change committed but a rebuildable copy needs repair. Trust the returned action and report the warning; daemon startup rebuilds from the ledger.
- `PIEVO_HOME` selects the instance — use what the environment gives you.

## Commands

```
pievo help                               # authoritative command catalog
pievo daemon status | start | stop | restart   # start: [--foreground] [--host H] [--port N]
pievo doctor                             # environment and state-root health
pievo loop register <config.yaml>        # create-or-update by content hash; new loops start paused
pievo loop list                          # triage rows: status, blocked reason, active/latest run, next due
pievo loop show <name>                   # full view: config, quota usage/limits, consecutive_errors, next_due, recent runs
pievo loop start <name>                  # activate scheduling; reports data.accepted_run_id for an immediate run
pievo loop pause <name>                  # stop future scheduling; the active run keeps going
pievo loop run <name> [--ignore-quota]   # accept one manual run now; returns data.run_id
pievo loop interrupt <name>              # interrupt the active run; returns once it is terminal
pievo loop remove <name>                 # remove from current state; history and run records survive
pievo loop runs <name> [--limit N]       # newest run summaries; default 20
pievo run show <run-id>                  # one run in full: state, result.data, diagnostic, usage
pievo run logs <run-id> [--limit N]      # newest log tail; default 200, live while executing
```

## Set up a loop — trial run before you schedule

`register` starts every loop **paused** on purpose: it schedules nothing until a manual **trial run** proves it and you then start it. Build → register → trial run → validate → start. Never `loop start` a loop whose trial run you have not inspected.

A loop then runs **unattended** — there is no user to consult when it fires at 3 a.m. So its behavior is decided *now*, at authoring time, while the user is here. **Confirm these three with the user before registering; don't decide them alone.** Each has a safe default, so autonomous setup still lands somewhere sane:

1. **Stop or retry.** *Default:* everything retries on the next tick (`error`) or takes a safe checkpoint (`complete`); `blocked` is reserved for a real action only a human can take (grant access, approve, do something physical). **Confirm which conditions — if any — should stop the loop and wait for the user.** Never `blocked` on a transient failure (timeout, rate limit, malformed output, reconcilable uncertainty) — that is the mistake that strands a loop.
2. **What each run reports.** *Default:* `data` answers what changed and whether attention is needed, as explicit booleans/enums. **Confirm what a finished run must tell the user**, and design `data` around their decisions — not the workflow's internal agents or stages.
3. **Spend ceiling.** *Default:* any model-backed loop sets a token/cost quota. **Propose quota + cadence and have the user confirm the ceiling** — a recurring loop is a standing spend commitment, and a short cadence with no token/cost quota can run unbounded.

Steps:

1. **Name & check.** Pick the stable `name`; `pievo loop show <name>` and continue only on `loop_not_found`.
2. **Write the workflow** at `<cwd>/.pi/workflows/<workflow.name>.js`, `meta.name` matching the config. It returns `{ status: "complete" | "blocked", message?, data? }`; **throw** for operational failures (they become `error`). Bake in the stop/retry behavior the user confirmed, and make external effects idempotent — durable records are not exactly-once delivery.
3. **Write the config** (schema below) with the confirmed limits, and `pievo loop register <file>` — complete only on `data.action: "created"`.
4. **Trial run.** `pievo loop run <name>` (still paused), poll `run show` to terminal. If it blocks or errors on a healthy input, fix the workflow — don't re-run a broken one.
5. **Validate & start.** When the trial reached `complete`, `result.data` answers the user's decision, and observed usage fits the quota → `pievo loop start <name>`. Report `next_due`.

## Loop config

```yaml
version: 1
name: kb-update            # ^[a-z0-9][a-z0-9_-]{0,63}$
objective: Keep the knowledge base current.
cwd: /abs/path/to/project  # absolute, must exist
cadence:
  kind: delay              # rerun N after each run finishes…
  after_completion: 6h     # durations: <N>s|m|h|d
  # …or fixed times:  kind: cron / expr: "0 9 * * *" (5 fields, no ranges/steps) / timezone: Asia/Shanghai
workflow:
  name: kb-update          # must match the workflow file's meta.name
  args: {}                 # passed to the workflow as `args`
  timeout: 240m            # optional wall-clock cap; default 240m
quotas:                    # optional daily gates — confirm with the user
  max_runs_per_day: 24
  max_tokens_per_day: 1000000
  max_cost_usd_per_day: 10
policy:
  max_consecutive_errors: 3  # errors in a row before the loop blocks (default 3)
```

Unknown keys are rejected at every level; durations are `<N>s|m|h|d` strings, never bare seconds. Copy quota and timeout field names exactly — a misspelled spend control is a rejection, not a silent no-op.

## Manage & diagnose

- Triage with `loop list`, then drill in: `loop show` → `loop runs` → `run show` → `run logs`. Report concrete fields (status, reason codes, `run_id`s, `next_due`), not paraphrase.
- **A `blocked` loop is a claim to verify, not proof.** Read `message` + `data.blocker`; confirm the condition still exists and truly needs a human. A block on a transient/retryable condition is a workflow misclassification — fix the classification (only with user authorization to edit workflow source), don't just restart. After the cause is fixed, `loop start` clears `blocked`; the error counter resets only on the next `complete` run.
- **Quota exhausted:** scheduled attempts are silently skipped (no run id); `loop run --ignore-quota` overrides one run if the user wants it. Resets at local midnight.
- **Update a loop:** `loop show` → edit the returned config → re-register under the same name. Applies to future runs only; an in-flight run keeps its pinned config.
- **Stop everything now:** `loop pause`, then `loop interrupt`. **Remove** is rejected while a run is active — interrupt first; history and same-day quota usage survive.
- **Recovery:** `run_acceptance_unconfirmed`, or `doctor` critical findings (`daemon_lock_live_pid`, `worker_control_*`), mean startup cannot safely finish a run. Verify the process/PID before touching `control/daemon.lock` or worker metadata; wait for the run to terminalize before another run-starting mutation.
