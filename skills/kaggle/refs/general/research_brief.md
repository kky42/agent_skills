# Research Briefs

Use this when the user asks to research a Kaggle competition and write a
strategy brief with sources, score context, plots, or an actionable plan.

## Research Flow

Chain only the sources needed for the brief:

- official overview, data, rules, metric, timeline, and submission contract
- public notebooks/kernels and version/score metadata
- discussions, especially official clarifications and metric/data issues
- leaderboard solution writeups when the competition has historical writeups
- local validation and submission records from the active repo, when available

Prioritize high-signal evidence. Do not read every public artifact just because
it exists.

## Source Honesty

- Cite sources as clickable markdown links using the real URL or ref gathered in
  this run.
- For notebooks, prefer `https://www.kaggle.com/code/<owner>/<slug>` links.
- For discussions, link the topic or comment when the claim depends on it.
- Distinguish official statements, reproducible local checks, author claims,
  and speculation.
- Treat numbers in notebook titles as author claims unless the score was fetched
  from Kaggle metadata or verified locally.

## Brief Content

A useful brief usually includes:

- competition mechanics: target, prediction unit, metric, constraints, runtime,
  rules, and public/private split risk
- evidence table: source, claim, support level, leakage/rule risk, and action
- score ladder: baseline → strong public notebook → top observed public result,
  with each score tied to its source and marked as verified or claimed
- validation threat model: how local validation can diverge from public/private
  LB and how to reduce that gap
- actionable path: baseline, features, models, validation, ensembling,
  submission cadence, and what to study next

## Plots

Use 2–4 plots only when they add insight.

- Every plotted number must trace to gathered evidence from this run.
- Prefer score distributions, score bands, or validation-vs-LB comparisons over
  vote/comment popularity charts.
- Label entities with readable notebook/discussion titles or slugs, not bare ids.
- Make verified scores visually distinct from title-claimed or unverified scores.
- Add a one-line takeaway for every plot; drop plots with no clear takeaway.

## Public-LB Discipline

Use public scores to understand the landscape and catch large mistakes. Do not
select final submissions solely by public LB rank, notebook popularity, or a
single public-score improvement without validation support.
