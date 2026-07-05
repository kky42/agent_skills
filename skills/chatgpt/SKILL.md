---
name: chatgpt
description: Use when the user says ask ChatGPT, GPT Pro, GPT-5.5, ChatGPT web, or wants ChatGPT Projects, sources, connectors, model/reasoning selection, or seed/harvest workers via playwright-cli.
allowed-tools: Bash(playwright-cli:*) Bash(python:*) Bash(node:*) Bash(npm:*)
---

# ChatGPT Web via playwright-cli

Use ChatGPT as a browser product, not an API. Keep the loop **tight**: one named browser session, one current tab, compact `run-code` actions, and an explicit verification artifact before claiming success.

Validation evidence lives in [`VALIDATION.md`](VALIDATION.md). Load it when you need exact proof, caveats, or selectors from the last full verification run.

## Core Loop

1. **Attach** to the user's logged-in browser.

   ```bash
   playwright-cli attach --extension=chrome-canary --session chatgpt
   playwright-cli list
   playwright-cli -s=chatgpt tab-list
   ```

   Completion criterion: `playwright-cli list` shows one intended `chatgpt` session.

2. **Choose the surface**.

   - Normal chat: one-off questions, no shared Project sources.
   - Project chat: persistent context, Project sources, Project runtime, worker farms.
   - Project sources: large/static files, text sources, Drive/Slack source connectors.
   - GitHub connector: fast-changing repo facts from live GitHub.

   Completion criterion: the page URL and visible UI match the intended surface.

3. **Act with a compact script**.

   Prefer one `run-code` per browser action over snapshot/click loops:

   ```bash
   playwright-cli --raw -s=chatgpt run-code \
     "async page => JSON.stringify({ url: page.url(), title: await page.title() })"
   ```

   For larger actions, write a temp JS file and run `--filename`. In extension `run-code`, use `await page.waitForTimeout(ms)`; global `setTimeout` may be unavailable.

4. **Verify**.

   Read URL/title/body text or saved receipt files. Do not claim an operation worked from a click alone.

## Tab Discipline

- Reuse session `chatgpt`.
- Do not use `tab-new` for routine ChatGPT work.
- Prefer `goto` in the current page.
- Check tab count before and after long automation:

  ```bash
  playwright-cli -s=chatgpt tab-list
  ```

- If many user tabs are open, ask before closing them.

## Normal Chat

Use `https://chatgpt.com/` for small independent questions or connector-backed one-offs.

Verified send/read pattern:

1. `goto https://chatgpt.com/`.
2. Fill the visible composer textbox.
3. Click `button[data-testid="send-button"]` or a Send-labelled button.
4. Poll `[data-message-author-role="assistant"]` until the expected marker appears and Stop is gone.

Use normal chat when Project sources are unnecessary. The composer `Add files and more` menu exposes tools/connectors such as Web search, Deep research, GitHub, OpenAI Platform, and Finances.

## Project Chat

Use a Project when context must persist across many chats or when chats should share Project sources/runtime.

Observed URL forms:

```text
https://chatgpt.com/g/<project-id>/project
https://chatgpt.com/g/<project-id>/project?tab=sources
https://chatgpt.com/g/<project-id>/c/<conversation-id>
```

Verified Project facts:

- Project tabs: `Chats`, `Sources`.
- Project composer can send/read like normal chat.
- Project runtime was validated by asking ChatGPT to run `printf CHATGPT_SKILL_BASH_OK` and receiving that exact output.

For runtime-dependent tasks, prompt ChatGPT to run a concrete command and report exact output. Treat the assistant's response as evidence, then require downstream local validation for any code/results it proposes.

## Project Sources

Use Project sources for large or slow-changing context: zipped datasets, source snapshots, evaluator scripts, reproducible experiment packages, and static docs shared by many chats.

Use GitHub connector/repo context for fast-changing material: current source files, queues, ledgers, and WIP notes.

### Text source

Verified flow:

1. Open `/project?tab=sources`.
2. Click `Add sources`.
3. Click `Text input`.
4. Fill `Title (optional)` and `Text`.
5. Click `Save`.
6. Verify the `.txt` source appears.
7. Remove via `Source actions -> Delete` when done.

### File source

With the Playwright Extension, prefer drag/drop upload; file chooser upload hit a browser security error in validation.

Verified flow:

```bash
playwright-cli -s=chatgpt click <Add sources ref>
playwright-cli -s=chatgpt drop <Drag sources here ref> --path=/absolute/path/to/file.md
```

Then verify the file source appears. Remove via `Source actions -> Delete`.

### Drive and Slack

`Add sources` exposes:

- `Upload`
- `Text input`
- `Google Drive`
- `Slack`

Google Drive and Slack were verified up to their auth gates. Do not proceed through OAuth or broad workspace permissions unless the user explicitly asks.

## GitHub Connector

Use GitHub for live repo context. Verified flow:

1. Open normal chat or Project composer.
2. Click `Add files and more`.
3. Click `GitHub`.
4. Verify a GitHub chip/selection appears or a connector prompt is visible.
5. Ask a narrow repo question and require a marker or JSON answer.

Validation got `GITHUB_CONNECTOR_OK` for a neurogolf-related repo query. Still ask for exact repo/branch/path in the prompt; connector state can vary by account/session.

## Model And Reasoning Effort

Verified in the Project composer:

- Model entry: `GPT-5.5`.
- Effort button: `Extra High`.
- Menu choices: `Instant`, `Medium`, `High`, `Extra High`, `Pro Extended`.
- `Pro effort options` submenu: `Pro Standard`, `Pro Extended`.

To change effort:

1. Click the current effort button (`Extra High`, `Pro Extended`, etc.).
2. Click the desired effort.
3. Re-read visible button text to verify selection.
4. Restore the prior setting if the change was only a test.

## Worker Farm

Use a repo-local farm script instead of manual browser loops for high-volume planting/harvesting.

Example from `neurogolf-2026`:

```bash
python scripts/chatgpt_pwcli_farm.py --session chatgpt status --browser
python scripts/chatgpt_pwcli_farm.py --session chatgpt batch-plant \
  --prompt-dir .context/chatgpt_farm/prompts \
  --project-url "$CHATGPT_PROJECT_URL" \
  --limit 25 \
  --wait-minutes 60
python scripts/chatgpt_pwcli_farm.py --session chatgpt batch-harvest \
  --all-active \
  --wait-ready-seconds 90
```

Hard rules:

- For Project-source workers, plant only into the Project URL; ordinary `https://chatgpt.com/` chats cannot see Project Sources.
- Verify Project sources before planting (`sources-status` or equivalent browser evidence). For validation-heavy workers, include the data they need (for NeuroGolf, canonical plus extended/fresh ARC-GEN JSONs), not just commands to generate it.
- At least 90 seconds between sends.
- At least 30 seconds between harvest reads.
- At most 25 active planted sessions.
- Every plant writes a receipt with conversation URL and `readAfterIso`.
- For repeated prompt variants on the same task, use an attempt/session key (for example `--attempt-id`) instead of overwriting the active session.
- Every harvest writes raw JSON/Markdown.
- If a chat is still generating, keep it active and harvest again later.

Prompt quality rules for implementation workers:

- Optimize prompts for free exploration plus runnable artifacts, not visible thinking time.
- Require complete solver/patch code in the answer; no code means reject/replant.
- Require source evidence and a public audit log, not private chain-of-thought.
- Require workers to distinguish commands actually run from proposed validation commands.

Validation covered manual plant, batch plant, single harvest, and batch harvest with spacing.

## Verification Checklist

Before reporting success, check the relevant criteria:

- `playwright-cli list` shows the intended session.
- `tab-list` shows no tab explosion.
- URL matches normal chat, Project, source page, or conversation as intended.
- A compact `run-code` returns parseable JSON.
- For Project sources, the source appears before use and disappears after delete tests.
- For connectors, stop at auth gates unless authorized; record whether access was actually verified.
- For model/effort, visible selected label matches the requested setting.
- For worker farms, inspect receipt/harvest files, not sidebar titles.

If any criterion fails, report the failed step and do not generalize the operation as verified.
