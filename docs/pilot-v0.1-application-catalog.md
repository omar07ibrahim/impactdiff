# Pilot v0.1 application catalog

## Status and scope

This document defines the planned human-readable catalog for Pilot v0.1: 20 local
mini-applications, two workflows per application, and one outer block per application.
It is a construction specification, not evidence that the complete fixture corpus,
official captures, labels, features, models, or results exist. The mutable
`pilot-market-basket-v1` and `pilot-incident-command-v1` pre-releases, their baseline
browser-authoring replays, capture-first paths, source-predicate measurements, and
pointer-definition pairs are implemented so far; the other 18 applications remain
planned.

The keys below are stable review and authoring keys. They are deliberately not
`application_group_id`, `workflow_id`, `source_state_id`, or `task_id` values. Those
content-addressed identities cannot exist until the corresponding closed fixture and
action-plan bytes exist. The generation plan must derive and bind them before the first
official corpus outcome. It must not manufacture digest-shaped placeholders from this
catalog. Human-readable application, fixture, and workflow keys remain
trusted-controller routing metadata and must never enter model-visible projections or
features.

Each future fixture must use the human-readable fixture key
`pilot-<kebab-case application key>-v1` and be versioned independently. Its first
releasable revision must use the existing `<fixture-key>.0.0` convention, but no
revision exists until its exact resource manifest is closed.

## Workflow convention

Every authored workflow must follow the same observable schedule:

1. capture `initial_state` before any action;
2. perform deterministic semantic and keyboard setup;
3. capture `pre_primary_action` immediately before the primary action;
4. pointer-click one source-bound native primary button; and
5. capture `post_primary_action` immediately after the click.

The application event handler, rather than a follow-up action, moves focus to an
accessible success or status node. Task success includes the declared setup steps and
the final state oracle. Thus a failed semantic or focus step remains a task failure even
if later execution can continue far enough to capture the final checkpoint.

Each authoring recipe contains 4–32 non-branching actions. It starts with exactly one
semantic focus action, ends with a `Tab` into the primary control and one source-bound
primary pointer click, and contains no earlier pointer action. An aliased
`focus_entry`/`setup` segment is either one exact non-empty fill or one or more approved
non-`Tab` keys. Distinct controls use exactly one intermediate `Tab`: the focus-entry
segment may be a fill or key sequence, while the setup segment is key-driven. A checked
transition admits one isolated radio with no same-name peer in its form, and its single
approved state action is `Space`. The three checkpoint boundaries are always `-1`,
`actions.length - 2`, and `actions.length - 1`.

Full workflow keys are `<application key>.<workflow key>.v1`.

## Exact catalog and block assignment

| Block     | Application key    | Planned domain and resource signature                                                                                | Workflow 1                                                                                                      | Workflow 2                                                                                                      |
| --------- | ------------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `block_0` | `market_basket`    | Commerce; asymmetric product grid and sticky receipt; `catalog/items.json`, `art/woven-tag.svg`                      | `add_bundle`: choose a variant by keyboard, then click **Add bundle** and observe the basket status             | `choose_pickup`: choose a pickup point by keyboard, then click **Use pickup** and observe the pickup summary    |
| `block_0` | `incident_command` | SRE operations; severity rail and dense alert table; `events/alerts.json`, `glyphs/severity.svg`                     | `acknowledge_alert`: select an alert semantically, then click **Acknowledge** and observe its status            | `assign_responder`: select a responder by keyboard, then click **Assign** and observe ownership                 |
| `block_0` | `clinic_slots`     | Healthcare; weekly calendar and visit drawer; `calendar/slots.json`, `illustrations/pulse-grid.svg`                  | `book_visit`: select a specialty and slot by keyboard, then click **Book visit** and observe the appointment    | `request_refill`: select a medicine semantically, then click **Request refill** and observe the request status  |
| `block_0` | `model_registry`   | MLOps; version comparison and stage rail; `registry/versions.json`, `plots/latency-bars.svg`                         | `promote_candidate`: select a version by keyboard, then click **Promote** and observe its stage                 | `restore_version`: select a prior version semantically, then click **Restore** and observe routing status       |
| `block_0` | `quality_cell`     | Manufacturing; inspection schematic and lot gauges; `lots/inspection.json`, `schematics/cell.svg`                    | `quarantine_lot`: select a lot by keyboard, then click **Quarantine** and observe its disposition               | `accept_rework`: select a rework route semantically, then click **Accept rework** and observe its status        |
| `block_1` | `rail_route`       | Travel; route timeline and fare drawer; `timetable/routes.json`, `maps/line.svg`                                     | `reserve_departure`: select a departure and fare by keyboard, then click **Reserve** and observe the itinerary  | `confirm_seat`: select a seat semantically, then click **Confirm seat** and observe the seat summary            |
| `block_1` | `workspace_access` | Identity administration; directory table and permission drawer; `directory/members.json`, `icons/key-grid.svg`       | `invite_member`: enter an email and choose a role by keyboard, then click **Send invite** and observe status    | `change_role`: select a member and role semantically, then click **Save role** and observe permissions          |
| `block_1` | `course_path`      | Education; lesson outline and quiz sheet; `curriculum/modules.json`, `diagrams/progress-ring.svg`                    | `enroll_module`: select a cohort by keyboard, then click **Enroll** and observe enrollment                      | `submit_answer`: select an answer semantically, then click **Submit answer** and observe the result             |
| `block_1` | `pipeline_runs`    | Data engineering; horizontal DAG and run log; `runs/history.json`, `graphs/dag.svg`                                  | `retry_stage`: select a failed stage by keyboard, then click **Retry** and observe run status                   | `pause_schedule`: select a pipeline semantically, then click **Pause schedule** and observe scheduler status    |
| `block_1` | `media_review`     | Content operations; filmstrip and annotation panel; `review/frames.json`, `frames/storyboard.svg`                    | `approve_frame`: select a frame by keyboard, then click **Approve** and observe review status                   | `request_revision`: enter a note and choose a category, then click **Send request** and observe revision status |
| `block_2` | `ledger_transfer`  | Fintech; balance header, transfer form, and activity ledger; `accounts/ledger.json`, `marks/balance-wave.svg`        | `schedule_transfer`: select a payee and enter an amount, then click **Schedule** and observe transfer status    | `freeze_card`: select a card by keyboard, then click **Freeze card** and observe card status                    |
| `block_2` | `sprint_space`     | Collaboration; kanban board and detail sheet; `work/items.json`, `art/lane-markers.svg`                              | `move_item`: select an item and lane by keyboard, then click **Move item** and observe its lane                 | `mark_blocker`: select a reason semantically, then click **Mark blocked** and observe blocker status            |
| `block_2` | `permit_desk`      | Civic services; vertical stepper and document checklist; `forms/application.json`, `marks/civic-grid.svg`            | `submit_application`: select a permit type and complete the checklist, then click **Submit** and observe status | `book_inspection`: select a slot by keyboard, then click **Book inspection** and observe the booking            |
| `block_2` | `metric_canvas`    | Analytics; filter rail and SVG chart canvas; `series/metrics.json`, `charts/baseline.svg`                            | `apply_segment`: select a segment by keyboard, then click **Apply** and observe chart status                    | `save_view`: enter a view name semantically, then click **Save view** and observe saved status                  |
| `block_2` | `parcel_dispatch`  | Logistics; depot lanes and abstract route map; `shipments/routes.json`, `maps/depots.svg`                            | `assign_courier`: select a shipment and courier, then click **Assign** and observe dispatch status              | `reroute_parcel`: select a hub by keyboard, then click **Reroute** and observe route status                     |
| `block_3` | `plan_control`     | SaaS subscriptions; plan cards and usage meter; `billing/plans.json`, `meters/usage.svg`                             | `switch_plan`: select a tier by keyboard, then click **Confirm plan** and observe plan status                   | `pause_renewal`: select a duration semantically, then click **Pause renewal** and observe renewal status        |
| `block_3` | `threat_triage`    | Cybersecurity; event heatmap and evidence drawer; `telemetry/events.json`, `diagrams/attack-path.svg`                | `quarantine_endpoint`: select an endpoint and reason, then click **Quarantine** and observe endpoint status     | `close_false_positive`: select a rule and reason, then click **Close finding** and observe finding status       |
| `block_3` | `talent_pipeline`  | Recruiting; candidate swimlanes and schedule sheet; `candidates/stages.json`, `calendar/interviews.svg`              | `advance_candidate`: select a candidate and stage, then click **Advance** and observe stage status              | `schedule_interview`: select a slot and panel by keyboard, then click **Schedule** and observe the interview    |
| `block_3` | `support_queue`    | Customer support; queue, thread, and details panes; `cases/threads.json`, `avatars/initials.svg`                     | `assign_case`: select a case and agent by keyboard, then click **Assign** and observe ownership                 | `resolve_case`: select a resolution semantically, then click **Resolve** and observe case status                |
| `block_3` | `grid_balance`     | Energy operations; one-line network diagram and dispatch console; `sensors/snapshot.json`, `schematics/one-line.svg` | `dispatch_battery`: select a reserve band by keyboard, then click **Dispatch** and observe grid status          | `acknowledge_fault`: select a sensor semantically, then click **Acknowledge** and observe fault status          |

Each block deliberately mixes consumer or transactional work, enterprise operations,
human or public services, data or AI work, and a physical, scientific, logistics, or
content system. Dense tables, calendars, timelines, forms, graphs, boards, diagrams, and
multi-pane layouts are distributed so that no block is defined by one visual archetype.

## Task-surface ABI

The 16 fixed family/relation operators must work without application-specific operator
selection. Their exact matched construction semantics are defined by the
[Pilot v0.1 mutation-operator catalog](pilot-v0.1-mutation-operators.md). Every workflow
must therefore implement a small logical ABI inside its own independently authored DOM:

- a `setup` native input, select, or radio control with a visible label and non-empty
  accessible name;
- a deterministic `focus_entry` and Tab path to the primary action;
- one enabled, fully visible native `button` as `primary`;
- one visible, enabled `native_control_peer` after `primary` in sequential focus order,
  matching its native role, element tag, exact source size/box-metric geometry signature
  under the frozen geometry-comparison rule, and relevant computed-style signature;
  absolute `x` and `y` are excluded from that signature, its border box is disjoint from
  the primary border box, and it remains outside every action and oracle dependency;
- distinct `clip_host`, `displacement_anchor`, and `content_pressure` surfaces;
- an accessible `success` status or heading that receives focus after activation; and
- closed semantic, focus, hit-test, final-state, and cleanup predicates.

The shared names describe bindings, not reusable markup or a component library. A
pointer action uses a source-bound hit point instead of relocating the target after a
mutation. Semantic and focus predicates are executable trace steps, not free-form model
judgments. These requirements make pointer hit testing, overflow clipping, target
displacement, native control state, focus navigation, accessible naming, content
overflow, and visual presentation observable on the same task schedule. The visual
presentation breaking operator still needs a declared usability predicate; a cosmetic
palette change alone is only suitable as a preserving control.

`setup_attribute` and the optional `focus_entry_attribute` are compatibility field names
for exact live control-state expectations, not serialized HTML attributes. `value` binds
an `email`, `search`, `tel`, `text`, or `url` input, a textarea, or select state;
`checked` binds an unchecked-to-checked isolated radio transition. A declared fill must
leave terminal element scroll offsets unchanged, so textarea content that induces
persistent internal scrolling is not an admissible recipe. A distinct focus entry
requires its own state-changing expectation; an aliased focus entry must not duplicate
one.

The code-owned catalog binds planned keys and blocks but does not resolve fixture,
action-plan, operator, or audit bytes. The baseline Pilot runtime now reopens either
exact authored package from an in-memory snapshot, enforces its retained ABI and
three-boundary workflow schedule in fresh browser contexts, performs the source-center
pointer action, and returns a success-only `official: false` audit. Its separate
capture-first API returns exactly three canonical PNG, accessibility-tree, and
layout-graph payloads only after the success oracle and attempt/context lifecycle
cleanup complete. Checkpoint bytes are exposed through defensive copies; a failed
execution or cleanup returns no partial tuple. The source-predicate API measures all
eight local predicates separately, while the pointer-pair API executes only the two
pointer definitions. A resolved operator verifier must still open the exact references,
validate every mutation audit, and bind them before the generation plan may execute.

## Data and shared-infrastructure policy

Each future application must be a standalone 800 by 600 local fixture using `en-US`,
UTC, light color scheme, and Noto Sans. Copy, dates, names, amounts, events, telemetry,
and SVG art must be synthetic and repository-authored. No production record, copied
brand, hosted API, third-party script, remote asset, service worker, nondeterministic
clock, or random input is allowed.

Before grouping, an exact-digest allowlist may exempt only:

- runner-side capture code for readiness, fixed-clock control, blocked-request
  observation, and checkpoint transport;
- the pinned Noto Sans font bytes; and
- exact license text.

The capture harness may not supply visible DOM, CSS, copy, state transitions, or
business logic. Application-owned HTML shells, resets, state helpers, JSON, SVG, icons,
and components are never exempt. Excluding allowlisted bytes, an application should
remain at or below 512 KiB and the complete source catalog at or below 10 MiB.

## Asset and near-duplicate audit

The audit must run before block identities enter the generation plan:

1. Build a bipartite graph from each application to the raw SHA-256 of every
   application-owned resource. Any cross-application exact match fails review, even
   within one block; allowlisted infrastructure is excluded only by exact digest.
2. Compare normalized HTML, CSS, and JavaScript with five-token shingles. Flag a pair
   when aggregate Jaccard similarity is at least `0.55` or any language-specific value
   is at least `0.70`.
3. Compare canonical SVG trees, rendered vector perceptual hashes, initial screenshots,
   and role/layout tree signatures. Flag a pair when both layout similarity is at least
   `0.90` and screenshot SSIM is at least `0.92`.
4. Confirmed near-duplicate relations form transitive components. No component may cross
   an outer block. The preferred resolution is independent re-authoring, not moving a
   copied fixture into the same block.
5. Content-address the audit report, digest allowlist, and accepted block assignment.
   Any later application-owned byte change requires a new fixture revision and a fresh
   audit before official outcomes.

Threshold flags require review; they are not evidence that two applications are
duplicates by themselves. Block construction must not use measured task labels.

## Acceptance gates

These are full-catalog authoring gates, not claims about the current fixture. Before
final source revisions and the generation plan are closed, authoring checks must
establish:

- 20 unique application keys, five applications per block, 40 unique workflow keys, and
  exactly 640 planned Cartesian-product cells;
- a closed resource manifest with exact byte lengths, media types, and digests, with no
  symlink, unlisted file, external request, or service worker;
- exactly three checkpoint boundaries: before all actions, after the last setup action,
  and after the final pointer action;
- every workflow uses 4–32 actions and the runtime replays its exact declared recipe
  rather than inferring actions from the application type;
- semantic focus, at least one real keyboard event, one final pointer click, a visible
  enabled native primary button, and deterministic success focus for every workflow;
- deterministic layout at 800 by 600 with the pinned font, no animation, blinking caret,
  unexpected viewport scrolling, random input, or live clock;
- three fresh-context authoring runs with identical PNG, accessibility, and layout
  payloads at every checkpoint;
- static precondition compatibility for all 16 operator templates on all 40 workflow
  bindings; and
- exact restoration of DOM, styles, listeners, accessibility, and layout after each
  operator inverse and cleanup.

The current market-basket and incident-command implementations cover package/resource
binding, closed no-mutation browser replay, and the current-authoring portion of the
modality gate. For all four workflows, three fresh-context capture-first runs produce
byte-identical canonical PNG, accessibility-tree, and layout-graph bytes at all three
manifest boundaries. Their source vectors pass the exact `P, O, D, N, F, A, C, V`
preconditions. The success-only `official: false` results are withheld until cleanup
completes, and checkpoint getters return defensive byte copies.

The two pointer definitions also complete exact apply/inverse/apply and final cleanup
for each workflow, but that narrow slice does not establish official 20-application
acceptance or 16-operator compatibility. It creates no `capture_id`, official corpus
row, operator outcome, label, generation-plan execution, or benchmark result.

Authoring checks may execute only explicitly versioned, mutable pre-release source and
action bytes. They produce no official corpus row, sealed label, or operator outcome and
must not influence block, declared relation, or final source selection. Their existence
and revision must be recorded. The exact source-state, action-plan, and operator
references admitted to the final generation plan must remain unexecuted until its
identity is frozen.

Once the final fixture bytes, IDs, operators, blocks, and all 640 cells are bound by the
generation plan, execution is official: observed failures cannot trigger a source edit,
replacement application, operator substitution, block move, or resampling. A technical
failure may retry only the same cell; a baseline task failure remains an invalid row. If
measured-class eligibility gates are not met, the result is released without the
benchmark or fusion claim rather than redesigned after observation.
