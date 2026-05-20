# Chough Setup And Troubleshooting

Keep this detail out of the main workflow unless setup or recovery is needed.

## Install

`chough` requires `ffmpeg` for audio/video support.

```bash
# macOS
brew install --cask hyperpuncher/tap/chough

# Arch Linux
paru -S chough-bin

# Windows
winget install chough

# Go source install
go install github.com/hyperpuncher/chough/cmd/chough@latest
```

## Missing CHOUGH_URL

If `chough --remote audio.mp3` returns:

```text
Error: --remote requires CHOUGH_URL (e.g. CHOUGH_URL=http://localhost:8080)
```

then configure a persistent default URL.

1. Check the current environment first:

   ```bash
   printenv CHOUGH_URL
   ```

2. Check shell environment files such as `~/.zshenv`, `~/.zprofile`, `~/.zshrc`, `~/.bash_profile`, `~/.bashrc`, or the platform-appropriate environment file.

3. If no `CHOUGH_URL` is registered, add this to `~/.zshenv` on zsh-based macOS setups:

   ```bash
   printf '\nexport CHOUGH_URL=http://localhost:8765\n' >> ~/.zshenv
   ```

4. Export it in the current shell before retrying:

   ```bash
   export CHOUGH_URL=http://localhost:8765
   ```

5. Start the server if it is not already running, then retry:

   ```bash
   tmux has-session -t chough-server 2>/dev/null || tmux new-session -d -s chough-server 'chough --server --port 8765'
   chough --remote audio.mp3
   ```

## Connection Refused

If `chough --remote audio.mp3` returns an error like:

```text
Error: remote request failed to http://localhost:8080/transcribe: Post "http://localhost:8080/transcribe": dial tcp 127.0.0.1:8080: connect: connection refused
```

then `CHOUGH_URL` exists but the server is not reachable.

1. Inspect the configured URL:

   ```bash
   printenv CHOUGH_URL
   ```

2. Start a persistent server. Prefer the port in `CHOUGH_URL` if it is already configured; otherwise use `8765`:

   ```bash
   tmux has-session -t chough-server 2>/dev/null || tmux new-session -d -s chough-server 'chough --server --port 8765'
   ```

   If `CHOUGH_URL` already points at another local port, start the server on that port instead:

   ```bash
   tmux has-session -t chough-server 2>/dev/null || tmux new-session -d -s chough-server 'chough --server --port 8080'
   ```

3. If `CHOUGH_URL` points at a different localhost port, either start the server on that port or update the persistent environment entry to:

   ```bash
   export CHOUGH_URL=http://localhost:8765
   ```

4. Retry the original remote command:

   ```bash
   chough --remote audio.mp3
   ```

Use tmux or another durable background process manager for the server. Do not start a foreground server unless the user explicitly wants to watch it.

## Checks

```bash
command -v chough
command -v ffmpeg
printenv CHOUGH_URL
tmux has-session -t chough-server
```

First server start may download the model to the chough cache. That one-time setup is expected; the remote workflow avoids repeating model loads for each transcription.
