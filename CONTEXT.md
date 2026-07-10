# Skill Management

This context defines who is authoritative for skill content and how external influence is represented without weakening local ownership.

## Language

**Mirror skill**:
A skill whose complete content is an exact materialization of one authoritative upstream directory.
_Avoid_: Pure third-party skill, vendored skill

**Owned skill**:
A skill whose final content is authoritative in this repository, regardless of whether it is original or informed by external material.
_Avoid_: Personal skill, locally patched third-party skill

**Content source**:
External material that informed a declared part or concern of an owned skill and whose changes are candidates for selective adoption.
_Avoid_: Merge source, upstream branch

**Reference**:
External material worth re-reviewing but not presumed to own or correspond to local content.
_Avoid_: Dependency, content source

**Skill dependency**:
Another skill required for an owned skill to operate correctly.
_Avoid_: Content source

**Tool dependency**:
A package, plugin, or command required for an owned skill to operate correctly.
_Avoid_: Skill-owned content

**Source review**:
An evaluation of source changes that records which relevant changes were adopted or skipped while preserving the owned skill as authority.
_Avoid_: Merge, sync

**Review scope**:
The upstream paths and local concerns that define which source changes deserve evaluation for an owned skill.
_Avoid_: Whole upstream repository
