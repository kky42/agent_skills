# ChatGPT Playwright helpers

Utilities used by `skills/chatgpt` when driving ChatGPT through `playwright-cli`.

## `chatgpt-pw-lock`

Local account/session lock for shared ChatGPT browser automation.

```bash
export CHATGPT_PW_LOCK=${CHATGPT_PW_LOCK:-$HOME/.agents/skills/chatgpt/tools/playwright/chatgpt-pw-lock}
export CHATGPT_PW_SESSION=${CHATGPT_PW_SESSION:-chatgpt-canary}

python3 "$CHATGPT_PW_LOCK" status --json
python3 "$CHATGPT_PW_LOCK" run --session "$CHATGPT_PW_SESSION" -- \
  playwright-cli -s="$CHATGPT_PW_SESSION" tab-list
```

For multi-command critical sections:

```bash
lock_json=$(python3 "$CHATGPT_PW_LOCK" acquire --session "$CHATGPT_PW_SESSION" --wait 300 --json)
lock_token=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])' <<<"$lock_json")
trap 'python3 "$CHATGPT_PW_LOCK" release --token "$lock_token" >/dev/null || true' EXIT
# browser operations here
python3 "$CHATGPT_PW_LOCK" release --token "$lock_token"
trap - EXIT
```

Exit code `75` means the lock is busy.

## `deep-research-extract-current.js`

Run with `playwright-cli --raw run-code --filename=...` after opening a Deep Research conversation. It extracts the longest readable frame, including sandboxed Deep Research reports.
