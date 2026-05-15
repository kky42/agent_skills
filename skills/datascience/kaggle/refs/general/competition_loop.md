# Competition Loop

Reusable Kaggle operating loop for new or active competitions.

## 1. Read The Contract

- Identify the metric, target, prediction unit, submission schema, rules, data
  access boundaries, external-data policy, inference/runtime limits, and final
  evaluation split.
- Locate official starter code or host metric code. Treat it as the scoring
  contract when it conflicts with informal descriptions.
- Write down what can differ between local validation, public LB, and private
  LB before modeling.

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

- Change one meaningful variable at a time when learning.
- Separate model-quality experiments from pipeline or data-fix experiments.
- Preserve failed experiments when they falsify a hypothesis that future work
  might otherwise repeat.

## 5. Select For Private Robustness

- Prefer candidates that perform consistently across validation views, seeds,
  folds, and plausible distribution slices.
- Use public LB deltas mainly to detect large mistakes or distribution clues,
  not to rank many close variants.
- When ensembling, value diversity backed by validation disagreement analysis,
  not just public score stacking.

## 6. Finalize Conservatively

- Freeze data, code, configs, seeds, and candidate artifacts before final
  submission selection.
- Rebuild the final artifact from a clean state or verify that stored artifacts
  match recorded fingerprints.
- Keep a final decision note explaining why the selected submission should
  generalize to private data.
