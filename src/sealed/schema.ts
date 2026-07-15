import type { FromSchema, JSONSchema } from "json-schema-to-ts";

const sha256Pattern = "^[0-9a-f]{64}$";
const idPattern = (prefix: string) => `^${prefix}[0-9a-f]{64}$`;

const fixedRectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y", "width", "height", "scale"],
  properties: {
    x: { type: "integer", minimum: -100_000_000, maximum: 100_000_000 },
    y: { type: "integer", minimum: -100_000_000, maximum: 100_000_000 },
    width: { type: "integer", minimum: 1, maximum: 100_000_000 },
    height: { type: "integer", minimum: 1, maximum: 100_000_000 },
    scale: { const: 1_000 },
  },
} as const satisfies JSONSchema;

const affectedNodeIdsSchema = {
  type: "array",
  minItems: 1,
  maxItems: 64,
  items: { type: "string", pattern: idPattern("idnd1_") },
} as const satisfies JSONSchema;

const regionsSchema = {
  type: "array",
  minItems: 1,
  maxItems: 64,
  items: fixedRectSchema,
} as const satisfies JSONSchema;

export const changedSurfaceSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/changed-surface-v1.json",
  title: "ImpactDiff sealed changed surface v1",
  type: "object",
  additionalProperties: false,
  required: [
    "contract",
    "version",
    "plan_id",
    "instance_id",
    "affected_node_ids",
    "regions_milli_css_px",
  ],
  properties: {
    contract: { const: "impactdiff.changed-surface" },
    version: { const: 1 },
    plan_id: { type: "string", pattern: idPattern("idmp1_") },
    instance_id: { type: "string", pattern: idPattern("idmi1_") },
    affected_node_ids: affectedNodeIdsSchema,
    regions_milli_css_px: regionsSchema,
  },
} as const satisfies JSONSchema;

const oracleCommonProperties = {
  contract: { const: "impactdiff.oracle-result" },
  version: { const: 1 },
  role: { enum: ["baseline", "candidate"] },
  capture_id: { type: "string", pattern: idPattern("idcp1_") },
  task_id: { type: "string", pattern: idPattern("idtk1_") },
  passed: { type: "boolean" },
} as const satisfies Record<string, JSONSchema>;

const finalStateOracleSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "contract",
    "version",
    "role",
    "capture_id",
    "task_id",
    "kind",
    "passed",
    "observed_state",
  ],
  properties: {
    ...oracleCommonProperties,
    kind: { const: "final_state" },
    observed_state: { enum: ["review", "confirmed"] },
  },
} as const satisfies JSONSchema;

const accessibilityOracleSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "contract",
    "version",
    "role",
    "capture_id",
    "task_id",
    "kind",
    "passed",
    "primary_action_count",
    "confirmation_count",
  ],
  properties: {
    ...oracleCommonProperties,
    kind: { const: "accessibility" },
    primary_action_count: { type: "integer", minimum: 0, maximum: 4_096 },
    confirmation_count: { type: "integer", minimum: 0, maximum: 4_096 },
  },
} as const satisfies JSONSchema;

export const oracleResultSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/oracle-result-v1.json",
  title: "ImpactDiff sealed executable oracle result v1",
  oneOf: [finalStateOracleSchema, accessibilityOracleSchema],
} as const satisfies JSONSchema;

const traceStepSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action_id", "ordinal", "status"],
  properties: {
    action_id: { type: "string", pattern: idPattern("idst1_") },
    ordinal: { type: "integer", minimum: 0, maximum: 9_999 },
    status: { enum: ["satisfied", "unsatisfied", "not_reached"] },
  },
} as const satisfies JSONSchema;

export const rawTraceSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/raw-trace-v1.json",
  title: "ImpactDiff sealed task trace v1",
  type: "object",
  additionalProperties: false,
  required: [
    "contract",
    "version",
    "role",
    "capture_id",
    "task_id",
    "task_success",
    "steps",
    "first_unsatisfied_step_id",
    "recovery_actions",
    "virtual_elapsed_ms",
  ],
  properties: {
    contract: { const: "impactdiff.raw-trace" },
    version: { const: 1 },
    role: { enum: ["baseline", "candidate"] },
    capture_id: { type: "string", pattern: idPattern("idcp1_") },
    task_id: { type: "string", pattern: idPattern("idtk1_") },
    task_success: { type: "boolean" },
    steps: {
      type: "array",
      minItems: 1,
      maxItems: 10_000,
      items: traceStepSchema,
    },
    first_unsatisfied_step_id: {
      anyOf: [{ type: "string", pattern: idPattern("idst1_") }, { type: "null" }],
    },
    recovery_actions: {
      type: "integer",
      minimum: 0,
      maximum: 10_000,
    },
    virtual_elapsed_ms: {
      type: "integer",
      minimum: 0,
      maximum: 86_400_000,
    },
  },
} as const satisfies JSONSchema;

export const localizationSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/localization-v1.json",
  title: "ImpactDiff sealed regression localization v1",
  type: "object",
  additionalProperties: false,
  required: [
    "contract",
    "version",
    "instance_id",
    "failed_step_id",
    "changed_surface_sha256",
    "affected_node_ids",
    "regions_milli_css_px",
  ],
  properties: {
    contract: { const: "impactdiff.localization" },
    version: { const: 1 },
    instance_id: { type: "string", pattern: idPattern("idmi1_") },
    failed_step_id: { type: "string", pattern: idPattern("idst1_") },
    changed_surface_sha256: { type: "string", pattern: sha256Pattern },
    affected_node_ids: affectedNodeIdsSchema,
    regions_milli_css_px: regionsSchema,
  },
} as const satisfies JSONSchema;

export type ChangedSurface = FromSchema<typeof changedSurfaceSchema>;
export type OracleResult = FromSchema<typeof oracleResultSchema>;
export type RawTrace = FromSchema<typeof rawTraceSchema>;
export type Localization = FromSchema<typeof localizationSchema>;
