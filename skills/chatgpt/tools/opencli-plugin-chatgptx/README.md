# opencli-plugin-chatgptx

Skill-owned OpenCLI helper commands for `skills/chatgpt`.

Install/repair through the repo, not directly:

```bash
/Users/kky/dev/agent_skills/scripts/skill-sync --tools-only
opencli chatgptx status -f json
```

Commands:

- `opencli chatgptx status`
- `opencli chatgptx consult "<prompt>" [--github true] [--model-tier normal|pro] [--wait true]`
- `opencli chatgptx harvest <receipt|job-id|conversation-url>`
- `opencli chatgptx broker-enqueue "<prompt>" [--github true]`
- `opencli chatgptx broker-run [--limit 1]`
- `opencli chatgptx broker-status`
- `opencli chatgptx project-source-list --project <project-id>`
- `opencli chatgptx project-source-delete --project <project-id> --name <file>`
- `opencli chatgptx retry <conversation-url> --mode again|thinking|web`

Receipts default to:

```text
$CHATGPTX_STATE_DIR/receipts
# or ~/.local/state/chatgptx/receipts
```

Harvested answers default to:

```text
$CHATGPTX_STATE_DIR/outputs/<job-id>.md
# or ~/.local/state/chatgptx/outputs/<job-id>.md
```

The broker uses a filesystem lock under the state dir. It holds the browser lock only while sending or harvesting, not while ChatGPT thinks.

Pacing defaults:

- Access/harvest/page visit interval: `30s`.
- Normal submit interval: `30s`.
- Pro submit interval: `60s` via `--model-tier pro`.

Override with `--access-interval`, `--submit-interval`, or `--rate-wait false` for fail-fast. Rate-limit modal handling clicks `Got it`, records the next slots in `~/.local/state/chatgptx/rate-state.json`, then waits before retrying.

This plugin is intentionally kept under the ChatGPT skill so OpenCLI upgrades do not erase local automation patches.
