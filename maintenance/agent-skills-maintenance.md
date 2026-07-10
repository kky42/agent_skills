# agent-skills-maintenance

Purpose: keep the `agent_skills` repository healthy by checking mirror integrity, owned-source review debt, skill/tool relations, runtime symlink sync, and high-risk skill currentness.

## Cadence

- Pievo bundle: `agent-skills-maintenance`
- Bundle status: unregistered and inactive. Its checked-in spec declares an initial paused state, but no current Pievo loop exists; redesign the old 0.4 LoopSpec/workflow contract before registration.
- Intended work cadence after registration and activation: every 12 hours (`43200` seconds)
- Dispatch behavior: an anchored probe runs first. It skips expensive work when the normalized skill model, `skill-sync --check`, the evidence note, priority mirror checks, and owned-source review checks look healthy. It fires the work workflow when maintenance debt is detected.
- Repo mode: imported-copy mode. The current git root has pre-existing uncommitted work, so managed mode would be inappropriate. Review promoted changes from Pievo's imported workspace/artifacts and apply them to the real repo deliberately.

## Metrics

The loop is a gate-style invariant. A candidate is keepable only when each target is met:

| Metric | Target | Meaning |
| --- | ---: | --- |
| `skill_model_ok` | 1 | Ownership, relations, manifests, locks, and dependency graph validate. |
| `sync_ok` | 1 | `./scripts/skill-sync --check` passes. |
| `scripts_ok` | 1 | Scripts compile and ownership/update policy tests pass. |
| `chatgpt_static_ok` | 1 | ChatGPT skill keeps GPT-5.5/model-selection, Playwright-only, lock, and validation evidence protocol present. |
| `evidence_ok` | 1 | This note contains purpose, cadence, metrics, operator actions, and last maintenance evidence. |

Core evaluation is anchored in `pievo/loops/agent-skills-maintenance/assets/eval/maintenance-check.mjs`; candidates must not edit it.

## Operator actions

- Do not register or activate this bundle until it has been redesigned and validated against the currently installed Pievo CLI contract.
- Before operating it, inspect `pievo --help` and the installed package documentation rather than relying on the historical commands below.
- Until activation, run the repository validation commands directly and review source debt with `thirdparty-update --check --format json`.
- When Pievo is restored, keep imported-copy mode while the real repo has unrelated uncommitted work; inspect/export candidates and apply wanted changes deliberately.
- For a mirror update, allow whole-directory replace only when ownership is explicit and the local path is clean. A dirty path may only be recorded without replacement when it already exactly equals the checked upstream tree.
- For an owned source update, inspect the scoped delta, selectively adapt only relevant changes, and record accepted/skipped decisions in `skill-lock.json`; never merge or apply the upstream tree.
- After changing a skill dependency or tool dependency, validate both the target skill and its reverse dependents.
- For ChatGPT UI/model drift, run a safe browser validation with the `chatgpt` skill and update `skills/chatgpt/VALIDATION.md` with evidence. Do not disrupt the attached Chrome Canary profile.

## Last maintenance evidence

Architecture and ownership migration evidence from 2026-07-10:

- Added the mirror/owned model, typed relations, review receipts, schemas, normalized model loader, safe mirror replacement, real runtime-link checks, and dependency verification.
- All **32 active skills** now have explicit ownership: **28 mirrors** and **4 owned**. Legacy v1 records are empty.
- Deleted `grill-me`, `browseruse`, `pi-agent-e2e`, `pi-soul`, and `pi-extension-dev` by user decision and removed their runtime links.
- All retained Matt Pocock skills, Pievo, Researcher, Playwright CLI, and the selected OpenCLI skills were materialized and locked from their declared Git sources. See `maintenance/skill-inventory.md`.
- All four OpenCLI-sourced skills are exact mirrors. Both Kaggle owned-source reviews are current; no explicit source-review debt remains.
- The global `@playwright/cli` package was updated with the Playwright mirror; strict dependency/tool verification passes with no unchecked edges.
- Shell syntax, Python/JSON/Node checks, unit tests, `skill-deps check`, strict dependency verification, and `skill-sync --check` pass.
- The maintenance bundle remains unregistered/inactive: the Pievo skill is now a current upstream mirror, but the separate maintenance bundle still uses the removed 0.4 LoopSpec/workflow contract.

Historical setup evidence from 2026-07-07:

- Historical generation-1 evidence: `pievo daemon status` showed version `0.4.8` running at the time. This no longer describes the installed CLI/runtime and must not be treated as current health.
- The foreground repo was not clean before loop creation: `skills/thirdparty/pievo/SKILL.md` had pre-existing uncommitted changes. This is why imported-copy mode was selected instead of managed mode.
- Loop bundle authored under `pievo/loops/agent-skills-maintenance/` with anchored dispatch probe and anchored maintenance evaluator.
- Historical: the then-supported `pievo loop preflight` and `pievo loop apply` commands created generation `1`, eval version `2026.07.07`.
- Historical: one `pievo loop run-now` completed run `run_5a6c58368b2949dfb199` with decision `dec_9a025e2351404e01aeda` (`invariant_preserved`).
- The historical generation used legacy metrics `deps_ok` and `thirdparty_manifest_ok`; those results predate the mirror/owned architecture and are superseded.
- Historical health reported `active/stable`; no loop is currently registered, so that old runtime state is not current evidence.
- No external effects/actions are configured or pending.
