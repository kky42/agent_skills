---
name: pievo
description: Operate Pievo for recurring or scheduled work that must survive restarts; manage or inspect existing loops; diagnose recovery, blocked runs, or quota gates.
---

# Operating pievo

Pievo runs named pi-flow workflows on a cadence. Each **loop** is one named workflow + cadence; every accepted **run** is recorded durably. Reach for pievo when work must repeat or survive restarts; do one-off work directly.

## Contract

- Every command prints exactly one JSON envelope. Judge success by `ok` and `diagnostics` only; the payload is `data`. Exit codes: 0 ok, 1 expected failure, 2 usage error, 70 internal.
- **Acceptance, then observe.** Run-starting commands return at acceptance: `loop run` uses `data.run_id`; `loop start` reports an immediate or durability-uncertain run attempt as `data.accepted_run_id`. Retain that ID. Poll `pievo run show <run-id>` when the user asks for the outcome. An explicit request to prove completion means poll to a terminal state; otherwise poll once after a few seconds and report the current state. There is no `--wait` flag.
- Mutations need the daemon; reads answer without it (with warning `daemon_unreachable_stale_read`). When a mutation fails, check `pievo daemon status` and `pievo doctor`, then run `pievo daemon start`. If start fails because the port is busy, retry with `pievo daemon start --port 0`. A `daemon_command_timeout` means the bounded request expired; inspect status before retrying a mutation whose acceptance may be uncertain.
- A successful mutation may carry warning `materialization_failed`: the ledger change committed, but rebuildable copies need repair. Trust the returned action, report the warning, and follow its `repair` metadata; daemon startup rebuilds from the ledger.
- `PIEVO_HOME` (env) selects the pievo instance; use what the environment gives you. `PIEVO_DASHBOARD_HOST`, `PIEVO_DASHBOARD_PORT`, and env-only `PIEVO_DASHBOARD_TOKEN` set daemon defaults; never invent a token flag.
- Speak pievo's language: *loop* (not job/task), *remove* (not delete), a run is *accepted* (not launched).

## Commands

```
pievo help                               # authoritative command catalog
pievo --version                          # CLI package version (compare with daemon status)
pievo daemon status                      # daemon health, version, and dashboard address
pievo daemon start [--foreground] [--host H] [--port N]
pievo daemon stop                        # interrupt active runs within the kill grace, then exit; unreachable live ownership is an error
pievo daemon restart [--foreground] [--host H] [--port N] # preserve prior host/port unless overridden
pievo doctor                             # environment and state-root health
pievo loop register <config.yaml>        # create-or-update by content hash
pievo loop list                          # triage rows: status, blocked reason, active/latest run, next due
pievo loop show <name>                   # full view: config, quota usage/limits, consecutive_errors, next_due, recent runs
pievo loop start <name>                  # activate scheduling; reports data.accepted_run_id for an immediate run
pievo loop pause <name>                  # stop future scheduling; the active run keeps going
pievo loop run <name> [--ignore-quota]   # accept one manual run now; returns data.run_id
pievo loop interrupt <name>              # interrupt the active run; returns once it is terminal
pievo loop remove <name>                 # remove from current state; history and run records survive
pievo loop runs <name> [--limit N]       # newest summaries; default 20
pievo run show <run-id>                  # one run in full: state, result.data, diagnostic, usage
pievo run logs <run-id> [--limit N]      # newest log tail; default 200, live while executing
```

## Loop config

```yaml
version: 1                 # schema version, always 1
name: kb-update            # stable key, ^[a-z0-9][a-z0-9_-]{0,63}$
objective: Keep the knowledge base current.
cwd: /abs/path/to/project  # absolute, must exist; workflows live under it
cadence:
  kind: delay              # rerun N after each run finishes…
  after_completion: 6h     # durations: <N>s|m|h|d
  # …or fixed times:
  # kind: cron
  # expr: "0 9 * * *"      # five fields; each is *, a number, or a comma list — no ranges/steps
  # timezone: Asia/Shanghai  # validated IANA timezone
workflow:
  name: kb-update          # must match a workflow file (below)
  args: {}                 # passed to the workflow as `args`
  timeout: 240m            # optional parent-enforced wall-clock cap; default 240m, maximum 2147483s
quotas:                    # optional daily gates, local calendar day
  max_runs_per_day: 24
  max_tokens_per_day: 1000000
  max_cost_usd_per_day: 10
policy:
  max_consecutive_errors: 3  # errors in a row before the loop blocks (default 3)
```

Unknown config keys are rejected at every level, and durations must use `<N>s|m|h|d` strings rather than bare numeric seconds. Copy field names exactly—especially quota and timeout fields—rather than assuming an ignored extension is harmless. The workflow must exist at `<cwd>/.pi/workflows/<name>.js` with `meta.name` matching, or registration fails. Minimal shape:

```js
export const meta = { name: "kb-update", description: "Keep the knowledge base current." };
const summary = await agent("Review recent changes and update the knowledge base.", { label: "update" });
return { status: "complete", message: summary.slice(0, 200) };
// return { status: "blocked", message: "why" } when a human must step in — this blocks the loop.
```

Author against these runtime boundaries:

- Make every external effect idempotent or implement domain-level dedupe; durable run records do not provide exactly-once effect delivery.
- Treat token and cost quotas as post-run gates, not hard per-run caps; one run can cross a limit before the next is gated.
- Treat cron as edge-triggered: missed ticks are not replayed. A due delay loop stays due until a run is accepted.

## Create a loop

1. Choose the stable name and run `pievo loop show <name>`. Continue creation only when it returns `loop_not_found`; an existing name routes to **Update a loop** or requires a different name.
2. Ensure the workflow file exists in the target `cwd`; write one from the shape above if missing, and satisfy the external-effect boundary above.
3. Write the config YAML and `pievo loop register <file>`. This step is complete only with `ok:true` and `data.action: "created"`; any other action routes to update or conflict handling before activation.
4. **New loops register `paused` and accept no scheduled runs until started.** Run `pievo loop start <name>` to activate. Subject to quota and recovery gates, a delay loop with no history accepts a run immediately as `data.accepted_run_id`.
5. Creation is complete when registration was `created`, `loop show` reports `active`, and any `data.accepted_run_id` has been handled by **Acceptance, then observe**. Report a concrete `next_due` when available; an active run can suppress it until terminal. With no accepted run, the schedule is ready; a manual `pievo loop run` belongs only to an explicit run-now or test request.

## Update a loop

1. `pievo loop show <name>` — `data.loop.config` is the registration schema (JSON is valid YAML).
2. Write it to a file, edit only what the user asked, and `pievo loop register <file>` under the same `name`.
3. Accept `data.action: "updated"` with a bumped `config_version`, or `"unchanged"` when the desired config was already accepted. Run `loop show` again; the update is complete when every requested field matches and every untouched field still equals the original config. Updates preserve status and apply to future runs only; an in-flight run keeps the old config.

## Diagnose and report status

Triage with `pievo loop list`, then drill into anything off with `loop show` → `loop runs` → `run show` → `run logs`.

- Status `blocked`, reason `workflow_blocked`: the workflow asked for attention — read its latest run's `message` and surface it.
- Status `blocked`, reason `too_many_errors`: the error breaker tripped — read the failing runs' `diagnostic` before proposing anything.
- Quota exhausted (`loop show` usage vs limits): scheduled attempts produce no run id until the gate resets at local midnight. A due delay loop remains due; cron waits for a future matching tick and never replays missed ticks. `loop run --ignore-quota` overrides for one run if the user wants it. Missing token/cost contributes zero to gating; partial usage contributes its observed lower bound. Both make the corresponding `*_known` flag false and must not be reported as exact.
- `run_acceptance_unconfirmed` means no worker was started. Track the returned `run_id` with `run show` and the daemon's recovery diagnostics. Resolution is complete when either the run becomes terminal `error` with diagnostic kind `run_acceptance_unconfirmed`, or that recovery diagnostic clears while `run show` remains `run_not_found`, meaning acceptance never committed. Wait for one outcome before issuing another run-starting mutation.
- `doctor` returns `ok:false`/exit 1 for error or critical findings. `daemon_lock_live_pid` means the daemon may be starting/unreachable or a stale lock PID was reused. Verify that PID before removing `control/daemon.lock`; malformed lock metadata fails closed. `worker_control_missing` or `worker_control_invalid` means startup cannot safely terminalize that unfinished run—do not invent or delete metadata until the worker/process group has been verified manually.
- After fixing the cause, `pievo loop start <name>` clears `blocked` and resumes scheduling; the error counter resets only on the next `complete` run.

Report concrete envelope fields — status, reason codes, `run_id`s, `next_due`, messages — not paraphrase.

## Manage loops

- Pause stops future runs only. To stop everything now: `loop pause`, then `loop interrupt`.
- Remove is rejected with `active_run` while a run executes — interrupt first; removal never kills work implicitly. History stays queryable and same-day quota usage survives; re-registering the name starts fresh (`paused`, `config_version` 1).
- A manual `loop run` while a run is active fails `already_running`; nothing queues — retry after the active run ends if it still matters.
