import type { FromSchema, JSONSchema } from "json-schema-to-ts";

const sha256Pattern = "^[0-9a-f]{64}$";
const idPattern = (prefix: string) => `^${prefix}[0-9a-f]{64}$`;

const canonicalFileSchema = <const Prefix extends string>(prefix: Prefix) =>
  ({
    type: "object",
    additionalProperties: false,
    required: ["id", "sha256", "byte_length"],
    properties: {
      id: {
        type: "string",
        pattern: idPattern(prefix),
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
    },
  }) as const satisfies JSONSchema;

export const pairedPublicationCommitSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/paired-publication-commit-v1.json",
  title: "ImpactDiff paired publication commit v1",
  type: "object",
  additionalProperties: false,
  required: [
    "contract",
    "version",
    "publication_id",
    "evidence_manifest",
    "sealed_record",
  ],
  properties: {
    contract: {
      const: "impactdiff.paired-publication-commit",
    },
    version: {
      const: 1,
    },
    publication_id: {
      type: "string",
      pattern: idPattern("idpb1_"),
    },
    evidence_manifest: canonicalFileSchema("idev1_"),
    sealed_record: canonicalFileSchema("idsr1_"),
  },
} as const satisfies JSONSchema;

export type PairedPublicationCommit = FromSchema<typeof pairedPublicationCommitSchema>;
