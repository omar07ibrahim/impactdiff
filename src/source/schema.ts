import type { FromSchema, JSONSchema } from "json-schema-to-ts";

const sha256Pattern = "^[0-9a-f]{64}$";

const resourceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["path", "media_type", "sha256", "byte_length", "license"],
  properties: {
    path: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      pattern: "^[a-zA-Z0-9][a-zA-Z0-9._/-]*$",
    },
    media_type: {
      type: "string",
      minLength: 3,
      maxLength: 192,
      pattern:
        "^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*(; [a-z0-9][a-z0-9!#$&^_.+-]*=[a-z0-9][a-z0-9!#$&^_.+-]*)*$",
    },
    sha256: {
      type: "string",
      pattern: sha256Pattern,
    },
    byte_length: {
      type: "integer",
      minimum: 1,
      maximum: 16_777_216,
    },
    license: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      pattern: "^[A-Za-z0-9][A-Za-z0-9.+-]*$",
    },
  },
} as const satisfies JSONSchema;

export const sourceStateSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/source-state-v1.json",
  title: "ImpactDiff sealed source state v1",
  type: "object",
  additionalProperties: false,
  required: ["contract", "version", "source", "initial_state"],
  properties: {
    contract: {
      const: "impactdiff.source-state",
    },
    version: {
      const: 1,
    },
    source: {
      type: "object",
      additionalProperties: false,
      required: [
        "kind",
        "fixture_id",
        "revision",
        "license",
        "entrypoint",
        "raw_manifest",
        "resources",
      ],
      properties: {
        kind: {
          const: "closed_fixture",
        },
        fixture_id: {
          type: "string",
          minLength: 1,
          maxLength: 64,
          pattern: "^[a-z0-9][a-z0-9-]*$",
        },
        revision: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[a-z0-9][a-z0-9._-]*$",
        },
        license: {
          type: "string",
          minLength: 1,
          maxLength: 64,
          pattern: "^[A-Za-z0-9][A-Za-z0-9.+-]*$",
        },
        entrypoint: {
          type: "string",
          minLength: 1,
          maxLength: 256,
          pattern: "^[a-zA-Z0-9][a-zA-Z0-9._/-]*$",
        },
        raw_manifest: {
          type: "object",
          additionalProperties: false,
          required: ["sha256", "byte_length"],
          properties: {
            sha256: {
              type: "string",
              pattern: sha256Pattern,
            },
            byte_length: {
              type: "integer",
              minimum: 1,
              maximum: 1_048_576,
            },
          },
        },
        resources: {
          type: "array",
          minItems: 1,
          maxItems: 1_024,
          items: resourceSchema,
        },
      },
    },
    initial_state: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "route", "storage"],
      properties: {
        kind: {
          const: "fixture_default",
        },
        route: {
          type: "string",
          minLength: 1,
          maxLength: 256,
          pattern: "^/([a-zA-Z0-9._~!$&'()*+,;=:@/-]*)$",
        },
        storage: {
          const: "empty",
        },
      },
    },
  },
} as const satisfies JSONSchema;

export type SourceState = FromSchema<typeof sourceStateSchema>;
