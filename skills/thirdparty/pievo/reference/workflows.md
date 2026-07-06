# Workflow authoring reference

## Runtime contract

Pievo workflows are real `@kky42/pi-flow` scripts. They run in a worker-thread VM with a narrow global context:

- available globals: `agent`, `parallel`, `pipeline`, `log`, `phase`, `args`, `cwd`, `JSON`, and `Math` without `random`
- unavailable: `import`, `require`, `fs`, `child_process`, `process.env`, `Date`, `eval`, `Function`

A workflow is **not** `run(input, runtime)`. It is:

1. first statement: `export const meta = { name, description }`
2. top-level async body
3. input via global `args`
4. output via top-level `return`
5. at least one awaited `agent()` call

Example:

```js
export const meta = { name: 'work', description: 'propose one candidate via a subagent' };

phase('propose');
const r = await agent(
  `In ${args.run.workspace_dir}: make ONE candidate change toward the goal. ` +
  `Do not run external side effects. Return {patch_summary, artifacts}.`,
  {
    label: 'work',
    schema: {
      type: 'object',
      required: ['patch_summary'],
      properties: { patch_summary: { type: 'string' }, artifacts: { type: 'array' } }
    }
  }
);

return {
  target_kind: 'work',
  status: 'ok',
  summary: r.patch_summary,
  candidates: [{ candidate_id: `cand_${args.run.id}`, kind: 'workspace_patch', artifact_refs: r.artifacts || [] }],
  local_eval: { verdict: 'unsure', metrics: [], checks: [], feedback: [] },
  effect_proposals: []
};
```

## Trust boundary

Workflow/subagent output is advisory. Trust comes from:

- `core_checks[]`: Pievo core executes anchored evaluator commands, captures real exit code/logs, recomputes candidate hashes, extracts metrics.
- `truth`: later external observations paired by candidate/action refs.

The work workflow proposes. It does not grade itself. **Eval failure ⇒ discard**: if any required core check fails, times out, hits an eval-anchor hash mismatch, or mutates the candidate workspace, every extracted metric is discarded and the decision can only be `discard` (reason `eval_failed`).

## Input shape

`args` is the target input:

```jsonc
{
  "loop": { "name": "...", "status": "active", "phase": "bootstrap" },
  "generation": { "number": 1, "hash": "sha256:...", "dir": "...", "assets_dir": "..." },
  "target": { "kind": "work|truth|recalibrate|repair|side|effect", "name": "work" },
  "run": { "id": "run_...", "dir": "...", "workspace_dir": "...", "artifact_dir": "..." },
  "measurement": {}, "goals": [], "audit": {}, "contracts": {},
  "snapshots": [],
  "effect": {}    // effect targets only: the approved action row (action_ref, hashes, keys, payload_ref)
}
```

Operator input is not injected into workflow args. Change intent by applying a new
bundle, and resolve action/outcome facts through typed lifecycle verbs.

## Result ABI by target

Every result **requires `target_kind`**, and it must equal the dispatched target's kind — a mismatch fails the run (`workflow_result_target_kind_mismatch`). This includes `recalibrate` and `repair`.

**work**:

```jsonc
{
  "target_kind": "work",
  "status": "ok|fail|attention",
  "summary": "...",
  "candidates": [{ "candidate_id": "cand_...", "kind": "artifact|workspace_patch", "artifact_refs": ["artifact://..."] }],
  "local_eval": { "verdict": "unsure", "metrics": [], "checks": [], "feedback": [] },
  "effect_proposals": [{ "proposal_id": "eff_...", "kind": "kaggle_submit", "candidate_id": "cand_...", "payload_ref": "artifact://submission.csv" }]
}
```

**truth**: `{ target_kind:'truth', status, summary, observations:[{ action_ref, candidate_id, external_ref, metrics, evidence_ref }] }`.

**recalibrate**: `{ target_kind:'recalibrate', status, outcome:'healthy|improved|needs_repair|failed', evidence, new_eval_candidate, metric_pairs_used, recommended_transition }`.

**repair**: `{ target_kind:'repair', status, outcome:'candidate_generation|cannot_fix|needs_owner', candidate_generation_ref, patch_ref, risk:'low|medium|high', high_risk_changes:[] }`.

**effect**: `{ target_kind:'effect', status, action_ref, proposal_hash, approved_proposal_hash, idempotency_key, content_dedup_key, external_ref, evidence_ref }`. `action_ref`, `proposal_hash`, `approved_proposal_hash`, and `idempotency_key` must echo `args.effect` **exactly** — any mismatch fails the effect (`workflow_result_effect_echo_mismatch`).

## Effect proposals and payload refs

`effect_proposals[].payload_ref` must stay inside the run: a relative path (resolved in the candidate workspace), `workspace://<rel>`, or `artifact://<rel>`. Absolute paths, `..`, and symlink realpaths that escape the workspace/artifact root are rejected — the action is blocked with `payload_ref_invalid`. A payload that does not exist at proposal time blocks the action with `payload_missing`. Valid payloads are snapshotted to `artifact://payloads/<hash>/<name>` and the approval binds to the snapshot hash, so the bytes an operator approves are the bytes the effect ships.

Approval is spec policy: proposals land as `awaiting_approval` unless the LoopSpec declares `spec.effects.<kind>.approval: "auto"` — a proposal can never grant its own auto-approval.

## Subagent rules

- Work subagents run with `cwd = args.run.workspace_dir`.
- Work subagents do not receive effect secrets or `PIEVO_HOME`, and env vars matching secret patterns (`SECRET`, `TOKEN`, `PASSWORD`, `COOKIE`, `API_KEY`, …) are stripped from work-agent and core-check env. Effect/truth workflows receive only the secrets their handler declares.
- Work subagents must not submit/publish/open PRs directly — propose effects instead.
- If `schema` is supplied to `agent()`, the returned value is parsed as the structured result.
- Use `parallel(() => agent(...))` and `pipeline(...)` only when the work genuinely benefits from concurrency.

Isolation honesty: until OS sandboxing ships, a bash-capable subagent is only *asked* to stay in its lane. The enforced boundary is post-hoc — git status/diff on the run worktree, eval anchor hashes, surface `denyWrite` audits, payload containment, CAS promotion, and effect gating. No security theater.

## Local eval provenance

Core records for deterministic checks: candidate hash, command/script hash, exit code, stdout/stderr artifacts, eval anchor hash, and workspace before/after hash proof. A core check that mutates the candidate workspace is an eval failure — and any eval failure discards the run's metrics (see Trust boundary).
