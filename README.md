# ImpactDiff

ImpactDiff is a research lab for task-aware visual regression detection. A pixel diff
can show that a page changed; this project asks whether the change breaks a user task,
damages accessibility, and which visible or structural evidence supports that
conclusion.

The planned input is a matched before/after capture containing screenshots,
accessibility trees, bounded DOM/layout graphs, and a fixed action plan. The planned
output is a calibrated regression score, severity, the affected UI node and region, and
an evidence trail back to the failed task step.

## Current status

The repository currently contains the research contract, not a trained model or
benchmark result. No accuracy claim is made yet. The first implementation milestone will
produce deterministic captures and typed, replayable UI mutations before any learned
baseline is introduced.

## Research question

Can a model that aligns pixels with accessibility and interaction evidence distinguish
task-breaking changes from benign redesigns better than screenshot, tree, or DOM diffing
alone when both the application and mutation family are held out?

ImpactDiff will test that question with paired interventions. Each source state is
rendered both unchanged and under a controlled mutation. Mutation metadata is retained
for scoring and audit but is never exposed as a model feature. Scripted task outcomes
provide the primary severity signal.

## Intended evidence bundle

Each benchmark item will contain:

- fixed-environment before and after screenshots;
- normalized accessibility snapshots;
- a bounded graph of visible DOM nodes and layout relations;
- a deterministic action plan shared by both captures;
- content hashes and capture-environment provenance; and
- separately sealed traces, oracle results, mutation provenance, and labels.

The initial mutation set will cover both task-breaking faults—such as occluded controls,
clipped content, broken focus order, misleading accessible names, and responsive
collapse—and benign controls such as theme changes, safe reflow, copy edits, and
deterministic date changes.

## Evaluation plan

The benchmark will use application-disjoint and mutation-family-disjoint test sets.
Planned comparisons include pixel distance, SSIM, DOM-tree distance, screenshot-only
models, accessibility-only models, and a fused multimodal model. Detection,
localization, severity, calibration, and false-positive rate on benign redesigns will be
reported separately.

See [the research charter](docs/charter.md) for hypotheses, metrics, falsification
criteria, and non-goals. The [data-boundary contract](docs/data-boundary.md) explains
how model-visible evidence is physically separated from outcomes and mutation metadata.

## Engineering constraints

- The data generator and capture path must run without paid APIs.
- Browser, fonts, locale, viewport, timezone, animation, and time are pinned or
  recorded.
- Generated artifacts are content-addressed and independently verifiable.
- Training is CPU-capable at development scale; larger optional runs must not be
  required to validate the pipeline.
- Evidence and labels come from executable state checks, not free-form model judgments.

## License

Apache-2.0. See [LICENSE](LICENSE).
