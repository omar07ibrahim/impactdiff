# Research charter

## Problem

Screenshot regression tools are intentionally sensitive to rendered change, but rendered
change is not the same as user harm. A recolored surface may be a large pixel delta and
preserve every task. A one-pixel stacking or clipping error may be a small delta and
make the primary action unreachable. DOM or accessibility snapshots expose different
parts of the same problem and can also miss failures that only appear in the rendered
composition.

ImpactDiff studies whether these signals can be aligned into a detector and localizer
whose claims are tied to executable task outcomes.

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

### H1 — task evidence beats visual magnitude

A detector using task and structural evidence will reduce false positives on benign
redesigns at the same recall as pixel-difference and perceptual-image baselines.

### H2 — modalities are complementary

A fused screenshot, accessibility, and layout representation will outperform every
corresponding unimodal ablation on held-out applications and held-out mutation families.

### H3 — executable outcomes support localization

Supervision derived from a mutation compiler and a failed trace step will localize the
affected UI region and accessibility node more accurately than ranking nodes by raw
visual or tree change magnitude.

These are hypotheses, not project claims. Negative results and failed ablations remain
part of the intended report.

## Labels and severity

The primary binary label is `task_regression`: the baseline task succeeds and the
candidate task fails under the same recorded inputs. Samples for which the baseline
fails are invalid rather than negative.

Severity is derived from observable consequences in this order:

1. final-state violation;
2. first failed or blocked task step;
3. accessibility invariant violations relevant to the task; and
4. additional actions or elapsed virtual time needed to recover.

No free-form language model judge participates in the ground truth. Human review may
audit samples but may not silently replace an executable label.

## Intervention families

Task-breaking candidates include occlusion, clipping, off-viewport placement, pointer
interception, focus-order corruption, accessible-name corruption, contrast loss, text
overflow, missing progress state, and responsive layout collapse.

Benign controls include palette and typography changes within readability bounds,
deterministic copy edits, equivalent control reordering, safe responsive reflow, and
changes to task-irrelevant content.

Every operator must declare its preconditions, changed surface, expected task relation,
inverse or cleanup behavior, and the evidence fields it is forbidden to leak into model
inputs.

Candidate outcome, missingness, retry count, duration, failed step, intervention
identity, and grouping keys are label-side data. They are not model inputs. See
[the data-boundary contract](data-boundary.md) for the physical separation and
fail-closed manifest rules.

## Splits

Random item splits are insufficient because screenshots from the same application and
variants from the same operator are highly correlated. ImpactDiff will report at least:

- an application-disjoint split;
- a mutation-family-disjoint split;
- a joint application-and-family holdout; and
- robustness slices for viewport, theme, locale, and font scale.

Near-duplicate source states and shared assets are grouped before splitting. All split
manifests are immutable and content-addressed.

## Baselines

The minimum comparison set is:

- absolute pixel change and connected components;
- SSIM or an equivalent declared structural image metric;
- DOM/layout graph edit distance;
- accessibility-tree edit distance;
- screenshot-only learned model;
- accessibility/layout-only learned model; and
- the fused model.

Each baseline receives the same train/test grouping and artifact budgets.

## Metrics

Detection is measured with AUROC, average precision, class-conditional recall, and
false-positive rate on benign controls. Thresholded results include bootstrap confidence
intervals grouped by source application.

Localization is measured with bounding-box IoU or mAP and accessibility-node Recall@k.
Severity uses rank correlation with the executable outcome scale. Calibration is
measured with reliability diagrams, expected calibration error, and selective risk at
declared coverage levels.

Runtime, peak memory, model size, and per-item artifact bytes are reported so a more
accurate method cannot hide an impractical capture or inference cost.

## Falsification criteria

The central multimodal claim is not supported if any of the following holds on the joint
holdout:

- a simple unimodal baseline matches the fused model within the predeclared confidence
  interval;
- gains disappear after grouping confidence intervals by application;
- performance depends on mutation metadata or another leakage channel;
- localization is no better than ranking changed regions by area; or
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
recorded license and revision may enter a public dataset. Capture manifests record
browser build, operating environment, fonts, locale, timezone, viewport, source
revision, task version, operator version, and hashes of every emitted artifact.
Generated datasets remain rebuildable and are not committed wholesale to Git.
