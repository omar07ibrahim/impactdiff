import type { FromSchema, JSONSchema } from "json-schema-to-ts";

const sha256Pattern = "^[0-9a-f]{64}$";
const idPattern = (prefix: string) => `^${prefix}[0-9a-f]{64}$`;

const nullable = <const Schema extends JSONSchema>(schema: Schema) =>
  ({ anyOf: [schema, { type: "null" }] }) as const;

const fixedRectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y", "width", "height", "scale"],
  properties: {
    x: {
      type: "integer",
      minimum: -100_000_000,
      maximum: 100_000_000,
    },
    y: {
      type: "integer",
      minimum: -100_000_000,
      maximum: 100_000_000,
    },
    width: {
      type: "integer",
      minimum: 1,
      maximum: 100_000_000,
    },
    height: {
      type: "integer",
      minimum: 1,
      maximum: 100_000_000,
    },
    scale: {
      const: 1_000,
    },
  },
} as const satisfies JSONSchema;

const mutationTargetSchema = {
  type: "object",
  additionalProperties: false,
  required: ["node_id", "locator"],
  properties: {
    node_id: {
      type: "string",
      pattern: idPattern("idnd1_"),
    },
    locator: {
      type: "object",
      additionalProperties: false,
      required: ["strategy", "value"],
      properties: {
        strategy: {
          const: "test_id",
        },
        value: {
          type: "string",
          minLength: 1,
          maxLength: 64,
          pattern: "^[a-z][a-z0-9-]*$",
        },
      },
    },
  },
} as const satisfies JSONSchema;

const mutationRequestBodySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "contract",
    "version",
    "source_state_id",
    "task_id",
    "environment_id",
    "operator_key",
    "operator_version",
    "replicate_index",
    "target",
  ],
  properties: {
    contract: {
      const: "impactdiff.mutation-request",
    },
    version: {
      const: 1,
    },
    source_state_id: {
      type: "string",
      pattern: idPattern("idss1_"),
    },
    task_id: {
      type: "string",
      pattern: idPattern("idtk1_"),
    },
    environment_id: {
      type: "string",
      pattern: idPattern("iden1_"),
    },
    operator_key: {
      enum: ["palette_swap", "pointer_interceptor"],
    },
    operator_version: {
      const: 1,
    },
    replicate_index: {
      type: "integer",
      minimum: 0,
      maximum: 2_147_483_647,
    },
    target: mutationTargetSchema,
  },
} as const satisfies JSONSchema;

export const mutationRequestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/mutation-request-v1.json",
  title: "ImpactDiff sealed mutation request v1",
  ...mutationRequestBodySchema,
} as const satisfies JSONSchema;

const targetProbeSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "resolution_count",
    "resolved_node_id",
    "visible",
    "in_viewport",
    "bounds",
    "center_hit_node_id",
    "used_by_task",
  ],
  properties: {
    resolution_count: {
      type: "integer",
      minimum: 0,
      maximum: 100,
    },
    resolved_node_id: nullable({
      type: "string",
      pattern: idPattern("idnd1_"),
    }),
    visible: nullable({ type: "boolean" }),
    in_viewport: nullable({ type: "boolean" }),
    bounds: nullable(fixedRectSchema),
    center_hit_node_id: nullable({
      type: "string",
      pattern: idPattern("idnd1_"),
    }),
    used_by_task: nullable({ type: "boolean" }),
  },
} as const satisfies JSONSchema;

const rgbChannelSchema = {
  type: "integer",
  minimum: 0,
  maximum: 255,
} as const satisfies JSONSchema;

const rgbSchema = {
  type: "array",
  minItems: 3,
  maxItems: 3,
  items: rgbChannelSchema,
} as const satisfies JSONSchema;

const paletteContrastPairSchema = {
  type: "object",
  additionalProperties: false,
  required: ["pair_id", "foreground_rgb", "background_rgb", "ratio_milli"],
  properties: {
    pair_id: {
      enum: ["body", "primary_action"],
    },
    foreground_rgb: rgbSchema,
    background_rgb: rgbSchema,
    ratio_milli: {
      type: "integer",
      minimum: 1_000,
      maximum: 21_000,
    },
  },
} as const satisfies JSONSchema;

const paletteProbeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["source_profile", "candidate_palette_sha256", "contrast_pairs"],
  properties: {
    source_profile: nullable({
      enum: ["default", "other"],
    }),
    candidate_palette_sha256: nullable({
      type: "string",
      pattern: sha256Pattern,
    }),
    contrast_pairs: nullable({
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: paletteContrastPairSchema,
    }),
  },
} as const satisfies JSONSchema;

const sourceProbeBodySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "contract",
    "version",
    "probe_fingerprint_sha256",
    "instance_id",
    "source_state_id",
    "task_id",
    "environment_id",
    "runtime_clean",
    "target",
    "palette",
  ],
  properties: {
    contract: {
      const: "impactdiff.mutation-probe",
    },
    version: {
      const: 1,
    },
    probe_fingerprint_sha256: {
      type: "string",
      pattern: sha256Pattern,
    },
    instance_id: {
      type: "string",
      pattern: idPattern("idmi1_"),
    },
    source_state_id: {
      type: "string",
      pattern: idPattern("idss1_"),
    },
    task_id: {
      type: "string",
      pattern: idPattern("idtk1_"),
    },
    environment_id: {
      type: "string",
      pattern: idPattern("iden1_"),
    },
    runtime_clean: {
      type: "boolean",
    },
    target: targetProbeSchema,
    palette: paletteProbeSchema,
  },
} as const satisfies JSONSchema;

export const sourceProbeSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/mutation-source-probe-v1.json",
  title: "ImpactDiff sealed mutation source probe v1",
  ...sourceProbeBodySchema,
} as const satisfies JSONSchema;

export const mutationPreconditionCodes = [
  "palette.contrast_safe",
  "palette.definition_match",
  "palette.pairs_complete",
  "palette.profile_match",
  "runtime.clean",
  "target.center_hit_testable",
  "target.exactly_one",
  "target.identity",
  "target.in_viewport",
  "target.nonempty_bounds",
  "target.used_by_task",
  "target.visible",
] as const;

const preconditionCheckSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "passed", "observed_sha256"],
  properties: {
    code: {
      enum: mutationPreconditionCodes,
    },
    passed: {
      type: "boolean",
    },
    observed_sha256: {
      type: "string",
      pattern: sha256Pattern,
    },
  },
} as const satisfies JSONSchema;

const preconditionReportBodySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "contract",
    "version",
    "instance_id",
    "probe_fingerprint_sha256",
    "request",
    "probe",
    "applicable",
    "checks",
  ],
  properties: {
    contract: {
      const: "impactdiff.intervention-preconditions",
    },
    version: {
      const: 1,
    },
    instance_id: {
      type: "string",
      pattern: idPattern("idmi1_"),
    },
    probe_fingerprint_sha256: {
      type: "string",
      pattern: sha256Pattern,
    },
    request: mutationRequestBodySchema,
    probe: sourceProbeBodySchema,
    applicable: {
      type: "boolean",
    },
    checks: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      items: preconditionCheckSchema,
    },
  },
} as const satisfies JSONSchema;

export const preconditionReportSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/intervention-preconditions-v1.json",
  title: "ImpactDiff sealed intervention precondition report v1",
  ...preconditionReportBodySchema,
} as const satisfies JSONSchema;

const paletteOperationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["opcode", "handle", "target_node_id", "palette", "palette_sha256"],
  properties: {
    opcode: {
      const: "install_palette_layer",
    },
    handle: {
      const: "h0",
    },
    target_node_id: {
      type: "string",
      pattern: idPattern("idnd1_"),
    },
    palette: {
      const: "ocean",
    },
    palette_sha256: {
      type: "string",
      pattern: sha256Pattern,
    },
  },
} as const satisfies JSONSchema;

const pointerInterceptorOperationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["opcode", "handle", "target_node_id", "rect_milli_css_px"],
  properties: {
    opcode: {
      const: "install_pointer_interceptor",
    },
    handle: {
      const: "h0",
    },
    target_node_id: {
      type: "string",
      pattern: idPattern("idnd1_"),
    },
    rect_milli_css_px: fixedRectSchema,
  },
} as const satisfies JSONSchema;

const inverseOperationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["opcode", "handle"],
  properties: {
    opcode: {
      const: "remove_inserted_node",
    },
    handle: {
      const: "h0",
    },
  },
} as const satisfies JSONSchema;

const mutationPlanBodySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "contract",
    "version",
    "plan_id",
    "instance_id",
    "request",
    "seed_sha256",
    "phase",
    "operator",
    "probe_fingerprint_sha256",
    "precondition_report_sha256",
    "forward",
    "inverse",
  ],
  properties: {
    contract: {
      const: "impactdiff.intervention-parameters",
    },
    version: {
      const: 1,
    },
    plan_id: {
      type: "string",
      pattern: idPattern("idmp1_"),
    },
    instance_id: {
      type: "string",
      pattern: idPattern("idmi1_"),
    },
    request: mutationRequestBodySchema,
    seed_sha256: {
      type: "string",
      pattern: sha256Pattern,
    },
    phase: {
      const: "before_task",
    },
    operator: {
      type: "object",
      additionalProperties: false,
      required: [
        "operator_key",
        "family_id",
        "operator_id",
        "operator_version",
        "expected_task_relation",
      ],
      properties: {
        operator_key: {
          enum: ["palette_swap", "pointer_interceptor"],
        },
        family_id: {
          type: "string",
          pattern: idPattern("idmf1_"),
        },
        operator_id: {
          type: "string",
          pattern: idPattern("idop1_"),
        },
        operator_version: {
          const: 1,
        },
        expected_task_relation: {
          enum: ["preserve", "break"],
        },
      },
    },
    probe_fingerprint_sha256: {
      type: "string",
      pattern: sha256Pattern,
    },
    precondition_report_sha256: {
      type: "string",
      pattern: sha256Pattern,
    },
    forward: {
      type: "array",
      minItems: 1,
      maxItems: 1,
      items: {
        anyOf: [paletteOperationSchema, pointerInterceptorOperationSchema],
      },
    },
    inverse: {
      type: "array",
      minItems: 1,
      maxItems: 1,
      items: inverseOperationSchema,
    },
  },
} as const satisfies JSONSchema;

export const mutationPlanSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/intervention-parameters-v1.json",
  title: "ImpactDiff sealed deterministic mutation plan v1",
  ...mutationPlanBodySchema,
} as const satisfies JSONSchema;

export type FixedRect = FromSchema<typeof fixedRectSchema>;
export type MutationRequest = FromSchema<typeof mutationRequestSchema>;
export type SourceProbe = FromSchema<typeof sourceProbeSchema>;
export type PreconditionCode = (typeof mutationPreconditionCodes)[number];
export type PreconditionReport = FromSchema<typeof preconditionReportSchema>;
export type MutationPlan = FromSchema<typeof mutationPlanSchema>;
