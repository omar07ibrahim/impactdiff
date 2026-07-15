# Pilot v0.1 mutation operators

## Status and scope

This document fixes the construction semantics and frozen order of the 16 Pilot v0.1
mutation-operator definitions: one declared-breaking definition and one matched
task-preserving control for each of the eight protocol families. It complements the
[Pilot protocol](pilot-v0.1-protocol.md) and the
[application catalog](pilot-v0.1-application-catalog.md).

This document is not an operator-definition artifact, an executable implementation, or
evidence that an operator has passed on any workflow. The code-owned catalog constructs
the canonical `application/vnd.impactdiff.mutation-operator+json` definitions and their
content-derived references and IDs; this prose creates none of those objects and cannot
replace them. No generation plan, capture, outcome, or label follows from the catalog.
Digest-shaped placeholders must not be manufactured from the prose.

`declared_breaking` and `task_preserving_control` are pre-outcome construction roles.
They are sealed provenance, not measured classes. A control is intended to preserve only
the declared workflow; it is not claimed to be harmless for unrelated behavior.

## Frozen order and keys

The generation plan must bind the rows below in this exact family order, with the
declared-breaking member before its control. Every definition has operator version `1`
and phase `before_task`.

| Order | Family                 | Relation                  | Definition key                                  |
| ----: | ---------------------- | ------------------------- | ----------------------------------------------- |
|     1 | `pointer_hit_testing`  | `declared_breaking`       | `pointer_hit_testing.intercept_source_point.v1` |
|     2 | `pointer_hit_testing`  | `task_preserving_control` | `pointer_hit_testing.pass_source_point.v1`      |
|     3 | `overflow_clipping`    | `declared_breaking`       | `overflow_clipping.exclude_source_point.v1`     |
|     4 | `overflow_clipping`    | `task_preserving_control` | `overflow_clipping.retain_primary.v1`           |
|     5 | `target_displacement`  | `declared_breaking`       | `target_displacement.beyond_source_point.v1`    |
|     6 | `target_displacement`  | `task_preserving_control` | `target_displacement.within_source_point.v1`    |
|     7 | `native_control_state` | `declared_breaking`       | `native_control_state.disable_primary.v1`       |
|     8 | `native_control_state` | `task_preserving_control` | `native_control_state.disable_peer.v1`          |
|     9 | `focus_navigation`     | `declared_breaking`       | `focus_navigation.insert_before_primary.v1`     |
|    10 | `focus_navigation`     | `task_preserving_control` | `focus_navigation.insert_after_primary.v1`      |
|    11 | `accessible_naming`    | `declared_breaking`       | `accessible_naming.empty_primary_name.v1`       |
|    12 | `accessible_naming`    | `task_preserving_control` | `accessible_naming.copy_primary_name.v1`        |
|    13 | `content_overflow`     | `declared_breaking`       | `content_overflow.unbreakable_pressure.v1`      |
|    14 | `content_overflow`     | `task_preserving_control` | `content_overflow.breakable_pressure.v1`        |
|    15 | `visual_presentation`  | `declared_breaking`       | `visual_presentation.low_contrast_primary.v1`   |
|    16 | `visual_presentation`  | `task_preserving_control` | `visual_presentation.high_contrast_primary.v1`  |

Definition keys are review and routing names. The content-addressed definition
reference, not the key by itself, is the executable authority.

## Closed definition and identity rules

Every canonical definition must use contract `impactdiff.pilot-mutation-operator`,
version `1`, media type `application/vnd.impactdiff.mutation-operator+json`, Pilot
release `pilot-v0.1`, and the exact bound Pilot protocol ID. It is a closed data object
that may refer only to the manifest-bound logical task-surface slots and fixed enum
profiles named in this document. It must not accept or contain a caller-supplied
selector, locator, path, JavaScript, CSS, markup fragment, application key,
workflow-specific field, arbitrary label text, or arbitrary pressure content. CSS, text,
markup, geometry, and native-node recipes are runtime-owned closed enum profiles.

Each definition has one owned handle, `h0`. Its exact inverse is
`remove_owned_intervention` over `h0`. The definition's closed source-probe set is its
precondition declaration; `preimage_hashes_bound` requires the bounded exact preimage.
The definition also carries its common changed-surface body, installed local predicate,
inverse, and cleanup probe keys. It must not contain its own `operator_id`, because
doing so would make the definition and its content-derived identity circular.

The family ID is derived from the frozen family key. The generation-plan operator ID is
then derived under the domain `impactdiff:pilot-mutation-operator:v1` from exactly:

- `mutation_family_id`;
- `declared_relation_variant`;
- `operator_version`; and
- all four fields of the exact definition `ArtifactRef`: `sha256`, `byte_length`,
  `media_type`, and `format_version`.

Changing any definition byte therefore requires a new definition reference and a new
operator ID. No operator ID exists until the canonical definition bytes exist.

Both members of a family pair must also carry the same content-derived pair identity and
exact common pair body. `pair_id` has prefix `idpr1_` and is the SHA-256 result under
domain `impactdiff:pilot-operator-pair:v1` over the canonical body containing exactly
the Pilot protocol ID, family ID, operator version, pair version `1`, and common pair
body. The common body contains only the primitive, changed surface, fixed parameters
(including a common target where the family has one), and contrast axis.
Relation-specific effects and installed predicates remain distinct definition fields;
for example, the native-control target is an effect, not pair-ID material. Catalog
validation separately requires both members to share the same phase, required probes,
inverse, cleanup audit, and relation-semantics policy. No pair ID value exists until
that exact common body is canonical.

The ordered operator-catalog identity has prefix `idoc1_` and is derived under domain
`impactdiff:pilot-operator-catalog:v1`. Its canonical body contains the Pilot protocol
ID, release `pilot-v0.1`, and the exact ordered 16 rows, each reduced to family ID,
declared relation, operator version, and all four definition-reference fields. No
operator-catalog ID value exists before all 16 canonical definition references exist.

The complete generation-plan identity binds the protocol ID and the exact ordered 16
family/relation/operator/reference rows. Reordering, substituting, or reusing a
definition reference is therefore a plan change, not a runtime choice.

## Required probe keys

The source-probe keys are the definition's complete closed precondition declaration.
Every definition requires these seven probes as an exact sequence in this order:

- `runtime_clean`;
- `bindings_resolve_once`;
- `primary_native_enabled_visible`;
- `primary_source_center_hit`;
- `local_task_predicate_passes`;
- `owned_handle_absent`; and
- `preimage_hashes_bound`.

Every non-pointer family adds exactly its matching eighth source probe:

| Family                 | Additional source probe                 |
| ---------------------- | --------------------------------------- |
| `overflow_clipping`    | `clip_host_compatible`                  |
| `target_displacement`  | `displacement_clearance`                |
| `native_control_state` | `native_peer_compatible`                |
| `focus_navigation`     | `source_focus_trace_exact`              |
| `accessible_naming`    | `source_accessible_name_nonempty`       |
| `content_overflow`     | `content_box_contained`                 |
| `visual_presentation`  | `source_primary_contrast_at_least_4500` |

All 16 definitions use the exact installed-probe sequence `owned_surface_exact`,
`family_effect_exact`, `changed_surface_bounded`, `local_predicate_expected`, and
`orthogonal_predicates_preserved`.

Every definition also carries `installed_predicate_policy` with `policy_version=1` and
an exact eight-row `vector`. Each row contains `predicate`, `expected_state`, and
`role`; the row order is fixed as follows:

| Symbol | Ordered predicate                               |
| ------ | ----------------------------------------------- |
| `P`    | `primary_source_point_dispatches_to_primary`    |
| `O`    | `primary_fully_visible_and_source_hit_testable` |
| `D`    | `primary_at_source_bound_hit_point`             |
| `N`    | `primary_enabled`                               |
| `F`    | `declared_focus_path_reaches_primary`           |
| `A`    | `primary_accessible_name_nonempty`              |
| `C`    | `content_pressure_contained`                    |
| `V`    | `primary_text_contrast_at_least_4500`           |

A declared-breaking policy has one `designated` fail row, the exact permitted
`correlated` fail rows below, and `preserved` pass rows everywhere else:

| Breaking family        | Designated fail | Correlated fail | Preserved pass                    |
| ---------------------- | --------------- | --------------- | --------------------------------- |
| `pointer_hit_testing`  | `P`             | `O`, `D`        | `N`, `F`, `A`, `C`, `V`           |
| `overflow_clipping`    | `O`             | `P`, `D`        | `N`, `F`, `A`, `C`, `V`           |
| `target_displacement`  | `D`             | `P`, `O`        | `N`, `F`, `A`, `C`, `V`           |
| `native_control_state` | `N`             | `F`             | `P`, `O`, `D`, `A`, `C`, `V`      |
| `focus_navigation`     | `F`             | none            | `P`, `O`, `D`, `N`, `A`, `C`, `V` |
| `accessible_naming`    | `A`             | none            | `P`, `O`, `D`, `N`, `F`, `C`, `V` |
| `content_overflow`     | `C`             | none            | `P`, `O`, `D`, `N`, `F`, `A`, `V` |
| `visual_presentation`  | `V`             | none            | `P`, `O`, `D`, `N`, `F`, `A`, `C` |

Every task-preserving control instead has its one designated row at pass and the other
seven rows marked `preserved` at pass, with no correlated rows. Thus
`orthogonal_predicates_preserved` enforces the code-owned correlation policy: every
unlisted predicate remains pass, while a listed correlated failure is required rather
than misclassified as an undeclared failure surface.

The inverse and cleanup audit use the exact sequence `owned_handles_absent`,
`mutation_preimages_equal`, `listener_registry_equal`, `dom_roundtrip_equal`,
`computed_style_roundtrip_equal`, `pixel_roundtrip_equal`,
`accessibility_roundtrip_equal`, `layout_roundtrip_equal`, `hit_test_roundtrip_equal`,
`focus_and_scroll_roundtrip_equal`, and `runtime_clean`. Definition bytes must carry
these closed probe keys, not caller-written prose or an application-specific assertion.

## Common source and lifecycle gates

Before any family-specific probe, the trusted runner must establish all of the following
from the exact resolved fixture, workflow, action-plan, and definition bytes:

- the runtime is clean, with no active intervention handle;
- every referenced logical slot resolves exactly once through its manifest binding;
- `primary` is a native, enabled, fully visible control inside the fixed viewport with
  non-empty finite bounds;
- the source-bound center of `primary` resolves to `primary` in hit testing;
- the source workflow's local semantic, focus, hit-test, and task predicates pass;
- the exact mutation preimages are bounded and captured before apply; and
- the requested operator, family, relation, version, source state, task, environment,
  and replicate are the predeclared cell bindings.

The common lifecycle is closed:

1. apply the one definition through owned handle `h0`;
2. run the mechanical installed probe and compare it with the definition's installed
   local predicate;
3. run the exact inverse and prove preimage restoration;
4. for an admitted candidate run, apply the same definition again and execute the
   unchanged workflow action plan; and
5. after the final checkpoint, remove the owned intervention and complete the cleanup
   audit before exposing a pair.

The apply/probe/inverse round trip must restore identical DOM, relevant computed styles,
pixels, accessibility, normalized layout, hit testing, focus, and scroll. After the
actual task, cleanup must additionally prove that all owned handles are absent, the
exact mutation preimages are restored, the listener registry is unchanged, and the
runtime is clean. An installation, probe, inverse, or cleanup failure is technical; it
cannot trigger a fallback recipe, a different operator, or an application-specific
substitution.

Installed probes establish only that the requested local mechanism was installed. They
are not task outcomes and must never determine `task_regression`.

## Exact matched definitions

### 1. Pointer hit testing

Both definitions use `install_hit_layer` over the source `primary` border box. The owned
layer is transparent, accessibility-hidden, nonfocusable, and geometrically identical in
both members.

- `pointer_hit_testing.intercept_source_point.v1` sets `pointer_mode=intercept`. The
  installed probe requires `elementFromPoint(source_center)` to return the owned layer
  and the local predicate `primary_source_point_dispatches_to_primary` to fail.
- `pointer_hit_testing.pass_source_point.v1` sets `pointer_mode=pass_through`. The
  installed probe requires the same source center to resolve to `primary` and the local
  predicate to pass.

The actual workflow still uses the same source-bound pointer coordinate in baseline and
candidate; the runner may not relocate the click after installation.

### 2. Overflow clipping

Both definitions use `install_overflow_clip` on `clip_host`, on the block axis at its
block-end edge, with the same overflow-clipping primitive. `clip_host` must be an
ancestor of `primary`, must not contain `success`, and must have at least eight CSS
pixels of source block-end safe margin beyond the primary border box.

- `overflow_clipping.exclude_source_point.v1` places the clip boundary exactly one CSS
  pixel before the source hit point. The installed probe requires the source center to
  lie outside the effective clip and `primary_fully_visible_and_source_hit_testable` to
  fail.
- `overflow_clipping.retain_primary.v1` places the boundary exactly eight CSS pixels
  after the primary border box. The installed probe requires the complete primary and
  its source center to remain inside the effective clip, the center hit to resolve to
  `primary`, and the local predicate to pass.

### 3. Target displacement

Both definitions use `install_translation` on `displacement_anchor`, in the inline-end
direction from the same border-box origin. The anchor must resolve once, contain
`primary`, have no source transform, and have enough viewport clearance for the larger
translation.

- `target_displacement.beyond_source_point.v1` translates by half the primary width plus
  eight CSS pixels. The installed probe requires the original source center to miss
  `primary` and `primary_at_source_bound_hit_point` to fail.
- `target_displacement.within_source_point.v1` translates by the smaller of eight CSS
  pixels and one quarter of the primary width. The shift must be non-zero, while the
  original source center must still hit `primary` and the local predicate must pass.

### 4. Native control state

Both definitions use `set_native_disabled` with value `true`. The fixture's
`native_control_peer` must be visible and enabled; match the primary's native role,
element tag, exact source size/box-metric geometry signature under the frozen
geometry-comparison rule, and relevant computed-style signature; occur after `primary`
in sequential focus order; and be outside every action and oracle dependency. Absolute
`x` and `y` are excluded from the geometry signature, and the peer and primary border
boxes must be disjoint.

- `native_control_state.disable_primary.v1` targets `primary`. The installed probe
  requires native `:disabled` to hold and `primary_enabled` to fail.
- `native_control_state.disable_peer.v1` targets `native_control_peer`. The installed
  probe requires the peer to be natively disabled while `primary` remains enabled and
  `primary_enabled` passes.

The control is not allowed to replace the peer with an application-selected element or
to depend on a different workflow path.

### 5. Focus navigation

Both definitions use `insert_focus_stop`: one owned native focus stop with
`element_profile=owned_fixed_focus_stop_v1`, `tab_index=0`,
`visual_position=fixed_bottom_end`, accessible name `Injected focus stop`,
`pointer_interaction=pass_through`, and the same closed visual and accessibility
payload. The pass-through behavior prevents the focus-stop surface from intercepting a
task hit point. The source focus trace must exactly match the workflow declaration and
must contain no positive `tabindex`.

- `focus_navigation.insert_before_primary.v1` inserts the stop immediately before
  `primary` in sequential focus order. The declared Tab prefix must reach the owned stop
  instead, so `declared_focus_path_reaches_primary` fails.
- `focus_navigation.insert_after_primary.v1` inserts the identical stop immediately
  after `primary`. The declared prefix through `primary` remains unchanged and the local
  predicate passes.

### 6. Accessible naming

Both definitions use `install_owned_labelledby` on `primary` with one hidden owned label
node. The recipe may derive text only from the source browser-computed accessible name,
which must initially be non-empty; no definition or caller may supply arbitrary label
text.

- `accessible_naming.empty_primary_name.v1` gives the owned label empty content. The
  installed Chromium accessibility probe must report an empty computed name and
  `primary_accessible_name_nonempty` fails.
- `accessible_naming.copy_primary_name.v1` copies the exact source computed name into
  the otherwise identical owned label. The computed name remains non-empty and the local
  predicate passes.

### 7. Content overflow

Both definitions use `install_content_pressure` on `content_pressure` with the exact
same runtime-owned `pilot_status_token_96_v1` text profile. The source content box must
be contained on both axes and expose fixed, finite capacity.

- `content_overflow.unbreakable_pressure.v1` uses the closed unbreakable wrap mode. The
  installed probe requires `scrollWidth` to exceed `clientWidth` by at least one CSS
  pixel and `content_pressure_contained` fails.
- `content_overflow.breakable_pressure.v1` uses the closed wrap-anywhere mode. The same
  text must remain contained on both axes and the local predicate passes.

### 8. Visual presentation

Both definitions use `install_solid_primary_palette` on `primary`. Foreground and
background are opaque solid colors with no gradient. The source colors must also be
solid and opaque, and their recomputed contrast ratio must be at least `4500` in
ratio-milli units.

- `visual_presentation.low_contrast_primary.v1` sets foreground RGB `[119, 126, 136]`
  and background RGB `[128, 135, 145]`. The recomputed ratio is exactly `1130`, so
  `primary_text_contrast_at_least_4500` fails.
- `visual_presentation.high_contrast_primary.v1` sets foreground RGB `[20, 43, 67]` and
  background RGB `[221, 238, 248]`. The recomputed ratio is exactly `12126`, so the
  local predicate passes.

A cosmetic palette swap without this predeclared, mechanically replayable usability
predicate is not the Pilot visual-presentation breaking definition.

## Structural and executable gates

The current `impactdiff.pilot-generation-plan/v1` validator establishes structural
shape, frozen family/relation order, content-derived identities, reference formats,
split binding, and complete matrix enumeration. It deliberately does not resolve the
referenced operator definitions, source states, action plans, or audits. Passing that
validator does not make any row executable.

Before an official cell can execute, a resolved verifier must additionally:

- resolve every exact canonical definition reference and reject noncanonical or unknown
  fields;
- prove that all 16 definitions and their common pair bodies match this document in the
  frozen order, with distinct definition references and correct content-derived IDs;
- resolve the source fixture and action plan, enforce the complete task-surface ABI, and
  reject application-specific operator parameters;
- prove exact membership in the resource, license, and grouping audits and bind every
  operator through its exact generation-plan definition reference;
- establish all common and family-specific source gates and static compatibility for
  every one of the 40 workflow bindings;
- require the exact three-checkpoint schedule and unchanged source-bound pointer action;
- require replayable installed, inverse, cleanup, semantic, focus, hit-test, and final
  task predicates; and
- issue an execution capability only for the frozen generation plan and its exact
  predeclared cell.

`accessible_naming`, `content_overflow`, and `visual_presentation` have an additional
hard gate: the opcodes for `primary_accessible_name_nonempty`,
`content_pressure_contained`, and `primary_text_contrast_at_least_4500` must be sealed,
typed, bounded, and independently replayable before their declared-breaking definitions
are executable. Prose, a fixture-provided boolean, screenshot inspection, or a free-form
human or model judgment cannot fill this gap.

Authoring checks may exercise only explicitly versioned mutable pre-release bytes and
must retain their attempt audit. They create no official corpus row or sealed label and
cannot select a different definition, application, block, or relation. The final exact
source, action, audit, and definition references remain unexecuted until the complete
generation-plan identity is frozen.

## Outcomes and model-visible boundary

The runtime must execute the same action plan in fresh baseline and candidate contexts.
Task success is derived from the independently replayed semantic trace and final
oracles. The measured label is positive only when the baseline succeeds and the
candidate fails; a failed baseline is invalid. Neither an installed local predicate nor
the definition's declared relation may be copied into the measured outcome.

Consequently, a declared-breaking candidate that completes the workflow is a measured
non-regression, and a control candidate that fails it is a measured regression. Neither
case authorizes substitution or resampling.

Operator definitions, IDs, relation variants, probes, preconditions, preimages,
installed checks, inverse state, cleanup state, outcomes, and audit artifacts remain
sealed from model features. Only the protocol-approved screenshot, accessibility/layout,
and capture-setting projections may cross the model-visible boundary.

The existing development `pointer_interceptor` and `palette_swap` implementations do not
become Pilot definitions by sharing a concept or primitive. They remain outside the
Pilot matrix until exact canonical definition bytes, resolved gates, and the frozen
generation plan exist. As of this document, none of the 16 rows has an executable or
measured-outcome claim.
