---
name: write-great-repo-readme
description: README writing and audits grounded in repository evidence. Use when the user wants to write README.md or assess one for reader success, truth, safety, and maintainability.
---

# Write a Great Repository README

Build the README from repository evidence, not generic boilerplate. Optimize for the reader's decision and first successful use; move exhaustive reference material to dedicated docs.

## Reader Outcome

The finished README must let the primary reader answer, in order:

1. What is this, who is it for, and why would I use it?
2. What proof shows the project actually does what it claims?
3. What is the shortest verified path to a useful result?
4. What requirements, limits, risks, and support boundaries matter?
5. Where should I go for deeper documentation or contribution work?

Call a material claim, command, link, compatibility statement, or screenshot caption verified only after checking it; label every remaining uncertainty explicitly.

## Workflow

### 1. Inspect Before Writing

Read the current README and the repository evidence needed to understand the product:

- package manifests, lockfiles, build files, and runtime version files;
- entry points, CLI help, public APIs, examples, tests, and sample configuration;
- documentation, release notes, license, contribution guide, security policy, and deployment files;
- existing screenshots, diagrams, demos, benchmark methodology, and generated docs.

Prefer primary evidence in the repository. Use external sources only for facts that cannot be established locally, and distinguish observed facts from inferences.

For an existing README, first record what must be preserved: accurate instructions, stable anchors, translations, badges, attribution, warnings, and links used elsewhere. Preserve that structure unless a concrete reader benefit justifies changing it.

**Done when:** the intended reader, project category, supported paths, verified commands, and material caveats are known.

### 2. Define the Reader and First Success

Choose one primary reader. Route secondary readers through later sections or links so the opening stays focused.

Write a one-sentence working brief:

```text
For <primary reader>, this repository provides <capability> so they can <outcome>, unlike <relevant alternative or current pain>.
```

Define the first-success event as something observable, such as:

- a command prints useful output;
- a library example returns a concrete result;
- a service responds to a request;
- an app launches or a hosted demo opens;
- a learner completes the first exercise;
- a reader reaches the correct resource category.

**Done when:** the README has a single primary audience and a testable first-success target.

### 3. Select a Repository Blueprint

Open [`references/blueprints.md`](references/blueprints.md) and follow exactly one project-type pointer. Plan only sections that help this repository's readers decide, succeed, or avoid a real failure.

When a repository serves two substantially different audiences, split their paths early with explicit labels—for example, “Use the app” versus “Embed the library,” or “Hosted” versus “Self-hosted.”

**Done when:** every planned section has a reader job, the main path is separate from maintainer-only setup, and the selected blueprint's acceptance condition is satisfied.

### 4. Build a Proof-First Opening

The first screen should usually contain:

1. project name;
2. a concrete one-sentence value proposition;
3. optional proof: a focused screenshot, short GIF, terminal transcript, result snippet, architecture diagram, or benchmark with methodology;
4. a small set of high-value links or badges;
5. the shortest route to try, install, download, or open the project.

Rules:

- Describe user outcomes before implementation details.
- Use comparisons only when they clarify the category, and ground superiority claims in reproducible evidence.
- Keep badges sparse. Each badge must answer a useful trust or compatibility question.
- Show visuals only when they reduce explanation cost. Crop them tightly, add useful alt text, and remove private data.
- A benchmark must state what was measured and link to reproducible methodology.

**Done when:** a new reader can identify the product and next action without scrolling through background material.

### 5. Write a Verified Quick Start

Create the shortest complete path from prerequisites to first success. It should normally contain:

1. prerequisites or supported versions;
2. installation or acquisition;
3. the smallest realistic example;
4. the exact run command or interaction;
5. expected output or visible result;
6. the next useful link.

Use copyable commands. Preserve the repository's actual package manager, directory names, ports, environment variables, and executable names. Never invent commands from convention.

Run safe commands when possible. If execution is unavailable or unsafe, verify them against tests, CI, manifests, and source, then say what remains unexecuted in the final report. Do not expose real secrets; use clearly named placeholders and explain where values come from.

Do not place contributor environment setup in the user quick start unless contributors are the primary audience.

**Done when:** every step is necessary, ordered, and tied to an observable result.

### 6. Add Only Supporting Sections That Earn Their Space

Common useful sections include:

- highlights or use cases;
- compatibility and requirements;
- configuration;
- architecture or component map;
- deployment or self-hosting;
- security, privacy, backup, or data-loss warnings;
- documentation map;
- troubleshooting;
- support channels;
- contributing;
- project status, stability, roadmap, and license.

Place irreversible-risk warnings before the risky action. Be explicit about pre-1.0 instability, data durability, authentication assumptions, destructive commands, network exposure, and unsupported environments when relevant.

Reserve tables for genuine comparisons or matrices. Use collapsible details only for optional material that does not block first success.

**Done when:** each remaining section either advances use, trust, safety, or navigation.

### 7. Edit for Scanability and Truth

Revise the draft with these constraints:

- headings form a predictable hierarchy and use reader language;
- the most common path appears before edge cases;
- paragraphs are short and lists are parallel;
- the same concept uses the same term throughout;
- links use descriptive labels rather than “here”;
- examples are minimal but complete;
- reference documentation is linked instead of duplicated;
- unsupported claims, stale badges, dead screenshots, and promotional filler are removed;
- existing accurate content is retained unless the new structure clearly improves it.

Open [`references/review-rubric.md`](references/review-rubric.md) and apply every mandatory gate. In audit mode, also use its severities and report format.

**Done when:** the README can be skimmed by headings, supports a complete first-use path, and every mandatory gate has been assessed.

### 8. Validate the Result

Discover the repository's documentation checks in contributor docs, manifest scripts, task files, and CI workflows. Review each command before execution, then run the relevant safe formatting, documentation, link, and example checks.

Also run [`scripts/check_readme.py`](scripts/check_readme.py) when Python is available. The script path is relative to this skill directory. From that directory, pass the target README explicitly:

```bash
python3 scripts/check_readme.py /absolute/path/to/repository/README.md --strict
```

For a nested README that links elsewhere in the repository, add `--root /absolute/path/to/repository`. Resolve every warning or justify it in the final report.

Then manually verify:

- rendered Markdown, heading anchors, tables, images, and details blocks;
- all local links and high-value external links;
- installation and quick-start commands in a clean-enough environment;
- expected output against current behavior;
- compatibility and project-status claims against authoritative files;
- no secrets, private paths, account data, or misleading screenshots;
- the diff contains no unrelated rewording or accidental removals.

For translated READMEs, keep shared facts and commands synchronized, but preserve natural language rather than line-by-line literalism.

**Done when:** in editing mode, every mandatory rubric gate and relevant automated check passes, the rendered document is visually sound, and the diff contains only intended changes. In audit mode, every gate has evidence and every uncertainty affecting a mandatory gate produces a `not ready` verdict. In both modes, report source-verified but unexecuted checks explicitly.

## Output

When editing a repository, make the README change directly. Report:

- the primary reader and first-success path chosen;
- the material structural changes;
- commands and links actually verified;
- any claim or step that could not be executed or independently confirmed.

For audit-only requests, use the severity levels and report format in [`references/review-rubric.md`](references/review-rubric.md); prioritize concrete fixes over taste-based commentary.
