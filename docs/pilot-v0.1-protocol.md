# Pilot v0.1 protocol

## Status

This document freezes the design of ImpactDiff Pilot v0.1 before any official corpus
captures, labels, features, or model results exist. Its application catalog is a
code-owned plan, not a claim that all fixtures are implemented. The matching machine
contract is content-addressed and rejects changes to the quantities and rules below. Its
frozen identity is
`idpp1_d6b3e033f59d51b17b29d6fb51c74368a8489f9f9284778cb39e856a73b29309`.

Pilot v0.1 has one learned research task: binary detection of task regressions on
previously unseen, deterministic local web applications. It is a controlled synthetic
pilot, not a benchmark of arbitrary websites.

## Primary question and claim

The primary question is whether a fused pixel and accessibility/layout detector
outperforms both learned unimodal detectors on concatenated application-disjoint outer
test predictions.

ImpactDiff may state that the pilot supports this claim only when the lower bound of a
paired 95% application-cluster bootstrap interval is strictly above zero for both:

- fused average precision minus pixel-only average precision; and
- fused average precision minus structured-only average precision.

The two comparators are predeclared. Neither is selected from test performance. A
negative or statistically undefined result is still a reportable result, but it cannot
be worded as support for the fusion claim.

## Complete planned matrix

The corpus plan is the complete Cartesian product of:

- 20 separately designed applications in the frozen catalog;
- 2 declared workflows per application;
- 8 mutation families;
- 2 relation variants per family: one declared task-breaking operator and one matched
  task-preserving control;
- replicate index `0`; and
- one fresh baseline/candidate capture pair per cell.

This produces exactly `20 × 2 × 8 × 2 × 1 = 640` planned pairs: 320 declared-breaking
cells and 320 task-preserving-control cells. These are planned relations, not measured
class labels.

The [application catalog](pilot-v0.1-application-catalog.md) fixes the human-readable
construction specification for those 20 applications and 40 workflows. Its authoring
keys are not content-addressed corpus identities and must never be substituted for them.

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
observed. The source state is fixed by application and workflow across every operator;
one operator is fixed by mutation family and declared relation across every application
and workflow; and each application group belongs to one outer block. These bindings
prevent relation-specific source assignment and application- or workflow-specific
operator selection. The `impactdiff.pilot-generation-plan/v1` contract validates this
shape and binding, but no real Pilot plan exists until its referenced source,
action-plan, operator, resource-audit, license-audit, and grouping-audit bytes exist.
`validatePilotGenerationPlan` is an unresolved structural validator: official execution
must additionally resolve those exact canonical bytes, prove complete audit membership,
and reject any mismatch before accepting the plan.

For this freeze rule, an outcome is an official corpus execution admitted by a frozen
`generation_plan_id`. Authoring checks may exercise only explicitly versioned
pre-release revisions. They produce no corpus row, sealed label, or eligibility result;
they may not drive operator, relation, application, or block selection; and their
revision and attempt log must be retained. Once the final plan references are frozen,
official failures cannot trigger redesign or replacement.

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

Every fixture recipe contains 4–32 deterministic, non-branching actions. It begins with
one semantic focus action, completes one aliased control segment or two state-changing
control segments separated by `Tab`, then uses a final `Tab` into one source-bound
native primary pointer click. The exact checkpoint ordinals are `-1`,
`actions.length - 2`, and `actions.length - 1`; runtime-owned code executes the declared
recipe rather than an application-specific shortcut.

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

## Primary grouped outer evaluation

Before any task outcome is observed, complete application groups are assigned to four
blocks of five. Four predeclared outer folds rotate those blocks through the roles
below:

| Fold      | Train blocks | Validation block | Test block |
| --------- | ------------ | ---------------- | ---------- |
| `outer_0` | 2, 3         | 1                | 0          |
| `outer_1` | 3, 0         | 2                | 1          |
| `outer_2` | 0, 1         | 3                | 2          |
| `outer_3` | 1, 2         | 0                | 3          |

Every fold has the same planned role counts:

| Partition  | Applications | Planned pairs | Declared breaking | Declared control |
| ---------- | -----------: | ------------: | ----------------: | ---------------: |
| train      |           10 |           320 |               160 |              160 |
| validation |            5 |           160 |                80 |               80 |
| test       |            5 |           160 |                80 |               80 |

An application's source states, workflows, near duplicates, and transitive shared asset
components remain in one block. Generic benchmark infrastructure may be exempted only by
a policy-bound allowlist frozen before grouping and limited to the capture harness, Noto
Sans font, and license text. Application-owned assets are never exempt. Block
construction cannot optimize measured label balance. Across the four folds, each
application and each planned pair contributes outer-test predictions exactly once per
model, giving 20 application clusters and 640 pre-label prediction rows for the pooled
evaluation.

Mutation-family and joint application/family views may be published only as diagnostic
slices. They are not eligible for a benchmark or headline claim in v0.1.

## Model-visible boundary

The trusted dataset verifier materializes a sanitized, modality-specific visible
projection plus a frozen, label-free feature configuration for an isolated feature
worker. The raw visible CAS is not mounted. The worker outputs numeric feature matrices
and a routing-only row map. The trusted scorer opens sealed records separately and
projects only the minimal labels and grouping tensors required by training and
evaluation.

Model-visible evidence may contain canonical screenshots, accessibility trees, bounded
layout graphs, capture settings, and routing references. The following may not become
numeric, categorical, hashed, embedded, or otherwise learned features:

- operator and expected-relation identities;
- task outcomes, oracle results, failed steps, recovery counts, or durations;
- split and grouping identities;
- evidence, capture, task, source, or artifact digests;
- paths, filenames, row order, or archive membership; and
- any bytes from sealed mutation, trace, label, audit, or localization artifacts.

Identifiers may be used only by the trusted controller to join verified rows outside the
feature matrix. Changing sealed bytes while keeping visible evidence fixed must leave
extracted feature bytes identical. Reordering rows may change only the row map. The
pixel projection contains only canonical PNG payloads; the structured projection
contains only accessibility and layout payloads.

The feature process must have no network namespace and no mount of the sealed store,
home directory, repository, or release parent. Until that OS-isolated runner and its
sealed-canary, modality-access, row-reorder, and sealed-perturbation tests pass, the
project may publish data but cannot make a benchmark or fusion-performance claim.

## Comparisons and temporal ablations

The learned comparison set is fixed to:

- pixel-only;
- structured accessibility/layout-only; and
- fused pixel plus structured evidence.

The deterministic supporting baselines are absolute pixel change, a declared
structural-image-similarity metric, layout-graph edit distance, and accessibility-tree
edit distance. Supporting baselines cannot replace either learned unimodal comparator in
the fusion claim gate.

The fused model is a late logistic stacker over exactly two inputs: the pixel-expert and
structured-expert logits. Its training inputs are grouped cross-fit logits produced only
from the current fold's training role, grouped by application. In-sample expert logits
are forbidden. After cross-fitting, both experts are refit on the complete fold-training
role and produce the validation/test logits used by the stacker.

All learned models are evaluated with three temporal views: initial checkpoint only,
post-primary-action checkpoint only, and all checkpoints. The headline fusion claim is
fixed to all checkpoints; the other two views are diagnostic ablations. They expose
models that rely only on a visible success/failure confirmation state.

The global algorithm, feature definitions, hyperparameter search space, calibration
procedure, random seeds, and software versions are frozen before any outer-role label is
opened. A test prediction may depend only on labels from its matching fold's training
and validation roles. Cross-fold label/metric feedback is forbidden, and a trusted
orchestrator enforces fold-scoped views. Calibration and the operating threshold use
only that fold's validation block. Predictions from every fold are sealed before pooled
metrics are computed once. A model or prediction from another fold cannot be
substituted.

## Metrics and eligibility

Average precision is the primary metric. Supporting metrics are AUROC, Recall at 5%
benign false-positive rate, Brier score, expected calibration error with 10 fixed
equal-width probability bins, task-regression recall, and task-non-regression recall.
Results are also broken out by application and mutation family.

The 5% benign-FPR threshold is chosen on each fold's validation data and applied
unchanged to its matching outer test fold. Every table and plot must be generated from
released prediction files rather than copied from a console or edited by hand.

Every learned model must provide exactly one prediction for all 640 planned outer-test
rows before the matching outer-test labels are projected. Baseline-invalid rows are then
excluded from metrics and their count is reported. They are also excluded from
base-model fitting, cross-fit stacker fitting, calibration, and threshold selection. All
paired comparisons use the same remaining rows; model-specific filtering or a missing
prediction blocks release.

No benchmark claim is eligible unless:

- every fold's training role contains 10 application groups and grouped out-of-fold
  logits are used for fusion;
- every fold's validation and test roles each contain five application groups, 50
  measured task regressions, and 50 measured task non-regressions; and
- the pooled outer-test population contains all 20 application groups, at least 200
  measured task regressions, and at least 200 measured task non-regressions; and
- every outer-test application contributes at least eight measured task regressions and
  eight measured task non-regressions.

If a metric or bootstrap resample is undefined because it contains one measured class,
the claim gate fails. The split, metric, or sample set is not changed in response.

## Confidence interval

The fusion comparison uses the concatenated outer-test predictions and 10,000 paired
percentile-bootstrap resamples with seed `20260715`. The resampling unit is one of the
20 application groups: all rows from a sampled application move together and retain
multiplicity. Both fused-minus-pixel and fused-minus-structured differences use the same
valid rows and are computed on each same resample. The interval level is 95%.

The reported claim belongs to the predeclared four-fold training procedure and its four
fold-specific model sets. Metrics from a model later retrained on all 20 applications
are not claim-eligible.

## Release correctness and artifacts

Two clean runs from the same frozen inputs must produce identical feature matrices, row
maps, coefficients, run metadata, and model artifact hashes. The released ONNX
probabilities must match the reference implementation with maximum absolute difference
`1e-6`. Each complete model bundle is at most 5 MiB; for fusion this limit covers both
experts, the stacker, and every required preprocessor.

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
