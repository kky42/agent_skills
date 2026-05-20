---
name: chough
description: Fast ASR CLI workflow for transcribing audio/video files through a persistent chough remote server. Use when the user wants speech-to-text, timestamped JSON, VTT subtitles, or audio/video transcription without repeatedly loading the local model.
---

# Chough

Use `chough --remote` first for transcription. Do not run local transcription commands like `chough audio.mp3`; that loads the model in the current process. The only normal non-remote command is starting the persistent server with `chough --server`.

## Quick Reference

```bash
# Basic transcription
chough --remote audio.mp3

# JSON with timestamps
chough --remote -f json podcast.mp3 > transcript.json

# WebVTT subtitles
chough --remote -f vtt -o subs.vtt video.mp4

# Smaller server-side chunks
chough --remote -c 30 audiobook.mp3

# Pipe audio from stdin through the remote server
cat audio.mp3 | chough --remote
```

## Default Workflow

1. Run the requested transcription with `--remote`.
2. If `CHOUGH_URL` is missing, read [references/setup-troubleshooting.md](references/setup-troubleshooting.md), register `CHOUGH_URL=http://localhost:8765`, start the persistent server, then retry with `--remote`.
3. If the remote request fails with connection refused, read [references/setup-troubleshooting.md](references/setup-troubleshooting.md), start the persistent server, then retry with `--remote`.
4. If the user asks about installation, server setup, environment variables, or failures, read [references/setup-troubleshooting.md](references/setup-troubleshooting.md).

## Flags

| Flag               | Description                      | Default |
| ------------------ | -------------------------------- | ------- |
| `-c, --chunk-size` | Chunk size in seconds            | 60      |
| `-f, --format`     | Output: text, json, vtt          | text    |
| `-o, --output`     | Output file                      | stdout  |
| `-r, --remote`     | Transcribe via CHOUGH_URL server | -       |
| `--version`        | Show version                     | -       |

## Notes

- Prefer `--remote` even for one-off files.
- A persistent server avoids loading the ASR model for every transcription command.
- Auto-extracts audio from video files.
- VTT groups tokens into subtitle cues automatically.
- Set `CHOUGH_MODEL` only when the user needs a custom model path.
