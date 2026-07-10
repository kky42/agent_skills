# agent_skills

One place to manage global agent skills across Codex, Pi, and Claude Code. Every skill is either a **mirror** (exact copy of an upstream directory, replaced wholesale on update) or **owned** (this repo is authoritative). Runtime dirs (`~/.agents/skills`, `~/.claude/skills`) are flat symlinks into `skills/`.

```bash
./scripts/skills apply            # link skills into the runtime dirs
./scripts/skills doctor           # health report (--remote checks upstreams)
./scripts/skills update <skill>   # check upstream delta; --apply replaces a mirror, --record-review logs an owned review
./scripts/skills verify [skill]   # run declared dependency checks (incl. reverse dependents)
./scripts/skills list             # skill inventory: ownership, sources, dependencies
```

Operating rules for agents: [`AGENTS.md`](AGENTS.md).

## Skills

### Engineering

Mirrors of [mattpocock/skills](https://github.com/mattpocock/skills):

- **[ask-matt](skills/thirdparty/ask-matt/SKILL.md)** — Router: ask which skill or flow fits your situation.
- **[setup-matt-pocock-skills](skills/thirdparty/setup-matt-pocock-skills/SKILL.md)** — One-time setup for the engineering skills: issue tracker, triage labels, domain doc layout.
- **[code-review](skills/thirdparty/code-review/SKILL.md)** — Review changes since a fixed point along two axes: repo standards and the originating spec.
- **[codebase-design](skills/thirdparty/codebase-design/SKILL.md)** — Shared vocabulary for designing deep modules and finding deepening opportunities.
- **[improve-codebase-architecture](skills/thirdparty/improve-codebase-architecture/SKILL.md)** — Scan a codebase for deepening opportunities, present an HTML report, grill through one.
- **[diagnosing-bugs](skills/thirdparty/diagnosing-bugs/SKILL.md)** — Diagnosis loop for hard bugs and performance regressions.
- **[domain-modeling](skills/thirdparty/domain-modeling/SKILL.md)** — Build and sharpen a project's domain model and ubiquitous language.
- **[to-spec](skills/thirdparty/to-spec/SKILL.md)** — Turn the current conversation into a spec on the project issue tracker.
- **[to-tickets](skills/thirdparty/to-tickets/SKILL.md)** — Break a plan or spec into tracer-bullet tickets with blocking edges.
- **[implement](skills/thirdparty/implement/SKILL.md)** — Implement a piece of work from a spec or set of tickets.
- **[tdd](skills/thirdparty/tdd/SKILL.md)** — Test-driven development: red-green-refactor, integration tests.
- **[triage](skills/thirdparty/triage/SKILL.md)** — Move issues and external PRs through triage roles into agent-ready briefs.
- **[wayfinder](skills/thirdparty/wayfinder/SKILL.md)** — Plan work too big for one session as a shared map of investigation tickets.
- **[research](skills/thirdparty/research/SKILL.md)** — Investigate a question against primary sources; capture findings as Markdown in the repo.
- **[prototype](skills/thirdparty/prototype/SKILL.md)** — Build a throwaway prototype to answer a design question.
- **[resolving-merge-conflicts](skills/thirdparty/resolving-merge-conflicts/SKILL.md)** — Resolve an in-progress git merge/rebase conflict.

### Productivity

Mirrors of [mattpocock/skills](https://github.com/mattpocock/skills):

- **[grilling](skills/thirdparty/grilling/SKILL.md)** — Grill the user relentlessly to stress-test a plan or design.
- **[grill-with-docs](skills/thirdparty/grill-with-docs/SKILL.md)** — Grilling that also builds docs (ADRs and glossary) as it goes.
- **[handoff](skills/thirdparty/handoff/SKILL.md)** — Compact the current conversation into a handoff document for another agent.
- **[teach](skills/thirdparty/teach/SKILL.md)** — Teach a new skill or concept within this workspace.
- **[writing-great-skills](skills/thirdparty/writing-great-skills/SKILL.md)** — Reference for writing and editing predictable skills.

### Planning & research

- **[plan-refiner](skills/reasoning/plan-refiner/SKILL.md)** *(owned)* — Stress-test and refine a plan, roadmap, or next step before execution.
- **[researcher](skills/thirdparty/researcher/SKILL.md)** *(mirror of [krzysztofdudek/ResearcherSkill](https://github.com/krzysztofdudek/ResearcherSkill))* — Optimize something measurable through repeated experiments toward a target metric.

### Browser & search

- **[playwright-cli](skills/thirdparty/playwright-cli/SKILL.md)** *(mirror of [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli))* — Automate browser interactions and work with Playwright tests.
- **[chatgpt](skills/chatgpt/SKILL.md)** *(owned; depends on playwright-cli)* — Drive ChatGPT web: model/reasoning selection, Projects, Deep Research, harvesting results.
- **[opencli-usage](skills/thirdparty/opencli-usage/SKILL.md)** — Top-level map of the `opencli` CLI: adapters, flags, output formats.
- **[opencli-adapter-author](skills/thirdparty/opencli-adapter-author/SKILL.md)** — Write an OpenCLI adapter for a new site, from recon to verify.
- **[opencli-autofix](skills/thirdparty/opencli-autofix/SKILL.md)** — Fix a broken OpenCLI adapter from a trace, retry, and file the upstream issue.
- **[smart-search](skills/thirdparty/smart-search/SKILL.md)** — OpenCLI-based search router, tuned for site-specific and Chinese-language queries.

The three `opencli-*` skills and `smart-search` are mirrors of [jackwener/opencli](https://github.com/jackwener/opencli).

### Data science

- **[kaggle](skills/datascience/kaggle/SKILL.md)** *(owned; depends on playwright-cli and the `kaggle` CLI)* — Kaggle competition operations: intake, validation design, leakage control, submissions.

### Automation

- **[pievo](skills/thirdparty/pievo/SKILL.md)** *(mirror of [kky42/pievo](https://github.com/kky42/pievo))* — Operate pievo, the durable loop runner, through its JSON CLI.
