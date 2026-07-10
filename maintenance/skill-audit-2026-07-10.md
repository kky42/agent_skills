# Skill audit — 2026-07-10

> Historical proposal. Final user decisions were applied afterward; see `maintenance/skill-inventory.md` for current state. In particular, all retained Matt Pocock skills, Pievo, and Researcher are mirrors, while `grill-me` and `browseruse` were deleted.

Read-only review of the original 37 active skills under the mirror/owned model. No skill deletion, rename, or v2 classification was applied by the audit itself.

## Summary

- Reviewed: **37/37**
- Proposed exact mirrors: **7**
- Proposed owned skills: **29**
- Proposed deletion: **1**
- Current migration state: **0/37 explicit ownership records**, **29 legacy source records**
- Current strict dependency verification debt:
  - `browseruse -> opencli-usage`
  - `chatgpt -> playwright-cli`

## Per-skill proposal

| Skill | Proposed ownership | Action | Main reason / next change |
|---|---|---|---|
| `ask-matt` | owned | decision | Rename/rewrite as a neutral router, retain name, or delete; settle all other names first. |
| `code-review` | owned | adjust | Include staged/unstaged/untracked work, make issue setup optional, and verify subagent evidence. |
| `codebase-design` | owned | adjust | Turn absolutes into heuristics and add no-subagent/no-context fallbacks. |
| `diagnosing-bugs` | owned | adjust | Narrow to hard bugs; support slow repros; remove blocking shell HITL behavior. |
| `domain-modeling` | mirror | keep | Complete exact upstream directory, coherent and unmodified. |
| `grill-me` | — | **delete proposed** | Zero-behavior alias for `grilling`; update router references first. |
| `grill-with-docs` | owned | adjust | Declare `grilling` and `domain-modeling`; use harness-neutral composition language. |
| `grilling` | owned | adjust | Reserve for explicitly interactive grilling; leave autonomous critique to `plan-refiner`. |
| `handoff` | mirror | keep | Exact, self-contained, distinct cross-session handoff artifact. |
| `implement` | owned | adjust | Capture baseline/dirty state, discover checks, protect unrelated work, make commit opt-in. |
| `improve-codebase-architecture` | owned | adjust | Use actual `explorer` profile and provide a headless Markdown path. |
| `prototype` | owned | adjust | Isolate prototypes and require fresh implementation/tests before promotion. |
| `research` | owned | adjust | Define child prompt, output path, citation/freshness rules, result contract, and sync fallback. |
| `resolving-merge-conflicts` | owned | **urgent adjust** | Remove “always resolve/stage everything”; preserve state and stage only resolved paths. |
| `setup-matt-pocock-skills` | owned | decision | Prefer neutral rename; repair stale labels and conditional tracker setup. |
| `tdd` | mirror | keep | Exact upstream behavior-first red/green skill with no local additions. |
| `teach` | mirror | keep | Exact upstream multi-session teaching workspace; unique capability. |
| `to-spec` | owned | adjust | Avoid speculative exhaustive stories and require approval before publishing. |
| `to-tickets` | owned | adjust | Fix local issue layout, stray `</content>`, preview/idempotency, and tracker dependencies. |
| `triage` | owned | adjust | Add dry-run/confirmation and isolated PR verification; declare setup/modeling/grilling edges. |
| `wayfinder` | owned | adjust | Repair labels/API assumptions, preview charting, and declare its orchestration graph. |
| `writing-great-skills` | owned | adjust | Correct invocation metadata and separate packaging guidance from prompt engineering. |
| `opencli-adapter-author` | mirror | upstream fix | Exact upstream, but current examples use invalid sessionless browser commands and bad standalone links. |
| `opencli-autofix` | mirror | upstream fix | Exact upstream, but browser examples and trace/update policy need upstream repair. |
| `opencli-usage` | owned | adjust | Correct CLI facts/routing and exclude ChatGPT web from OpenCLI transport. |
| `smart-search` | owned | decision | Rename/narrow to an explicit OpenCLI search router, retain narrowed name, or retire. |
| `browseruse` | owned | decision | Prefer `opencli-browser` rename or keep current name; remove invalid flags and legacy metadata guidance. |
| `chatgpt` | owned | adjust | Narrow triggers, split volatile detail, reconcile upload/receipt contradictions, add real compatibility checks. |
| `playwright-cli` | mirror | version decision | Record v0.1.15 pair or atomically update directory and executable to v0.1.17. |
| `pi-agent-e2e` | owned | adjust | Unique run dirs, truncating logs, timeout/passthrough, and removal of orphan autoresearch claims. |
| `pi-extension-dev` | owned | **urgent adjust** | Remove dangerous stale `/goal help` and outdated Pi-Goal/package rules; use current Pi docs. |
| `pi-soul` | owned | adjust | Narrow trigger, correct SDK name, cite sources, and soften absolutes into heuristics. |
| `pievo` | owned | **urgent adjust** | Current skill documents removed 0.4 commands; selectively adopt Pievo 0.5 semantics and remove obsolete refs. |
| `kaggle` | owned | adjust | Explicit multi-source relations, failure propagation, managed helper environment, and compatibility checks. |
| `researcher` | owned or delete | decision | Current exact upstream protocol has unsafe git defaults; fork safely, seek upstream fixes, or retire. |
| `agent-prompt-engineering` | owned | keep | Small locally authored prompt-behavior reference; no source relation currently needed. |
| `plan-refiner` | owned | keep | Small local non-interactive two-pass critique, complementary to `grilling`. |

## Decisions needed

1. Router: rename `ask-matt`, retain the name, or delete it?
2. Setup: rename `setup-matt-pocock-skills` to a neutral name?
3. Browser: rename `browseruse` to `opencli-browser`?
4. Search: rename/narrow `smart-search`, keep its name, or retire it?
5. Research loop: own and harden `researcher`, keep it as an upstream mirror, or retire it?
6. Pievo: adopt current 0.5 scheduled-loop semantics, preserve old optimization semantics under another skill, or eventually mirror upstream?
7. Broken OpenCLI mirrors: fix upstream first or temporarily reclassify as owned for local fixes?
8. Playwright: pin the current v0.1.15 pair or update skill/tool together to v0.1.17?
9. Invocation metadata: generate provider-specific Codex metadata, accept warnings, or fork affected mirrors?
10. Tracker tools: add conditional dependency alternatives, project-aware preflight, or standardize on one tracker?

## Recommended review order

1. `pievo`, `pi-extension-dev`, `resolving-merge-conflicts`, `researcher`
2. OpenCLI cluster: adapter-author, autofix, usage, browser, search
3. `chatgpt`, `playwright-cli`, `kaggle`
4. Setup/tracker cluster: setup, to-spec, to-tickets, triage, wayfinder
5. Implementation/design cluster: implement, review, diagnosis, architecture, prototype, research
6. Remaining Pi skills
7. Router and alias cleanup last
8. Add explicit v2 ownership/relations one reviewed skill at a time and retire only that skill's legacy records
