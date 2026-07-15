# Pilot v0.1 market-basket authoring package

`pilot-market-basket-v1` is the first independently authored application package for the
ImpactDiff Pilot. Its current revision, `pilot-market-basket-v1.0.0-authoring.2`, is a
mutable pre-release used to review source provenance, task identity, and the shared
mutation ABI before any Pilot outcome exists.

This package is not a benchmark row. Loading it cannot produce an operator ID, capture
ID, sealed record, task-success label, regression label, or official result. The final
`.0.0` revision will be minted from reviewed bytes and rebound into the complete
20-application generation plan before its first official execution.

## Application and workflows

Thread & Tally is a fixed 800 by 600 market board with two independent workflows:

- `add_bundle` moves the native Bundle weave selection from Dawn Pantry to Harbor
  Picnic, tabs to the primary action, and ends with the exact status
  `Harbor Picnic bundle added, 3 pieces.`
- `choose_pickup` moves the native Pickup point selection from North Arcade to River
  Steps, tabs to the primary action, and ends with the exact status
  `Pickup set to River Steps, Saturday 10 AM to noon.`

Each action plan contains `focus`, `ArrowDown`, `Tab`, and a source-bound primary
pointer click. It declares checkpoint boundaries before action zero, after action two,
and after action three; the baseline authoring replay validates that schedule but does
not collect checkpoint modalities. Both workflows are present before the raw manifest
digest is computed; neither can be added later without rotating the source and task
identities.

The page is synthetic and repository-authored. It has no checkout, payment, address,
delivery, order-confirmation, remote-service, clock, randomness, or storage dependency.
Only the exact vendored Noto Sans and OFL license bytes are shared with the development
checkout fixture.

## Closed workflow ABI

Every workflow declares test-ID locators for `root`, `setup`, `focus_entry`, `primary`,
`native_control_peer`, `clip_host`, `displacement_anchor`, `content_pressure`, and
`success`. `setup` and `focus_entry` deliberately alias one native select. All other
workflow-local slots are distinct, and only `root` may be shared between workflows.

The manifest also carries the exact ordered eight-predicate vocabulary from the Pilot
operator catalog. This remains an authoring claim, not a measured result. The baseline
runtime validates the workflow's retained ABI elements, native setup and primary
controls, source-center hit target, action path, and exact final state; it does not
mechanically probe all eight mutation predicates. A later mutation-authoring runtime
must probe every predicate and exact operator policy before the fixture can be
finalized.

## Identity graph

The raw manifest lists application resources and declarative workflow recipes, but it
does not contain derived IDs or artifact references. This keeps the graph acyclic:

```text
resource bytes
    -> resource digests and lengths
    -> raw fixture.json digest
       -> canonical SourceState reference -> source_state_id
       -> target and step IDs -> canonical ActionPlan references -> task_ids
```

ActionPlan JSON is therefore derived in memory and is not a fixture resource. Putting an
ActionPlan reference in `fixture.json` would make the manifest depend on an artifact
whose target and step identities already depend on the manifest digest.

Application-group and workflow IDs are intentionally deferred. They bind both ordered
workflow tasks and will be computed only from the final source-state and action-plan
references when the complete generation plan is resolved.

## Package verification

The authoring loader audits a real, non-aliased directory; rejects symbolic links, hard
links, special entries, unlisted files, unsafe paths, and unstable reads; and matches
every resource digest and byte length against the canonical manifest. It then builds the
existing `impactdiff.source-state/v1` and `impactdiff.action-plan/v1` artifacts rather
than introducing weaker Pilot-specific copies of those contracts.

The returned value is deeply immutable in structure and exposes artifact bytes through
defensive copies with exact standalone `ArrayBuffer` backing stores. It is marked
`official: false` and contains no execution or label surface.

## Baseline browser-authoring boundary

The Pilot launcher snapshots the complete audited resource tree in memory before it
starts the verified pinned Chromium environment. Every attempt receives a fresh context
bound to that CaptureSpec and serves only exact manifest GET paths from the snapshot;
the live fixture directory is not consulted during replay.

This boundary attests cooperative, repository-authored fixture bytes after package
review and provenance checks. It is not a sandbox for hostile page code; source review
remains part of the authoring threat boundary.

The exact response/meta policy includes `webrtc 'block'`. Pre-navigation guards also
disable peer-connection constructors and author `attachShadow`; readiness re-proves
those sealed descriptors. A bounded CDP DOM audit detects closed-root metadata without
materializing shadow descendants and admits only Chromium's `user-agent` shadow trees
for native controls. These are fail-closed authoring constraints, not a claim that
arbitrary hostile JavaScript has been safely sandboxed.

For either declared workflow, the runtime audits the fixed display and paused clock,
sealed readiness state, exact CSP, custom Noto Sans glyph use, absent service workers,
single page/frame topology, retained ABI identities, request accounting, document
integrity, and cleanup. It performs real focus, `ArrowDown`, and `Tab` actions, freezes
the primary button's source geometry, clicks its raw center with the browser mouse, and
checks the exact selected value, final root state, success text, and success focus.

The bounded document fingerprint covers light-DOM/CSS structure, all form-control live
state, and window, visual-viewport, and element scroll offsets while normalizing only
the declared setup/root/success transition. This baseline rejects author canvas/media,
active animations, open popovers/dialogs, fullscreen, pointer lock, picture-in-picture,
and author shadow roots. Request failures, renderer crashes, file choosers, extra pages,
workers, dialogs, downloads, and post-completion activity revoke success. Cleanup must
leave the owned browser connected with exactly zero contexts before it can be reused.

A successful attempt returns a frozen, success-only audit marked `official: false`,
binding the fixture, source state, workflow, task, environment, four executed actions,
the `[-1, 2, 3]` checkpoint schedule, and served-resource counts. Blocked external or
unexpected fixture requests fail the attempt instead of becoming a partial result.

## Deliberate next boundary

The baseline audit is not a modality capture, mutation attempt, task outcome, label,
generation-plan entry, or benchmark row. It emits no PNG, accessibility, or layout
checkpoint payloads and does not compile, apply, invert, or clean up any mutation
operator. The next Pilot milestone must execute and restore all 16 family/relation
operators, mechanically probe the eight predicates, and add deterministic three-modal
checkpoint capture while its authoring results remain `official: false`.
