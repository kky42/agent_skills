---
name: chatgpt
description: Use when the user says ask ChatGPT, GPT Pro, GPT-5.5, ChatGPT web, ChatGPT Projects, model/reasoning selection, Deep Research, Web Search, connectors, project sources, retry/resend, or browser-based ChatGPT harvesting. Uses playwright-cli as the only browser automation transport.
allowed-tools: Bash(playwright-cli:*) Bash(python:*) Bash(python3:*) Bash(node:*) Bash(npm:*) Bash(osascript:*) Bash(pkill:*) Bash(mkdir:*) Bash(rm:*) Bash(date:*) Bash(ps:*) Bash(sleep:*) Bash(cat:*) Bash(tee:*)
---

# ChatGPT Web via playwright-cli

Use ChatGPT as a browser product, not an API. Drive it through `playwright-cli`, preferably attached to the already logged-in Chrome Canary profile with the Playwright Extension.

`playwright-cli` gives low-level browser primitives; this skill adds the missing ChatGPT-specific protocol: account locks, tab leases, receipts, pacing, cleanup, and verification.

Validation evidence lives in [`VALIDATION.md`](VALIDATION.md). Some older validation may mention other adapters; follow this Playwright-first protocol for new ChatGPT work.

## Operating Model

- Treat the ChatGPT account and attached Chrome profile as shared mutable state.
- Use one browser writer at a time for sends, model/tool changes, source edits, retries, and harvest reads.
- Release the lock while ChatGPT thinks. Save a receipt with the conversation URL, then harvest later.
- Prefer attached Chrome Canary for logged-in ChatGPT work. Do not create fresh persistent profiles unless the user explicitly wants isolation and is willing to log in there.
- Do not use `close-all`, `kill-all`, `delete-data`, cookie clearing, localStorage clearing, or profile deletion on an attached user browser unless the user explicitly asks.
- Verify visible state after every important UI action. A click is not proof.

## What playwright-cli Does Not Provide

Compensate for these gaps yourself:

| Missing in base `playwright-cli` | Required ChatGPT discipline |
| --- | --- |
| No account/browser mutex | Use `tools/playwright/chatgpt-pw-lock` before every browser mutation or harvest. |
| No job receipts | Write receipt JSON for every sent prompt. |
| No pacing/rate limit state | Enforce submit/access intervals and record cooldowns. |
| No broker queue | For multi-agent or batch work, queue receipt files and run one browser operation at a time. |
| No site-specific selectors | Verify ChatGPT composer, tool pill, model label, conversation URL, and generation state. |
| No shared-profile safety | Only close tabs you opened; detach instead of closing Chrome Canary. |
| `run-code` cannot read shell env | Generate temporary JS with JSON-embedded prompt/config using Python or Node. |

## Default Session

Use a stable attached session name. On this machine prefer:

```bash
export CHATGPT_PW_SESSION=${CHATGPT_PW_SESSION:-chatgpt-canary}
playwright-cli attach --extension=chrome-canary --session "$CHATGPT_PW_SESSION"
playwright-cli list --json
playwright-cli -s="$CHATGPT_PW_SESSION" tab-list
```

If the session already exists, reuse it. If work is complete, detach the Playwright controller without closing the real browser:

```bash
playwright-cli -s="$CHATGPT_PW_SESSION" detach
```

Use `playwright-cli -s="$CHATGPT_PW_SESSION" close` only for sessions created with `open`, not for attached Chrome Canary sessions.

## Chrome Canary Extension Token

The Playwright Extension uses a local pairing token. It is not a ChatGPT token. It can change when Chrome Canary, the extension, or the browser profile changes.

Symptoms of a stale token:

- `playwright-cli attach --extension=chrome-canary --session ...` hangs.
- A `chrome-extension://.../connect.html` tab says `Invalid token provided`.
- The shell has an old `PLAYWRIGHT_MCP_EXTENSION_TOKEN` value.

Recovery:

1. Open/click the Playwright Extension icon in Chrome Canary, or inspect an existing `status.html` tab.
2. If automation is allowed, this usually extracts the status text:

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

3. Copy `PLAYWRIGHT_MCP_EXTENSION_TOKEN=<token>` into the local shell env source, or use it inline.
4. Kill stale attach attempts if necessary:

   ```bash
   pkill -f 'playwright-cli attach --extension=chrome-canary' || true
   pkill -f 'cliDaemon.js .*--extension' || true
   ```

5. Retry attach and verify `tab-list` works.

## Lock Protocol

Use the bundled lock helper before any operation that touches ChatGPT UI state: opening/selecting tabs, changing model/tool, filling composer, sending, retrying, reading a still-changing answer, adding/deleting sources, or closing tabs.

```bash
export CHATGPT_PW_SESSION=${CHATGPT_PW_SESSION:-chatgpt-canary}
export CHATGPT_PW_LOCK=${CHATGPT_PW_LOCK:-$HOME/.agents/skills/chatgpt/tools/playwright/chatgpt-pw-lock}
python3 "$CHATGPT_PW_LOCK" status --json
```

For a single browser command, prefer `run`; it acquires and releases automatically:

```bash
python3 "$CHATGPT_PW_LOCK" run --session "$CHATGPT_PW_SESSION" -- \
  playwright-cli -s="$CHATGPT_PW_SESSION" tab-list
```

For a multi-command critical section, acquire once and release with the returned token. Keep acquire/release in the same shell block; do not acquire in one tool call and release in a later tool call.

```bash
lock_json=$(python3 "$CHATGPT_PW_LOCK" acquire \
  --session "$CHATGPT_PW_SESSION" \
  --owner "${USER:-agent}:$$" \
  --wait 300 \
  --json)
lock_token=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])' <<<"$lock_json")
trap 'python3 "$CHATGPT_PW_LOCK" release --token "$lock_token" >/dev/null || true' EXIT

# browser mutation or harvest here

python3 "$CHATGPT_PW_LOCK" release --token "$lock_token"
trap - EXIT
```

If a previous process crashed, inspect first, then let the helper release only stale locks:

```bash
python3 "$CHATGPT_PW_LOCK" status --json
python3 "$CHATGPT_PW_LOCK" release --force --if-stale
```

Rules:

- The lock protects browser/account interaction, not the entire model generation time.
- Release the lock immediately after send is accepted and the receipt is saved.
- Reacquire the lock for each harvest attempt, then release it again.
- Use the helper for stale cleanup; do not `rm -rf` lock directories by hand.
- Do not force-release an active lock unless the user explicitly authorizes taking over the browser.
- Do not ask parallel agents to drive the same `CHATGPT_PW_SESSION`. Parallel agents may prepare prompts or analyze outputs, but a single broker/driver should touch the browser.

## Tab Lease Discipline

- Use one tab per job while sending or harvesting.
- Record the conversation URL in the receipt as soon as it appears.
- Close only tabs you opened for the job, unless `--keep-tab`-style debugging was explicitly requested.
- If the user already has many ChatGPT tabs, avoid broad tab cleanup; report the session and URL instead.
- For attached Chrome Canary, prefer `detach` over `close` at the end.

Typical send lifecycle:

1. Acquire lock.
2. Attach/reuse `CHATGPT_PW_SESSION`.
3. `tab-new` the target (`https://chatgpt.com/new`, a Project URL, or an existing conversation URL).
4. Select model/tool/source context.
5. Fill composer and send.
6. Wait until a conversation URL exists and the prompt visibly moved into the thread.
7. Write receipt.
8. Optionally close the send tab.
9. Release lock while ChatGPT thinks.

Typical harvest lifecycle:

1. Acquire lock.
2. Open/goto receipt `conversationUrl`.
3. Check whether generation is still running.
4. Extract latest assistant output or Deep Research iframe text.
5. Write output and update receipt.
6. Close own harvest tab unless debugging.
7. Release lock.

## Receipts

Every send must produce a receipt. Minimum schema:

```json
{
  "jobId": "short-stable-id",
  "status": "sent",
  "promptHash": "sha256:...",
  "conversationUrl": "https://chatgpt.com/c/...",
  "projectUrl": null,
  "model": "extra-high",
  "tool": "web-search|deep-research|github|null",
  "sentAtIso": "2026-07-05T00:00:00Z",
  "readAfterIso": "2026-07-05T00:10:00Z",
  "outputPath": "/tmp/chatgpt-job.md",
  "session": "chatgpt-canary",
  "history": []
}
```

Suggested locations:

```text
~/.local/state/chatgpt-playwright/receipts/<job-id>.json
~/.local/state/chatgpt-playwright/outputs/<job-id>.md
```

For multi-agent work, use receipt files as the broker. Only one browser driver should process due receipts. Other agents can enqueue prompts by writing receipt stubs or prompt files; they should not independently operate the browser.

## Pacing And Rate Limits

Default pacing:

| Operation | Minimum spacing |
| --- | ---: |
| Page access / harvest read | 30s |
| Normal submit | 30s |
| Pro / Extra High submit | 60s |
| Deep Research submit | 60s+ |

Suggested first harvest:

| Effort / task kind | First harvest | Retry cadence |
| --- | ---: | ---: |
| Instant / small normal chat | 30-60s | 30s |
| Medium | 2-4m | 1-2m |
| High | 5-8m | 2-3m |
| Extra High | 10-15m | 3-5m |
| Pro Standard | 15-25m | 5-10m |
| Pro Extended / Deep Research | 30-60m | 10-20m |

If ChatGPT shows `Too many requests` or `You're making requests too quickly`:

1. Click `Got it` if present.
2. Save the cooldown in the receipt or `~/.local/state/chatgpt-playwright/rate-state.json`.
3. Do not retry in a tight loop. Wait or report the next retry time.

## Run-code Pattern

`playwright-cli run-code --filename` executes a single function in Playwright's context. It cannot read shell variables via `process.env`. Generate temporary JS with JSON literals embedded:

```bash
prompt_file=/tmp/prompt.md
js_file=/tmp/chatgpt-send-$$.js
python3 - "$prompt_file" "$js_file" <<'PY'
import json, sys
prompt = open(sys.argv[1]).read()
out = sys.argv[2]
open(out, 'w').write("async page => {\n  const prompt = " + json.dumps(prompt, ensure_ascii=False) + ";\n  return await (async () => ({ ok: true, chars: prompt.length }))();\n}\n")
PY
playwright-cli --raw -s="$CHATGPT_PW_SESSION" run-code --filename="$js_file"
rm -f "$js_file"
```

Use `--raw` when piping JSON to files or parsers.

## Normal Chat: Send

Minimal send flow:

```bash
export CHATGPT_PW_SESSION=${CHATGPT_PW_SESSION:-chatgpt-canary}
prompt_file=/tmp/prompt.md
js_file=/tmp/chatgpt-send-$$.js
python3 - "$prompt_file" "$js_file" <<'PY'
import json, sys
prompt = open(sys.argv[1]).read()
out = sys.argv[2]
open(out, 'w').write(f'''async page => {{
  const prompt = {json.dumps(prompt, ensure_ascii=False)};
  await page.goto('https://chatgpt.com/new', {{ waitUntil: 'domcontentloaded' }});
  await page.locator('#prompt-textarea, [data-testid="prompt-textarea"]').last().waitFor({{ timeout: 30000 }});
  const editor = page.locator('#prompt-textarea, [data-testid="prompt-textarea"]').last();
  await editor.fill(prompt);
  await page.waitForTimeout(500);
  const send = page.locator('button[data-testid="send-button"], #composer-submit-button').last();
  await send.waitFor({{ timeout: 15000 }});
  await send.click();
  await page.waitForFunction(() => /chatgpt\\.com\\/(?:g\\/g-p-[^/]+\\/)?c\\/[A-Za-z0-9_-]+/.test(location.href), null, {{ timeout: 45000 }});
  return JSON.stringify({{ ok: true, conversationUrl: page.url(), title: await page.title() }});
}}
''')
PY
playwright-cli --raw -s="$CHATGPT_PW_SESSION" run-code --filename="$js_file"
rm -f "$js_file"
```

After send:

- Parse `conversationUrl`.
- Verify the URL is not `/new`.
- Write the receipt.
- Release the lock.

If `fill()` fails or the send button stays disabled, inspect a snapshot and use explicit click/type as fallback:

```bash
playwright-cli -s="$CHATGPT_PW_SESSION" snapshot --depth=4
playwright-cli -s="$CHATGPT_PW_SESSION" click '#prompt-textarea'
playwright-cli -s="$CHATGPT_PW_SESSION" type "short diagnostic prompt"
```

For long prompts, prefer generated `run-code` with `locator.fill()` over CLI `type`; it is faster and less error-prone.

## Normal Chat: Harvest

Harvest the latest answer from a saved conversation URL:

```bash
conversationUrl='https://chatgpt.com/c/...'
playwright-cli -s="$CHATGPT_PW_SESSION" goto "$conversationUrl"
playwright-cli --raw -s="$CHATGPT_PW_SESSION" run-code "async page => {
  await page.waitForTimeout(2000);
  const stop = await page.locator('button[aria-label*=\"Stop\"], button[data-testid*=\"stop\"]').count().catch(() => 0);
  const turns = await page.locator('section[data-testid^=\"conversation-turn-\"]').all();
  let text = '';
  for (const turn of turns) {
    const body = await turn.innerText().catch(() => '');
    if (/ChatGPT said:|Sora said:|Assistant/.test(body) || body.length > text.length) text = body;
  }
  return JSON.stringify({ generating: stop > 0, url: page.url(), title: await page.title(), text });
}"
```

Stability rule:

- If `generating` is true, update `readAfterIso` and release the lock.
- If text length changes between two reads separated by 3-10 seconds, wait and retry later.
- Save raw JSON plus Markdown output. Do not summarize away source evidence unless the user asked for a summary.

## Deep Research

Sending Deep Research is just a normal send with tool selection first. Harvesting is different: the final report may live inside a cross-origin sandbox iframe.

Use the bundled extractor after opening the conversation:

```bash
playwright-cli -s="$CHATGPT_PW_SESSION" goto "$conversationUrl"
playwright-cli --raw -s="$CHATGPT_PW_SESSION" run-code \
  --filename=/Users/kky/dev/agent_skills/skills/chatgpt/tools/playwright/deep-research-extract-current.js \
  > /tmp/deep-research.json
python3 - <<'PY'
import json
raw = open('/tmp/deep-research.json').read().strip()
data = json.loads(json.loads(raw)) if raw.startswith('"') else json.loads(raw)
print(data.get('text',''))
PY
```

Deep Research is done when the extracted text contains a report body and the visible page no longer shows an active research/progress state. If only the user prompt is visible, update `readAfterIso` and retry later.

## Model And Reasoning Effort

Before sending, explicitly set and verify the desired model/effort when it matters.

Known labels include:

- `Instant`
- `Medium`
- `High`
- `Extra High`
- `Pro Standard`
- `Pro Extended`

Procedure:

1. Snapshot the composer area.
2. Click the current model/effort button near the composer.
3. Click the desired option by visible text.
4. Re-read the visible label and fail if it does not match.
5. Mention the selected model/effort in the receipt.

Do not assume a previous conversation's effort carries over correctly. ChatGPT UI state is global and can drift.

## Tools And Connectors

The composer `Add files and more` menu exposes tools/connectors such as Web Search, Deep Research, GitHub, OpenAI Platform, and Finances.

Procedure:

1. Click `button[data-testid="composer-plus-btn"]` or `#composer-plus-btn`.
2. Select the desired item by visible text (`Web search`, `Deep research`, `GitHub`, etc.).
3. Verify the composer shows the selected pill/tool state before sending.
4. Include `tool` in the receipt.

For GitHub connector:

- A plain text `@github` is not enough. Verify a real inline connector pill appears.
- Ask a narrow repo/branch/path question first to prove access.
- If ChatGPT says GitHub connector is unavailable or lacks access, report that. Do not silently fall back to local `gh` unless the user asked for local GitHub access.

## Project Chat

Use a Project when context must persist across many chats or when chats should share Project sources/runtime.

Observed URL forms:

```text
https://chatgpt.com/g/<project-id>/project
https://chatgpt.com/g/<project-id>/project?tab=sources
https://chatgpt.com/g/<project-id>/c/<conversation-id>
```

Project send flow:

1. Acquire lock.
2. Open the Project URL, not ordinary `/new`.
3. Verify the page title/body identifies the intended Project.
4. Verify required Sources exist if the prompt depends on them.
5. Select model/tool if needed.
6. Fill composer and send.
7. Save Project conversation URL in the receipt.
8. Release lock while ChatGPT thinks.

For runtime-dependent tasks, ask ChatGPT to run a concrete command and report exact output. Treat the answer as evidence, then validate locally before acting on code/results.

## Project Sources

Use Project sources for large or slow-changing context: zipped datasets, source snapshots, evaluator scripts, reproducible experiment packages, and static docs shared by many chats.

Use GitHub connector/repo context for fast-changing material: current source files, queues, ledgers, and WIP notes.

### Text source

1. Open `/project?tab=sources`.
2. Click `Add sources`.
3. Click `Text input`.
4. Fill `Title (optional)` and `Text`.
5. Click `Save`.
6. Verify the `.txt` source appears.
7. Delete test sources after validation.

### File source

1. Open `/project?tab=sources`.
2. Click `Add sources` -> `Upload`.
3. Use `playwright-cli -s="$CHATGPT_PW_SESSION" upload /absolute/path/to/file` when the file chooser is active.
4. Wait for the filename to appear.
5. For critical runs, ask a marker question that can only be answered from the source before planting workers.

### Drive and Slack

`Add sources` may expose Google Drive and Slack. Stop at OAuth or broad workspace permission screens unless the user explicitly asks to continue.

## Conversation Continuity And Follow-ups

Follow-up questions should usually continue the same ChatGPT conversation, not start a fresh chat.

- Open the saved `conversationUrl`.
- Verify URL/title/body match the prior task.
- Ensure the prior answer is no longer generating.
- Send the follow-up in the same composer.
- Restate key constraints briefly; do not assume hidden context was retained perfectly.
- Harvest only the latest assistant message, but keep the full conversation URL as the receipt.

## Retry / Resend

Use retry when the browser/UI accepted the prompt but the answer is bad, failed, or incomplete.

- Reopen the receipt conversation URL.
- Verify the target response is the one you intend to retry.
- Prefer an explicit follow-up such as “try again with these constraints” when auditability matters.
- UI-level regenerate buttons can be used, but record the action in receipt history and verify the new response replaced or followed the old one.

## Worker Farms And Batch Work

For high-volume work, do not let many agents touch the browser. Use a single Playwright driver loop that consumes queued receipts/prompts.

Hard rules:

- One active browser writer.
- At least 60-90 seconds between sends for expensive models.
- At least 30 seconds between harvest reads.
- Every plant writes a receipt with conversation URL and `readAfterIso`.
- Every harvest writes raw JSON/Markdown.
- If a chat is still generating, keep it active and harvest again later.
- For repeated prompt variants on the same task, use an attempt/session key instead of overwriting the active receipt.

Parallel agents may prepare prompts, review outputs, or synthesize results outside the browser. They must not independently drive `CHATGPT_PW_SESSION`.

## Screenshots, Video, And Visual Evidence

Use Playwright's native capture tools when the task asks for UI evidence or README assets:

```bash
playwright-cli -s="$CHATGPT_PW_SESSION" screenshot --filename=/tmp/chatgpt-page.png
playwright-cli -s="$CHATGPT_PW_SESSION" screenshot '#prompt-textarea' --filename=/tmp/composer.png
playwright-cli -s="$CHATGPT_PW_SESSION" video-start /tmp/chatgpt-flow.webm
playwright-cli -s="$CHATGPT_PW_SESSION" video-stop
```

Before saving or sharing screenshots/videos:

- Redact user account data, private prompts, tokens, emails, repo secrets, and sidebar titles when needed.
- Prefer cropped element screenshots over full-page screenshots.
- Keep README images small and reproducible; store generation steps with the asset.

## Cleanup

At the end of each task:

- Save receipt/output paths and conversation URL.
- Close tabs opened solely for the task, unless debugging or user handoff requires keeping them.
- Hide highlights and stop videos/traces.
- Detach attached Chrome Canary sessions instead of closing the browser:

  ```bash
  playwright-cli -s="$CHATGPT_PW_SESSION" detach
  ```

- Report any kept session/tab with session name and URL.

Never run broad cleanup (`close-all`, `kill-all`, delete profile data) against shared Chrome Canary without explicit user approval.

## Verification Checklist

Before reporting success, verify the relevant evidence:

- `python3 "$CHATGPT_PW_LOCK" status --json` is checked when browser state may be shared, and no active lock was force-released without authorization.
- `playwright-cli list --json` shows the intended attached session.
- `tab-list` does not show uncontrolled tab explosion.
- URL matches normal chat, Project, source page, or conversation as intended.
- Model/effort visible label matches the requested setting.
- Tool/connector pill is visible when requested.
- Send result contains a non-`/new` conversation URL.
- Receipt JSON exists and includes prompt hash/task id, conversation URL, model/tool, sent time, `readAfterIso`, and output path.
- Harvest output is from the latest assistant turn or Deep Research iframe, not just the user prompt.
- Project sources are visibly present before use and removed after delete tests.
- OAuth/auth gates were not crossed without explicit permission.
- Screenshots/videos are redacted or scoped appropriately.

If any criterion fails, report the failed step and do not generalize the operation as verified.
