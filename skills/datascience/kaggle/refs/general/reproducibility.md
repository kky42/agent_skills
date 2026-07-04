# Reproducibility

Kaggle work needs enough provenance to explain and rebuild a submitted artifact.

## Identity

- Give every candidate a deterministic identity from stable inputs: data
  version, code/config version, fixed split/fold definition, model family,
  model-specific seed, and post-processing variant.
- Pin every randomness source that affects comparison: folds, initialization,
  dataloading, augmentation, sampling, pseudo-label selection, and ensembling.
- Do not silently mutate a candidate after it has been evaluated or submitted.
  Create a new identity for behavior changes.
- Keep human-friendly names, but rely on machine-checkable fingerprints for
  artifact equality.

## Records

Track enough to answer:

- What data and external sources were used?
- Which code, config, seed, folds, and environment produced the artifact?
- What hypothesis or bottleneck was this candidate testing?
- Which params, thresholds, feature switches, and post-processing choices were
  used?
- Which validation views were run, what local scores resulted, and what failed?
- Was public LB used to tune, calibrate, or select it? If yes, what score and
  submission id?
- Which final submission included it and why was it accepted or rejected?
- If the artifact was downloaded from Kaggle rather than rebuilt locally, who
  submitted it, when, from which authorized UI/API source, with what status,
  score(s), description, displayed size, local path, and SHA256?

For long-running agentic search, keep compact machine-readable indexes in
addition to human notes:

- one candidate trace row per attempted candidate, including hypothesis,
  changed variable, commit/config id, params summary, local/proxy score, LB/real
  score when available, status, relation to baseline/best, and copied artifact
  references;
- flattened scalar artifact fields for model/config/validation diagnostics, not
  large prediction arrays or full logs;
- aggregate summaries of repeated field values, tied-score plateaus, recurring
  errors, and proxy/real mismatch signatures. Keep these summaries as route
  maps: top counts, relation counts, and omitted-value counts are usually more
  durable than copying full per-candidate fields into every value. Keep short
  references for high-signal repeated values or mismatch signals, then jump
  back to the full index for detail.

Expose those indexes through a short repo entrypoint or manifest. The entrypoint
should list files, folders, globs, commands, and what they contain; it should not
hand-pick frontier candidates or rewrite prior research into prompt memory. When
possible, include cheap context-budget metadata such as existence, byte size,
line count, and directory entry count so agents can open compact summaries first
and defer bulky sessions or raw artifacts until they have a specific question.

## Handoff

- Store durable notes in stable docs, not chat logs or temporary directories.
- Separate general method from competition-specific facts.
- Keep current best-known workflow discoverable from a short repo entrypoint.
- Compress stale notes; a smaller accurate runbook beats a long chronological
  log.
- Keep full session transcripts and bulky artifacts available but off the first
  context path. Agents should scan summaries and compact tables first, then open
  raw artifacts only for a specific question.

## Artifact Baselines

Distinguish **source-reproducible** baselines from **artifact-only** baselines.
A source-reproducible baseline can be rebuilt from pinned code/config/data. An
artifact-only baseline is a submitted file downloaded from Kaggle or another
authorized source; it is useful feedstock but may be overwritten or fall behind
when the repo is rebuilt from source.

When rebasing to an artifact-only submission:

- backup the prior local baseline artifact and manifest;
- verify archive integrity, expected layout, file count, size limits, and hash;
- write a manifest containing source, command/browser action, timestamp,
  submitter, submission id/ref, score(s), status, description, SHA256, and an
  inventory appropriate to the competition;
- explicitly record that the artifact has not yet been imported into source;
- avoid committing raw downloaded artifacts unless the active repo's policy says
  they are tracked.

## Final Submission Hygiene

- Re-run format and metric checks after packaging.
- Verify final artifacts against recorded hashes or rebuild from pinned inputs.
- Keep rejected final candidates and the reason they were rejected; they are
  often needed when diagnosing public/private leaderboard gaps.
