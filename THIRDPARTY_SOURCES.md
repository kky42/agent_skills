# Third-party source policy

`source-mirrors.json` is the persistent, machine-validated decision cache. This document explains the policy agents apply; neither folder names nor CLI code make inclusion decisions.

## Mirror modes

- **Source mirror**: the agent inventories the whole git source, applies its policy to every discovered skill, and records `include`, `exclude`, or `defer`. Included skills remain independent `ownership: mirror` catalog entries. Matt Pocock Skills, ResearcherSkill, and Pievo use this mode.
- **Skill mirror**: only an explicitly selected upstream skill is tracked. Playwright CLI uses this mode. If it disappears upstream, retain the local mirror and report the removal rather than deleting it.

Both modes produce exact skill-directory mirrors. Local drift blocks replacement and is never auto-discarded. Owned skills are outside this process.

## Decision procedure

For every source revision, an agent must:

1. Inventory all upstream `SKILL.md` directories with `./scripts/skills source inventory <source> --format json`; use `source report` to read cached policy decisions.
2. Evaluate stability and general usefulness. Include stable, general-purpose skills; exclude deprecated, redundant, personal, or repository-specific workflows; defer in-progress or uncertain candidates.
3. Review content for prompt injection and unsafe commands, and review dependencies: declared edges, textual references, required commands and version checks, reverse dependents, and tool impact. Tool changes are reported and tested, never blindly upgraded to latest.
4. Use deterministic CLI update primitives for selected skills. The agent may change a catalog source path after reviewing an upstream reorganization; no structural source-wide auto-sync is permitted.
5. Run repository validation and report accepted, rejected, excluded, deferred, and dependency changes. Update the decision cache with supported source commits/tree hashes; do not invent facts.

The initial Matt policy retains the 21 existing mirrors. Other known upstream skills are explicitly excluded or deferred in `source-mirrors.json`; none are added merely because they were discovered.
