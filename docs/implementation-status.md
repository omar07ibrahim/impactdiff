# ImpactDiff implementation status

This page is the detailed inventory behind the shorter
[README status](../README.md#current-result). ImpactDiff has an executable evidence
boundary and the deterministic core of its capture and mutation pipeline. It does
**not** yet contain a released dataset, trained model, or benchmark result, and it makes
no accuracy claim.

## Scope at a glance

| Surface                                | Implemented now |                  Pilot v0.1 plan |
| -------------------------------------- | --------------: | -------------------------------: |
| Independently authored applications    |               2 |                               20 |
| Declared workflows                     |               4 |                               40 |
| Local authoring checkpoints            |              12 |      Not an official corpus unit |
| Catalogued operator definitions        |              16 |                               16 |
| Browser-executable pointer definitions |               2 | 16 definitions across 8 families |
| Official before/after pairs            |               0 |            640 at replicate zero |
| Released datasets                      |               0 |                      Future work |
| Trained models                         |               0 |                      Future work |
| Benchmark results                      |               0 |                      Future work |

The 12 committed screenshots, accessibility trees, and layout graphs are deterministic
local authoring evidence marked `official: false`. They are not official before/after
corpus pairs.

## Implemented capability inventory

- A machine-validated Pilot v0.1 protocol frozen before corpus outcomes: 20 application
  keys, two workflows per application, eight causal mutation families, paired breaking
  and preserving relations, four application-disjoint outer folds, exact metrics, and
  explicit claim gates.
- A content-addressed Pilot operator catalog with 16 exact definitions. Each definition
  binds typed effects, source and installed probes, inverse/cleanup requirements, and an
  ordered eight-predicate causal policy that distinguishes designated, correlated, and
  preserved effects.
- Four closed dataset-manifest schemas with strict canonical JSON, content-derived
  identities, visible/sealed binding, and leakage-aware split validation.
- A registered-codec content-addressed store that canonicalizes on write, revalidates on
  read and audit, and enforces exact membership, plus a paired audit that keeps visible
  and sealed roots disjoint.
- Bounded canonical PNG decoding and deterministic RGBA re-encoding, including removal
  of ancillary metadata and invisible-RGB channels.
- Closed action-plan, capture-specification, accessibility, and layout payloads, plus
  deterministic accessibility/layout normalization and Q64 geometry.
- Resolved evidence/intervention validators that bind every supplied payload to its
  manifest reference, checkpoint schedule, viewport, graph links, and sealed mutation
  provenance.
- Closed changed-surface, executable-oracle, raw-trace, and localization payloads, plus
  resolved-record replay that derives outcomes from captured task state instead of
  trusting stored labels.
- A typed, reversible mutation compiler for a contrast-safe palette swap and a pointer
  interceptor expected to break the task, with source probes and derived preconditions.
- A runtime-owned Chromium mutation environment over a deterministic checkout fixture.
  It derives environment identity from canonical CaptureSpec bytes that bind installed
  Playwright and browser trees, the project-pinned live executable and launch profile,
  declared font bytes, and capture settings. The session separately verifies fixture
  resources, CSP, actual custom-font use, virtual time, network policy, DOM/CSS
  integrity, and exact mutation cleanup. Its authenticated task executor derives and
  locks deterministic scroll/target geometry, performs a true coordinate click, then
  emits two canonical PNG, accessibility-tree, and layout-graph checkpoints without
  exposing a partial run.
- A fixed fresh-pair assembler for `checkout-card-v1`. It commits replicate zero before
  execution, runs baseline and candidate sequentially in distinct browser contexts under
  one verified Chromium environment, requires cleanup, audited session closes, an empty
  blocked-external-request audit, and browser shutdown, then derives and replays the
  complete pair before publication.
- An append-only paired-release publisher. It snapshots caller bytes before its first
  asynchronous operation, builds independent visible and sealed CAS roots in one private
  staging directory, verifies exact topology and full semantic replay, writes a commit
  binding both canonical records, and exposes the pair with one same-parent directory
  rename. Startup recovers only reserved owned stages; committed releases are idempotent
  and immutable.
- Two independently authored Pilot pre-release packages: the Thread & Tally
  `pilot-market-basket-v1` board and the Nightwatch Relay `pilot-incident-command-v1`
  console. Each strict manifest binds an application-owned 800 by 600 UI, two
  four-action workflows, the shared mutation ABI, exact resource provenance, a canonical
  SourceState, and two derived ActionPlans without creating identity cycles. The loader
  remains deliberately `official: false` and has no outcome, capture, or label surface.
- A separate Pilot browser-authoring runtime exercised across all four workflows. It
  snapshots each audited fixture before launch, binds it to the pinned Chromium and
  CaptureSpec, and replays one workflow in a fresh isolated context. The replay closes
  request, CSP, WebRTC, shadow-root, custom-font, readiness, ABI, action, bounded
  live-document, and lifecycle audits around a raw source-center click. The ordinary
  replay API returns only a success audit marked `official: false`; a separate
  capture-first API returns, only after the success oracle and cleanup complete, an
  `official: false` result with exactly three manifest-bound checkpoints. Their payloads
  are canonical PNG and canonical accessibility-tree and layout-graph JSON bytes,
  exposed through defensive copies. The current authoring gate requires three
  fresh-context runs of every market-basket and incident-command workflow to produce
  byte-identical payloads at every checkpoint. This attests reviewed,
  repository-authored fixture code rather than hostile page code. It creates no
  `capture_id`, corpus row, operator, outcome, label, generation-plan execution, or
  benchmark result, and no failure or cleanup error exposes a partial capture result.
- The first executable Pilot operator slice across both authoring packages.
  `authorPilotFixturePointerHitTestingPair` accepts only either exact catalogued pointer
  definition, runs a successful baseline and candidate in separate fresh contexts,
  installs the same CSP-authorized transparent owned layer twice, measures the complete
  installed `P, O, D, N, F, A, C, V` policy, proves exact inverse and final cleanup over
  DOM, computed style, pixels, accessibility, layout, hit testing, focus, scroll,
  listener registrations, and owned handles, and independently classifies the candidate
  as `exact_success` or `exact_unchanged`. The complete current slice covers four
  workflows by two definitions, with three exact fresh attempts per case. Its small
  frozen result remains `official: false`; checkpoints, probes, declared relations,
  labels, and private browser capabilities never cross the API boundary.

## Runtime and boundary qualification

The capture contract names the exact installed file trees for `@playwright/test`,
`playwright`, and `playwright-core` 1.61.1; the Chromium Headless Shell executable,
complete installation tree, source revision, and normalized launch profile; every
render-font file; and an honest Linux host or an OCI shape reserved for external
attestation verification. The current launcher produces a host capability only.

The verified single-role runtime, fixed fresh-pair assembler, and paired-release
transaction are implemented for the closed checkout fixture. Real-browser integration
covers the task-breaking pointer interceptor and task-preserving palette swap. This is a
development path, not a corpus generator: multi-pair dataset construction,
process-isolated feature loading, general scoring, training, and learned baselines
remain future work.

## Evidence and claim boundary

The committed local evidence bundle establishes deterministic local Pilot authoring
replay, byte identities for screenshot/accessibility/layout checkpoints, and closed
fixture, task, source, compiled-runtime, and capture-environment bindings. It does not
establish:

- an official dataset release;
- model quality or benchmark performance; or
- production-browser compatibility.

See the [Pilot protocol](pilot-v0.1-protocol.md), [data boundary](data-boundary.md), and
[research charter](charter.md) for the frozen evaluation and claim gates.
