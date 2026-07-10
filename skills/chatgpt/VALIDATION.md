# ChatGPT Skill Validation Log

Validated on 2026-07-04 and revalidated against the redesigned UI on 2026-07-10 using `playwright-cli` session `chatgpt` attached to Chrome Canary via the Playwright Extension.

## Environment

- Attach succeeded: `playwright-cli attach --extension=chrome-canary --session chatgpt`.
- `playwright-cli list` showed one attached browser: `chatgpt`, browser type `chrome-canary`.
- `playwright-cli -s=chatgpt tab-list` showed a single current ChatGPT tab after validation; no tab explosion observed.
- Verified compact JSON `run-code` pattern. Note: extension `run-code` should use `page.waitForTimeout(ms)`, not global `setTimeout`.

## Validated Operations

| Area | Status | Evidence |
|---|---:|---|
| Normal chat send/read | verified | Sent prompt at `https://chatgpt.com/`; got exact assistant marker `CHATGPT_SKILL_NORMAL_OK`; conversation URL `/c/6a48fe01-ed5c-83e8-87e3-88b94d1d7c56`. |
| Project chat send/read | verified | Sent prompt at Kaggle Project; got exact marker `CHATGPT_SKILL_PROJECT_OK`; conversation URL `/g/g-p-6a40b412e4648191baee8edae6e3f786-kaggle/c/6a48fe0d-4f8c-83e8-a69f-57ac19e59157`. |
| Project runtime command | verified | In Project chat, asked ChatGPT to run `printf CHATGPT_SKILL_BASH_OK`; got exact marker `CHATGPT_SKILL_BASH_OK`; conversation URL `/g/g-p-6a40b412e4648191baee8edae6e3f786-kaggle/c/6a48fe5e-42bc-83e8-b089-975748665af9`. |
| Project Sources tab | verified | Project URL `https://chatgpt.com/g/g-p-6a40b412e4648191baee8edae6e3f786-kaggle/project?tab=sources`; found `Sources`, `Newest`, `All`, `Add sources`. |
| Text source create/delete | verified | Created `skill-validation-delete-me-20260704-1.txt` via `Add sources -> Text input -> Save`; verified it appeared; deleted via `Source actions -> Delete`; verified absent. |
| File source upload/delete | verified | Uploaded `.context/chatgpt_farm/skill-validation-upload-delete-me.md` via `Add sources -> Drag sources here` using `playwright-cli drop`; verified `skill-validation-upload-delete-me.md`; deleted via `Source actions -> Delete`; verified absent. |
| File chooser upload via extension | failed/avoid | `Upload from file chooser` produced `Protocol error (DOM.setFileInputFiles): Not allowed`; prefer `drop <ref> --path=<file>` with the Playwright Extension. |
| Google Drive Project connector | verified to auth gate | `Add sources -> Google Drive` opened `Connect Google Drive` modal with `Continue to Google Drive`; did not proceed into external auth. |
| Slack Project connector | verified to auth gate | `Add sources -> Slack` opened `Add Slack to ChatGPT` modal; did not proceed into external auth. |
| Composer GitHub connector | verified | `Add files and more -> GitHub` was clickable; sent a connector validation prompt and got exact marker `GITHUB_CONNECTOR_OK`; conversation URL `/c/6a48fec6-882c-83e8-b4a4-b82e2c2fbc40`. |
| Chat/Work surface split | verified 2026-07-10 | Home and Project pages expose `[role="group"][aria-label="Select chat surface"]` with `Chat` and `Work` radios. `Chat` was selected and verified via `aria-checked=true`; switching to Work showed a different `Work on anything` composer and `5.6 Sol / Light`, then Chat was restored. |
| Model/reasoning menu | verified 2026-07-10 | In Chat mode the intelligence picker contained `Instant` (`5.5`), `Medium`, `High`, `Extra High`, and `Pro`; its model submenu contained checked `GPT-5.6 Sol`, plus `GPT-5.5`, `GPT-5.4`, `GPT-5.3`, and `o3`. `ensure-settings --surface Chat --model "GPT-5.6 Sol" --effort Pro` independently verified all three. The former visible `Pro Extended` label is now `Pro`. |
| Worker farm plant | verified | `scripts/chatgpt_pwcli_farm.py` planted task018 manually and batch-planted task023/task025/task054 with 90s spacing and receipts. |
| Worker farm harvest | verified 2026-07-10 | New assistant-scoped extraction correctly classified live Round7 examples: task254 `thinking_failed`, task260 incomplete `analysis_paused`, and task251/task271 `complete`. It no longer treats prompt/project body text as an answer. GPT-5.6 Sol Pro first reads now default to 150m; batch harvesting retains enforced 30s spacing. |
| Multi-turn harvest reconciliation | verified 2026-07-10 | `reconcile-attempt` restored task266's complete first result after a weaker partial re-read, and all harvest snapshots/modules are preserved and variant-ranked instead of latest-wins. |

## Project Source Recipes Proven

### Text source

1. Project sources URL: `/project?tab=sources`.
2. Click `Add sources`.
3. Click `Text input`.
4. Fill title input and text textarea.
5. Click `Save`.
6. Verify new `.txt` source appears.
7. Delete via `Source actions -> Delete`.

### File source with extension

1. Project sources URL: `/project?tab=sources`.
2. Click `Add sources`.
3. Use drag target `Drag sources here`.
4. Run:

```bash
playwright-cli -s=chatgpt drop <drag-ref> --path=/absolute/path/to/file.md
```

5. Verify file source appears.
6. Delete via `Source actions -> Delete`.

Do not rely on `Upload` + `playwright-cli upload` through the extension; it hit the browser security error above.

## Remaining Boundaries

- Did not complete external OAuth for Google Drive or Slack.
- Did not test GitHub Project-source attachment; GitHub was validated as a composer connector/tool.
- Did not test very large source uploads or zip limits.
- Project runtime command was validated by ChatGPT response marker; the UI evidence was the assistant result, not a direct local transcript of ChatGPT's hidden tool call.
