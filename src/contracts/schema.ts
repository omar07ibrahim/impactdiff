import type { FromSchema, JSONSchema } from "json-schema-to-ts";

const sha256Pattern = "^[0-9a-f]{64}$";
const idPattern = (prefix: string) => `^${prefix}[0-9a-f]{64}$`;

const artifactRefSchema = <const MediaType extends string>(
  mediaType: MediaType,
  maximumBytes: number,
) =>
  ({
    type: "object",
    additionalProperties: false,
    required: ["sha256", "byte_length", "media_type", "format_version"],
    properties: {
      sha256: {
        type: "string",
        pattern: sha256Pattern,
      },
      byte_length: {
        type: "integer",
        minimum: 1,
        maximum: maximumBytes,
      },
      media_type: {
        const: mediaType,
      },
      format_version: {
        const: 1,
      },
    },
  }) as const satisfies JSONSchema;

const screenshotRefSchema = artifactRefSchema("image/png", 8_388_608);
const accessibilityRefSchema = artifactRefSchema(
  "application/vnd.impactdiff.accessibility+json",
  2_097_152,
);
const layoutRefSchema = artifactRefSchema(
  "application/vnd.impactdiff.layout+json",
  4_194_304,
);
const actionPlanRefSchema = artifactRefSchema(
  "application/vnd.impactdiff.action-plan+json",
  131_072,
);
const captureSpecRefSchema = artifactRefSchema(
  "application/vnd.impactdiff.capture-spec+json",
  65_536,
);
const interventionParametersRefSchema = artifactRefSchema(
  "application/vnd.impactdiff.intervention-parameters+json",
  131_072,
);
const interventionPreconditionsRefSchema = artifactRefSchema(
  "application/vnd.impactdiff.intervention-preconditions+json",
  131_072,
);
const changedSurfaceRefSchema = artifactRefSchema(
  "application/vnd.impactdiff.changed-surface+json",
  1_048_576,
);
const oracleRefSchema = artifactRefSchema(
  "application/vnd.impactdiff.oracle-result+json",
  131_072,
);
const rawTraceRefSchema = artifactRefSchema(
  "application/vnd.impactdiff.raw-trace+json",
  4_194_304,
);
const localizationRefSchema = artifactRefSchema(
  "application/vnd.impactdiff.localization+json",
  1_048_576,
);

const checkpointSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "checkpoint_id",
    "ordinal",
    "screenshot",
    "accessibility_tree",
    "layout_graph",
  ],
  properties: {
    checkpoint_id: {
      type: "string",
      pattern: idPattern("idck1_"),
    },
    ordinal: {
      type: "integer",
      minimum: 0,
      maximum: 15,
    },
    screenshot: screenshotRefSchema,
    accessibility_tree: accessibilityRefSchema,
    layout_graph: layoutRefSchema,
  },
} as const satisfies JSONSchema;

const captureSchema = <const Role extends "baseline" | "candidate">(role: Role) =>
  ({
    type: "object",
    additionalProperties: false,
    required: ["capture_id", "role", "checkpoints"],
    properties: {
      capture_id: {
        type: "string",
        pattern: idPattern("idcp1_"),
      },
      role: {
        const: role,
      },
      checkpoints: {
        type: "array",
        minItems: 1,
        maxItems: 16,
        items: checkpointSchema,
      },
    },
  }) as const satisfies JSONSchema;

const groupingSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "application_group_id",
    "source_state_group_id",
    "source_task_group_id",
    "near_duplicate_group_id",
    "asset_component_id",
    "mutation_family_group_id",
  ],
  properties: {
    application_group_id: {
      type: "string",
      pattern: idPattern("idag1_"),
    },
    source_state_group_id: {
      type: "string",
      pattern: idPattern("idsg1_"),
    },
    source_task_group_id: {
      type: "string",
      pattern: idPattern("idtg1_"),
    },
    near_duplicate_group_id: {
      type: "string",
      pattern: idPattern("idng1_"),
    },
    asset_component_id: {
      type: "string",
      pattern: idPattern("idac1_"),
    },
    mutation_family_group_id: {
      type: "string",
      pattern: idPattern("idmg1_"),
    },
  },
} as const satisfies JSONSchema;

const outcomeSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "task_success",
    "final_state_oracle",
    "accessibility_oracle",
    "raw_trace",
    "first_unsatisfied_step_id",
    "recovery_actions",
    "virtual_elapsed_ms",
  ],
  properties: {
    task_success: {
      type: "boolean",
    },
    final_state_oracle: oracleRefSchema,
    accessibility_oracle: oracleRefSchema,
    raw_trace: rawTraceRefSchema,
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

export const evidenceManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/evidence-manifest-v1.json",
  title: "ImpactDiff visible evidence manifest v1",
  type: "object",
  additionalProperties: false,
  required: [
    "contract",
    "version",
    "evidence_id",
    "feature_profile_id",
    "source_state_id",
    "task",
    "environment",
    "pair",
  ],
  properties: {
    contract: {
      const: "impactdiff.evidence",
    },
    version: {
      const: 1,
    },
    evidence_id: {
      type: "string",
      pattern: idPattern("idev1_"),
    },
    feature_profile_id: {
      type: "string",
      pattern: idPattern("idfp1_"),
    },
    source_state_id: {
      type: "string",
      pattern: idPattern("idss1_"),
    },
    task: {
      type: "object",
      additionalProperties: false,
      required: ["task_id", "action_plan"],
      properties: {
        task_id: {
          type: "string",
          pattern: idPattern("idtk1_"),
        },
        action_plan: actionPlanRefSchema,
      },
    },
    environment: {
      type: "object",
      additionalProperties: false,
      required: ["environment_id", "capture_spec"],
      properties: {
        environment_id: {
          type: "string",
          pattern: idPattern("iden1_"),
        },
        capture_spec: captureSpecRefSchema,
      },
    },
    pair: {
      type: "object",
      additionalProperties: false,
      required: ["baseline", "candidate"],
      properties: {
        baseline: captureSchema("baseline"),
        candidate: captureSchema("candidate"),
      },
    },
  },
} as const satisfies JSONSchema;

export const sealedRecordSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/sealed-record-v1.json",
  title: "ImpactDiff sealed record v1",
  type: "object",
  additionalProperties: false,
  required: [
    "contract",
    "version",
    "sealed_record_id",
    "evidence_id",
    "evidence_manifest_sha256",
    "label_policy_id",
    "grouping",
    "intervention",
    "execution",
    "labels",
  ],
  properties: {
    contract: {
      const: "impactdiff.sealed-record",
    },
    version: {
      const: 1,
    },
    sealed_record_id: {
      type: "string",
      pattern: idPattern("idsr1_"),
    },
    evidence_id: {
      type: "string",
      pattern: idPattern("idev1_"),
    },
    evidence_manifest_sha256: {
      type: "string",
      pattern: sha256Pattern,
    },
    label_policy_id: {
      type: "string",
      pattern: idPattern("idlp1_"),
    },
    grouping: groupingSchema,
    intervention: {
      type: "object",
      additionalProperties: false,
      required: [
        "family_id",
        "operator_id",
        "operator_version",
        "instance_id",
        "parameters",
        "preconditions",
        "changed_surface",
        "expected_task_relation",
      ],
      properties: {
        family_id: {
          type: "string",
          pattern: idPattern("idmf1_"),
        },
        operator_id: {
          type: "string",
          pattern: idPattern("idop1_"),
        },
        operator_version: {
          type: "integer",
          minimum: 1,
          maximum: 2_147_483_647,
        },
        instance_id: {
          type: "string",
          pattern: idPattern("idmi1_"),
        },
        parameters: interventionParametersRefSchema,
        preconditions: interventionPreconditionsRefSchema,
        changed_surface: changedSurfaceRefSchema,
        expected_task_relation: {
          enum: ["preserve", "break"],
        },
      },
    },
    execution: {
      type: "object",
      additionalProperties: false,
      required: ["baseline", "candidate"],
      properties: {
        baseline: outcomeSchema,
        candidate: outcomeSchema,
      },
    },
    labels: {
      type: "object",
      additionalProperties: false,
      required: [
        "sample_valid",
        "invalid_reason",
        "task_regression",
        "severity_ordinal",
        "first_failed_step_id",
        "localization",
      ],
      properties: {
        sample_valid: {
          type: "boolean",
        },
        invalid_reason: {
          anyOf: [
            {
              enum: [
                "baseline_failed",
                "capture_incomplete",
                "oracle_inconclusive",
                "contract_violation",
              ],
            },
            { type: "null" },
          ],
        },
        task_regression: {
          anyOf: [{ type: "boolean" }, { type: "null" }],
        },
        severity_ordinal: {
          anyOf: [{ type: "integer", minimum: 0, maximum: 4 }, { type: "null" }],
        },
        first_failed_step_id: {
          anyOf: [{ type: "string", pattern: idPattern("idst1_") }, { type: "null" }],
        },
        localization: {
          anyOf: [localizationRefSchema, { type: "null" }],
        },
      },
    },
  },
} as const satisfies JSONSchema;

const evidenceIdListSchema = {
  type: "array",
  minItems: 1,
  maxItems: 1_000_000,
  uniqueItems: true,
  items: {
    type: "string",
    pattern: idPattern("idev1_"),
  },
} as const satisfies JSONSchema;

export const splitAssignmentSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/split-assignment-v1.json",
  title: "ImpactDiff visible split assignment v1",
  type: "object",
  additionalProperties: false,
  required: [
    "contract",
    "version",
    "split_id",
    "dataset_id",
    "feature_profile_id",
    "protocol",
    "partitions",
  ],
  properties: {
    contract: {
      const: "impactdiff.split-assignment",
    },
    version: {
      const: 1,
    },
    split_id: {
      type: "string",
      pattern: idPattern("idsp1_"),
    },
    dataset_id: {
      type: "string",
      pattern: idPattern("idds1_"),
    },
    feature_profile_id: {
      type: "string",
      pattern: idPattern("idfp1_"),
    },
    protocol: {
      enum: [
        "source_state_holdout",
        "application_holdout",
        "mutation_family_holdout",
        "joint_application_and_family_holdout",
      ],
    },
    partitions: {
      type: "object",
      additionalProperties: false,
      required: ["train", "validation", "test"],
      properties: {
        train: evidenceIdListSchema,
        validation: evidenceIdListSchema,
        test: evidenceIdListSchema,
      },
    },
  },
} as const satisfies JSONSchema;

const splitAuditItemSchema = {
  type: "object",
  additionalProperties: false,
  required: ["evidence_id", "grouping"],
  properties: {
    evidence_id: {
      type: "string",
      pattern: idPattern("idev1_"),
    },
    grouping: groupingSchema,
  },
} as const satisfies JSONSchema;

export const splitAuditSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/split-audit-v1.json",
  title: "ImpactDiff sealed split audit v1",
  type: "object",
  additionalProperties: false,
  required: [
    "contract",
    "version",
    "split_audit_id",
    "split_id",
    "assignment_sha256",
    "policy_id",
    "items",
  ],
  properties: {
    contract: {
      const: "impactdiff.split-audit",
    },
    version: {
      const: 1,
    },
    split_audit_id: {
      type: "string",
      pattern: idPattern("idsa1_"),
    },
    split_id: {
      type: "string",
      pattern: idPattern("idsp1_"),
    },
    assignment_sha256: {
      type: "string",
      pattern: sha256Pattern,
    },
    policy_id: {
      type: "string",
      pattern: idPattern("idpl1_"),
    },
    items: {
      type: "array",
      minItems: 3,
      maxItems: 1_000_000,
      items: splitAuditItemSchema,
    },
  },
} as const satisfies JSONSchema;

export type EvidenceManifest = FromSchema<typeof evidenceManifestSchema>;
export type SealedRecord = FromSchema<typeof sealedRecordSchema>;
export type SplitAssignment = FromSchema<typeof splitAssignmentSchema>;
export type SplitAudit = FromSchema<typeof splitAuditSchema>;
