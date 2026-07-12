# Submission Artifact Downloads

Use this when an authorized Kaggle account can see a submission artifact in the
web UI but the official CLI or SDK only exposes submission metadata. This often
matters for team competitions where you need to inspect, preserve, or rebase to a
teammate's submitted file.

## Permission Boundary

- Use only the user's authenticated Kaggle session and authorized team access.
- Do not extract cookies, CSRF tokens, hidden download URLs, or bearer tokens to
  bypass permissions.
- If the UI does not expose the artifact to the logged-in user, stop and report
  that access is unavailable.

## Identify the Target First

Before downloading, establish which submission is the target from CLI/API data or
the visible UI:

```bash
kaggle competitions submissions -c SLUG --page-size 200 --csv
```

For each candidate, record at least:

- competition slug;
- submission id/ref if visible;
- author/team member;
- submitted date/time;
- status (`COMPLETE`/terminal success, not merely the newest row);
- public/private score fields that are visible;
- description/message;
- file name and displayed size.

Do not trust a single visible row if a higher-scoring row may exist. Fetch enough
pages or use the competition's submission UI filters/sorting to confirm the best
authorized target. Error rows can appear above successful rows; an empty score is
not a zero score.

## Browser Download Workflow

Use an already authenticated browser profile. In environments with
`playwright-cli`:

```bash
playwright-cli attach --extension=chrome
playwright-cli -s=chrome goto https://www.kaggle.com/competitions/SLUG/submissions
playwright-cli -s=chrome snapshot
# Open the target row's "Submission Details" panel, then click the
# "download <filename>" button discovered in the current snapshot.
```

With OpenCLI, use the same pattern:

```bash
opencli browser kaggle open "https://www.kaggle.com/competitions/SLUG/submissions"
opencli browser kaggle state
# Click the target row, then the visible download button.
```

Always discover element refs dynamically from the current snapshot/state. Do not
hardcode refs across sessions.

## Locate the Downloaded File

Browser downloads commonly land in `~/Downloads` with names such as
`submission (17).zip`. Do not assume a fixed filename. Identify the new artifact
by mtime, size, and content hash:

```bash
find "$HOME/Downloads" -maxdepth 1 -type f -name '*submission*.zip' \
  -print0 | xargs -0 stat
```

Copy it into the active repo's ignored scratch area with a descriptive name, for
example:

```bash
mkdir -p .context/downloads
cp "$HOME/Downloads/submission (17).zip" \
  .context/downloads/TEAM_OR_AUTHOR_SCORE_SUBMISSIONID.zip
```

Keep browser snapshots, console logs, and raw downloads out of committed paths
unless the active repo explicitly tracks such provenance.

## Verify The Artifact

Run format checks appropriate to the competition. At minimum:

```bash
sha256sum .context/downloads/ARTIFACT.zip  # or: shasum -a 256 on macOS
unzip -tq .context/downloads/ARTIFACT.zip
zipinfo -1 .context/downloads/ARTIFACT.zip | head
```

Then verify the competition-specific submission contract: expected filename,
flat vs nested layout, expected file count, required extensions, and any size
limits. Record the SHA256 and displayed/downloaded size.

## Rebase / Baseline Hygiene

When using a downloaded artifact as the new local baseline:

1. Backup the previous local baseline artifact and manifest in ignored scratch.
2. Replace the active artifact only after verification.
3. Write a manifest with source, command/browser action, timestamp, competition,
   submission id/ref, author, score(s), status, description, artifact path,
   SHA256, size, and included files or other competition-specific inventory.
4. Mark whether this is **artifact-only** or **source-reproducible**.
5. If artifact-only, warn future agents that a clean source rebuild may overwrite
   or fall behind the downloaded baseline until its deltas are ported into source.

Artifact provenance belongs in the active repo, not in this global skill. Keep
competition-specific ids, scores, paths, and changed-file lists repo-local.
