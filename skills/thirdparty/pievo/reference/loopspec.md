# LoopSpec v1 reference

A LoopBundle is a directory:

```text
./pievo/loops/<name>/
  loop.json            # the LoopSpec (this file describes it)
  workflows/*.js       # entrypoint + effect + side workflows (see workflows.md)
  assets/**            # prompts, rubrics, eval scripts, docs
```

Only `loop.json`, `workflows/**/*.js`, and `assets/**` are imported into an immutable **generation**. Secret values are never imported — `spec.secrets` references env/config names only.

**No dead knobs.** If Pievo cannot enforce a spec field, the field does not exist: unenforced config is rejected or ignored at preflight rather than silently accepted. Everything documented below is enforced.

## Top-level shape

```jsonc
{
  "apiVersion": "pievo.dev/v1",
  "kind": "Loop",
  "metadata": { "name": "^[a-z0-9][a-z0-9_-]{0,63}$", "description": "…" },
  "spec": {
    "initial_status": "active",       // active | paused
    "initial_phase": "bootstrap",     // only value
    "entrypoints": { "work": {}, "recalibrate": {}, "repair": {}, "truth": {} },
    "side_workflows": {}, "effect_handlers": {}, "effects": {}, "secrets": {},
    "workspace": {}, "measurement": {}, "goals": [], "decision": {},
    "campaign": {},                     // campaign budget (time / iterations)
    "audit": {}, "contracts": {}, "retention": {}
  }
}
```

## Campaign (time / iteration budget)

```jsonc
"campaign": {
  "max_wall_minutes": 480,    // total wall time from first apply; daemon stops dispatch
  "max_iterations": 20,       // total work runs before auto_pause
  "consequence": "auto_pause" // auto_pause | block | archive
}
```

Both fields are optional. When either limit is exceeded the loop status transitions to the configured consequence and a `campaign_limit_reached` audit entry is recorded. Campaign is checked after each completed work run and during daemon tick dispatch. The timer starts from the first `apply` (`campaign_started_at`).

## Effect approval policy (`spec.effects`)

```jsonc
"effects": {
  "kaggle_submit": { "approval": "manual" },   // default: proposals wait as awaiting_approval
  "git_push":      { "approval": "auto" }      // auto-approve at proposal time (still quota/dedup/containment gated)
}
```

Actions built from `effect_proposals` default to `awaiting_approval`. Auto-approval happens **only** when the spec declares `spec.effects.<kind>.approval: "auto"` — the workflow's own proposal can never grant auto (spec policy wins), and there is no `policy` alias. Operators approve with `pievo loop approve-action <name> <action-ref>` / `reject-action`, or from the dashboard.

## Effect circuit breaker (`audit.effect_failures`)

```jsonc
"audit": {
  "effect_failures": {
    "consecutive_to_pause": 3,   // N consecutive failed effects → pause
    "pause_minutes": 60           // auto-recovery after this many minutes
  }
}
```

When an effect handler returns a failed status and the consecutive failure count reaches `consecutive_to_pause`, the circuit breaker for that effect kind engages. New proposals of that kind are blocked with `effect_circuit_breaker_active`. A successful execution resets the counter and clears the breaker.

## Verified best (scorecard)

The loop state includes `verified_best` alongside `best`:
- `best` — best local eval values (provisional)
- `verified_best` — best values confirmed by `truth` observations, with `action_ref`/`external_ref` references

`pievo loop health` returns both sections.

`metadata.name` is the loop's only identity. Applying the same name creates a new generation (an update). An archived name stays reserved until `purge`.

## Status and phase

- **status** (may anything run?): `active`, `paused` (owner stop — drain by default; `pause_kind: operator_abort` after `loop stop`), `auto_paused` (budget/resource gate), `blocked` (needs a human), `archived` (records-only).
- **phase** (which work runs while active): `bootstrap` (warmup), `stable` (normal), `calibrate` (align proxy↔truth), `loop_repair` (fix machinery). Core owns all transitions.

## Calibration mode → required sections

The mode is the pivotal choice; it decides what the bundle must contain.

| Mode | Meaning | Requires |
|---|---|---|
| `identity` | local/proxy score *is* the truth | no `truth` entrypoint, no effects needed |
| `paired` | proxy now, truth arrives later, paired by ref | `truth` entrypoint; usually effects |
| `sampled` | truth expensive/rate-limited, sampled under quota | `truth` entrypoint + `action_quota` |

Required entrypoints in every mode: `work`, `recalibrate`, `repair`.

## Entrypoints

Generic entrypoint fields: `workflow` (path), `cadence` (`{kind:"manual"|"interval", seconds}` — **cron is not supported** and is rejected at preflight with `cadence_cron_unsupported`), `overlap` (`{max_concurrent_runs, max_pending_runs, policy}` — default `coalesce_latest`, one pending), `timeout_minutes`.

The truth entrypoint additionally supports (and defaults to) `cadence: {kind:"after_effects", min_interval_minutes: 10}`: while any executed effect action remains unverified, the daemon dispatches a truth run at most once per `min_interval_minutes`; a truth observation that pairs an `action_ref` promotes that action to `observed`, which quiesces the trigger. `after_effects` on any other entrypoint is rejected at preflight (`cadence_after_effects_truth_only`). Opt out with `{kind:"manual"}`.

The work entrypoint additionally supports `dispatch_probe` — a cheap anchored script the
daemon runs at each cadence boundary **instead of** blindly dispatching, so idle loops never
wake an agent to discover there is nothing to do:

```jsonc
"work": {
  "cadence": { "kind": "interval", "seconds": 300 },
  "dispatch_probe": {
    "command": "node ${PIEVO_GENERATION_DIR}/assets/probe/debt.mjs",
    "timeout_seconds": 30,
    "eval_anchor": { "mode": "generation_asset", "paths": ["assets/probe/debt.mjs"] }
  }
}
```

- Script only, never an agent. Runs with sanitized env (no secrets, no `PIEVO_HOME`), cwd =
  the current promoted workspace, `${PIEVO_GENERATION_DIR}` / `${PIEVO_WORKSPACE_DIR}` substituted.
- Explicit exit-code protocol: **0 = no debt (skip dispatch), 10 = debt (dispatch work),
  anything else / timeout = broken** — a broken probe degrades to plain interval dispatch,
  writes a `dispatch_probe_broken` audit row, and raises a dashboard attention item.
- Anchored like core_checks (`probe_unanchored` at preflight otherwise); the daemon
  re-verifies the anchor hash before every exec. Only valid on `entrypoints.work`
  (`probe_work_only`). Probe outcomes are recorded in the schedules ledger
  (`probe_skipped` / `probe_fired` / `probe_broken`).

**work** additionally carries the trust config:

```jsonc
"work": {
  "workflow": "workflows/work.js",
  "cadence": { "kind": "interval", "seconds": 3600 },
  "overlap": { "max_concurrent_runs": 1, "max_pending_runs": 1, "policy": "coalesce_latest" },
  "bootstrap_trigger": "immediate_until_min_trials",   // | normal_cadence | manual_only
  "local_eval": {
    "required": true,
    "core_checks": [                                   // core runs these itself
      { "name": "tests", "command": "npm test", "cwd": ".", "timeout_minutes": 10,
        "metric_extractors": [ { "metric_name": "test.pass", "kind": "exit_code_zero" } ] }
    ]
  }
}
```

`metric_extractors[].kind`: `exit_code_zero` | `json_pointer` | `regex` | command-produced JSON. Core executes each `core_check` against the materialized candidate, captures the real exit code/logs, and emits the metric. **A `core_check` command and every file it transitively runs must resolve to generation-owned or `denyWrite`-protected bytes** — otherwise a candidate can rewrite its own test and self-certify. `eval_anchor.mode` must be `generation_asset`; `workspace_protected` anchors and `local_eval.reviewer_checks` are rejected at preflight (`eval_anchor_mode_invalid`, `independent_reviewer_unsupported`).

**truth** (paired/sampled): `{ workflow, cadence, timeout_minutes }`.

## Measurement and goals

```jsonc
"measurement": {
  "metrics": { "judge.quality": { "source": "local_eval", "higher_is_better": true, "calibrates_to": "xhs.engagement" } },
  "calibration": { "mode": "paired", "primary_truth_metrics": ["xhs.engagement"], "proxy_metrics": ["judge.quality"],
                   "min_pairs": 5, "min_spearman": 0.7, "warning_spearman": 0.5, "rebuild_below_spearman": 0.2, "stale_after_hours": 168 }
}
```

```jsonc
"goals": [
  { "name": "engagement", "kind": "primary", "metric_name": "xhs.engagement", "source": "truth",
    "higher_is_better": true, "epsilon": "auto", "guardrail": null, "missing_policy": "use_calibrated_proxy_if_healthy" },
  { "name": "cost", "kind": "auxiliary", "metric_name": "tokens_per_post", "source": "local_eval",
    "higher_is_better": false, "epsilon": 50, "guardrail": { "max": 4000 }, "missing_policy": "ignore" }
]
```

- Exactly one `primary` goal is required. `source`: `local_eval` | `truth` | `both`.
- `missing_policy`: `ignore` | `block` | `use_calibrated_proxy_if_healthy` | `provisional`.
- **Keep classes** core assigns: `primary_improved`, `auxiliary_improved` (no primary regression + an auxiliary gain), `provisional_auxiliary` (truth pending, capped by `decision.provisional_quota.perDay`). `tradeoff_accepted` is reserved — no decision path emits it in this build. Default rejects any primary regression.
- **Eval failure ⇒ discard**: if any required core check fails, times out, hits an anchor mismatch, or mutates the candidate workspace, all extracted metrics are discarded and the decision can only be `discard` (reason `eval_failed`).

## decision

```jsonc
"decision": { "mode": "ratchet", "allow_auxiliary_keeps": true, "provisional_quota": { "perDay": 1 } }
```

- `mode` — `"ratchet"` (default; keep only record-beating candidates) or `"gate"` (maintenance semantics; see below).
- `provisional_quota.perDay` — **enforced**: caps `provisional_auxiliary` keeps per calendar day, counted from the decisions ledger; over-quota candidates are discarded with reason `provisional_quota_exhausted`. Omit for unlimited.
- `tradeoffs[]` — **unenforced** in this build; preflight warns with `decision_knob_unenforced`. Leave it out.

### Gate mode (maintenance loops)

```jsonc
"decision": { "mode": "gate" },
"goals": [ { "name": "ci", "kind": "primary", "metric_name": "tests_failed", "source": "local_eval",
             "higher_is_better": false, "target": 0 } ]
```

For loops that maintain invariants instead of maximizing a score (dependency updates, CI
repair, doc hygiene). A candidate is kept (class `invariant_preserved`) iff **every** goal's
metric is present and meets its explicit target; there is no record to beat. Rules:

- Every goal **must** declare a `target` (`gate_goal_target_required`) with `source: local_eval`
  (`gate_goal_source_local_only`), produced by a core_check extractor (`goal_metric_unextracted`
  is an **error** in gate mode — an unmeasurable invariant means "keep everything").
- Requires `calibration.mode: identity`; `allow_auxiliary_keeps` / `provisional_quota` are
  rejected (`gate_incompatible_knob`).
- A keep must change something: a candidate whose tree is identical to its base is discarded
  with reason `no_change` — the invariant holding is not by itself a reason to occupy history.
- Effects stay gated exactly as in ratchet mode (manual approval by default, quotas, dedup).

## contracts (`oneOf` by kind)

```jsonc
"contracts": {
  "daily_submit":     { "kind": "action_quota",   "actions": ["kaggle_submit"], "perDay": 5, "consequence": "block_action" },
  "protected_eval":   { "kind": "surface", "denyRead": ["secrets/**"], "denyWrite": ["eval/**"], "consequence": "block" }
}
```

`action_quota` and `surface` are the enforced contract kinds. Quota counts approvals — including actions approved earlier in the same batch — not just prior ledgers. The `surface` contract is what makes `core_checks` trustworthy — put eval/scoring code under `denyWrite`.

## audit

```jsonc
"audit": {
  "bootstrap": { "min_trials": 3, "max_trials": 10, "allow_effects": false },
  "runtime":   { "heartbeat_interval_seconds": 60 },
  "effect_failures": { "consecutive_to_pause": 3, "pause_minutes": 60 }
}
```

That is the whole enforced audit surface: `bootstrap` (min/max trials before `stable`, whether effects may fire during bootstrap), `runtime.heartbeat_interval_seconds` (run lease heartbeats), and `effect_failures` (the circuit breaker above). Former knobs — `audit.stagnation`, `audit.turnover`, `audit.post_run`, `audit.failures`, novelty thresholds — are gone; specs that declare them are rejected/ignored at preflight rather than silently un-enforced.

## workspace, secrets, effects, retention

```jsonc
"workspace": { "source": { "required": true },
               "mounts": [ { "name": "browser", "target": ".pievo/browser", "mode": "scratch" } ] },
"secrets": { "xhs_cookie": { "source": "env", "env_var": "XHS_COOKIE" } },
"effects": { "xiaohongshu_publish": { "approval": "manual" } },
"effect_handlers": { "xiaohongshu_publish": { "workflow": "workflows/publish.js", "timeout_minutes": 10,
                     "secrets": ["xhs_cookie"], "idempotency_required": true, "approved_proposal_hash_required": true } },
"retention": { "delete_run_workspaces": true, "keep_workspaces_on": ["attention","failed","blocked"], "max_artifacts_gb": 20 }
```

Mount modes: `read_only`, `scratch` (per-run temp), `persistent` (needs explicit contract). **Isolation honesty**: until OS sandboxing ships, mount modes and read-only declarations are advisory for a bash-capable agent — the enforced boundary is post-hoc (git status/diff, eval anchor hashes, surface contracts, payload containment, CAS promotion, effect gating).

How the workspace is owned is decided at apply/adopt time, not in the spec. **Managed mode** (`pievo repo adopt`, or `loop apply --managed --branch <b>`): the loop owns a git repo; work runs in detached per-run worktrees and kept candidates fast-forward the managed branch. **Legacy mode**: the source workspace is imported once (a copy); promotion writes to the loop's copy and each new best is synced to a `pievo/<loop>` branch — landing changes upstream is a separate, manual step. Calibration holdout artifacts are retention-exempt so recalibration survives evaluator changes.

Secrets are env-sourced only. `work` entrypoints must not request secrets (`work_secrets_unsupported`); only effect/truth handlers receive their declared secrets, and secret-pattern env vars are stripped from work-agent and core-check env.

## Minimal identity example

```jsonc
{
  "apiVersion": "pievo.dev/v1", "kind": "Loop",
  "metadata": { "name": "llamacpp-qwen3-speed" },
  "spec": {
    "entrypoints": {
      "work": { "workflow": "workflows/work.js", "overlap": { "max_concurrent_runs": 1, "max_pending_runs": 1, "policy": "coalesce_latest" },
        "local_eval": {
          "required": true,
          "core_checks": [
            { "name": "bench",
              "command": "node ${PIEVO_GENERATION_DIR}/assets/eval/run_bench.mjs --workspace ${PIEVO_CANDIDATE_WORKSPACE}",
              "cwd": "${PIEVO_RUN_DIR}",
              "timeout_minutes": 10,
              "eval_anchor": { "mode": "generation_asset", "paths": ["assets/eval/run_bench.mjs"] },
              "metric_extractors": [ { "metric_name": "speed_score", "kind": "json_pointer", "file": "metrics.json", "pointer": "/speed_score" } ] } ] } },
      "recalibrate": { "workflow": "workflows/recalibrate.js", "max_attempts": 3 },
      "repair": { "workflow": "workflows/repair.js", "max_attempts": 2 }
    },
    "workspace": { "source": { "required": true } },
    "measurement": { "metrics": { "speed_score": { "source": "local_eval", "higher_is_better": true } },
                     "calibration": { "mode": "identity" } },
    "goals": [ { "name": "speed", "kind": "primary", "metric_name": "speed_score", "source": "local_eval", "higher_is_better": true, "epsilon": "auto" } ],
    "contracts": { "protect_eval": { "kind": "surface", "denyWrite": ["eval/**"], "consequence": "block" } },
    "audit": { "bootstrap": { "min_trials": 3, "max_trials": 8 } }
  }
}
```
