---
name: pievo
description: "pievo loops — design, build, and operate durable metric-driven optimization loops through the installed pievo CLI. Use when the user wants a self-improving loop created, optimized, or managed (Kaggle/benchmark tuning, content growth with real-engagement truth, model hyperparameter search, runtime-cost reduction), mentions pievo / `pievo loop` / a LoopBundle, or needs help turning a fuzzy optimization goal into a sound loop design."
---

# pievo

**pievo** runs **durable metric-driven loops** — repeatedly generate candidates, evaluate them against declared goals, keep the winners, and repeat. The loop runs as a daemon; you drive it through the `pievo` CLI.

```bash
npm install -g @kky42/pievo
pievo doctor          # verify installation
pievo daemon start    # start the background daemon
pievo daemon status   # is it running?
```

Every CLI command prints **one JSON envelope** to stdout. Parse that, not prose.

---

## Core concepts (what you need to understand)

### Loop

A loop is a named, persistent optimization process. It has:
- a **status**: `active` / `paused` (drain; `pause_kind: operator_abort` after `loop stop`) / `auto_paused` / `blocked` / `archived`
- a **phase**: `bootstrap` (warmup, exploring) → `stable` (normal) → maybe `calibrate` / `loop_repair`
- a **generation number**: each time you apply an updated bundle, the generation increments
- state files under `PIEVO_HOME/loops/<name>/` — ledgers, runs, generations, scorecard

### LoopBundle

A LoopBundle is a directory that defines one loop. It's what you author and apply:

```text
pievo/loops/<name>/
  loop.json               # the spec
  workflows/work.js       # required: propose candidates
  workflows/recalibrate.js  # required: check calibration health
  workflows/repair.js       # required: fix mechanical issues
  workflows/truth.js        # needed for paired/sampled calibration
  workflows/<effect>.js    # only if external effects exist
  assets/**                 # eval scripts, prompts, config files
```

### Repo modes (where results land)

| Mode | How you create it | Where results land |
|---|---|---|
| **managed** (recommended) | `pievo repo adopt <bundle> --workspace <repo> --branch main` (or `loop apply --managed`) | Kept candidates become git commits; promotion fast-forwards the repo's managed branch |
| **legacy** | `pievo loop apply <bundle> --workspace <path>` | Workspace imported as a copy; each new best synced to a `pievo/<loop>` branch |

Managed mode requires a clean git repo root. Work runs execute in detached per-run worktrees, candidates/promotions are preserved on internal refs (`refs/pievo/candidates/<run>/<cand>`, `refs/pievo/promotions/<run>`), and any external modification (dirty tree or moved branch head) blocks the loop with `repo_conflict` plus an inbox question — Pievo never `reset --hard`s over uncommitted human edits. `.pievo/owner.json` is written repo-locally and `.pievo/` is added to `.git/info/exclude`. One loop per repo.

### Workflow types

| Workflow | When it runs | What it does |
|---|---|---|
| **work** | Each iteration | Propose one candidate change. Must call `agent()` to generate ideas, not hardcode. |
| **truth** | Auto after effects | Pull real-world observations (Kaggle LB score, engagement metrics) and pair them back to candidate/action refs. Default cadence is `after_effects`: the daemon keeps dispatching truth (min every `min_interval_minutes`, default 10) while any executed effect is still unverified; pairing marks the action `observed` and the chase stops. Also runnable manually via `run-now`. |
| **recalibrate** | Manual | Check proxy↔truth alignment is still healthy. |
| **repair** | On failure | Fix broken machinery — evaluator, data pipeline, workflow issues. |
| **effect** | After approval | Execute an approved external action (submit to Kaggle, publish a post). |

### External effects and why they're gated

An **external effect** is an action that affects the real world — Kaggle submission, social media publish, API call that costs money. These are **gated** because:

- they consume quota / budget
- they can't be rolled back
- they leave records in your name

The separation is enforced structurally:
- **work** may only *propose* effects (`effect_proposals: [{kind: "kaggle_submit", ...}]`)
- proposals land as **`awaiting_approval` actions** — an operator approves via `pievo loop approve-action <name> <action-ref>` / `reject-action` or the dashboard, unless the LoopSpec declares `spec.effects.<kind>.approval: "auto"` (the proposal itself can never grant auto; spec policy wins)
- only the **effect handler** (a separate workflow) executes the approved action, after core checks quota, dedup, idempotency, and payload containment (`payload_ref` must stay inside the run — relative or `workspace://`/`artifact://`; escaping, absolute, or missing payloads block the action; approved payloads are snapshotted and hash-bound)
- direct dispatch is forbidden: `run-now --target effect:<kind>` fails with `direct_effect_dispatch_forbidden`

Work agents do not receive effect secrets or `PIEVO_HOME`, and secret-pattern env vars are stripped from work-agent and core-check env. Effect/truth handlers receive only their declared secrets.

### Core evaluation (why the work can't grade itself)

When `work` finishes, Pievo **core** runs the declared `core_checks[]` — anchored evaluator scripts from the **generation-owned** assets directory. The candidate cannot rewrite these scripts (they're protected). Core captures:

- candidate hash (tree hash of workspace before eval)
- script hash
- exit code, stdout/stderr artifacts
- extracted metrics via `metric_extractors`

The workflow/subagent output is **advisory only** for scoring/keep decisions. Core evidence decides. **Eval failure ⇒ discard**: if any core check fails, times out, hits an anchor mismatch, or mutates the workspace, all extracted metrics are discarded and the decision can only be `discard` (reason `eval_failed`).

Until OS sandboxing ships, isolation for bash-capable agents is post-hoc enforcement — git status/diff, eval anchor hashes, surface contracts, payload containment, CAS promotion, effect gating — not a security boundary. No security theater.

### Calibration modes

How do you know your local metric reflects real-world performance?

| Mode | Meaning | Requires |
|---|---|---|
| `identity` | Local score IS the truth (e.g., benchmark speed) | Nothing extra |
| `paired` | Local score now, external truth arrives later, paired by submission/action ref | truth workflow, effect handler |
| `sampled` | Truth is expensive/rate-limited; sample a subset under quota | truth workflow + action_quota contract |

### Scorecard and decisions

After each work run, core makes a decision per candidate:

| Decision class | Meaning |
|---|---|
| `primary_improved` | Primary metric improved (or met target) |
| `auxiliary_improved` | Primary unchanged, auxiliary metric better |
| `provisional_auxiliary` | Truth pending, kept provisionally — capped by `decision.provisional_quota.perDay` (over-quota candidates are discarded with `provisional_quota_exhausted`) |
| `invariant_preserved` | Gate mode (`decision.mode: "gate"`) only: every goal met its explicit target — maintenance work lands without beating any record. Identical-tree candidates are still discarded (`no_change`) |
| `discard` | Didn't meet goals |
| `tradeoff_accepted` | Reserved — no decision path emits it yet; preflight warns if `decision.tradeoffs` is configured |

The **scorecard** tracks `best` values per metric — what's the best local score, best runtime, best verified LB score.

---

## The full CLI reference

See [`reference/cli.md`](reference/cli.md) for every command. The most important ones day-to-day:

```bash
# Setup (presets are templates: kaggle-runtime | runtime-cost | release-publish)
pievo loop scaffold --preset kaggle-runtime --name <name> --baseline-score <score> --target-runtime-seconds <seconds> --out ./pievo/loops/<name>
pievo loop preflight ./pievo/loops/<name> --workspace <path>
pievo repo adopt     ./pievo/loops/<name> --workspace <repo> --branch main   # managed mode (clean git repo root)
pievo loop apply     ./pievo/loops/<name> --workspace <path>                 # legacy copy mode
pievo loop health    <name>

# Running
pievo loop run-now <name> --target work --wait-seconds <N>
pievo loop watch   <name> --until idle

# Operator control
pievo loop pause  <name>            # drain: no new dispatch; in-flight run finishes, cannot promote/fire effects
pievo loop stop   <name>            # abort: kills the run's worker process groups
pievo loop resume <name>
pievo loop questions <name> [--all]
pievo loop answer <name> <question-id> <choice-or-text>
pievo loop approve-action <name> <action-ref>
pievo loop reject-action  <name> <action-ref> [--reason <text>]

# Inspection
pievo loop health      <name>
pievo loop runs        <name> --limit 10
pievo loop metrics     <name> --limit 20
pievo loop decisions   <name> --limit 20
pievo loop actions     <name> --limit 20
pievo loop explain     <name> <decision-id>
```

Every loop command returns a JSON envelope. Read `ok` first, then `data`, `diagnostics[]`, `questions[]`, `next[]`.

The **dashboard** (served by `pievo daemon start`, URL in `pievo daemon status`) is the operator console: it shows loops/runs/metrics/decisions/actions plus a "needs attention" panel, and drives the same verbs — pause/stop/resume, approve/reject actions, answer questions, free-form feedback. Answered questions and feedback flow into the next runs as `args.feedback.answers`.

---

## Translating a user's domain goal to a Pievo loop

A user typically says things like:

> "I have a Kaggle submission with public score 7800.94. The LB runtime is 30 minutes — too close to timeout. I want to reduce runtime to 20 minutes without dropping score."

Or:

> "I'm running llama.cpp benchmarks on my Mac. I want to automatically try different configurations and keep the fastest one that still passes my quality floor."

### How to map to Pievo concepts

1. **What's the primary metric?** → `score` / `accuracy` / `speed_score` → `primary` goal
   - Must it not regress? → set `target` on the primary goal
   - **Noisy metric (benchmarks, timing)?** Do NOT set `target` to a single-sample
     baseline — run-to-run variance (~1-2% for llama-bench-style timing) will
     discard genuinely better candidates at the line. Measure baseline and
     candidates as a median of repeats, leave `target` off (record-based keeps:
     beat the current best), and use `epsilon` to absorb noise.
   - **Goals must measure the user's outcome, never the loop's own activity.**
     Iteration counts, runs completed, candidates produced and similar counters
     are self-satisfying: they "improve" whenever the loop runs, so every run
     looks like progress while the real objective goes nowhere. If you cannot
     name a metric the *user* would celebrate, stop and ask — do not invent one.
     (Goal changes on generation updates are audited as `goals_changed` and
     surfaced on the dashboard; a 100% keep streak also raises attention.)
   - **Maintaining an invariant instead of maximizing?** (deps current, CI green,
     docs build) → `decision.mode: "gate"` with an explicit `target` per goal;
     candidates land when every target holds (`invariant_preserved`).
2. **What else matters?** → runtime, cost, token count → `auxiliary` goals
3. **How do you measure?** → script you run → becomes a `core_check`
   - Can you trust it locally? → `identity` mode
   - Or do you need external truth? → `paired` / `sampled` mode
4. **What external actions are needed?** → Kaggle submit, publish, deploy → `effect_handler`
   - How many per day? → `action_quota` contract
5. **What constraints?** → "each run ≤ 600s", "don't change eval code" → `contracts.surface`, `guardrail`, `timeout_minutes`
6. **How long should this run?** → `campaign.max_wall_minutes` / `campaign.max_iterations` — limits met automatically pauses the loop
7. **Should it idle cheaply?** (long-lived maintenance loops) → `entrypoints.work.dispatch_probe` — an anchored script the daemon runs each cadence boundary; work is dispatched only when the probe exits 10 ("debt present"), so no agent wakes up just to find nothing to do

### Example mapping: Kaggle runtime optimization

| User says | Pievo equivalent |
|---|---|
| "Score 7800.94, don't regress" | `primary` goal `local_score`, `source: local_eval`, `target: 7800.94` |
| "Reduce runtime from 30min to 20min" | `auxiliary` goal `local_runtime_seconds`, `higher_is_better: false`, `target: 1200` |
| "Local eval script measures score + runtime" | `core_check` with `eval_anchor` on generation-owned script |
| "Submit to Kaggle to verify" | `effect_handler: kaggle_submit` with `action_quota`; `truth` workflow pulls LB |
| "Don't change the eval script" | `surface` contract `denyWrite: ["eval/**"]` |
| "Each work run has 2 hours max" | `timeout_minutes: 120` on work entrypoint |

---

## Workflow authoring essentials

Workflows are `@kky42/pi-flow` scripts. Full reference: [`reference/workflows.md`](reference/workflows.md).

Key rules:
- First line: `export const meta = { name: '...', description: '...' }`
- Available globals: `agent`, `parallel`, `pipeline`, `log`, `phase`, `args`, `cwd`
- NOT available: `import`, `require`, `fs`, `child_process`, `process.env`, `Date`, `Math.random`
- Input via `args` (target info, run context, workspace paths, `feedback.answers` with answered operator questions)
- Output via top-level `return`
- Every result must set `target_kind` matching the dispatched target (`work`/`truth`/`recalibrate`/`repair`/`side`/`effect`) — a mismatch fails the run
- Every workflow must call `agent()` at least once

### work workflow pattern

```js
export const meta = { name: 'work', description: 'Propose one candidate; core evaluates it' };

phase('propose');
const r = await agent(
  `You are optimizing a Kaggle submission. Work in: ${args.run.workspace_dir}. ` +
  `Do not change eval scripts. Read the constraints from the generation assets. ` +
  `Return {patch_summary, artifacts, submit_ready, payload_ref}.`,
  {
    label: 'work',
    schema: {
      type: 'object',
      required: ['patch_summary'],
      properties: {
        patch_summary: { type: 'string' },
        artifacts: { type: 'array', items: { type: 'string' } },
        submit_ready: { type: 'boolean' },
        payload_ref: { type: 'string' }
      }
    }
  }
);

const candidateId = 'cand_' + args.run.id;
const effects = r.submit_ready
  ? [{ candidate_id: candidateId, kind: 'kaggle_submit', payload_ref: r.payload_ref }]
  : [];

return {
  target_kind: 'work',
  status: 'ok',
  summary: r.patch_summary,
  candidates: [{ candidate_id: candidateId, kind: 'workspace_patch', artifact_refs: r.artifacts || [] }],
  local_eval: { verdict: 'unsure', metrics: [], checks: [], feedback: ['Core check is authoritative'] },
  effect_proposals: effects
};
```

### effect handler pattern

```js
export const meta = { name: 'kaggle_submit', description: 'Execute approved Kaggle submission' };
const r = await agent(
  `Submit to Kaggle using: ${args.effect.payload_ref}. ` +
  `Resolve relative paths inside: ${args.run.workspace_dir}. ` +
  `Respect idempotency keys. Return {external_ref, evidence_ref}.`,
  { label: 'effect', schema: { type: 'object', required: ['external_ref'], properties: { external_ref: { type: 'string' }, evidence_ref: { type: 'string' } } } }
);
return {
  target_kind: 'effect',
  status: 'ok',
  action_ref: args.effect.action_ref,
  proposal_hash: args.effect.proposal_hash,
  approved_proposal_hash: args.effect.approved_proposal_hash,
  idempotency_key: args.effect.idempotency_key,
  content_dedup_key: args.effect.content_dedup_key,
  external_ref: r.external_ref,
  evidence_ref: r.evidence_ref
};
```

The echoed fields (`action_ref`, `proposal_hash`, `approved_proposal_hash`, `idempotency_key`) must match `args.effect` exactly, or the effect fails.

---

## LoopSpec essentials (`loop.json`)

The LoopSpec is a JSON file that defines everything about a loop. Full reference: [`reference/loopspec.md`](reference/loopspec.md).

Required fields:

```jsonc
{
  "apiVersion": "pievo.dev/v1",
  "kind": "Loop",
  "metadata": { "name": "my-loop", "description": "..." },
  "spec": {
    "initial_status": "active",
    "initial_phase": "bootstrap",
    "entrypoints": {
      "work": { "workflow": "workflows/work.js", "timeout_minutes": 120,
        "local_eval": { "required": true, "core_checks": [...] }
      },
      "recalibrate": { "workflow": "workflows/recalibrate.js" },
      "repair": { "workflow": "workflows/repair.js" }
    },
    "measurement": { "metrics": { ... }, "calibration": { "mode": "identity|paired|sampled" } },
    "goals": [ { "name": "...", "kind": "primary|auxiliary", "metric_name": "...", "source": "local_eval|truth", "higher_is_better": true|false } ],
    "decision": { "allow_auxiliary_keeps": true, ... },
    "effects": { "<kind>": { "approval": "manual|auto" } },
    "contracts": { ... },
    "audit": { ... }
  }
}
```

Entrypoint `cadence` is `{ "kind": "manual" }` or `{ "kind": "interval", "seconds": N }` — cron is rejected at preflight (`cadence_cron_unsupported`). Repo mode (managed vs legacy) is chosen at adopt/apply time, not in the spec.

### Core checks (`entrypoints.work.local_eval.core_checks[]`)

Each core check is a command that Pievo core runs after work proposes a candidate:

```jsonc
{
  "name": "eval-runtime",
  "command": "node ${PIEVO_GENERATION_DIR}/assets/eval/run_eval.mjs",
  "cwd": "${PIEVO_CANDIDATE_WORKSPACE}",
  "timeout_minutes": 60,
  "eval_anchor": { "mode": "generation_asset", "paths": ["assets/eval/run_eval.mjs"] },
  "metric_extractors": [
    { "metric_name": "local_score", "kind": "json_pointer", "file": "metrics.json", "pointer": "/local_score" },
    { "metric_name": "local_runtime_seconds", "kind": "json_pointer", "file": "metrics.json", "pointer": "/local_runtime_seconds" }
  ]
}
```

The `eval_anchor` tells Pievo which files must be generation-owned (not editable by work). If a candidate tries to change them, the check is invalidated.

### Campaign (time / iteration budget)

```jsonc
"campaign": {
  "max_wall_minutes": 480,    // 8 hours total from first apply
  "max_iterations": 20,       // max work runs
  "consequence": "auto_pause" // what happens when limit is hit
}
```

- `max_wall_minutes`: total wall-clock time from the loop's first `apply`. Daemon stops dispatching new work when this is exceeded.
- `max_iterations`: total count of completed `work` runs (not effects/truth).
- `consequence`: `auto_pause` (default) | `block` | `archive`

When a limit is reached, the loop's status changes and an audit entry is recorded. The daemon also skips the loop in tick dispatch before the limit is reached.

`pievo loop health` now shows campaign info:

```jsonc
"campaign": {
  "started_at": "2026-07-05T00:00:00+08:00",
  "work_runs": 12,
  "elapsed_minutes": 245
}
```

### Effect circuit breaker

```jsonc
"audit": {
  "effect_failures": {
    "consecutive_to_pause": 3,   // N consecutive failures → pause
    "pause_minutes": 60           // how long to pause before auto-recovery
  }
}
```

When effect failures (e.g., `kaggle_submit` returns error) reach the threshold:
- Subsequent proposals of that effect kind are blocked (`effect_circuit_breaker_active`)
- An audit entry is written
- Health shows the breaker state
- Successful execution resets the counter and clears the breaker

`pievo loop health` now shows:
```jsonc
"effect_circuit_breakers": {
  "kaggle_submit": {
    "consecutive_failures": 3,
    "paused": true,
    "paused_until": "2026-07-05T02:00:00+08:00"
  }
}
```

### Verified best (scorecard)

The scorecard now has two sections:
- `best` — local eval best (provisional, may include unverified candidates)
- `verified_best` — externally confirmed via `truth` workflow observations

`pievo loop health` shows both. `verified_best` is only populated when truth metrics arrive and includes `action_ref` / `external_ref` for provenance.

### Contracts

```jsonc
"contracts": {
  "kaggle_submit_quota": {
    "kind": "action_quota",
    "actions": ["kaggle_submit"],
    "perDay": 20,
    "consequence": "block_action"
  },
  "protect_eval": {
    "kind": "surface",
    "denyWrite": ["eval/**"],
    "consequence": "block"
  }
}
```

### Audit configuration

```jsonc
"audit": {
  "bootstrap": { "min_trials": 3, "max_trials": 8, "allow_effects": true },
  "runtime": { "heartbeat_interval_seconds": 60 },
  "effect_failures": { "consecutive_to_pause": 3, "pause_minutes": 60 }
}
```

That is the whole enforced audit surface. Former knobs (`audit.stagnation`, `audit.turnover`, `audit.post_run`, `audit.failures`, novelty thresholds) are gone — specs declaring them are rejected/ignored at preflight. Likewise `local_eval.reviewer_checks` and `workspace_protected` eval anchors are rejected at preflight.

---

## Common pitfalls

- **Workflow doesn't call `agent()`**: deterministic loops are only acceptable for smoke tests
- **Work reports its own score**: only core checks are trusted for keep/discard — and a failed eval discards all metrics (`eval_failed`)
- **Effect not gated**: work must never execute external effects directly; `run-now --target effect:<kind>` is forbidden
- **Effect stuck?** It's probably `awaiting_approval` — check `pievo loop actions`/`questions` and approve, or deliberately set `spec.effects.<kind>.approval: "auto"`
- **Eval script not protected**: if work can edit the evaluator, it can grade itself
- **No truth in paired mode**: without truth observations, decisions stay provisional. The daemon chases unverified effects automatically (truth cadence `after_effects` is the default); `pievo loop health` shows `truth.unverified_actions` and the dashboard raises a truth-debt attention item while any executed effect is unverified
- **Cron cadence**: not supported — `cadence.kind` is `manual`, `interval`, or (truth only) `after_effects`; cron is rejected at preflight (`cadence_cron_unsupported`)
- **Editing a managed repo while the loop is active**: a dirty tree or moved branch head blocks the loop with `repo_conflict` — pause the loop first, or answer the inbox question after fixing

---

## Reference files

- [`reference/cli.md`](reference/cli.md) — every CLI command in detail
- [`reference/loopspec.md`](reference/loopspec.md) — full LoopSpec schema
- [`reference/workflows.md`](reference/workflows.md) — workflow authoring ABI and examples
