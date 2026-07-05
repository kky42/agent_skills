# pievo CLI reference

Assume `pievo` is installed globally with `npm install -g @kky42/pievo` and is available on `PATH`.

Every command prints **exactly one JSON object** to stdout. Stderr is for unexpected process diagnostics only — never parse it for results.

## The envelope

```jsonc
{
  "schema_version": 1,
  "ok": true,
  "command": "loop.apply",
  "request_id": "req_…",
  "timestamp": "2026-07-04T10:30:00+08:00",
  "pievo_home": "/Users/kky/.pievo",
  "data": {},            // command-specific result
  "diagnostics": [],     // {severity: info|warning|error, code, message, path?, details?}
  "questions": [],       // owner questions to answer before retrying — see below
  "next": []             // recommended follow-ups: {kind: command|wait|edit|ask, command?, reason?, after_seconds?}
}
```

Read in this order: `ok` → if false, `diagnostics[].code` (stable snake_case) tells you what to fix → `questions[]` may need an owner decision → `next[]` suggests the follow-up command. Do not judge outcomes from a workflow's prose; judge from `data` and the ledgers.

**Questions** carry `{id, kind: owner_approval|missing_secret|unsafe_change, message, choices, default}`. A question means the loop is *waiting on the owner* — surface it to the user and relay their choice back; do not answer on their behalf for `owner_approval`/`unsafe_change`. Durable inbox questions (for example `repo_conflict`, `user_feedback`) live in the loop's inbox — list them with `pievo loop questions` and answer with `pievo loop answer` (see Operator control).

## Exit codes

`0` ok · `1` expected failure (`ok:false`, envelope printed) · `2` usage/parse error · `70` internal error (best-effort envelope + stderr) · `77` E2E skip (runner scripts only).

## Commands

### Daemon

```bash
pievo daemon status              # is it running; pievo_home; the daemon's package version; dashboard url+token
pievo daemon start [--foreground] [--no-dashboard] [--dashboard-host HOST] [--dashboard-port PORT] [--dashboard-token TOKEN]
pievo daemon restart             # in-place restart/upgrade; detached run workers survive
pievo daemon stop
pievo daemon upgrade [--target v] # full-fleet upgrade: pause all loops (work killed, effects drain), spawn a detached
                                  # upgrader (npm i -g, then daemon bounce), then the NEW daemon's tick resumes each
                                  # stopped loop once its in-flight effects have drained. Durable state machine in
                                  # PIEVO_HOME/upgrade.json (upgrading→restarting→resuming→done, or failed — a failed
                                  # upgrade still restarts the current version and resumes loops: roll-forward).
                                  # config.daemon.upgrade_command overrides the npm command; config.daemon.tick_seconds
                                  # sets the scheduler tick (default 30).
pievo doctor                     # environment + state-root health (flags synced/networked PIEVO_HOME)
pievo help
```

Mutating loop commands (`apply`, `run-now`, lifecycle changes) are routed to the daemon over local IPC. If the daemon is unavailable, they return `daemon_required` with a `next` action; start it or explicitly set `PIEVO_ALLOW_LOCAL_MUTATIONS=1` for local-only mutation.

Daemon-dispatched runs execute in detached `pievo-worker` processes (their own process group), so a daemon restart or crash never kills in-flight runs; leases + heartbeats + pid liveness recover abandoned runs afterwards. Two upgrade stories: **rolling** — `pievo daemon restart` after installing the new version (in-flight workers finish under the old code, new runs get new code); **clean-stop** — `pievo daemon upgrade` (or the dashboard button) for the fully automated stop-all → npm → bounce → gated-resume flow when you don't want mixed versions. `daemon status` reports the daemon's package version so you can spot version skew.

#### Web dashboard

`pievo daemon start` also brings up the **web dashboard — the operator console** (loops overview, per-loop runs/metrics/decisions/actions/audit/events, and a "needs attention" panel that aggregates blocked/paused loops, failed runs, open questions, pending approvals, engaged effect circuit breakers, truth debt, broken dispatch probes, goal changes, and upgrade progress). It also mutates: pause / start / **stop now** per loop, **pause all / start all** fleet buttons, per-run **stop** on running work-class runs, the **upgrade** button (full flow above), approve/reject effect actions, answer inbox questions, and submit free-form feedback — authenticated POSTs over the same durable ledgers as the CLI, so both stay in sync. Paused loops show a "draining N effects" chip until in-flight effects settle.

- **Open it**: `pievo daemon status` returns `data.daemon.dashboard = { enabled, host, port, url, token, require_token }`. Open `url` in a browser.
- **Auth**: a **loopback bind (default `127.0.0.1`) needs no token for reads** — the URL is just `http://127.0.0.1:4319/` — because the socket is only reachable from the same host, and a spoofed `Host` header is rejected so DNS-rebinding can't bypass it. **Mutating POSTs always require the dashboard token** (the in-page controls send it automatically). A **non-loopback bind requires a token for everything**, and `url` then embeds it, so LAN exposure stays gated.
- **LAN access**: `pievo daemon start --dashboard-host 0.0.0.0`. Set a **memorable, stable token** to reuse across restarts with `--dashboard-token <secret>`, `dashboard.token` in `config.json`, or `PIEVO_DASHBOARD_TOKEN`; otherwise a random token is generated each start. A loopback bind can still be reached remotely via an SSH tunnel.
- **Disable / configure**: `--no-dashboard` (or `dashboard.enabled=false`). `config.json` accepts `dashboard: { enabled, host, port, token }`; `PIEVO_DASHBOARD_ENABLED|HOST|PORT|TOKEN` env vars and `--dashboard-host|--dashboard-port|--dashboard-token|--no-dashboard` flags override it. The active token lives only in `control.json`.

### Author / lifecycle

```bash
pievo loop scaffold --mode identity|paired|sampled --name <name> --out <dir>
pievo loop scaffold --preset kaggle-runtime|runtime-cost|release-publish --name <name> [--baseline-score <score>] [--target-runtime-seconds <seconds>] --out <dir>
pievo loop preflight <bundle-dir> [--workspace <path>]      # pure validation; repeat until ok:true
pievo repo adopt     <bundle-dir> [--workspace <repo>] [--branch main]   # managed mode (recommended); --workspace defaults to cwd
pievo loop apply     <bundle-dir> [--workspace <path>] [--managed --branch <b>] [--wait-seconds N]
pievo loop pause   <name>            # == stop: kill work-class workers (their keeps are fail-closed anyway), DRAIN in-flight effects, pause
pievo loop stop    <name> [--now]    # same verb; --now is the emergency breaker: effects are killed too → their actions become
                                     # unknown_outcome + an effect_interrupted inbox question (verify externally, then answer resolved)
pievo loop stop    --all [--now]     # fleet pause; skips non-active loops and reports them
pievo loop resume  <name>            # sets active and clears pause_kind/auto_pause_reason
pievo loop resume  --all             # resumes ONLY loops with pause_kind=operator_abort; auto_paused/blocked are skipped with reasons
pievo loop cancel-run <name> <run-id> # kill ONE running work-class run; the loop keeps going. Effects refuse (effect_cancel_unsupported)
                                     # — use stop --now. A canceled run can never land a keep at finalize (run_canceled).
pievo loop archive <name>                                   # records-only; name stays reserved; refuses while live runs exist
pievo loop purge   <name>                                   # deletes state; frees the name (archived loops only, no live workers)
```

**Presets are templates.** `--preset` copies a bundled template LoopBundle (real files under the package's `templates/` directory) and fills in flag values — the runtime contains no preset-specific behavior. `kaggle-runtime`/`runtime-cost` set up score-preserving runtime optimization; `release-publish` shows governed delivery (`git_push`/`npm_publish` effect handlers behind manual approval and quota).

`apply` on an existing name creates a new generation (update). During an active run it should not publish a stale generation.

**One loop per repo.** A given source directory can back **only one live loop** — applying a second loop with the same `--workspace` fails with `source_repo_already_bound` (archive/purge the first, or point elsewhere). One loop already optimizes multiple goals (primary + auxiliary), so this isn't limiting. There are two repo modes:

- **Managed (recommended).** `pievo repo adopt` (sugar for `loop apply --managed`) makes Pievo the repo-owning writer: kept candidates are promoted as commits onto the repo's canonical **managed branch**. See below.
- **Legacy.** `loop apply --workspace <path>` without `--managed`: the workspace is imported (copied, `.git` stripped) into `~/.pievo/loops/<name>/workspace`, and each new best is synced to a `pievo/<name>` branch. See Workspace sync-back.

### Managed repo mode

- **Adoption requires a clean git repo root** (`managed_repo_requires_git_root`, `managed_repo_dirty`); the managed branch defaults to the current branch (or `--branch`). `.pievo/owner.json` is written repo-locally and `.pievo/` is added to `.git/info/exclude`.
- **Detached per-run worktrees.** Each work run gets `git worktree add --detach` at the managed head; the managed branch is never checked out inside a run worktree.
- **Candidate identity is a git commit.** Kept candidates fast-forward the managed branch via a compare-and-swap `update-ref` (old head must still match). Internal refs preserve evidence: `refs/pievo/candidates/<run>/<cand>` and `refs/pievo/promotions/<run>`.
- **External modification fails closed.** A dirty worktree or a moved branch head blocks the loop with `repo_conflict` and raises an inbox question (`resume_after_fix` | `archive`). The dirty-tree check also runs at promotion time — Pievo never `reset --hard`s over uncommitted human edits.

### Workspace sync-back (legacy mode only)

Managed loops promote straight to the managed branch and do not use sync-back. For **legacy** loops, when a work run produces a **new best** (a kept candidate that improves the scorecard), pievo writes that best back to the **source git repo** so results land where you work — not buried in `~/.pievo`.

```bash
pievo loop sync <name>     # manually push the current best to the source's pievo/<name> branch
```

- **git-only, zero-touch.** Only if `source_workspace` is a git repo root. pievo commits the best onto a dedicated **`pievo/<name>` branch** and **never touches your working tree, index, HEAD, or current branch** — it only creates objects and moves that one ref.
- **Frozen baseline / clean review.** Every pievo commit is rooted at `import_base` (the source `HEAD` recorded at first apply), so `git diff <import_base>..pievo/<name>` is exactly pievo's changes. Merge them when you want: `git merge pievo/<name>` does a normal 3-way merge (base = `import_base`) — your own edits since apply are combined, not reverted. pievo optimizes the imported snapshot and does not track your later commits (rebuild the loop to re-baseline).
- **Non-git source →** no auto-sync; use `pievo loop export`.
- **Disable:** `sync.enabled=false` in `config.json`. Push-to-remote / release publishing are **not** part of sync-back — model those as governed effects (quota/approval/truth).

### Run control

```bash
pievo loop run-now <name> [--target work|truth|recalibrate|repair|side:<name>] [--wait-seconds N]
pievo loop watch   <name> [--until idle|blocked|run-complete]
```

`run-now` defaults to `work`. `--target effect:<kind>` is **forbidden** (`direct_effect_dispatch_forbidden`) — effects run only from approved action ledger entries. With `--wait-seconds` it returns the result if it finishes in time, else a durable `run_id` and a `next` to `watch`/`run-show`; the run continues in its detached `pievo-worker` process either way. `watch` is durable polling and survives a daemon restart.

### Operator control (questions and effect approvals)

```bash
pievo loop questions <name> [--all]                        # open inbox items; --all includes answered/closed
pievo loop answer    <name> <question-id> <choice-or-text>
pievo loop approve-action <name> <action-ref>
pievo loop reject-action  <name> <action-ref> [--reason text]
```

Actions built from `effect_proposals` default to `awaiting_approval`; auto-approval happens only when the LoopSpec declares `spec.effects.<kind>.approval: "auto"` (the proposal itself can never grant auto). `approve-action` requires an active loop, re-checks `action_quota` at approval time, and fires execution exactly once on the awaiting→approved transition — a repeated approve (dashboard double-click) is a no-op. Approval binds to the proposal/payload hashes, and the effect result must echo them back. Answered questions are injected into subsequent runs as `args.feedback.answers` (most recent 20); `answer` rejects a question that is already answered/closed (`question_already_closed`). The dashboard drives these same verbs.

### Inspection

```bash
pievo loop list [--archived] [--status active|paused|auto_paused|blocked|archived]
pievo loop health [<name>|--all]        # compact: status, phase, generation, last runs, keep ratio, calibration health, budget, blocked reason, top audit issues
pievo loop show <name> [--runs N] [--events N] [--include-issues]
pievo loop runs <name> [--limit N]
pievo loop run-show <name> <run-id> [--include evidence|logs|diff|artifacts]
pievo loop metrics   <name> [--limit N]  # proxy + truth metric records, paired by candidate/action ref
pievo loop actions   <name> [--limit N]  # external effect lifecycle rows
pievo loop decisions <name> [--limit N]  # keep/discard/block classes
pievo loop explain   <name> <decision-id>  # reconstruct one decision: scorecard diff, evidence, gate results
pievo loop audit  <name>                 # deterministic core audit + why a phase changed
pievo loop export <name> --out <dir>     # current generation + evidence summaries; secrets redacted
```

`health` is the first thing to read when managing a loop. `decisions` + `explain` answer "why did it keep/discard that?"; `audit` answers "why did the phase change?"; `metrics` + `actions` answer "did truth arrive and pair?"; `questions` answers "what is it waiting on me for?". For loops with a truth entrypoint, `health` also reports `truth.unverified_actions` (executed effects nothing has verified yet — the daemon keeps chasing them under the `after_effects` cadence) and `truth.last_truth_completed_at`.

## Idempotent mutation

Pass `--request-id <id>` to make a mutating command safe to retry (same id = same effect). Where a race matters, add `--if-generation <n>` / `--expected-status <s>` so a stale command fails loudly instead of acting on changed state.
