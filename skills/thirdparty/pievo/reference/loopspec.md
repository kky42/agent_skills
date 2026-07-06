# LoopSpec v1 reference

A LoopBundle is a directory:

```text
./pievo/loops/<name>/
  loop.json            # the LoopSpec (this file describes it)
  workflows/*.js       # entrypoint + effect + side workflows (see workflows.md)
  assets/**            # prompts, rubrics, eval scripts, docs
```

Only `loop.json`, `workflows/**/*.js`, and `assets/**` are imported into an immutable **generation**. Secret values are never imported — `spec.secrets` references env/config names only.

**No dead knobs.** If Pievo cannot enforce a spec field, the field does not exist: unenforced config is rejected at preflight or documented only in the roadmap, not as active LoopSpec surface.

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
    "campaign": {},                     // campaign budget (time / iterations / cost)
    "audit": {}, "contracts": {}
  }
}
```

## Campaign (time / iteration / cost budget)

```jsonc
"campaign": {
  "max_wall_minutes": 480,    // total wall time from first apply; daemon stops dispatch
  "max_iterations": 20,       // total work runs before auto_pause
  "max_cost_usd": 60,         // lifetime agent spend (USD) before the consequence fires
  "daily_cost_usd": 10,       // per-local-day spend cap: throttles scheduled work dispatch, resets at midnight
  "consequence": "auto_pause" // auto_pause | block | archive
}
```

All fields are optional. When `max_wall_minutes`, `max_iterations`, or `max_cost_usd` is exceeded the loop status transitions to the configured consequence and a `campaign_limit_reached` audit entry is recorded; these are checked after each completed work run and during daemon tick dispatch. The timer starts from the first `apply` (`campaign_started_at`).

Hard limits are also checked at daemon dispatch, so a resumed-but-still-exhausted loop idles rather than overspending. To restart, raise the cap with `pievo loop set-budget <name> --max-cost-usd 120` (or the dashboard Campaign **set** button) — it re-applies the current generation with the new campaign config; lifetime spend/counts are ledger projections and never reset.

`daily_cost_usd` is different: it never changes loop status. When today's spend crosses the quota the daemon stops dispatching **work** for the rest of the local day (truth/repair/side targets stay schedulable, and manual `loop run-now` bypasses it), records a single `daily_budget_deferred` schedules row, and resumes automatically when the date rolls over. "Today" is the daemon host's current local calendar day: each row's timestamp is parsed and re-rendered in the current zone, so rows written under a different offset (a traveled laptop, workflow-supplied UTC times) still bucket into the right day. If the host itself changes timezone across a day boundary the quota window shifts with it — a bounded one-day anomaly, the cost of the friendlier local-midnight reset.

How spend is measured: every agent call made through the pi backend writes session files; the runner sums their per-message `usage` (tokens + USD) and stamps the total on the run's terminal ledger row (`usage: {tokens, cost_usd, child_agents}`). Campaign totals and today's spend are projections over those rows — there is no second accumulator to drift. Runs whose agents use the `codex`/`claude` backends are not metered (their spend is invisible to this process) and count as $0; seed runs make no agent calls and are genuinely free.

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

- **status** (may anything run?): `active`, `paused` (`pause_kind: operator_abort|campaign|seed_failed|eval_dependency_drift`), `blocked` (needs a human), `archived` (records-only).
- **phase** (read projection): `bootstrap` until `run_counts.work >= audit.bootstrap.min_trials`, then `stable`. It is not stored in new `loop.json` writes.

## Calibration mode → required sections

The mode is the pivotal choice; it decides what the bundle must contain.

| Mode | Meaning | Requires |
|---|---|---|
| `identity` | the local score *is* the truth | no `truth` entrypoint, no effects needed |
| `proxy` | local score is a proxy; truth arrives later, paired by ref | `truth` entrypoint; usually effects |

Truth expensive or rate-limited? Stay in `proxy` and bound submissions with an `action_quota` contract. The former `paired`/`sampled` values are rejected at preflight (`calibration_mode_removed`).

**The calibration pair (proxy mode).** One primary metric rules the loop: the single `kind: "primary"` goal must be the truth metric (`source: "truth"`), and exactly one local metric declares `calibrates_to: "<that truth metric>"` — that proxy↔truth pair is where correlation is measured; every other metric is auxiliary. Preflight enforces the contract: exactly one primary goal (`calibration_requires_single_primary`), primary sourced from truth (`primary_goal_truth_source_required`), a resolvable unique pair (`calibration_pair_unresolved` / `calibration_pair_not_unique` / `calibrates_to_invalid`; with a single local metric the pair is derived without declaration), and `calibrates_to` is rejected outright in identity mode (`calibrates_to_identity_invalid`). Runtime pairs proxy and truth values by `candidate_id` and reports Spearman ρ over recent pairs in `loop health` → `scores` — proxy values only compare within the current `metric_eval_version`, while truth values are external reality and survive eval-version bumps.

Required entrypoint in every mode: `work`. `truth` is required for `proxy` calibration. `recalibrate` and `repair` are optional workflows.

## Entrypoints

Generic entrypoint fields: `workflow` (path), `cadence` (`{kind:"manual"|"interval", seconds}` — **cron is not supported** and is rejected at preflight with `cadence_cron_unsupported`), `timeout_minutes`.

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
- Anchored like core_checks (`probe_unanchored` at preflight otherwise): every
  anchor path must exist in the bundle, and `command` must directly invoke one
  of those files through `${PIEVO_GENERATION_DIR}`. The daemon re-verifies the
  anchor hash before every exec. Only valid on `entrypoints.work`
  (`probe_work_only`). Probe outcomes are recorded in the schedules ledger
  (`probe_skipped` / `probe_fired` / `probe_broken`).

**work** additionally carries the trust config:

```jsonc
"work": {
  "workflow": "workflows/work.js",
  "cadence": { "kind": "interval", "seconds": 3600 },
  "local_eval": {
    "required": true,
    "core_checks": [                                   // core runs these itself
      { "name": "tests",
        "command": "node ${PIEVO_GENERATION_DIR}/assets/eval/run_tests.mjs ${PIEVO_ARTIFACT_DIR}",
        "cwd": "${PIEVO_RUN_DIR}",
        "timeout_minutes": 10,
        "eval_anchor": { "mode": "generation_asset", "paths": ["assets/eval/run_tests.mjs"] },
        "metric_extractors": [ { "metric_name": "test.pass", "kind": "exit_code_zero" } ] }
    ]
  }
}
```

`metric_extractors[].kind`: `exit_code_zero` | `json_pointer` | `regex` | command-produced JSON. Core executes each `core_check` against the materialized candidate, captures the real exit code/logs, and emits the metric. **A `core_check` command must invoke a generation-owned evaluator via `${PIEVO_GENERATION_DIR}/...`** — otherwise a candidate can rewrite its own test and self-certify. `eval_anchor.mode` must be `generation_asset`; `workspace_protected` anchors and `local_eval.reviewer_checks` are rejected at preflight (`eval_anchor_mode_invalid`, `independent_reviewer_unsupported`). Keep `cwd` outside the candidate workspace, normally `${PIEVO_RUN_DIR}`; the evaluator should read candidate files through `PIEVO_CANDIDATE_WORKSPACE` and write metrics under `${PIEVO_ARTIFACT_DIR}`, because extractor `file` paths are artifact-relative. If a scored candidate proposes an external payload, the same anchored evaluator must be able to independently reproduce or byte-verify those submitted bytes; `artifact://...` refs are the preferred way to bind the payload to the core check output. For data or environment the eval depends on but that lives OUTSIDE the bundle, declare `measurement.eval_dependencies` (see Measurement) — same freeze-and-verify discipline, extended past the bundle boundary.

**truth** (proxy mode): `{ workflow, cadence, timeout_minutes }`.

## Measurement and goals

```jsonc
"measurement": {
  "metrics": {
    "judge.quality":   { "source": "local_eval", "higher_is_better": true, "calibrates_to": "xhs.engagement" },
    "xhs.engagement":  { "source": "truth", "higher_is_better": true }
  },
  "calibration": { "mode": "proxy" },
  "eval_dependencies": [
    { "name": "valset", "kind": "files", "paths": ["~/pievo-data/comp/val_v3"] },
    { "name": "toolchain", "kind": "fingerprint", "command": "python -V 2>&1", "timeout_seconds": 30 }
  ]
}
```

**`eval_dependencies`** — declare every input OUTSIDE the bundle that the local-eval score depends on: local datasets (`kind: "files"`, paths hashed, `~` expands), or anything a short command can fingerprint — a data manifest, a DB watermark, the toolchain version (`kind: "fingerprint"`, trimmed stdout is the fingerprint; runs with cwd = generation dir, sanitized env, no workspace placeholder — it must be a pure probe). Names must be unique; half-declared entries are rejected at preflight (`eval_dependency_*`). Semantics:

- **Apply freezes** the fingerprints into the manifest and folds them into `metric_eval_version` — changing the data and re-applying mints a new eval version (label `yyyy.mm.dd`, then `.1`, `.2`… same-day; identical content re-uses its existing label, so a no-op apply never resets the baseline).
- **The daemon re-verifies before dispatching work**: drift → the loop is `paused` with `pause_kind: "eval_dependency_drift"` and an audit row — no agent runs are burned into guaranteed discards.
- **Core eval re-verifies before and after every evaluation**: drift → the eval fails closed (`eval_dependency_drift`, zero metrics), including a mid-eval swap by the candidate (TOCTOU).
- **Recovery**: `pievo loop refreeze <name>` re-applies the current bundle, accepting the new data as a new eval version; the scorecard baseline resets and a **seed run** re-scores the incumbent workspace (identity candidate, no agent) so new candidates compete against the old champion's fresh score, not an empty board. The seed is fail-closed: while it is pending, regular work dispatch is refused (`seed_baseline_pending`), and a seed whose eval fails pauses the loop with `pause_kind: "seed_failed"` plus a `seed_failed` audit row — `resume` re-dispatches the seed automatically (the pending flag is consumed only by a seed that lands its keep); crashes retry on their own.

Scored eval data should change rarely; if you are refreezing often, that input belongs to truth or training, not local eval.

```jsonc
"goals": [
  { "name": "engagement", "kind": "primary", "metric_name": "xhs.engagement", "source": "truth",
    "higher_is_better": true, "epsilon": "auto", "missing_policy": "use_calibrated_proxy_if_healthy" },
  { "name": "cost", "kind": "auxiliary", "metric_name": "tokens_per_post", "source": "local_eval",
    "higher_is_better": false, "epsilon": 50, "missing_policy": "ignore" }
]
```

- Exactly one `primary` goal is required. `source`: `local_eval` | `truth`.
- `auxiliary` goals are opportunistic secondary metrics. They can produce `auxiliary_improved` when primary goals are not worse, but they are not hard constraints and must not be used as runtime/cost guardrails.
- `missing_policy`: `ignore` | `block` | `use_calibrated_proxy_if_healthy` | `provisional`.
- **Keep classes** core assigns: `primary_improved`, `auxiliary_improved` (no primary regression + an auxiliary gain), `provisional_auxiliary` (truth pending, capped by `decision.provisional_quota.perDay`), `invariant_preserved` (gate mode). Default rejects any primary regression.
- **Eval failure ⇒ discard**: if any required core check fails, times out, hits an anchor mismatch, or mutates the candidate workspace, all extracted metrics are discarded and the decision can only be `discard` (reason `eval_failed`).

## decision

```jsonc
"decision": { "mode": "ratchet", "allow_auxiliary_keeps": true, "provisional_quota": { "perDay": 1 } }
```

- `mode` — `"ratchet"` (default; keep only record-beating candidates) or `"gate"` (maintenance semantics; see below).
- `provisional_quota.perDay` — **enforced**: caps `provisional_auxiliary` keeps per calendar day, counted from the decisions ledger; over-quota candidates are discarded with reason `provisional_quota_exhausted`. Omit for unlimited.
- `tradeoffs[]` — not supported in this build; preflight warns with `decision_knob_unenforced`. Leave it out.

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
- Observability: `loop health` → `scores.gate` (and the dashboard Scores box) reports each
  invariant's current value vs target with holding/broken status, a recent per-candidate ✓/✗
  history, and the last violation — gate loops have no "best" to show.

## contracts (`oneOf` by kind)

```jsonc
"contracts": {
  "daily_submit":     { "kind": "action_quota",   "actions": ["kaggle_submit"], "perDay": 5, "consequence": "block_action" },
  "protected_surface": { "kind": "surface", "denyWrite": ["eval/**"], "consequence": "block" }
}
```

`action_quota` and `surface` are the enforced contract kinds. Quota counts each action on its first charged lifecycle row (`approved`, `executing`, `executed`, `observed`, or `unknown_outcome`) — including actions approved earlier in the same batch — not just prior ledgers. Historical `unknown` rows are normalized to `unknown_outcome`. Later rows for the same `action_ref` do not move that action into another day's quota.

`surface.denyWrite[]` is a candidate-workspace-relative write-surface guard. Pievo adds the protected patterns to work-agent instructions, snapshots matching files/directories before and after the work workflow, and discards the candidate with `surface_deny_write_violation` if anything matching was created, modified, or deleted. This is not a read sandbox: `denyRead` is unsupported and rejected at preflight. Keep secrets outside candidate workspaces and generation assets. `denyWrite` protects accepted candidates and reviewability; it does not prove a process never wrote and restored a file during execution.

## audit

```jsonc
"audit": {
  "bootstrap": { "min_trials": 3, "allow_effects": false },
  "runtime":   { "heartbeat_interval_seconds": 60 },
  "effect_failures": { "consecutive_to_pause": 3, "pause_minutes": 60 }
}
```

That is the whole enforced audit surface: `bootstrap.min_trials` (when phase projects to `stable`), `bootstrap.allow_effects` (whether effects may fire during bootstrap), `runtime.heartbeat_interval_seconds` (run lease heartbeats), and `effect_failures` (the circuit breaker above). Former knobs — `audit.stagnation`, `audit.turnover`, `audit.post_run`, `audit.failures`, novelty thresholds — are gone; specs that declare them are rejected/ignored at preflight rather than silently un-enforced.

## workspace, secrets, effects

```jsonc
"workspace": {},
"secrets": { "xhs_cookie": { "source": "env", "env_var": "XHS_COOKIE" } },
"effects": { "xiaohongshu_publish": { "approval": "manual" } },
"effect_handlers": { "xiaohongshu_publish": { "workflow": "workflows/publish.js", "timeout_minutes": 10,
                     "secrets": ["xhs_cookie"] } }
```

How the workspace is owned is decided at apply/adopt time, not in the spec. **Managed mode** (`pievo repo adopt`, or `loop apply --managed --branch <b>`): the loop owns a git repo; work runs in detached per-run worktrees and kept candidates fast-forward the managed branch. **Imported-copy mode**: the source workspace is copied once into `PIEVO_HOME`; promotion writes to that loop-owned copy, and export is the only built-in way to move results elsewhere. Calibration holdout artifacts are retention-exempt so recalibration survives evaluator changes.

Secrets are env-sourced only. `work` entrypoints must not request secrets (`work_secrets_unsupported`); only effect/truth handlers receive their declared secrets, and secret-pattern env vars are stripped from work-agent and core-check env.

## Minimal identity example

```jsonc
{
  "apiVersion": "pievo.dev/v1", "kind": "Loop",
  "metadata": { "name": "llamacpp-qwen3-speed" },
  "spec": {
    "entrypoints": {
      "work": { "workflow": "workflows/work.js",
        "local_eval": {
          "required": true,
          "core_checks": [
            { "name": "bench",
              "command": "node ${PIEVO_GENERATION_DIR}/assets/eval/run_bench.mjs --workspace ${PIEVO_CANDIDATE_WORKSPACE}",
              "cwd": "${PIEVO_RUN_DIR}",
              "timeout_minutes": 10,
              "eval_anchor": { "mode": "generation_asset", "paths": ["assets/eval/run_bench.mjs"] },
              "metric_extractors": [ { "metric_name": "speed_score", "kind": "json_pointer", "file": "metrics.json", "pointer": "/speed_score" } ] } ] } },
      "recalibrate": { "workflow": "workflows/recalibrate.js" },
      "repair": { "workflow": "workflows/repair.js" }
    },
    "workspace": {},
    "measurement": { "metrics": { "speed_score": { "source": "local_eval", "higher_is_better": true } },
                     "calibration": { "mode": "identity" } },
    "goals": [ { "name": "speed", "kind": "primary", "metric_name": "speed_score", "source": "local_eval", "higher_is_better": true, "epsilon": "auto" } ],
    "contracts": { "protect_eval": { "kind": "surface", "denyWrite": ["eval/**"], "consequence": "block" } },
    "audit": { "bootstrap": { "min_trials": 3 } }
  }
}
```
