import type { FromSchema, JSONSchema } from "json-schema-to-ts";

import type { PilotMutationFamilyKey } from "../identity.js";

const idPattern = (prefix: string) => `^${prefix}[0-9a-f]{64}$`;

const exactObject = <const Properties extends Record<string, JSONSchema>>(
  properties: Properties,
) =>
  ({
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties) as (keyof Properties & string)[],
    properties,
  }) as const;

export const pilotMutationFamilyKeys = Object.freeze([
  "pointer_hit_testing",
  "overflow_clipping",
  "target_displacement",
  "native_control_state",
  "focus_navigation",
  "accessible_naming",
  "content_overflow",
  "visual_presentation",
] as const satisfies readonly PilotMutationFamilyKey[]);

export const pilotMutationRelationVariants = Object.freeze([
  "declared_breaking",
  "task_preserving_control",
] as const);

export const pilotMutationOperatorDefinitionKeys = Object.freeze([
  "pointer_hit_testing.intercept_source_point.v1",
  "pointer_hit_testing.pass_source_point.v1",
  "overflow_clipping.exclude_source_point.v1",
  "overflow_clipping.retain_primary.v1",
  "target_displacement.beyond_source_point.v1",
  "target_displacement.within_source_point.v1",
  "native_control_state.disable_primary.v1",
  "native_control_state.disable_peer.v1",
  "focus_navigation.insert_before_primary.v1",
  "focus_navigation.insert_after_primary.v1",
  "accessible_naming.empty_primary_name.v1",
  "accessible_naming.copy_primary_name.v1",
  "content_overflow.unbreakable_pressure.v1",
  "content_overflow.breakable_pressure.v1",
  "visual_presentation.low_contrast_primary.v1",
  "visual_presentation.high_contrast_primary.v1",
] as const);

export type PilotMutationRelationVariant =
  (typeof pilotMutationRelationVariants)[number];
export type PilotMutationOperatorDefinitionKey =
  (typeof pilotMutationOperatorDefinitionKeys)[number];

/**
 * Literal cross-layer binding kept here to avoid a benchmark-to-mutation module cycle.
 * A protocol coherence test requires this value to equal pilotV01ProtocolId.
 */
export const pilotMutationBoundProtocolId =
  "idpp1_d6b3e033f59d51b17b29d6fb51c74368a8489f9f9284778cb39e856a73b29309" as const;

export const pilotMutationSourceProbeCodes = Object.freeze([
  "runtime_clean",
  "bindings_resolve_once",
  "primary_native_enabled_visible",
  "primary_source_center_hit",
  "local_task_predicate_passes",
  "owned_handle_absent",
  "preimage_hashes_bound",
  "clip_host_compatible",
  "displacement_clearance",
  "native_peer_compatible",
  "source_focus_trace_exact",
  "source_accessible_name_nonempty",
  "content_box_contained",
  "source_primary_contrast_at_least_4500",
] as const);

export const pilotMutationInstalledProbeCodes = Object.freeze([
  "owned_surface_exact",
  "family_effect_exact",
  "changed_surface_bounded",
  "local_predicate_expected",
  "orthogonal_predicates_preserved",
] as const);

export const pilotMutationRoundtripProbeCodes = Object.freeze([
  "owned_handles_absent",
  "mutation_preimages_equal",
  "listener_registry_equal",
  "dom_roundtrip_equal",
  "computed_style_roundtrip_equal",
  "pixel_roundtrip_equal",
  "accessibility_roundtrip_equal",
  "layout_roundtrip_equal",
  "hit_test_roundtrip_equal",
  "focus_and_scroll_roundtrip_equal",
  "runtime_clean",
] as const);

const pointerPairBodySchema = exactObject({
  primitive: { const: "install_hit_layer" },
  changed_surface: { const: "primary_hit_region" },
  fixed_parameters: exactObject({
    target: { const: "primary" },
    footprint: { const: "source_primary_border_box" },
    paint: { const: "transparent" },
    accessibility: { const: "hidden" },
    focusable: { const: false },
  }),
  contrast_axis: { const: "pointer_mode" },
});

const overflowPairBodySchema = exactObject({
  primitive: { const: "install_overflow_clip" },
  changed_surface: { const: "clip_host_block_end" },
  fixed_parameters: exactObject({
    target: { const: "clip_host" },
    axis: { const: "block" },
    edge: { const: "block_end" },
    overflow: { const: "clip" },
  }),
  contrast_axis: { const: "boundary" },
});

const displacementPairBodySchema = exactObject({
  primitive: { const: "install_translation" },
  changed_surface: { const: "displacement_anchor_transform" },
  fixed_parameters: exactObject({
    target: { const: "displacement_anchor" },
    direction: { const: "inline_end" },
    transform_origin: { const: "border_box_origin" },
  }),
  contrast_axis: { const: "distance" },
});

const nativeStatePairBodySchema = exactObject({
  primitive: { const: "set_native_disabled" },
  changed_surface: { const: "native_disabled_state" },
  fixed_parameters: exactObject({ value: { const: true } }),
  contrast_axis: { const: "target" },
});

const focusPairBodySchema = exactObject({
  primitive: { const: "insert_focus_stop" },
  changed_surface: { const: "sequential_focus_order" },
  fixed_parameters: exactObject({
    element_profile: { const: "owned_fixed_focus_stop_v1" },
    tab_index: { const: 0 },
    visual_position: { const: "fixed_bottom_end" },
    accessible_name: { const: "Injected focus stop" },
    pointer_interaction: { const: "pass_through" },
  }),
  contrast_axis: { const: "placement" },
});

const accessibleNamePairBodySchema = exactObject({
  primitive: { const: "install_owned_labelledby" },
  changed_surface: { const: "primary_accessible_name" },
  fixed_parameters: exactObject({
    target: { const: "primary" },
    label_node: { const: "hidden" },
    source: { const: "source_computed_name" },
  }),
  contrast_axis: { const: "label_content" },
});

const contentOverflowPairBodySchema = exactObject({
  primitive: { const: "install_content_pressure" },
  changed_surface: { const: "content_pressure_box" },
  fixed_parameters: exactObject({
    target: { const: "content_pressure" },
    content_profile: { const: "pilot_status_token_96_v1" },
    same_exact_text: { const: true },
  }),
  contrast_axis: { const: "wrap_mode" },
});

const visualPairBodySchema = exactObject({
  primitive: { const: "install_solid_primary_palette" },
  changed_surface: { const: "primary_foreground_background" },
  fixed_parameters: exactObject({
    target: { const: "primary" },
    opacity_milli: { const: 1_000 },
    no_gradient: { const: true },
  }),
  contrast_axis: { const: "palette" },
});

export const pilotMutationPairBodySchema = {
  oneOf: [
    pointerPairBodySchema,
    overflowPairBodySchema,
    displacementPairBodySchema,
    nativeStatePairBodySchema,
    focusPairBodySchema,
    accessibleNamePairBodySchema,
    contentOverflowPairBodySchema,
    visualPairBodySchema,
  ],
} as const satisfies JSONSchema;

const effectSchema = {
  oneOf: [
    exactObject({
      kind: { const: "pointer_hit_testing" },
      pointer_mode: { enum: ["intercept", "pass_through"] },
    }),
    exactObject({
      kind: { const: "overflow_clipping" },
      boundary: {
        enum: [
          "one_css_px_before_source_hit_point",
          "eight_css_px_after_primary_border_box",
        ],
      },
    }),
    exactObject({
      kind: { const: "target_displacement" },
      distance: {
        enum: ["primary_half_width_plus_8px", "min_8px_or_primary_quarter_width"],
      },
    }),
    exactObject({
      kind: { const: "native_control_state" },
      target: { enum: ["primary", "native_control_peer"] },
    }),
    exactObject({
      kind: { const: "focus_navigation" },
      placement: { enum: ["immediately_before_primary", "immediately_after_primary"] },
    }),
    exactObject({
      kind: { const: "accessible_naming" },
      label_content: { enum: ["empty", "exact_source_name"] },
    }),
    exactObject({
      kind: { const: "content_overflow" },
      wrap_mode: { enum: ["unbreakable", "anywhere"] },
    }),
    exactObject({
      kind: { const: "visual_presentation" },
      foreground_rgb: {
        oneOf: [{ const: [119, 126, 136] }, { const: [20, 43, 67] }],
      },
      background_rgb: {
        oneOf: [{ const: [128, 135, 145] }, { const: [221, 238, 248] }],
      },
      ratio_milli: { enum: [1_130, 12_126] },
    }),
  ],
} as const satisfies JSONSchema;

export const pilotMutationLocalPredicateKeys = Object.freeze([
  "primary_source_point_dispatches_to_primary",
  "primary_fully_visible_and_source_hit_testable",
  "primary_at_source_bound_hit_point",
  "primary_enabled",
  "declared_focus_path_reaches_primary",
  "primary_accessible_name_nonempty",
  "content_pressure_contained",
  "primary_text_contrast_at_least_4500",
] as const);

export const pilotMutationOperatorDefinitionSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/pilot-mutation-operator-v1.json",
  title: "ImpactDiff Pilot v0.1 mutation operator definition",
  ...exactObject({
    contract: { const: "impactdiff.pilot-mutation-operator" },
    version: { const: 1 },
    protocol_id: { const: pilotMutationBoundProtocolId },
    pilot_release: { const: "pilot-v0.1" },
    definition_key: { enum: pilotMutationOperatorDefinitionKeys },
    operator_version: { const: 1 },
    family_key: { enum: pilotMutationFamilyKeys },
    mutation_family_id: { type: "string", pattern: idPattern("idmf1_") },
    declared_relation_variant: { enum: pilotMutationRelationVariants },
    pairing: exactObject({
      pair_id: { type: "string", pattern: idPattern("idpr1_") },
      pair_version: { const: 1 },
      body: pilotMutationPairBodySchema,
    }),
    phase: { const: "before_task" },
    required_probes: exactObject({
      source: {
        type: "array",
        minItems: 7,
        maxItems: 8,
        uniqueItems: true,
        items: { enum: pilotMutationSourceProbeCodes },
      },
      installed: {
        const: pilotMutationInstalledProbeCodes,
      },
      inverse_roundtrip: {
        const: pilotMutationRoundtripProbeCodes,
      },
    }),
    effect: effectSchema,
    expected_local_task_predicate: exactObject({
      predicate: { enum: pilotMutationLocalPredicateKeys },
      state: { enum: ["fail", "pass"] },
    }),
    inverse: exactObject({
      opcode: { const: "remove_owned_intervention" },
      handle: { const: "h0" },
      restore_preimage: { const: "exact" },
    }),
    cleanup_audit: exactObject({
      required: { const: pilotMutationRoundtripProbeCodes },
    }),
    relation_semantics: exactObject({
      provenance_only: { const: true },
      measured_label_source: { const: "independent_task_replay" },
      preservation_scope: { const: "declared_workflow_only" },
    }),
  }),
} as const satisfies JSONSchema;

export type PilotMutationPairBody = FromSchema<typeof pilotMutationPairBodySchema>;
export type PilotMutationOperatorDefinition = FromSchema<
  typeof pilotMutationOperatorDefinitionSchema
>;

const operatorDefinitionReferenceSchema = exactObject({
  sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
  byte_length: { type: "integer", minimum: 1, maximum: 131_072 },
  media_type: { const: "application/vnd.impactdiff.mutation-operator+json" },
  format_version: { const: 1 },
});

const pilotMutationOperatorBindingSchema = exactObject({
  mutation_family_id: { type: "string", pattern: idPattern("idmf1_") },
  declared_relation_variant: { enum: pilotMutationRelationVariants },
  operator_version: { const: 1 },
  operator_definition: operatorDefinitionReferenceSchema,
  operator_id: { type: "string", pattern: idPattern("idop1_") },
});

export const pilotMutationOperatorCatalogSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/pilot-mutation-operator-catalog-v1.json",
  title: "ImpactDiff Pilot v0.1 mutation operator catalog",
  ...exactObject({
    contract: { const: "impactdiff.pilot-mutation-operator-catalog" },
    version: { const: 1 },
    protocol_id: { const: pilotMutationBoundProtocolId },
    pilot_release: { const: "pilot-v0.1" },
    catalog_id: { type: "string", pattern: idPattern("idoc1_") },
    operators: {
      type: "array",
      minItems: 16,
      maxItems: 16,
      items: pilotMutationOperatorBindingSchema,
    },
  }),
} as const satisfies JSONSchema;

export type PilotMutationOperatorBinding = FromSchema<
  typeof pilotMutationOperatorBindingSchema
>;
export type PilotMutationOperatorCatalog = FromSchema<
  typeof pilotMutationOperatorCatalogSchema
>;

export const pilotMutationOperatorContract =
  "impactdiff.pilot-mutation-operator" as const;
export const pilotMutationOperatorVersion = 1 as const;
export const pilotMutationOperatorMediaType =
  "application/vnd.impactdiff.mutation-operator+json" as const;
export const pilotMutationOperatorCatalogContract =
  "impactdiff.pilot-mutation-operator-catalog" as const;
export const pilotMutationOperatorCatalogVersion = 1 as const;
export const pilotMutationOperatorCatalogMediaType =
  "application/vnd.impactdiff.mutation-operator-catalog+json" as const;
