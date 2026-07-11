# Skill Management

## Language

**Mirror skill**: exact materialization of one authoritative upstream git directory. Local drift is an integrity error.

**Owned skill**: locally authoritative content, even when informed by external sources.

**Source mirror**: governance mode where an agent discovers a whole source and decides which independent skills to include, exclude, or defer.

**Skill mirror**: governance mode tracking one explicitly selected upstream skill; upstream removal is reported while the local copy is retained.

**Content source / reference**: scoped external influence on an owned skill, reviewed selectively rather than merged.

**Skill dependency / tool dependency**: runtime requirements represented by declared edges and verification commands. Textual references and reverse dependents must also be reviewed.

**Decision cache**: `source-mirrors.json`, containing agent-made policy outcomes and supported commit/tree evidence. It is not an auto-sync specification.

## Decisions

**Local authority for owned skills** (2026-07-10): ownership has only `mirror` and `owned`. Owned skills never receive wholesale upstream trees.

**Orthogonal mirror governance** (2026-07-11): source versus skill mirror describes discovery and selection, not ownership. Source-mirror agents inventory the whole source, apply documented policy, review security and dependency impact, then invoke deterministic CLI primitives. Skill mirrors retain/report when removed upstream. No directory heuristic or structural auto-sync algorithm makes policy decisions.
