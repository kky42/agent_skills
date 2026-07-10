# AGENTS

This repo manages global agent skills and skill-owned tools for this user's machines.

`README.md` is for humans. Keep it short and friendly. This file is for agents operating in the repo. Put execution rules here.

## Core Model

- `skills/` is the source of truth for all active skill content.
- Skill location is organizational only. In particular, `skills/thirdparty/` does **not** determine ownership.
- Every skill has exactly one ownership state:
  - `mirror`: an exact, replaceable copy of one upstream git directory.
  - `owned`: content for which this repo is authoritative, whether original or informed by one or many external sources.
- Unclassified skills default conservatively to `owned`.
- `skill-manifest.json` records explicit ownership, source registry entries, and typed relations.
- `skill-lock.json` records mutable mirror sync state and owned-source review receipts.
- `schemas/` documents both formats; `scripts/skill_model.py` is the validating implementation seam.
- All active skills have explicit v2 ownership. `thirdparty-skills.yml` and `thirdparty-lock.json` are retired empty compatibility files; do not add records to them. Legacy `skill.meta.json` parsing remains only for imported repositories.
- Runtime folders are generated links, not source of truth:
  - Codex/Pi via `~/.agents/skills`
  - Claude Code via `~/.claude/skills`

Runtime layout is flat:

```text
./skills/**/<skill>/SKILL.md -> ~/.agents/skills/<skill>
./skills/**/<skill>/SKILL.md -> ~/.claude/skills/<skill>
```

The target roots come from `AGENT_SKILLS_SKILL_TARGETS`, defaulting to `~/.agents/skills:~/.claude/skills`. The legacy `AGENT_HUB_SKILL_TARGETS` name is still accepted.

## User Control Panel

Treat a top-level user message consisting of `doctor`, or an explicit request for a doctor report, as a read-only repository health check.

Doctor must:

1. Validate the normalized skill model, runtime links, strict declared dependencies/tools, tests, and basic syntax.
2. Check mirror integrity and upstream-ref freshness; group mirrors by source rather than dumping every skill.
3. Check owned-source review debt; group owned skills by source, with local-authoritative skills as their own source group.
4. Report working-tree and paused-automation state without treating expected uncommitted work as content corruption.
5. Use this stable default report contract, omitting only sections that truly have no data:

   ```text
   # DOCTOR — HEALTHY|WARN|BROKEN

   **<active> skills · <mirror> mirror · <owned> owned · <explicit>/<active> explicit**

   ## Mirror
   | Source | Count | Status |

   ## Owned
   | Source | Count | Status |

   ## Health checks
   - compact pass/fail lines with test and verification counts

   ## Warnings
   1. actionable warning, or `None`

   Doctor made no updates or repairs.
   ```

   Use `✅ Current`, `⚠️ Update available`, `⚠️ Review debt`, and `❌ Drift/Broken` consistently. In the Owned table, summarize both affected skill count and relation-review count when they differ.
6. List individual skill names only for small groups, exceptions, or failures. Distinguish mirror drift/update debt from owned review debt. If asked what needs review, explain the watched upstream scope, affected local paths, concrete compatibility questions, and whether the debt is an initial baseline or a delta from a prior receipt.

Doctor is observational: do not apply updates, install tools, edit files, clean the worktree, record review receipts, or reactivate automation unless the user separately asks for repair. Use `BROKEN` for failed invariants, tests, links, or dependency verification; use `WARN` for available upstream updates, review debt, a dirty worktree, or intentionally paused automation.

### `update`

Treat `update <skill-or-source>` as a state-changing request to update the named target under its declared ownership policy. A bare `update` only reports candidates and asks the user to choose; it must not update everything implicitly.

Before changing a skill, capture its current purpose, applicability boundary, frontmatter `name`/`description`, ownership, source scope, dependencies, and reverse dependents. Then apply these gates:

1. **Behavioral/tool changes must solve a demonstrated problem.** An agent must use the skill as a user would, reproduce the failure through the relevant local command/workflow before editing, and repeat the same task afterward. Do not add a skill-specific test script that merely restates a changing third-party CLI contract. For an unsafe, costly, credentialed, or externally mutating boundary, the agent may use an isolated fixture or controlled fake boundary, but must exercise the real local control flow and label the result as non-live. If the agent cannot reproduce the problem, do not claim or apply a speculative fix; record it as blocked or skipped.
2. **Descriptive changes must be factual, current, and concise.** Have an agent follow the description and documented workflow, and verify commands, flags, APIs, and behavioral claims against current primary sources and, when safe, the installed tool. Remove stale claims rather than adding broad explanatory prose. Cite the evidence in the update report or durable source note.
3. **Owned scope is invariant.** Upstream material may update facts or behavior already inside the owned skill's established purpose; it must not broaden, narrow, or redirect that purpose. Resolve conflicts with the current version by reproduction or primary-source verification, then selectively adapt only the in-scope part. Never merge or apply an upstream owned-source tree.
4. **Frontmatter description is frozen by default.** It defines when the skill should be invoked and what it does. Do not change it unless the user explicitly requests a scope/trigger change. For a mirror, if an upstream update changes the description, surface that change and obtain explicit approval for the exact replacement rather than patching the mirror locally.
5. **Keep changes minimal and attributable.** Avoid cleanup, refactors, formatting churn, new dependencies, or upstream policy files unless they are necessary to the reproduced issue. Preserve local safety policy and adaptations.
6. **Verify through agents and record.** Use fresh agents for representative in-scope tasks and inspect their actual skill use, commands, outputs, artifacts, and failure handling. Re-run the same agent task after each accepted behavioral fix. Existing repository invariant checks may still be executed by the agent, but do not create or maintain skill-specific scripted tests unless the user explicitly requests them. Also run declared dependency/reverse-dependent, model, and runtime-link checks as applicable. For owned source review, record accepted and skipped upstream paths plus concrete reasons in `skill-lock.json` only after agent verification.

An update report must state: target and ownership; preserved scope/description; agent reproduction task and observed behavior; accepted changes and evidence; skipped changes and reasons; compatibility/invariant results; source receipt/lock movement; and residual risks. Never describe a controlled boundary as a live external end-to-end test.

## Ownership Invariants

### Mirror skills

- Upstream owns the content; this repo materializes it exactly.
- Declare the mirror in the root `skill-manifest.json`. Never put a local `skill.meta.json` inside a mirror directory.
- A mirror has exactly one external git directory and no relations of its own.
- Do not edit a mirror locally. If local customization is needed, explicitly reclassify it as `owned` first.
- Update with whole-directory replace only. `thirdparty-update --apply` refuses to replace a dirty path; during migration it may record a dirty working tree only when its complete directory is already byte-for-byte/mode-for-mode equal to the checked upstream tree.
- If a mirror drifts from its recorded upstream tree, treat that as an integrity error, not as a patch to preserve.

### Owned skills

- This repo owns the final content. External changes can propose updates but can never overwrite it.
- An owned skill may have zero or many typed relations:

| Relation | Meaning | Update action |
|---|---|---|
| `content-source` | Some local content was informed by this source | Review the scoped source delta and selectively adapt only relevant changes |
| `reference` | Material worth re-reading, but not a content lineage | Review; adopt nothing automatically |
| `skill-dependency` | Another skill is needed for operation | Update that skill according to its own ownership, then validate compatibility and reverse dependents |
| `tool-dependency` | A package/plugin/command is needed | Resolve according to its update policy, run verify, then adapt the owned skill only if necessary |

- Never merge an upstream tree or patch into an owned skill.
- Never introduce unrelated upstream files, structure, wording, or policy merely because the source changed.
- For each external source, record the source directory, watched paths, affected local paths/concerns, and the last reviewed commit.
- After selective review, record accepted and skipped changes. Advance `lastReviewedCommit` even when every relevant change was skipped, so rejected changes do not recur forever.
- A target may be both a dependency and a content source; declare those as separate relations because their update actions differ.

## Scripts

Use these user-facing scripts:

```bash
./scripts/skill-sync
./scripts/skill-deps
./scripts/thirdparty-update
```

`skill-migrate` is legacy/import-only. Do not use it as the normal update path. Do not add helper wrappers such as `bootstrap`, `apply-thirdparty`, `skills-bootstrap`, or `skills-apply-thirdparty` unless the user explicitly asks for a larger script surface.

Useful commands:

```bash
./scripts/skill-sync
./scripts/skill-sync --skills-only
./scripts/skill-sync --tools-only
./scripts/skill-sync --check
./scripts/skill-deps check
./scripts/skill-deps list
./scripts/skill-deps why <skill>
./scripts/skill-deps verify [<changed-skill>]
./scripts/skill-deps check --format json
./scripts/thirdparty-update <skill> --check
./scripts/thirdparty-update <skill> --check --format json
```

`thirdparty-update` keeps its historical name for compatibility, but it now follows ownership rather than a “third-party” category.

## Source Update Workflow

### Mirror

```bash
./scripts/thirdparty-update <skill> --check
./scripts/thirdparty-update <skill> --apply
```

`--apply` is valid only for an explicitly declared, clean mirror. It atomically replaces the complete skill directory and updates `skill-lock.json`.

### Owned source/reference

1. Inspect the scoped delta:

   ```bash
   ./scripts/thirdparty-update <skill> --check --relation <relation-id>
   ```

2. Edit only the relevant owned files. Preserve local intent and structure.
3. Write a review receipt. `toCommit` is mandatory, and the accepted/skipped decisions must cover every relevant changed upstream path exactly once. For example:

   ```json
   {
     "toCommit": "<checked-commit>",
     "accepted": [
       {
         "upstreamPaths": ["scripts/parser.py"],
         "localPaths": ["scripts/vendor/parser.py"],
         "note": "Adapted the parser fix while preserving the local safety policy."
       }
     ],
     "skipped": [
       {
         "upstreamPaths": ["SKILL.md"],
         "reason": "Unrelated to the declared local concern."
       }
     ]
   }
   ```

4. Record it without changing skill content:

   ```bash
   ./scripts/thirdparty-update <skill> \
     --record-review /path/to/review.json \
     --relation <relation-id>
   ```

5. Validate and inspect the diff.

For an owned skill, `--apply` must fail. A base/ours/theirs report may help an agent understand history, but it must never become an automatic merge operation.

## Add Or Change A Skill

1. Create or edit a directory under `skills/`.
2. Ensure `SKILL.md` frontmatter `name` exactly matches the directory name.
3. An unlisted new skill is `owned`. Add an explicit manifest record when it has tracked sources/relations or when ownership should be reviewable rather than implicit.
4. Add dependency/source declarations to `skill-manifest.json`. Do not create new `skill.meta.json` files.
5. Run:

   ```bash
   ./scripts/skill-deps check
   ./scripts/skill-sync
   ```

Do not edit skills through runtime folders. Runtime entries should be symlinks back into this repo.

## Delete Or Rename A Skill

Before deleting or renaming, check reverse dependencies:

```bash
./scripts/skill-deps why <skill>
```

Then update:

- downstream skill dependencies;
- manifest ownership and relations;
- lock state;
- any owned source/reference watches;
- source and lock state associated with the renamed/deleted skill.

`skill-deps check` and `skill-sync --check` must pass before finalizing.

## Review Existing Skills

Review one skill at a time; do not classify by directory name or repository owner.

1. Decide whether the skill should be kept, adjusted, renamed, or deleted.
2. If kept, decide ownership:
   - exact upstream authority and no local additions → `mirror`;
   - anything else → `owned`.
3. For a mirror, verify the complete local directory equals the selected upstream directory before declaring it.
4. For an owned skill, enumerate all content sources, references, skill dependencies, and tool dependencies. Give each source relation a narrow watch scope and local concern.
5. Add or update the explicit v2 manifest record and its lock/review state.
6. Check reverse dependents and runtime/tool verification before moving to the next skill.

Do not bulk-convert legacy third-party records into mirrors. Provenance alone does not prove upstream authority.

## Skill-owned Tools

An owned skill may keep helper scripts under its directory. Declare install/update/verify behavior as a `tool-dependency` in `skill-manifest.json`.

Legacy `skill.meta.json` declarations can still be normalized for imports, but active repo skills declare tools in `skill-manifest.json`. `skill-sync` currently installs declared local `opencli-plugin` tools; other tool kinds remain dependencies to update and verify through their declared policy.

`skills/chatgpt` is Playwright-only and must not depend on an installable browser plugin.

## Legacy Files

- `thirdparty-skills.yml` and `thirdparty-lock.json` are retired empty compatibility files.
- `skill.meta.json` is accepted only as an import adapter; active skills must use the root manifest.
- `skills/thirdparty/` remains an organizational directory with no ownership semantics.

Do not repopulate the retired v1 files. New provenance, ownership, dependencies, and review state belong in `skill-manifest.json` and `skill-lock.json`.

Use `npx skills add <source> --list` only for discovery. Never use `npx skills` as a blind updater.

## Validation

After changing scripts, schemas, manifests, ownership, or relations, run:

```bash
git diff --check
bash -n scripts/skill-sync
python3 -m py_compile scripts/skill_model.py scripts/skill-deps scripts/thirdparty-update
python3 -m json.tool skill-manifest.json >/dev/null
python3 -m json.tool skill-lock.json >/dev/null
python3 -m unittest discover -s tests -p 'test_*.py'
./scripts/skill-deps check
./scripts/skill-deps verify
./scripts/skill-sync --check
```

After changing a declared tool, also run its verify command. After replacing a mirror, inspect the resulting repo diff before committing.
