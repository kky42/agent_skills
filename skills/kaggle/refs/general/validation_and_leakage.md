# Validation And Leakage

Validation is a model of the private leaderboard, not a convenience split.

## Evaluation Contract

- Capture the public/private leaderboard split ratio. A tiny public slice can be
  a poor proxy for private performance; expect rank shakeups and rely more on
  local validation, robust slices, and conservative final selection.
- Identify how the hidden test is split or generated: random, grouped,
  chronological/future-period, arena-style, interactive, filtered, or otherwise
  distribution-shifted. Mirror the dangerous split mechanism locally when
  possible.
- Read the exact metric implementation and its edge cases before modeling.
  Report validation with the competition metric, design training losses or
  surrogates that align with it, and focus error analysis on the terms that
  most affect final score.
- Treat daily submission limits as a scarce calibration budget, not an inner
  loop. Decide what each LB probe is meant to learn before submitting.

## Hidden-Test Threat Model

Ask what mechanism could make public/local examples easier than private:

- time drift or future-only labels
- subject, user, patient, item, or location overlap
- duplicate or near-duplicate leakage
- source, instrument, annotator, site, or collection-policy shift
- generated versus natural data mismatch
- class-prior or target-distribution shift
- hidden filtering, truncation, or post-processing in the evaluation set

The split should block the most dangerous overlap first, even if that produces
fewer folds or noisier scores.

## Validation Stack

- Format validation: submission is accepted and metric code runs.
- Local metric validation: exact metric implementation on held-out labels.
- Robustness validation: folds, groups, time windows, seeds, or source slices
  that stress private-LB assumptions.
- Public LB validation: low-frequency external check for severe mismatch.
- Post-submission audit: compare expected local score movement with public LB
  movement and update the threat model.

## Calibration

- Build the local evaluation pipeline from the beginning; do not wait for model
  complexity before validating the metric, split, and submission path.
- Track local validation and public LB as paired observations for submitted
  candidates. Correlation and rank preservation usually matter more than the
  absolute score gap.
- Recalibrate periodically after data, features, model family, post-processing,
  or public discussion evidence changes the threat model.
- If local/LB pairing shows weak correlation, frequent rank inversions, or
  plausible public-overfit behavior, revise splits, slice weights, metric
  implementation, or candidate selection before spending more submissions.

## Leakage Discipline

- Label every feature by when and how it is available at inference time.
- Treat row order, filenames, ids, metadata, duplicates, and public notebooks as
  possible leakage vectors until checked.
- Do not tune preprocessing, fold assignment, thresholds, pseudo-labels, or
  ensemble weights on public LB without recording that dependency.
- Keep pseudo-labels and external data in separate provenance layers so they can
  be removed or downweighted if leakage risk rises.

## Leaderboard Alignment

- A public LB gain is high signal only when it is large, repeatable, and agrees
  with validation or a credible distribution-shift explanation.
- Small public LB deltas across many submissions are usually noise plus
  overfitting pressure.
- If validation and public LB disagree, diagnose by slice, seed, and artifact
  differences before choosing a side.
- When submissions are scarce, spend real-score checks on candidates that test
  suspected mismatch axes, not only on the top local/proxy scores. Prefer
  field or slice extremes where validation rewards one direction and public or
  real feedback appears to reward the other.
- When proxy/real pairing shows weak correlation, a wrong top-proxy candidate,
  or frequent rank inversions, stop blind search against that proxy and revise
  validation before spending more agent iterations. A faster proxy is useful
  only if it preserves the real-metric ranking well enough for the current
  decision.
- Compare alternative validation views across the same public-scored candidate
  set before adopting one as the inner-loop proxy. Better overall correlation is
  not enough if top-candidate selection is still wrong.
- When candidate artifacts expose shallow scalar diagnostics, compare each
  field's direction against both local proxy and public/real feedback. A field
  that aligns with real feedback while conflicting with the current proxy is a
  proxy-revision hypothesis, not a replacement metric by itself.
- Evaluate candidate proxy views in both directions before adopting them. A
  field that ranks the best real row correctly under one direction and not the
  other is useful evidence; a better correlation alone is not enough.
- Keep explicit tie or near-tie markers in your records. A candidate that only
  matches the best local score may still be the most informative probe for the
  next round, even if it is not a strict improvement.
- For final selection, prefer submissions that are stable under alternative
  reasonable validation assumptions.
