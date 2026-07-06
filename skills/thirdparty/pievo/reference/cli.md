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
  "next": []             // recommended follow-ups: {kind: command|wait|edit|ask, command?, reason?, after_seconds?}
}
```

Read in this order: `ok` → if false, `diagnostics[].code` (stable snake_case) tells you what to fix → `data` → `next[]` suggests the follow-up command. Do not judge outcomes from a workflow's prose; judge from `data` and the ledgers.

There is no durable operator-question surface. Operator-visible work is projected
from loop status and action state, then handled with typed verbs such as
`approve-action`, `reject-action`, `resolve-action`, `refreeze`, and `apply`.

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
                                  # PIEVO_HOME/upgrade.json (upgrading→restarting→resuming→done, or
                                  # recovering→failed — a failed upgrade still restarts the current version
                                  # and resumes loops: roll-forward).
                                  # config.daemon.upgrade_command overrides the npm command; config.daemon.tick_seconds
                                  # sets the scheduler tick (default 30).
pievo doctor                     # environment + state-root health (flags synced/networked PIEVO_HOME)
pievo help
```

Mutating loop commands (`apply`, `run-now`, lifecycle changes) are routed to the daemon over local IPC. If the daemon is unavailable, they return `daemon_required` with a `next` action; start it or explicitly set `PIEVO_ALLOW_LOCAL_MUTATIONS=1` for local-only mutation.

Daemon-dispatched runs execute in detached `pievo-worker` processes (their own process group), so a daemon restart or crash never kills in-flight runs; leases + heartbeats + pid liveness recover abandoned runs afterwards. Two upgrade stories: **rolling** — `pievo daemon restart` after installing the new version (in-flight workers finish under the old code, new runs get new code); **clean-stop** — `pievo daemon upgrade` (or the dashboard button) for the fully automated stop-all → npm → bounce → gated-resume flow when you don't want mixed versions. `daemon status` reports the daemon's package version so you can spot version skew.

#### Web dashboard

`pievo daemon start` also brings up the **web dashboard — the operator console**, with two sections: **Loops** (cards overview + per-loop runs/metrics/decisions/actions/audit/events) and **Logs** (daemon log tail, credentials scrubbed). Everything needing operator eyes lives on the loop cards: status badges with the stuck reason, plus chips for effects awaiting approval ✋, unknown-outcome/blocked actions, engaged circuit breakers, truth debt, and draining effects — all handled inside the loop page. Runs that carry error diagnostics get a ⚠ marker in the runs tab; click the run for the full details. Each loop page shows a **Scores** box — eval ver + calibration mode up top; in proxy mode the best VERIFIED primary score with the proxy value that predicted it, Spearman ρ over recent proxy↔truth pairs, and a recent-candidates table (pending = not yet verified) with expandable auxiliary scores; identity mode shows the best local score; gate (maintenance) loops show per-goal invariant status (current vs target, ✓ holding / ✗ broken, last violation); loops with no scored goals fall back to the latest work run's check results — plus a **Campaign** box with lifetime tokens (K/M/B), lifetime spend vs `max_cost_usd`, and today's spend vs `daily_cost_usd` (spend turns red at the quota). The runs tab lists per-run duration, tokens, and cost. It also mutates: **start / pause / stop now** per loop and matching **start / pause / stop** fleet buttons (each double-confirms; fleet stop is the emergency interrupt that reaches paused loops too), per-run **stop** on running work-class runs, approve/reject effect actions, resolve unknown-outcome actions, refreeze, and budget changes — authorized POSTs over the same durable ledgers as the CLI, so both stay in sync. The header **upgrade** button narrates the lifecycle: `upgrade → vX.Y.Z` when the npm registry has a newer version, `upgrading… (state)` while in flight (unclickable), `upgrade failed — retry` after a failure, `up to date` otherwise.

- **Open it**: `pievo daemon status` returns `data.daemon.dashboard = { enabled, host, port, url, token, require_token }`. Open `url` in a browser.
- **Auth**: a **loopback bind (default `127.0.0.1`) needs no token for reads or mutations** — the URL is just `http://127.0.0.1:4319/` — because the socket is only reachable from the same host, and spoofed `Host` / mismatched `Origin` headers are rejected so DNS-rebinding can't bypass it. A **non-loopback bind requires a token for everything**, and `url` then embeds it, so LAN exposure stays gated.
- **LAN access**: `pievo daemon start --dashboard-host 0.0.0.0`. Set a **memorable, stable token** to reuse across restarts with `--dashboard-token <secret>`, `dashboard.token` in `config.json`, or `PIEVO_DASHBOARD_TOKEN`; otherwise a random token is generated each start. A loopback bind can still be reached remotely via an SSH tunnel.
- **Disable / configure**: `--no-dashboard` (or `dashboard.enabled=false`). `config.json` accepts `dashboard: { enabled, host, port, token }`; `PIEVO_DASHBOARD_ENABLED|HOST|PORT|TOKEN` env vars and `--dashboard-host|--dashboard-port|--dashboard-token|--no-dashboard` flags override it. The active token lives only in `control.json`.

### Author / lifecycle

```bash
cp -r "$(npm root -g)/@kky42/pievo/examples/<demo|kaggle-runtime|release-publish>" <dir>   # start from a bundled example; edit loop.json (metadata.name at minimum)
pievo loop preflight <bundle-dir> [--workspace <path>]      # pure validation; repeat until ok:true
pievo repo adopt     <bundle-dir> [--workspace <repo>] [--branch main]   # managed mode (recommended); --workspace defaults to cwd
pievo loop apply     <bundle-dir> [--workspace <path>] [--managed --branch <b>] [--wait-seconds N]
pievo loop pause   <name>            # == stop: kill work-class workers (their keeps are fail-closed anyway), DRAIN in-flight effects, pause
pievo loop stop    <name> [--now]    # same verb; --now is the emergency breaker: effects are killed too → their actions become
                                     # unknown_outcome (verify externally, then resolve-action happened|failed)
pievo loop stop    --all [--now]     # fleet pause; skips non-active loops (--now reaches paused/blocked too — emergency)
pievo loop refreeze <name>           # eval_dependencies drifted: re-freeze current data as a NEW eval version (yyyy.mm.dd[.n]),
pievo loop set-budget <name> [--max-iterations N|none] [--max-wall-minutes M|none] [--max-cost-usd X|none] [--daily-cost-usd Y|none] [--consequence auto_pause|block|archive]   # adjust campaign budgets by re-applying the current generation (spend never resets; campaign-paused loops resume)
                                     # reset the scorecard baseline, queue a seed run, resume
pievo loop resume  <name>            # sets active and clears pause_kind/pause_reason
pievo loop resume  --all             # resumes ONLY loops with pause_kind=operator_abort; other pauses/blocked are skipped with reasons
pievo loop cancel-run <name> <run-id> # kill ONE running work-class run; the loop keeps going. Effects refuse (effect_cancel_unsupported)
                                     # — use stop --now. A canceled run can never land a keep at finalize (run_canceled).
pievo loop archive <name>                                   # records-only; name stays reserved; refuses while live runs exist
pievo loop purge   <name>                                   # deletes state; frees the name (archived loops only, no live workers)
```

**Examples, not scaffolds.** There is no scaffold command. The package ships complete, preflight-green LoopBundles under `examples/` — copy one and edit `loop.json` directly (the agent authors specs; preflight is the guardrail). `demo` is a minimal identity loop; `kaggle-runtime` shows score-preserving runtime optimization with proxy calibration and a quota-gated `kaggle_submit` effect (rename the effect kind for non-Kaggle uses); `release-publish` shows governed delivery (`git_push`/`npm_publish` behind manual approval and quota).

`apply` on an existing name creates a new generation (update). During an active run it should not publish a stale generation.

**One loop per repo.** A given source directory can back **only one live loop** — applying a second loop with the same `--workspace` fails with `source_repo_already_bound` (archive/purge the first, or point elsewhere). One loop already optimizes multiple goals (primary + auxiliary), so this isn't limiting. There are two workspace modes:

- **Managed (recommended).** `pievo repo adopt` (sugar for `loop apply --managed`) makes Pievo the repo-owning writer: kept candidates are promoted as commits onto the repo's canonical **managed branch**. See below.
- **Imported copy.** `loop apply --workspace <path>` without `--managed`: the workspace is imported (copied, `.git` stripped) into `~/.pievo/loops/<name>/workspace`. Use `pievo loop export` to inspect or move results; sync-back was removed.

### Managed repo mode

- **Adoption requires a clean git repo root** (`managed_repo_requires_git_root`, `managed_repo_dirty`); the managed branch defaults to the current branch (or `--branch`). `.pievo/owner.json` is written repo-locally and `.pievo/` is added to `.git/info/exclude`.
- **Detached per-run worktrees.** Each work run gets `git worktree add --detach` at the managed head; the managed branch is never checked out inside a run worktree.
- **Candidate identity is a git commit.** Kept candidates fast-forward the managed branch via a compare-and-swap `update-ref` (old head must still match). Internal refs preserve evidence: `refs/pievo/candidates/<run>/<cand>` and `refs/pievo/promotions/<run>`.
- **External modification fails closed.** A dirty worktree or a moved branch head blocks the loop with `repo_conflict`. The dirty-tree check also runs at promotion time — Pievo never `reset --hard`s over uncommitted human edits.

### Imported-copy mode

Imported-copy loops never write back to the source directory. The source path is only an import seed; the evolving workspace lives under `PIEVO_HOME`. Use `pievo loop export <name> --out <dir>` to inspect or move the current loop state. Push-to-remote / release publishing should be modeled as governed effects with quota, approval, and truth verification.

### Run control

```bash
pievo loop run-now <name> [--target work|truth|recalibrate|repair|side:<name>] [--seed] [--wait-seconds N]
pievo loop watch   <name> [--until idle|blocked|run-complete]
```

`run-now` defaults to `work`. `--seed` (work only) runs an **identity candidate**: no workflow, no agent — the incumbent workspace is re-scored through core eval + decision to establish the baseline under the current eval version (the daemon queues one automatically after an eval-version bump via `seed_pending`). The seed is fail-closed: while `seed_pending` is set, non-seed work dispatch is refused (`seed_baseline_pending`) so candidates never compete against an empty scoreboard; the flag is consumed only by a seed that lands its keep, and a deterministically failing seed pauses the loop with `pause_kind: "seed_failed"` plus a `seed_failed` audit row (`resume` re-seeds automatically; a fixed re-apply handles a broken eval; crashes retry on their own). `--target effect:<kind>` is **forbidden** (`direct_effect_dispatch_forbidden`) — effects run only from approved action ledger entries. With `--wait-seconds` it returns the result if it finishes in time, else a durable `run_id` and a `next` to `watch`/`run-show`; the run continues in its detached `pievo-worker` process either way. `watch` is durable polling and survives a daemon restart.

### Operator Control

```bash
pievo loop approve-action <name> <action-ref>
pievo loop reject-action  <name> <action-ref> [--reason text]
pievo loop resolve-action <name> <action-ref> <happened|failed> [--external-ref ref] [--evidence-ref ref]
```

Actions built from `effect_proposals` default to `awaiting_approval`; auto-approval happens only when the LoopSpec declares `spec.effects.<kind>.approval: "auto"` (the proposal itself can never grant auto). `approve-action` requires an active loop, re-checks `action_quota` at approval time, and fires execution exactly once on the awaiting→approved transition — a repeated approve (dashboard double-click) is a no-op. Approval binds to the proposal/payload hashes, and the effect result must echo them back. `resolve-action` is only for executed or `unknown_outcome` actions: `happened` records that the external action happened and keeps truth debt alive, optionally adding `external_ref`/`evidence_ref` as pairing keys; `failed` records that an unknown outcome did not happen or failed. Metric values never enter through `resolve-action`; they enter through truth observations. `apply` rejects all not-yet-started pending actions from prior generations with `stale_generation`.

### Inspection

```bash
pievo loop list [--archived] [--status active|paused|blocked|archived]
pievo loop health [<name>|--all]        # compact: status, phase, generation, last runs, keep ratio, calibration health, budget, blocked reason, top audit issues
pievo loop show <name> [--runs N] [--events N]
pievo loop runs <name> [--limit N]
pievo loop run-show <name> <run-id> [--include evidence|logs|diff|artifacts]
pievo loop metrics   <name> [--limit N]  # proxy + truth metric records, paired by candidate/action ref
pievo loop actions   <name> [--limit N]  # external effect lifecycle rows
pievo loop decisions <name> [--limit N]  # keep/discard/block classes
pievo loop explain   <name> <decision-id>  # reconstruct one decision: scorecard diff, evidence, gate results
pievo loop audit  <name>                 # deterministic core audit and campaign/eval events
pievo loop export <name> --out <dir>     # diagnostic archive; treat as sensitive
```

`health` is the first thing to read when managing a loop. `decisions` + `explain` answer "why did it keep/discard that?"; `audit` answers "what control/eval/campaign event happened?"; `metrics` + `actions` answer "did truth arrive and pair, and what needs operator action?". For loops with a truth entrypoint, `health` also reports `truth.unverified_actions` (executed effects nothing has verified yet — the daemon keeps chasing them under the `after_effects` cadence) and `truth.last_truth_completed_at`.

## Mutation guards

Where a race matters, add `--if-generation <n>` / `--expected-status <s>` so a stale command fails loudly instead of acting on changed state.
