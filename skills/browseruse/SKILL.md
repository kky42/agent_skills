---
name: browseruse
description: Use when driving a live browser through OpenCLI for ad-hoc web tasks, UI verification, screenshots, scraping visible page state, or building reusable browser workflows. Prefer this over raw playwright-cli when OpenCLI browser sessions are available, especially for concurrent agent work.
---

# browseruse

Use OpenCLI `browser` commands as the default live-browser surface. Keep browser state explicit, isolated, and cleaned up.

## When To Use

- The task needs visible browser state: login-gated pages, UI clicks, screenshots, file upload, or manual verification.
- Multiple agents may need browser work and need separate sessions.
- You are exploring UI behavior before turning it into an OpenCLI adapter/plugin command.
- You need deterministic receipts: URL, extracted text, screenshot path, downloaded file path, or command JSON output.

Use a site adapter command instead of raw browser driving when one exists, e.g. `opencli chatgpt ask`, `opencli github ...`, or `opencli web read`.

## Session Discipline

- Pick a task-scoped session name: `site-purpose-<short-id>`.
- Use `--window background` by default. Use foreground only when human visual inspection matters.
- Close sessions you opened:

  ```bash
  opencli browser <session> close || true
  ```

- Use `--keep-tab true` only for debugging, long-running user-visible state, or a receipt that explicitly names the session.
- Before leaving a kept session, report session name, URL, and why it remains open.
- Do not reuse another agent's browser session unless the task explicitly says to continue it.

## Concurrency

OpenCLI browser sessions isolate tabs better than a single shared Playwright extension session, but they still share the same browser profile and site account.

- Parallel read-only page inspection is usually fine with separate session names.
- Serialize global UI mutations: changing account settings, changing model, connecting integrations, uploading/deleting project sources, or submitting prompts in a shared app.
- Use a file lock around shared-account mutations:

  ```bash
  lock=/tmp/opencli-browser-chatgpt.lock
  if ! mkdir "$lock" 2>/dev/null; then
    echo "browser mutation busy: $lock" >&2
    exit 75
  fi
  trap 'rm -rf "$lock"' EXIT
  ```

- Release locks after the mutation/receipt is complete. Do not hold locks while a remote model or page is merely thinking.

## Workflow

1. `opencli doctor` if browser bridge state is unknown.
2. `opencli profile list` / `opencli profile use <id>` if multiple profiles are connected.
3. Open a task-scoped session:

   ```bash
   opencli browser <session> open <url> --window background
   ```

4. Inspect state before acting:

   ```bash
   opencli browser <session> state
   opencli browser <session> find --css '<selector>'
   ```

5. Prefer semantic selectors (`--role`, `--name`, `--text`, `--testid`) or stable CSS. If a ref goes stale, rerun `state`.
6. Verify postconditions with `state`, `get url`, `extract`, `screenshot`, or adapter-specific reads.
7. Close the session unless intentionally kept.

## Cleanup Rules

- Every opened session needs one of: closed, kept with receipt, or handed off with explicit session name.
- If a run fails, still attempt `opencli browser <session> close` unless preserving state for trace/debug.
- Do not close user-owned tabs or unrelated sessions.
- If OpenCLI leaves too many tabs/groups, list sessions/tabs first, then close only sessions created by the current task.

## Turning Browser Work Into Tools

If you repeat a browser sequence more than twice, promote it:

- Browser-only reusable operation → OpenCLI plugin command under the owning skill's `tools/` directory.
- Site-wide reusable adapter → `~/.opencli/clis/<site>/<command>.js` for a quick local draft, then an upstream OpenCLI PR if generally useful.
- Multi-agent queue/receipt workflow → external CLI or broker wrapper, then register it as a tool dependency.

Record new tool dependencies in the owning skill's `skill.meta.json` and run:

```bash
/Users/kky/dev/agent_skills/scripts/skill-sync
/Users/kky/dev/agent_skills/scripts/skill-deps check
```
