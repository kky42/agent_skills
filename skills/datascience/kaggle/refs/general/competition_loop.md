# Competition Loop

Reusable Kaggle operating loop for new or active competitions.

## 1. Read The Contract

- Identify the metric, target, prediction unit, submission schema, rules, data
  access boundaries, external-data policy, inference/runtime limits, public vs
  private leaderboard split ratio, and final evaluation split strategy.
- Locate official starter code or host metric code. Treat it as the scoring
  contract when it conflicts with informal descriptions.
- Write down what can differ between local validation, public LB, and private
  LB before modeling, especially when the hidden test is time-shifted,
  source-shifted, arena-style, interactive, or built from a tiny public slice.

## 2. Build A Baseline That Teaches

- Create the smallest reproducible baseline that produces a valid submission.
- Verify the metric implementation and submission format independently.
- Record baseline score, validation split, seed, data version, and artifact
  hash before iterating.

## 3. Improve Validation Before Capacity

- Choose splits that reflect the hidden-test threat model: group, time, source,
  patient/user/session, geography, duplicate cluster, or generated-vs-real
  boundaries when relevant.
- Keep at least one validation view that is hard to optimize directly.
- Track public LB as an external probe, not as the primary objective.

## 4. Iterate With Evidence

- Make the inner loop fast before exploring many ideas: cache reusable data,
  features, embeddings, folds, out-of-fold predictions, and intermediate
  artifacts; invalidate caches explicitly when their inputs change.
- Parallelize computation-heavy pipeline nodes and keep both a cheap smoke
  evaluation and the slower trusted evaluation available.
- Change one meaningful variable at a time when learning.
- Separate model-quality experiments from pipeline or data-fix experiments.
- Record the hypothesis, changed variable, local score, optional LB score,
  config/params, seeds, artifact path, and decision for each candidate.
- Preserve failed experiments when they falsify a hypothesis that future work
  might otherwise repeat.

## 5. Select For Private Robustness

- Prefer candidates that perform consistently across validation views, seeds,
  folds, and plausible distribution slices.
- Use public LB deltas mainly to detect large mistakes or distribution clues,
  not to rank many close variants.
- When ensembling, value diversity backed by validation disagreement analysis,
  not just public score stacking.
- For cost-gated tasks (runtime, memory, parameter limits), rank by frontier
  value, not raw score alone. A candidate that saves memory or parameter count
  while crossing a score threshold can be more valuable than one with a
  marginally higher score that consumes the full budget.

## 6. Finalize Conservatively

- Freeze data, code, configs, seeds, and candidate artifacts before final
  submission selection.
- Rebuild the final artifact from a clean state or verify that stored artifacts
  match recorded fingerprints.
- Keep a final decision note explaining why the selected submission should
  generalize to private data.
