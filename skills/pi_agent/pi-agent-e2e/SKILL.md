---
name: pi-agent-e2e
description: Run fresh pi-agent end-to-end tests for skills, extensions, and agent workflows with isolated session dirs and constrained resources. Use when validating pi packages, skills, extensions, autoresearch loops, fresh-context behavior, tool use, robustness, performance, or real-model UX.
---

# Pi Agent E2E

Use this skill when the claim depends on a real agent using the package from a fresh context. The output should be evidence: command, session dir, artifacts inspected, benchmark movement or rubric result, failures, and residual risks.

## Quick Start

Create a temporary repo or fixture with a real task, keep the prompt outside the target repo, then run:

```bash
node /path/to/pi-agent-e2e/scripts/run-fresh-pi.mjs \
  --cwd /path/to/fixture \
  --session-dir /tmp/pi-e2e/sessions \
  --model deepseek/deepseek-v4-flash \
  --skill /path/to/skill-dir \
  --prompt /tmp/pi-e2e-prompt.md
```

The helper disables ambient skills, ambient extensions, prompt templates, themes, and context files. Explicit skill and extension paths still load through `--skill` and `--extension`, so pass the resource under test explicitly.

For skill-only runs, the helper defaults to the built-in coding and search tools: `read,bash,edit,write,grep,find,ls`. For extension runs, the helper omits `--tools` by default so extension-registered tools remain active. If you pass `--tools`, include every extension tool that the contract expects the model to call.

If `--session-dir` is omitted, the helper uses an OS temp directory under `pi-e2e/sessions` rather than writing session files into the target repo.

The helper writes `e2e-prompt.md` inside the session dir and prepends launch context such as cwd, session dir, explicit skill paths, explicit extension paths, tools, and disabled ambient resources. A fresh agent cannot reliably infer those CLI flags unless they are included in the prompt.

## Workflow

1. Define the behavioral contract before running the agent: expected setup, editable surface, eval, forbidden files, expected output fields, and success threshold.
2. Build a fixture that cannot be solved by editing the score directly. Put implementation under the editable path and eval/rubric outside it.
3. Commit or otherwise record the baseline. Keep the E2E prompt and scratch logs outside the repo or commit them deliberately.
4. Run a fresh `pi -p` session through [scripts/run-fresh-pi.mjs](scripts/run-fresh-pi.mjs) or an equivalent explicit command.
5. Watch intermediate behavior through session files and target artifacts, not final prose only:
   ```bash
   find /tmp/pi-e2e/sessions -type f | sort
   tail -n 20 /path/to/fixture/.autoresearch/runs/<id>/experiment_results.jsonl
   cat /path/to/fixture/.autoresearch/runs/<id>/status.json
   ```
6. Verify the contract: the right skill/extension loaded, the agent used expected commands, forbidden files were untouched, generated artifacts exist, eval was actually run, and reported metrics match machine-readable records.
7. If behavior is weak, patch docs/scripts/prompts, rerun the same fresh-agent test, and keep the failed trace as a regression note.

## Fresh Pi Command Shape

Use this shape when not using the helper script:

```bash
pi -p \
  --model deepseek/deepseek-v4-flash \
  --session-dir /tmp/pi-e2e/sessions \
  --no-skills \
  --no-extensions --no-prompt-templates --no-themes --no-context-files \
  --skill /path/to/skill-dir \
  --tools read,bash,edit,write,grep,find,ls \
  @/tmp/pi-e2e-prompt.md
```

For extension tests, keep `--no-extensions`, add explicit `--extension /path/to/extension`, and use `--no-skills` unless a skill is part of the contract. Avoid `--tools` unless you include the extension's tool names in the allowlist.

## What To Report

- Exact `pi` command or helper command.
- Repo/fixture path and session dir.
- Loaded skill or extension path.
- Baseline and final metric, or rubric score and judge details.
- Kept/attempted ratio for loops, plus failures and no-ops.
- Whether the agent actually used the intended workflow rather than hand-solving outside the contract.
- Files changed, forbidden files touched or not touched, and artifact paths.
- Wall-clock/runtime, approximate token/cost if available, and any provider stalls.
- Residual risks, especially policy-eval versus real-eval gaps.

## Autoresearch-Specific Checks

For autoresearch, the fresh agent should create or use `.autoresearch/run.mjs`; it should not hand-run N separate experiments from the outer prompt. Inspect `.autoresearch/contract.json`, `status.json`, `experiment_results.jsonl`, best patch, and inner session files. Bounded evals should set `--target-score` so a saturated policy score stops early.
