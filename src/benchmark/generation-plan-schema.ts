import type { FromSchema, JSONSchema } from "json-schema-to-ts";

import type { PilotMutationFamilyKey } from "../mutations/identity.js";
import { pilotV01ApplicationBlockIds } from "./application-catalog.js";

const sha256Pattern = "^[0-9a-f]{64}$";
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

const artifactReferenceSchema = <const MediaType extends string>(
  mediaType: MediaType,
  maximumBytes: number,
) =>
  exactObject({
    sha256: { type: "string", pattern: sha256Pattern },
    byte_length: {
      type: "integer",
      minimum: 1,
      maximum: maximumBytes,
    },
    media_type: { const: mediaType },
    format_version: { const: 1 },
  });

export const pilotGenerationPlanFamilyKeys = Object.freeze([
  "pointer_hit_testing",
  "overflow_clipping",
  "target_displacement",
  "native_control_state",
  "focus_navigation",
  "accessible_naming",
  "content_overflow",
  "visual_presentation",
] as const satisfies readonly PilotMutationFamilyKey[]);

export type { PilotMutationFamilyKey } from "../mutations/identity.js";

export const pilotGenerationPlanRelationVariants = Object.freeze([
  "declared_breaking",
  "task_preserving_control",
] as const);

export const pilotGenerationPlanRoleSchedule = Object.freeze([
  Object.freeze({
    fold_id: "outer_0",
    train_blocks: Object.freeze(["block_2", "block_3"] as const),
    validation_blocks: Object.freeze(["block_1"] as const),
    test_blocks: Object.freeze(["block_0"] as const),
  }),
  Object.freeze({
    fold_id: "outer_1",
    train_blocks: Object.freeze(["block_3", "block_0"] as const),
    validation_blocks: Object.freeze(["block_2"] as const),
    test_blocks: Object.freeze(["block_1"] as const),
  }),
  Object.freeze({
    fold_id: "outer_2",
    train_blocks: Object.freeze(["block_0", "block_1"] as const),
    validation_blocks: Object.freeze(["block_3"] as const),
    test_blocks: Object.freeze(["block_2"] as const),
  }),
  Object.freeze({
    fold_id: "outer_3",
    train_blocks: Object.freeze(["block_1", "block_2"] as const),
    validation_blocks: Object.freeze(["block_0"] as const),
    test_blocks: Object.freeze(["block_3"] as const),
  }),
] as const);

const sourceStateReferenceSchema = artifactReferenceSchema(
  "application/vnd.impactdiff.source-state+json",
  1_048_576,
);
const actionPlanReferenceSchema = artifactReferenceSchema(
  "application/vnd.impactdiff.action-plan+json",
  131_072,
);
const operatorDefinitionReferenceSchema = artifactReferenceSchema(
  "application/vnd.impactdiff.mutation-operator+json",
  131_072,
);

const workflowSchema = exactObject({
  workflow_key: {
    type: "string",
    minLength: 1,
    maxLength: 64,
    pattern: "^[a-z][a-z0-9_]*$",
  },
  workflow_id: { type: "string", pattern: idPattern("idwf1_") },
  source_state_id: { type: "string", pattern: idPattern("idss1_") },
  source_state: sourceStateReferenceSchema,
  task_id: { type: "string", pattern: idPattern("idtk1_") },
  action_plan: actionPlanReferenceSchema,
});

const applicationSchema = exactObject({
  application_key: {
    type: "string",
    minLength: 1,
    maxLength: 64,
    pattern: "^[a-z][a-z0-9_]*$",
  },
  fixture_key: {
    type: "string",
    minLength: 1,
    maxLength: 96,
    pattern: "^[a-z][a-z0-9-]*$",
  },
  application_group_id: {
    type: "string",
    pattern: idPattern("idag1_"),
  },
  workflows: {
    type: "array",
    minItems: 2,
    maxItems: 2,
    items: workflowSchema,
  },
});

const mutationFamilySchema = exactObject({
  family_key: { enum: pilotGenerationPlanFamilyKeys },
  mutation_family_id: { type: "string", pattern: idPattern("idmf1_") },
});

const operatorSchema = exactObject({
  mutation_family_id: { type: "string", pattern: idPattern("idmf1_") },
  declared_relation_variant: {
    enum: pilotGenerationPlanRelationVariants,
  },
  operator_id: { type: "string", pattern: idPattern("idop1_") },
  operator_version: {
    type: "integer",
    minimum: 1,
    maximum: 2_147_483_647,
  },
  operator_definition: operatorDefinitionReferenceSchema,
});

const applicationBlockSchema = exactObject({
  block_id: {
    enum: pilotV01ApplicationBlockIds,
  },
  application_group_ids: {
    type: "array",
    minItems: 5,
    maxItems: 5,
    uniqueItems: true,
    items: { type: "string", pattern: idPattern("idag1_") },
  },
});

const cellSchema = exactObject({
  application_group_id: {
    type: "string",
    pattern: idPattern("idag1_"),
  },
  workflow_id: { type: "string", pattern: idPattern("idwf1_") },
  source_state_id: { type: "string", pattern: idPattern("idss1_") },
  mutation_family_id: { type: "string", pattern: idPattern("idmf1_") },
  operator_id: { type: "string", pattern: idPattern("idop1_") },
  declared_relation_variant: {
    enum: pilotGenerationPlanRelationVariants,
  },
  replicate: { const: 0 },
});

export const pilotGenerationPlanSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/pilot-generation-plan-v1.json",
  title: "ImpactDiff Pilot v0.1 pre-outcome generation plan",
  ...exactObject({
    contract: { const: "impactdiff.pilot-generation-plan" },
    version: { const: 1 },
    generation_plan_id: {
      type: "string",
      pattern: idPattern("idgp1_"),
    },
    protocol_id: { type: "string", pattern: idPattern("idpp1_") },
    application_catalog_id: {
      type: "string",
      pattern: idPattern("idpc1_"),
    },
    audit_refs: exactObject({
      resource_audit: artifactReferenceSchema(
        "application/vnd.impactdiff.pilot-resource-audit+json",
        4_194_304,
      ),
      license_audit: artifactReferenceSchema(
        "application/vnd.impactdiff.pilot-license-audit+json",
        1_048_576,
      ),
      grouping_audit: artifactReferenceSchema(
        "application/vnd.impactdiff.pilot-grouping-audit+json",
        4_194_304,
      ),
    }),
    applications: {
      type: "array",
      minItems: 20,
      maxItems: 20,
      items: applicationSchema,
    },
    mutation_families: {
      type: "array",
      minItems: 8,
      maxItems: 8,
      items: mutationFamilySchema,
    },
    operators: {
      type: "array",
      minItems: 16,
      maxItems: 16,
      items: operatorSchema,
    },
    split: exactObject({
      split_id: { type: "string", pattern: idPattern("idps1_") },
      application_catalog_id: {
        type: "string",
        pattern: idPattern("idpc1_"),
      },
      grouping_audit_sha256: { type: "string", pattern: sha256Pattern },
      application_blocks: {
        type: "array",
        minItems: 4,
        maxItems: 4,
        items: applicationBlockSchema,
      },
      role_schedule: { const: pilotGenerationPlanRoleSchedule },
    }),
    cells: {
      type: "array",
      minItems: 640,
      maxItems: 640,
      items: cellSchema,
    },
  }),
} as const satisfies JSONSchema;

export type PilotGenerationPlan = FromSchema<typeof pilotGenerationPlanSchema>;
export const pilotGenerationPlanContract = "impactdiff.pilot-generation-plan" as const;
export const pilotGenerationPlanVersion = 1 as const;
