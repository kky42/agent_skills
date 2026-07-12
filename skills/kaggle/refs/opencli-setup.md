# OpenCLI Browser Setup

Some Kaggle operations (posting discussions, replying) require a live browser
session. OpenCLI reuses your existing logged-in Chrome session — no manual
cookie extraction needed.

## Prerequisites

OpenCLI must be installed and connected. Browser commands require a session
name; Kaggle examples use `kaggle` as that reusable session name.

```bash
opencli doctor
```

Expected output:
```
[OK] Daemon: running on port 19825
[OK] Extension: connected
[OK] Connectivity: connected in 0.1s
```

If `opencli doctor` fails:

1. **Install OpenCLI:**
   ```bash
   npm install -g @jackwener/opencli@latest
   ```

2. **Install the Browser Bridge Extension:**
   Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk).

3. **Verify again:**
   ```bash
   opencli doctor
   ```

## How it works

OpenCLI drives your existing Chrome window through the Browser Bridge
extension. It reuses your logged-in sessions, so there is no need to manually
extract cookies or CSRF tokens for each operation. Browser action commands return
structured JSON envelopes with target and match details.

## Cost guide

| Command | Rough cost | When to use |
|---------|-----------|-------------|
| `browser <session> state` | medium | First call on any page, after every nav |
| `browser <session> find --css <sel>` | small | Targeted element search |
| `browser <session> click <ref>` | tiny | Click a button or link by numeric ref |
| `browser <session> type <ref> <text>` | tiny | Fill a text field |
| `browser <session> get text/value` | tiny | Verify field content |
| `browser <session> wait` | varies | Wait for page transitions |
