# Research charter

## Problem

Screenshot regression tools are intentionally sensitive to rendered change, but rendered
change is not the same as user harm. A recolored surface may be a large pixel delta and
preserve every task. A one-pixel stacking or clipping error may be a small delta and
make the primary action unreachable. DOM or accessibility snapshots expose different
parts of the same problem and can also miss failures that only appear in the rendered
composition.

ImpactDiff studies whether these signals can be aligned into detectors whose claims are
tied to executable task outcomes. Pilot v0.1 tests binary task-regression detection;
learned localization and ordinal severity remain later research directions.

## Unit of analysis

One item is a matched pair derived from a single immutable source state:

1. a baseline capture;
2. a candidate capture produced by one declared intervention;
3. a deterministic task specification;
4. a fixed action plan and symmetric observation checkpoints;
5. sealed baseline and candidate task traces;
6. sealed final-state and accessibility oracle results; and
7. sealed intervention provenance.

The intervention is the unit of labeling. A page is not globally labeled "broken". The
label states whether this intervention changed the outcome of this task under the
recorded environment.

## Hypotheses

### H1 — structured evidence beats visual magnitude

A detector using accessibility and layout evidence will outperform deterministic pixel
difference and perceptual-image baselines on application-disjoint data.

### H2 — modalities are complementary

A fused screenshot, accessibility, and layout representation will outperform both
learned unimodal baselines on held-out applications.

### H3 — executable outcomes can support later localization

The sealed mutation compiler and failed trace step may support a future localization
benchmark. Pilot v0.1 does not train or score a localizer.

These are hypotheses, not project claims. Negative results and failed ablations remain
part of the intended report.

## Labels and severity

The primary binary label is `task_regression`: the baseline task succeeds and the
candidate task fails under the same recorded inputs. Samples for which the baseline
fails are invalid rather than negative.

Pilot v0.1 has no learned severity target. The current development policy's ordinals `0`
and `4` are fixture-specific replay outputs, not a calibrated severity scale.

No free-form language model judge participates in the ground truth. Human review may
audit samples but may not silently replace an executable label.

## Intervention families

Pilot v0.1 freezes eight causal families: pointer hit testing, overflow clipping, target
displacement, native control state, focus navigation, accessible naming, content
overflow, and visual presentation. Each family has one task-breaking operator and one
matched control that preserves only the declared task. It is not claimed to be globally
harmless.

Every operator must declare its preconditions, changed surface, expected task relation,
inverse or cleanup behavior, and the evidence fields it is forbidden to leak into model
inputs.

Candidate outcome, missingness, retry count, duration, failed step, intervention
identity, and grouping keys are label-side data. They are not model inputs. See
[the data-boundary contract](data-boundary.md) for the physical separation and
fail-closed manifest rules.

## Splits

Random item splits are insufficient because screenshots from the same application are
highly correlated. Pilot v0.1 therefore uses one primary application-disjoint split,
frozen at 10 training, 5 validation, and 5 test applications before outcomes are seen.
Mutation-family and joint holdouts are exploratory stress views only; they cannot
support a headline claim unless their predeclared group and class-count gates pass.

Near-duplicate source states and shared assets are grouped before splitting. All split
manifests are immutable and content-addressed.

## Baselines

The minimum comparison set is:

- absolute pixel change and connected components;
- SSIM or an equivalent declared structural image metric;
- layout-graph edit distance;
- accessibility-tree edit distance;
- screenshot-only learned model;
- accessibility/layout-only learned model; and
- the fused model.

Each baseline receives the same train/validation/test grouping and artifact budgets.

## Metrics

Average precision is the primary detection metric. Supporting measurements are AUROC,
Recall at 5% benign false-positive rate, class-conditional recall, Brier score, expected
calibration error, and per-application and per-family results. Confidence intervals use
paired application-cluster bootstrap resampling.

Runtime, peak memory, model size, and per-item artifact bytes are reported so a more
accurate method cannot hide an impractical capture or inference cost.

## Falsification criteria

The central multimodal claim is supported only when the lower bound of the paired 95%
application-cluster bootstrap interval is above zero for both fused-minus-pixel and
fused-minus-structured average precision on the primary test split. It is not supported
if any of the following holds:

- a simple unimodal baseline matches the fused model within the predeclared confidence
  interval;
- gains disappear after grouping confidence intervals by application;
- performance depends on mutation metadata or another leakage channel;
- the false-positive rate on benign controls makes the operating point unusable.

The report will state such outcomes directly rather than changing the split or metric
after observing results.

## Non-goals

ImpactDiff is not a general browser agent, a replacement for end-to-end tests, or a
claim that synthetic mutations reproduce every production incident. The first benchmark
will target deterministic local web applications, not arbitrary internet pages. It will
not execute third-party scripts or send captured data to hosted vision services.

## Reproducibility and data rights

Only fixtures created in this repository or compatible open-source applications with
recorded license and revision may enter a public dataset. The sealed source-state
contract now binds the exact fixture revision, raw manifest, normalized resource table,
license, and initial state; the runtime resolves and matches those canonical bytes. The
paired publisher materializes that artifact only in the sealed store while keeping the
model-visible capture specification limited to renderer/environment provenance and
operator identity/version in sealed intervention data. Supported emitted artifacts are
content-addressed. Generated datasets must remain rebuildable and are not committed
wholesale to Git.
