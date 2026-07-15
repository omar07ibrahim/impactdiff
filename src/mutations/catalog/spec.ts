import type {
  PilotMutationOperatorDefinition,
  PilotMutationOperatorDefinitionKey,
  PilotMutationPairBody,
  PilotMutationRelationVariant,
} from "./schema.js";
import type { PilotMutationFamilyKey } from "../identity.js";
import { normalizeJsonData } from "../../contracts/canonical.js";

type DeepReadonly<Value> = Value extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : Value extends object
    ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
    : Value;

export interface PilotMutationDefinitionSpec {
  readonly definitionKey: PilotMutationOperatorDefinitionKey;
  readonly familyKey: PilotMutationFamilyKey;
  readonly relation: PilotMutationRelationVariant;
  readonly pairBody: DeepReadonly<PilotMutationPairBody>;
  readonly sourceProbes: DeepReadonly<
    PilotMutationOperatorDefinition["required_probes"]["source"]
  >;
  readonly effect: DeepReadonly<PilotMutationOperatorDefinition["effect"]>;
  readonly predicate: PilotMutationOperatorDefinition["expected_local_task_predicate"]["predicate"];
  readonly predicateState: "fail" | "pass";
}

const commonSourceProbes = [
  "runtime_clean",
  "bindings_resolve_once",
  "primary_native_enabled_visible",
  "primary_source_center_hit",
  "local_task_predicate_passes",
  "owned_handle_absent",
  "preimage_hashes_bound",
] as const;

const sourceProbes = <const Extra extends string>(extra?: Extra) =>
  extra === undefined ? commonSourceProbes : ([...commonSourceProbes, extra] as const);

const pointerPairBody = {
  primitive: "install_hit_layer",
  changed_surface: "primary_hit_region",
  fixed_parameters: {
    target: "primary",
    footprint: "source_primary_border_box",
    paint: "transparent",
    accessibility: "hidden",
    focusable: false,
  },
  contrast_axis: "pointer_mode",
} as const satisfies PilotMutationPairBody;

const overflowPairBody = {
  primitive: "install_overflow_clip",
  changed_surface: "clip_host_block_end",
  fixed_parameters: {
    target: "clip_host",
    axis: "block",
    edge: "block_end",
    overflow: "clip",
  },
  contrast_axis: "boundary",
} as const satisfies PilotMutationPairBody;

const displacementPairBody = {
  primitive: "install_translation",
  changed_surface: "displacement_anchor_transform",
  fixed_parameters: {
    target: "displacement_anchor",
    direction: "inline_end",
    transform_origin: "border_box_origin",
  },
  contrast_axis: "distance",
} as const satisfies PilotMutationPairBody;

const nativeStatePairBody = {
  primitive: "set_native_disabled",
  changed_surface: "native_disabled_state",
  fixed_parameters: { value: true },
  contrast_axis: "target",
} as const satisfies PilotMutationPairBody;

const focusPairBody = {
  primitive: "insert_focus_stop",
  changed_surface: "sequential_focus_order",
  fixed_parameters: {
    element_profile: "owned_fixed_focus_stop_v1",
    tab_index: 0,
    visual_position: "fixed_bottom_end",
    accessible_name: "Injected focus stop",
    pointer_interaction: "pass_through",
  },
  contrast_axis: "placement",
} as const satisfies PilotMutationPairBody;

const accessibleNamePairBody = {
  primitive: "install_owned_labelledby",
  changed_surface: "primary_accessible_name",
  fixed_parameters: {
    target: "primary",
    label_node: "hidden",
    source: "source_computed_name",
  },
  contrast_axis: "label_content",
} as const satisfies PilotMutationPairBody;

const contentOverflowPairBody = {
  primitive: "install_content_pressure",
  changed_surface: "content_pressure_box",
  fixed_parameters: {
    target: "content_pressure",
    content_profile: "pilot_status_token_96_v1",
    same_exact_text: true,
  },
  contrast_axis: "wrap_mode",
} as const satisfies PilotMutationPairBody;

const visualPairBody = {
  primitive: "install_solid_primary_palette",
  changed_surface: "primary_foreground_background",
  fixed_parameters: {
    target: "primary",
    opacity_milli: 1_000,
    no_gradient: true,
  },
  contrast_axis: "palette",
} as const satisfies PilotMutationPairBody;

const rawPilotMutationDefinitionSpecs = [
  {
    definitionKey: "pointer_hit_testing.intercept_source_point.v1",
    familyKey: "pointer_hit_testing",
    relation: "declared_breaking",
    pairBody: pointerPairBody,
    sourceProbes: sourceProbes(),
    effect: { kind: "pointer_hit_testing", pointer_mode: "intercept" },
    predicate: "primary_source_point_dispatches_to_primary",
    predicateState: "fail",
  },
  {
    definitionKey: "pointer_hit_testing.pass_source_point.v1",
    familyKey: "pointer_hit_testing",
    relation: "task_preserving_control",
    pairBody: pointerPairBody,
    sourceProbes: sourceProbes(),
    effect: { kind: "pointer_hit_testing", pointer_mode: "pass_through" },
    predicate: "primary_source_point_dispatches_to_primary",
    predicateState: "pass",
  },
  {
    definitionKey: "overflow_clipping.exclude_source_point.v1",
    familyKey: "overflow_clipping",
    relation: "declared_breaking",
    pairBody: overflowPairBody,
    sourceProbes: sourceProbes("clip_host_compatible"),
    effect: {
      kind: "overflow_clipping",
      boundary: "one_css_px_before_source_hit_point",
    },
    predicate: "primary_fully_visible_and_source_hit_testable",
    predicateState: "fail",
  },
  {
    definitionKey: "overflow_clipping.retain_primary.v1",
    familyKey: "overflow_clipping",
    relation: "task_preserving_control",
    pairBody: overflowPairBody,
    sourceProbes: sourceProbes("clip_host_compatible"),
    effect: {
      kind: "overflow_clipping",
      boundary: "eight_css_px_after_primary_border_box",
    },
    predicate: "primary_fully_visible_and_source_hit_testable",
    predicateState: "pass",
  },
  {
    definitionKey: "target_displacement.beyond_source_point.v1",
    familyKey: "target_displacement",
    relation: "declared_breaking",
    pairBody: displacementPairBody,
    sourceProbes: sourceProbes("displacement_clearance"),
    effect: {
      kind: "target_displacement",
      distance: "primary_half_width_plus_8px",
    },
    predicate: "primary_at_source_bound_hit_point",
    predicateState: "fail",
  },
  {
    definitionKey: "target_displacement.within_source_point.v1",
    familyKey: "target_displacement",
    relation: "task_preserving_control",
    pairBody: displacementPairBody,
    sourceProbes: sourceProbes("displacement_clearance"),
    effect: {
      kind: "target_displacement",
      distance: "min_8px_or_primary_quarter_width",
    },
    predicate: "primary_at_source_bound_hit_point",
    predicateState: "pass",
  },
  {
    definitionKey: "native_control_state.disable_primary.v1",
    familyKey: "native_control_state",
    relation: "declared_breaking",
    pairBody: nativeStatePairBody,
    sourceProbes: sourceProbes("native_peer_compatible"),
    effect: { kind: "native_control_state", target: "primary" },
    predicate: "primary_enabled",
    predicateState: "fail",
  },
  {
    definitionKey: "native_control_state.disable_peer.v1",
    familyKey: "native_control_state",
    relation: "task_preserving_control",
    pairBody: nativeStatePairBody,
    sourceProbes: sourceProbes("native_peer_compatible"),
    effect: { kind: "native_control_state", target: "native_control_peer" },
    predicate: "primary_enabled",
    predicateState: "pass",
  },
  {
    definitionKey: "focus_navigation.insert_before_primary.v1",
    familyKey: "focus_navigation",
    relation: "declared_breaking",
    pairBody: focusPairBody,
    sourceProbes: sourceProbes("source_focus_trace_exact"),
    effect: { kind: "focus_navigation", placement: "immediately_before_primary" },
    predicate: "declared_focus_path_reaches_primary",
    predicateState: "fail",
  },
  {
    definitionKey: "focus_navigation.insert_after_primary.v1",
    familyKey: "focus_navigation",
    relation: "task_preserving_control",
    pairBody: focusPairBody,
    sourceProbes: sourceProbes("source_focus_trace_exact"),
    effect: { kind: "focus_navigation", placement: "immediately_after_primary" },
    predicate: "declared_focus_path_reaches_primary",
    predicateState: "pass",
  },
  {
    definitionKey: "accessible_naming.empty_primary_name.v1",
    familyKey: "accessible_naming",
    relation: "declared_breaking",
    pairBody: accessibleNamePairBody,
    sourceProbes: sourceProbes("source_accessible_name_nonempty"),
    effect: { kind: "accessible_naming", label_content: "empty" },
    predicate: "primary_accessible_name_nonempty",
    predicateState: "fail",
  },
  {
    definitionKey: "accessible_naming.copy_primary_name.v1",
    familyKey: "accessible_naming",
    relation: "task_preserving_control",
    pairBody: accessibleNamePairBody,
    sourceProbes: sourceProbes("source_accessible_name_nonempty"),
    effect: { kind: "accessible_naming", label_content: "exact_source_name" },
    predicate: "primary_accessible_name_nonempty",
    predicateState: "pass",
  },
  {
    definitionKey: "content_overflow.unbreakable_pressure.v1",
    familyKey: "content_overflow",
    relation: "declared_breaking",
    pairBody: contentOverflowPairBody,
    sourceProbes: sourceProbes("content_box_contained"),
    effect: { kind: "content_overflow", wrap_mode: "unbreakable" },
    predicate: "content_pressure_contained",
    predicateState: "fail",
  },
  {
    definitionKey: "content_overflow.breakable_pressure.v1",
    familyKey: "content_overflow",
    relation: "task_preserving_control",
    pairBody: contentOverflowPairBody,
    sourceProbes: sourceProbes("content_box_contained"),
    effect: { kind: "content_overflow", wrap_mode: "anywhere" },
    predicate: "content_pressure_contained",
    predicateState: "pass",
  },
  {
    definitionKey: "visual_presentation.low_contrast_primary.v1",
    familyKey: "visual_presentation",
    relation: "declared_breaking",
    pairBody: visualPairBody,
    sourceProbes: sourceProbes("source_primary_contrast_at_least_4500"),
    effect: {
      kind: "visual_presentation",
      foreground_rgb: [119, 126, 136],
      background_rgb: [128, 135, 145],
      ratio_milli: 1_130,
    },
    predicate: "primary_text_contrast_at_least_4500",
    predicateState: "fail",
  },
  {
    definitionKey: "visual_presentation.high_contrast_primary.v1",
    familyKey: "visual_presentation",
    relation: "task_preserving_control",
    pairBody: visualPairBody,
    sourceProbes: sourceProbes("source_primary_contrast_at_least_4500"),
    effect: {
      kind: "visual_presentation",
      foreground_rgb: [20, 43, 67],
      background_rgb: [221, 238, 248],
      ratio_milli: 12_126,
    },
    predicate: "primary_text_contrast_at_least_4500",
    predicateState: "pass",
  },
] as const satisfies readonly PilotMutationDefinitionSpec[];

export const pilotMutationDefinitionSpecs = normalizeJsonData(
  rawPilotMutationDefinitionSpecs,
) as unknown as readonly PilotMutationDefinitionSpec[];
