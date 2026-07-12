# Public Research

Public notebooks and discussions are evidence sources, not authority.

## Notebook Mining

- Read high-performing notebooks for data handling, validation choices,
  post-processing, ensembling, and failure analysis before copying model code.
- Prefer notebooks with clear validation and reproducible artifacts over title
  claims or screenshots.
- Compare code against competition rules: external data, internet access,
  inference limits, train/test contamination, and submission constraints.
- Extract reusable ideas into local experiments with controlled attribution and
  provenance.

## Discussion Mining

- Prioritize host posts, rule clarifications, metric corrections, known bugs,
  data issues, and deadline/runtime changes.
- Separate official statements from competitor speculation.
- Record exact dates for rule or environment changes in the competition repo.
- Search for negative evidence too: validation failures, private shakeup
  warnings, metric edge cases, and disallowed tricks.

## Claim Evaluation

For each public claim, classify:

- Fact: directly supported by official docs, code, or reproducible local check.
- Strong hypothesis: supported by multiple independent observations.
- Weak hypothesis: plausible but based on one notebook, one LB jump, or one
  discussion comment.
- Risky shortcut: improves public/local score while increasing leakage,
  brittleness, or rule risk.

Only facts and strong hypotheses should influence final submission selection
without additional validation.

## Artifact Handling

- Keep downloaded public artifacts separate from owned artifacts.
- Record source URL or slug, retrieval date, license/rule context, and any
  transformations.
- When using public outputs as model banks or ensemble inputs, preserve raw
  bytes when compatibility matters and document the dependency.
