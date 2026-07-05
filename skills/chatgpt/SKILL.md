---
name: chatgpt
description: Use when the user says ask ChatGPT, GPT Pro, GPT-5.5, ChatGPT web, or wants ChatGPT Projects, sources, connectors, model/reasoning selection, retry/resend, or seed/harvest workers. Prefer OpenCLI first; fall back to playwright-cli only for unsupported UI flows.
allowed-tools: Bash(opencli:*) Bash(playwright-cli:*) Bash(python:*) Bash(node:*) Bash(npm:*)
---

# ChatGPT Web

Use ChatGPT as a browser product, not an API. Prefer **OpenCLI adapter/plugin commands** for normal ask/detail/project-source/retry flows because they return JSON receipts and isolate browser sessions better than a singleton Playwright tab. Fall back to `playwright-cli` only when OpenCLI lacks the needed UI action or when debugging extension-specific behavior.

Validation evidence lives in [`VALIDATION.md`](VALIDATION.md). Load it when you need exact proof, caveats, or selectors from the last full verification run.

## OpenCLI First Loop

1. **Check browser bridge/profile when state is unknown**.

   ```bash
   opencli doctor
   opencli profile list
   opencli profile use <profile-id>
   ```

2. **Send and save a receipt**.

   Normal chat:

   ```bash
   opencli chatgpt ask "$prompt" --new --wait false --site-session ephemeral -f json
   ```

   Project chat:

   ```bash
   opencli chatgpt ask "$prompt" --project <project-id-or-url> --wait false --site-session ephemeral -f json
   ```

   Continue a conversation:

   ```bash
   opencli chatgpt ask "$followup" --conversation <conversation-url> --wait false --site-session ephemeral -f json
   ```

   Save `conversationUrl` as the receipt. Do not hold a browser lock while ChatGPT thinks.

3. **Harvest later**.

   ```bash
   opencli chatgpt detail "$conversationUrl" --wait --stable 3 --timeout 600 --site-session ephemeral -f json
   ```

4. **Use chatgptx plugin for patched flows and receipts**.

   ```bash
   opencli chatgptx status -f json
   opencli chatgptx consult "$prompt" --github true --model-tier normal --wait false -f json
   opencli chatgptx harvest <receipt-or-job-id> --wait true --timeout 600 --stable 3 -f json
   opencli chatgptx broker-enqueue "$prompt" --github true --model-tier pro -f json
   opencli chatgptx broker-run --limit 1 -f json
   opencli chatgptx broker-status -f json
   opencli chatgptx project-source-list --project <project-id> -f json
   opencli chatgptx project-source-delete --project <project-id> --name <file-name> -f json
   opencli chatgptx retry <conversation-url> --mode again -f json
   ```

5. **Verify**.

   Read URL/title/body text, `detail` JSON, project source list, or saved receipt files. Do not claim an operation worked from a click alone.

## Playwright Fallback Loop

Use this only for unsupported UI flows, debugging, or when OpenCLI is broken.

```bash
playwright-cli attach --extension=chrome-canary --session chatgpt
playwright-cli list
playwright-cli -s=chatgpt tab-list
```

Completion criterion: `playwright-cli list` shows one intended `chatgpt` session.

If attach hangs or the extension page says `Invalid token provided`, recover the Chrome Canary Playwright Extension token before retrying (see **Chrome Canary Extension Token** below).

## Chrome Canary Extension Token

The Playwright Extension uses a local pairing token. It is not a ChatGPT token. It can change when Chrome Canary, the extension, or the browser profile changes. The CLI token must match the token shown by the extension.

Symptoms of a stale token:

- `playwright-cli attach --extension=chrome-canary --session chatgpt` hangs.
- A `chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html...` tab says `Invalid token provided`.
- The shell has an old `PLAYWRIGHT_MCP_EXTENSION_TOKEN` value.

Recovery flow:

1. Open/click the Playwright Extension icon in Chrome Canary, or inspect an existing `status.html` tab.
2. Read the status text. If automation is allowed and a status tab exists, this pattern works:

   ```bash
   osascript <<'OSA'
   tell application "Google Chrome Canary"
     repeat with w from 1 to count of windows
       repeat with i from 1 to count of tabs of window w
         set u to URL of tab i of window w
         if u starts with "chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/status.html" then
           set active tab index of window w to i
           delay 0.2
           return execute tab i of window w javascript "document.body.innerText"
         end if
       end repeat
     end repeat
     return "no status tab"
   end tell
   OSA
   ```

3. Copy the line `PLAYWRIGHT_MCP_EXTENSION_TOKEN=<token>`.
4. Update the local shell env source (normally `~/.zshenv.local`, sourced by zsh and bash on this machine), or use the token inline:

   ```bash
   PLAYWRIGHT_MCP_EXTENSION_TOKEN='<token>' \
     playwright-cli attach --extension=chrome-canary --session chatgpt
   ```

5. Kill stale attach daemons before retrying if necessary:

   ```bash
   pkill -f 'playwright-cli attach --extension=chrome-canary --session=chatgpt' || true
   pkill -f 'cliDaemon.js chatgpt .*--extension' || true
   ```

Verify after retry: `playwright-cli list` shows `chatgpt` attached to `chrome-canary`, then `playwright-cli -s=chatgpt tab-list` works.

## Browser Session Discipline

- Prefer OpenCLI `--site-session ephemeral` for ask/detail fan-out.
- For ad-hoc browser driving, use a task-scoped OpenCLI browser session and close it when done:

  ```bash
  opencli browser chatgpt-<task> open https://chatgpt.com/ --window background
  opencli browser chatgpt-<task> close || true
  ```

- Use `--keep-tab true` only for debugging or an explicit handoff; report session name and URL.
- In Playwright fallback, reuse session `chatgpt`; do not use `tab-new` for routine work.
- Check tab/session count before and after long automation.
- If many user tabs are open, ask before closing them.

## Conversation Continuity And Follow-ups

Follow-up questions should usually continue the same ChatGPT conversation, not start a fresh chat.

- Save or report the conversation URL after the first successful send, e.g. `https://chatgpt.com/c/<conversation-id>` or Project conversation URL.
- For a follow-up, `goto` the saved conversation URL (or keep the current tab if already there), verify the title/body matches the prior task, then send the follow-up in the same composer.
- Mention relevant previous constraints briefly in the follow-up prompt; do not assume ChatGPT retained hidden context perfectly.
- Harvest only the latest assistant message for the follow-up, but keep the full conversation URL as the receipt.
- If the prior answer is still generating, do not send a follow-up; wait until Stop is gone.
- If connector/source context matters, verify the GitHub chip, Project URL, or Sources tab again before the follow-up.

## Concurrency And Multi-agent Use

Multiple agents driving the same ChatGPT account can type into the wrong composer, switch global UI state, interrupt generation, or harvest the wrong answer. OpenCLI improves tab isolation, but agents still need external state: a lock plus receipts.

Preferred pattern: **OpenCLI send-and-release, then scheduled harvest**.

- Hold a browser/account lock only while performing mutations: connector selection, model/effort switch, project source add/delete, retry/resend, fill, send, or harvest read.
- Respect pacing while holding the lock: access/harvest every 30s; prompt submissions every 30s for normal model and 60s for pro unless overridden.
- After send is accepted and the conversation URL is saved, release the lock. Do not hold the lock for the whole model thinking time.
- Store a receipt with `conversationUrl`, `promptHash` or task id, model/effort, sent time, expected earliest harvest time, and output path. Prefer `chatgptx consult` or `chatgptx broker-enqueue` so this is automatic.
- Harvest later by reacquiring the lock, going to the receipt URL, checking whether Stop is gone, saving the latest assistant message, then releasing the lock again. Prefer `chatgptx harvest` or `chatgptx broker-run`.
- If Stop is still present or the answer is incomplete, update `readAfterIso` and release the lock; do not wait while holding it.
- Follow-ups must use the same receipt/conversation URL and the same lock protocol.

Suggested harvest schedule by effort:

| Effort / task kind | First harvest | Retry cadence |
| --- | ---: | ---: |
| Instant / small normal chat | 30-60s | 30s |
| Medium | 2-4m | 1-2m |
| High | 5-8m | 2-3m |
| Extra High | 10-15m | 3-5m |
| Pro Standard | 15-25m | 5-10m |
| Pro Extended / deep research | 30-60m | 10-20m |

For manual one-off operations, serialize each browser operation with a local lock:

```bash
lock=/tmp/chatgpt-playwright.lock
if ! mkdir "$lock" 2>/dev/null; then
  echo "chatgpt session busy: $lock" >&2
  exit 75
fi
cat > "$lock/owner.json" <<EOF
{"pid":$$,"cwd":"$PWD","started_at":"$(date -u +%FT%TZ)"}
EOF
trap 'rm -rf "$lock"' EXIT
# opencli chatgpt/chatgptx mutation or playwright fallback only
```

Rules:

- Do not ask parallel subagents to independently drive the same `chatgpt` session unless they all obey the same lock/receipt protocol.
- The lock protects browser interaction, not the whole ChatGPT generation.
- Release the lock immediately after the send receipt is saved, and after each harvest attempt.
- If a lock is stale, inspect owner process/session before removing it; never delete another active agent's lock blindly.
- If true simultaneous browser interaction is required, use separate browser profiles/sessions and separate conversations, then merge results outside the browser.

## Broker / Receipt Queue

Use the broker when multiple agents or long-running prompts need safe coordination.

```bash
opencli chatgptx broker-enqueue "$prompt" --github true --tag <task> -f json
opencli chatgptx broker-run --limit 1 -f json      # sends one queued job or harvests one due job
opencli chatgptx broker-status -f json
```

Default state is `~/.local/state/chatgptx/` unless `CHATGPTX_STATE_DIR` is set. Each receipt records prompt hash, connector choice, model tier, pacing intervals, conversation URL, `readAfterIso`, output path, attempts, and history. Use `--receipt-dir` and `--output` for project-local artifacts.

## Rate Limits And Pacing

ChatGPT may show a `Too many requests` modal even when one click on `Got it` clears it. `chatgptx` handles this by dismissing the modal, recording a cooldown in `~/.local/state/chatgptx/rate-state.json`, and waiting before retrying the page action.

Defaults:

- Submit interval, normal model: `30s`.
- Submit interval, pro model: `60s` (`--model-tier pro`).
- Access/harvest interval: `30s`.

Useful flags:

```bash
opencli chatgptx consult "$prompt" --model-tier normal          # submit every 30s
opencli chatgptx consult "$prompt" --model-tier pro             # submit every 60s
opencli chatgptx consult "$prompt" --submit-interval 45         # override submit pacing
opencli chatgptx harvest <job> --access-interval 30             # read/visit pacing
opencli chatgptx status -f json                                 # shows next access/submit slot
```

Keep `--rate-wait true` unless you want fail-fast behavior. With `--rate-wait false`, commands stop and report the next allowed slot instead of sleeping.

## Normal Chat

Use normal chat for small independent questions when Project sources are unnecessary.

Preferred send/read pattern:

```bash
opencli chatgpt ask "$prompt" --new --wait false --site-session ephemeral -f json
opencli chatgpt detail "$conversationUrl" --wait --stable 3 --timeout 600 --site-session ephemeral -f json
```

The composer `Add files and more` menu exposes tools/connectors such as Web search, Deep research, GitHub, OpenAI Platform, and Finances. OpenCLI's built-in `--web-search` and `--deep-research` are available. Use `opencli chatgptx consult "$prompt" --github true` when you need a real GitHub connector pill plus a receipt.

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

Preferred OpenCLI flow:

```bash
opencli chatgpt project-file-add /absolute/path/to/file.md \
  --id <project-id> \
  --site-session persistent \
  --keep-tab true \
  -f json
opencli chatgptx project-source-list --project <project-id> -f json
```

Important: `project-file-add` can return before source indexing is fully usable. Verify the filename in Sources and, for critical runs, ask a marker question before planting workers.

Delete with:

```bash
opencli chatgptx project-source-delete --project <project-id> --name <file-name> -f json
```

Playwright drag/drop remains a fallback if OpenCLI upload breaks.

### Drive and Slack

`Add sources` exposes:

- `Upload`
- `Text input`
- `Google Drive`
- `Slack`

Google Drive and Slack were verified up to their auth gates. Do not proceed through OAuth or broad workspace permissions unless the user explicitly asks.

## GitHub Connector

Use GitHub for live repo context, but verify access per repo/session.

Observed behavior:

- Plain text `@github` sent through `opencli chatgpt ask` may be treated as text, not a connector pill.
- Browser UI can turn `@github` into a real inline connector pill (`data-inline-selection-pill`, `data-keyword="GitHub"`).
- A real pill still may fail if ChatGPT's GitHub connector lacks repo/account access.

Flow:

1. Open normal chat or Project composer.
2. Type `@github`, select the GitHub suggestion, and verify the GitHub pill appears.
3. Ask a narrow repo/branch/path question and require a marker or JSON answer.
4. If the answer says unavailable, report connector access failure; do not silently fall back to local `gh` unless the user asked for that.

`opencli chatgptx consult "$prompt" --github true` encapsulates explicit connector selection and fails if the GitHub pill is not created. If the answer says unavailable, report connector access failure; do not silently fall back to local `gh` unless the user asked for that.

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

- `opencli chatgptx status -f json` works when patched commands are needed.
- OpenCLI command output includes the expected `conversationUrl`, receipt path, rows, or status.
- For brokered jobs, `chatgptx broker-status` shows `sent` or `done`, and `Output` exists for `done` jobs.
- In Playwright fallback, `playwright-cli list` shows the intended session and `tab-list` shows no tab explosion.
- URL matches normal chat, Project, source page, or conversation as intended.
- Browser snippets return parseable JSON.
- For Project sources, `chatgptx project-source-list` shows the source before use and no visible row after delete tests.
- For connectors, stop at auth gates unless authorized; record whether access was actually verified.
- For model/effort, visible selected label matches the requested setting.
- For worker farms, inspect receipt/harvest files, not sidebar titles.

If any criterion fails, report the failed step and do not generalize the operation as verified.
