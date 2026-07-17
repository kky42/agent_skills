# README Review Rubric

Use this for an audit or as the final adversarial pass after writing. Evaluate evidence, not personal style preferences.

## Severity

- **Blocker** — likely to prevent installation or first success, expose secrets, cause destructive misuse, misrepresent security/data safety, or make a central claim false.
- **Major** — materially confuses the target audience, omits a required prerequisite, leaves a common path incomplete, or hides a significant compatibility/status constraint.
- **Minor** — slows scanning, creates avoidable ambiguity, duplicates reference material, or weakens maintainability without blocking normal use.
- **Suggestion** — optional polish with a clear reader benefit.

## Quality Gates

A README is ready only when every mandatory gate passes.

### 1. Truth and Safety — Mandatory

- Central claims are supported by source, tests, reproducible evidence, or clearly labeled inference.
- Commands, paths, package names, ports, and environment variables match the repository.
- Project status, support level, compatibility, and licensing are accurate.
- Data-loss, security, privacy, network, migration, and destructive-action risks appear before the relevant action.
- Credential and account identifiers are clearly fictional or redacted; private or machine-specific filesystem paths are absent; screenshots are current, accurate, and free of private data.

### 2. Orientation — Mandatory

- The opening identifies what the project is, who it serves, and the outcome it enables.
- The primary action—try, install, download, deploy, learn, or browse—is obvious.
- Multiple audiences or operating modes are split into labeled paths.
- The opening leads with the reader's outcome and next action; maintainer history and internal architecture appear only where they help that journey.

### 3. First Success — Mandatory

- Prerequisites precede commands that depend on them.
- The quick start is minimal but complete.
- The reader can observe a result and compare it with an expected result.
- Examples use current public interfaces and realistic configuration.
- Contributor and end-user setup have separate, explicit paths.

### 4. Evidence and Trust

- Visuals, demos, benchmarks, and badges answer real reader questions.
- Performance claims link to methodology and environment details.
- Screenshots are current, tightly scoped, legible, and redacted where necessary.
- Stability, maintenance, roadmap, and support expectations are explicit when material.

### 5. Information Architecture

- Section order follows the primary reader's journey.
- Headings are descriptive and form a clean hierarchy.
- Common paths come before edge cases.
- Long reference material is routed to dedicated docs.
- Tables represent genuine matrices or comparisons.
- Navigation is sufficient for the document's length.

### 6. Maintainability

- Commands and facts have an identifiable source of truth.
- Links and local assets resolve.
- Examples are testable or derived from tested examples when practical.
- Repeated facts are minimized.
- Translated READMEs can be kept synchronized without forcing unnatural literal translation.
- The diff is limited to intended changes, avoids unrelated voice churn, and preserves useful stable anchors.

## Audit Procedure

1. Identify the primary reader and intended first-success event from the repository, not only the README.
2. Attempt the most common path in order, recording the first point of uncertainty or failure.
3. Check every central claim against repository evidence.
4. Render the Markdown and inspect headings, tables, links, images, and details blocks.
5. Run repository documentation checks and the bundled static checker.
6. Classify findings by severity and propose the smallest concrete correction.
7. Re-read the resulting document from a new user's perspective.

## Audit Report Format

```markdown
## README audit

**Primary reader:** ...
**Expected first success:** ...
**Verdict:** ready | ready with minor fixes | not ready

### Blockers
- `README.md:<line>` — Finding. Evidence. Concrete fix.

### Major issues
- ...

### Minor issues
- ...

### What already works
- ...

### Validation performed
- Command or rendered check — result

### Remaining uncertainty
- ...
```

Omit empty severity sections. Point to exact lines or headings. Classify a stylistic preference as a defect only when you can explain the reader harm or maintenance cost.
