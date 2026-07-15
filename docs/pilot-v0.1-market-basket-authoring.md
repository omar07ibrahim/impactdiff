# Pilot v0.1 market-basket authoring package

`pilot-market-basket-v1` is the first independently authored application package for the
ImpactDiff Pilot. Its current revision, `pilot-market-basket-v1.0.0-authoring.1`, is a
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
pointer click. Checkpoints are captured before action zero, after action two, and after
action three. Both workflows are present before the raw manifest digest is computed;
neither can be added later without rotating the source and task identities.

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
operator catalog. This is an authoring claim, not a measured result: the later browser
authoring runtime must mechanically probe each predicate and the exact operator policy
before the fixture can be finalized.

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
defensive copies. It is marked `official: false` and contains no execution or label
surface.

## Deliberate next boundary

Browser execution is a separate milestone. The checkout mutation runtime is purposely
closed to one fixture, one pointer action, and two checkpoints; it is not extended here.
The next Pilot runtime will use fresh isolated contexts, the pinned renderer and font,
raw source-bound pointer coordinates, three checkpoints, executable ABI predicates,
apply/inverse/cleanup auditing, and an authoring-attempt result that remains
`official: false`.
