# Pilot v0.1 protocol

## Status

This document freezes the design of ImpactDiff Pilot v0.1 before its application
catalog, captures, labels, features, or model results exist. The matching machine
contract is content-addressed and rejects changes to the quantities and rules below.

Pilot v0.1 has one learned research task: binary detection of task regressions on
previously unseen, deterministic local web applications. It is a controlled synthetic
pilot, not a benchmark of arbitrary websites.

## Primary question and claim

The primary question is whether a fused pixel and accessibility/layout detector
outperforms both learned unimodal detectors on an application-disjoint test set.

ImpactDiff may state that the pilot supports this claim only when the lower bound of a
paired 95% application-cluster bootstrap interval is strictly above zero for both:

- fused average precision minus pixel-only average precision; and
- fused average precision minus structured-only average precision.

The two comparators are predeclared. Neither is selected from test performance. A
negative or statistically undefined result is still a reportable result, but it cannot
be worded as support for the fusion claim.

## Complete planned matrix

The corpus plan is the complete Cartesian product of:

- 20 independently authored applications;
- 2 declared workflows per application;
- 8 mutation families;
- 2 relation variants per family: one declared task-breaking operator and one matched
  task-preserving control;
- replicate index `0`; and
- one fresh baseline/candidate capture pair per cell.

This produces exactly `20 × 2 × 8 × 2 × 1 = 640` planned pairs: 320 declared-breaking
cells and 320 task-preserving-control cells. These are planned relations, not measured
class labels.

The eight frozen causal families are:

1. pointer hit testing;
2. overflow clipping;
3. target displacement;
4. native control state;
5. focus navigation;
6. accessible naming;
7. content overflow; and
8. visual presentation.

Each operator must be a closed typed operation with declared probes, preconditions,
changed surface, exact inverse, and cleanup audit. A control is claimed to preserve only
the declared workflow. It is not claimed to be globally harmless.

The protocol freezes matrix cardinality and construction, but this revision does not
pretend that the not-yet-authored application IDs already exist. Before any outcome is
executed, a separate content-addressed generation plan must bind all application,
workflow, source-state, operator, and split identities. It must enumerate every matrix
cell exactly once. No cell may be added, removed, or reassigned after an outcome is
observed.

## Capture environment and schedule

Every application uses a deterministic standalone local fixture with no production data,
hosted API, third-party script, or external network dependency. The frozen common
capture settings are:

- viewport: 800 × 600 CSS pixels;
- locale: `en-US`;
- timezone: `UTC`;
- color scheme: light;
- capture font: Noto Sans; and
- three checkpoints: initial state, immediately before the primary action, and
  immediately after the primary action.

Each pair receives distinct fresh baseline and candidate browser contexts under one
verified browser environment. Runtime-owned code executes the same action plan in both
roles. Environment, session-close, cleanup, or blocked-request failures cannot expose a
pair.

## Failure and retry policy

The generation plan is frozen before execution. A technical failure may retry only the
same predeclared cell and must retain its attempt audit. It may not cause replacement by
a different task, application, operator, seed, or replicate. A persistently failed cell
blocks the complete pilot publication.

A successfully captured pair whose baseline task fails remains an invalid record. It is
never relabeled as a non-regression and is not silently resampled. Measured class counts
are reported even when they differ from the equal declared-relation counts.

## Labels

The sole learned target is `task_regression`:

- positive: baseline succeeds and candidate fails;
- negative: baseline succeeds and candidate succeeds; and
- invalid: baseline fails.

Labels are recomputed by independent replay of the sealed task trace and oracles. The
operator's declared relation is sealed provenance, never the measured label. Free-form
model judgments do not participate in ground truth.

The development policy's severity ordinals `0` and `4` remain replayable metadata for
the existing checkout fixture. They are not a Pilot v0.1 training target or a general
severity scale.

## Primary split

The primary protocol is an application holdout. Complete application groups are assigned
before any task outcome is observed:

| Partition  | Applications | Planned pairs | Declared breaking | Declared control |
| ---------- | -----------: | ------------: | ----------------: | ---------------: |
| train      |           10 |           320 |               160 |              160 |
| validation |            5 |           160 |                80 |               80 |
| test       |            5 |           160 |                80 |               80 |

An application's source states, workflows, near duplicates, and transitive shared asset
components remain in one partition. Generic benchmark infrastructure may be exempted
only by an explicit policy-bound allowlist. Split construction cannot optimize measured
label balance.

Mutation-family and joint application/family holdouts may be published as exploratory
stress views. They cannot support the headline claim unless their own predeclared group
and measured-class gates pass. Their absence or insufficiency does not alter the primary
application-holdout protocol.

## Model-visible boundary

The trusted dataset verifier materializes a visible-only input for an isolated feature
worker. The trusted scorer opens sealed records separately and projects only the minimal
labels and grouping tensors required by training and evaluation.

Model-visible evidence may contain canonical screenshots, accessibility trees, bounded
layout graphs, capture settings, and routing references. The following may not become
numeric, categorical, hashed, embedded, or otherwise learned features:

- operator and expected-relation identities;
- task outcomes, oracle results, failed steps, recovery counts, or durations;
- split and grouping identities;
- evidence, capture, task, source, or artifact digests;
- paths, filenames, row order, or archive membership; and
- any bytes from sealed mutation, trace, label, audit, or localization artifacts.

Identifiers may be used only to join verified rows outside the feature matrix. Changing
sealed bytes while keeping visible evidence fixed must leave extracted feature bytes
identical. Reordering rows may change only the row map. Pixel-only extraction may open
only PNG payloads; structured-only extraction may open only accessibility and layout
payloads; fused training receives only the already extracted numeric modalities.

The feature process must have no network namespace and no mount of the sealed store,
home directory, repository, or release parent. Until that OS-isolated runner and its
canary tests pass, the project may claim physical visible/sealed byte separation but not
process-level leakage safety.

## Comparisons and temporal ablations

The learned comparison set is fixed to:

- pixel-only;
- structured accessibility/layout-only; and
- fused pixel plus structured evidence.

The deterministic supporting baselines are absolute pixel change, a declared
structural-image-similarity metric, layout-graph edit distance, and accessibility-tree
edit distance. Supporting baselines cannot replace either learned unimodal comparator in
the fusion claim gate.

All learned models are evaluated with three temporal views: initial checkpoint only,
post-primary-action checkpoint only, and all checkpoints. This exposes models that rely
only on a visible success/failure confirmation state.

Training hyperparameters, feature definitions, calibration procedure, random seeds, and
software versions must be bound in a run configuration before test labels are opened.
Validation may select calibration and an operating threshold; test may be evaluated once
by the release scorer.

## Metrics and eligibility

Average precision is the primary metric. Supporting metrics are AUROC, Recall at 5%
benign false-positive rate, Brier score, expected calibration error with 10 fixed
equal-width probability bins, task-regression recall, and task-non-regression recall.
Results are also broken out by application and mutation family.

The 5% benign-FPR threshold is chosen on validation data and applied unchanged to the
test set. Every table and plot must be generated from released prediction files rather
than copied from a console or edited by hand.

No benchmark claim is eligible unless:

- training contains at least five application groups and grouped out-of-fold logits are
  used for fusion;
- validation and test each contain at least five application groups, 50 measured task
  regressions, and 50 measured task non-regressions; and
- any claimed family holdout contains at least two held-out breaking variants and two
  held-out control variants across its held-out families.

If a metric or bootstrap resample is undefined because it contains one measured class,
the claim gate fails. The split, metric, or sample set is not changed in response.

## Confidence interval

The fusion comparison uses 10,000 paired percentile-bootstrap resamples with seed
`20260715`. The resampling unit is the application group: all rows from a sampled
application move together and retain multiplicity. Both fused-minus-pixel and
fused-minus-structured differences are computed on each same resample. The interval
level is 95%.

## Release correctness and artifacts

Two clean runs from the same frozen inputs must produce identical feature matrices, row
maps, coefficients, run metadata, and model artifact hashes. The released ONNX
probabilities must match the reference implementation with maximum absolute difference
`1e-6`. Each complete model bundle is at most 5 MiB.

One-thread CPU latency p50/p95, peak RSS, model bytes, feature bytes, and per-item
artifact bytes are mandatory measurements. The exact hardware and software environment
must accompany them. Pilot v0.1 does not set a blocking latency or RSS threshold before
a reference performance harness is frozen.

The public release must include:

- a visible data archive and a separately distributed sealed scoring archive;
- frozen generation, split, feature, training, and evaluation configurations;
- row maps, predictions, scalar metrics, confidence intervals, and per-group results;
- the safe model bundles and checksums;
- generated precision-recall/reliability tables or plots and the source prediction
  files;
- data and model cards;
- a benchmark report that includes negative results and invalid-cell counts;
- license and third-party-notice files; and
- reproduction commands that run without paid services.

Missing matrix cells, failed replay, visible/sealed contamination, nondeterministic
artifacts, feature changes under sealed perturbation, ONNX parity failure, unmet sample
gates, or an incomplete release manifest block a benchmark claim.

## Explicit non-claims

Pilot v0.1 makes no claim of:

- a universal severity scale;
- learned localization;
- performance on arbitrary or production websites;
- state-of-the-art performance;
- production readiness;
- classifier causality;
- accessibility harm beyond the declared executable oracle; or
- process-level leakage safety before OS isolation passes.

## Change control

Any change to the matrix, environment, split, target, metric hierarchy, eligibility
gates, confidence interval, or non-claims produces a new protocol identity. Once any
outcome has been observed, Pilot v0.1 is not silently amended. A correction must be
versioned and the original result retained with an explicit erratum.
