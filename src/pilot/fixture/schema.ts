import type { FromSchema, JSONSchema } from "json-schema-to-ts";

import { pilotMutationLocalPredicateKeys } from "../../mutations/catalog/schema.js";

const sha256Pattern = "^[0-9a-f]{64}$";
const idPattern = (prefix: string) => `^${prefix}[0-9a-f]{64}$`;
const resourcePathPattern = "^[a-z0-9][a-z0-9._/-]*$";
const testIdPattern = "^[a-z0-9][a-z0-9-]*$";

const exactObject = <const Properties extends Record<string, JSONSchema>>(
  properties: Properties,
) =>
  ({
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties) as (keyof Properties & string)[],
    properties,
  }) as const;

export const pilotFixtureManifestContract =
  "impactdiff.pilot-fixture-manifest" as const;
export const pilotFixtureManifestVersion = 1 as const;
export const pilotFixtureManifestMediaType =
  "application/vnd.impactdiff.pilot-fixture-manifest+json" as const;

export const pilotFixtureAbiSlots = Object.freeze([
  "root",
  "setup",
  "focus_entry",
  "primary",
  "native_control_peer",
  "clip_host",
  "displacement_anchor",
  "content_pressure",
  "success",
] as const);

export type PilotFixtureAbiSlot = (typeof pilotFixtureAbiSlots)[number];

export const pilotFixtureCheckpointKeys = Object.freeze([
  "initial_state",
  "pre_primary_action",
  "post_primary_action",
] as const);

const resourceSchema = exactObject({
  path: {
    type: "string",
    minLength: 1,
    maxLength: 256,
    pattern: resourcePathPattern,
  },
  media_type: {
    type: "string",
    minLength: 3,
    maxLength: 192,
    pattern:
      "^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*(; [a-z0-9][a-z0-9!#$&^_.+-]*=[a-z0-9][a-z0-9!#$&^_.+-]*)*$",
  },
  sha256: { type: "string", pattern: sha256Pattern },
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
});

const testIdLocatorSchema = exactObject({
  strategy: { const: "test_id" },
  value: {
    type: "string",
    minLength: 1,
    maxLength: 128,
    pattern: testIdPattern,
  },
});

const abiSchema = exactObject(
  Object.fromEntries(
    pilotFixtureAbiSlots.map((slot) => [slot, testIdLocatorSchema]),
  ) as Record<PilotFixtureAbiSlot, typeof testIdLocatorSchema>,
);

const focusActionSchema = exactObject({
  intent: { const: "focus" },
  target: { const: "focus_entry" },
  value: exactObject({ kind: { const: "none" } }),
  pointer_source_point: { type: "null" },
});

const keyActionSchema = exactObject({
  intent: { const: "press_key" },
  target: { type: "null" },
  value: exactObject({
    kind: { const: "key" },
    key: { enum: ["ArrowDown", "Tab"] },
  }),
  pointer_source_point: { type: "null" },
});

const pointerActionSchema = exactObject({
  intent: { const: "pointer_click" },
  target: { const: "primary" },
  value: exactObject({
    kind: { const: "pointer" },
    button: { const: "primary" },
  }),
  pointer_source_point: { const: "source_primary_border_box_center" },
});

const actionSchema = {
  oneOf: [focusActionSchema, keyActionSchema, pointerActionSchema],
} as const satisfies JSONSchema;

const checkpointSchema = exactObject({
  key: { enum: pilotFixtureCheckpointKeys },
  after_action_ordinal: {
    type: "integer",
    minimum: -1,
    maximum: 255,
  },
});

const workflowSchema = exactObject({
  workflow_key: {
    type: "string",
    minLength: 1,
    maxLength: 64,
    pattern: "^[a-z][a-z0-9_]*$",
  },
  abi: abiSchema,
  actions: {
    type: "array",
    minItems: 1,
    maxItems: 256,
    items: actionSchema,
  },
  checkpoints: {
    type: "array",
    minItems: 3,
    maxItems: 3,
    items: checkpointSchema,
  },
  predicate_keys: { const: pilotMutationLocalPredicateKeys },
  expectations: exactObject({
    setup_attribute: exactObject({
      name: {
        type: "string",
        minLength: 1,
        maxLength: 64,
        pattern: "^[a-z][a-z0-9_-]*$",
      },
      initial: { type: "string", minLength: 1, maxLength: 256 },
      selected: { type: "string", minLength: 1, maxLength: 256 },
    }),
    pre_primary_focus: { enum: pilotFixtureAbiSlots },
    final: exactObject({
      root_attribute: exactObject({
        name: {
          type: "string",
          minLength: 6,
          maxLength: 64,
          pattern: "^data-[a-z0-9]+(?:-[a-z0-9]+)*$",
        },
        value: { type: "string", minLength: 1, maxLength: 256 },
      }),
      success_text: { type: "string", minLength: 1, maxLength: 512 },
      focus: { enum: pilotFixtureAbiSlots },
    }),
  }),
});

export const pilotFixtureManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/pilot-fixture-manifest-v1.json",
  title: "ImpactDiff Pilot fixture manifest v1",
  ...exactObject({
    contract: { const: pilotFixtureManifestContract },
    version: { const: pilotFixtureManifestVersion },
    protocol_id: { type: "string", pattern: idPattern("idpp1_") },
    application_catalog_id: {
      type: "string",
      pattern: idPattern("idpc1_"),
    },
    pilot_release: { const: "pilot-v0.1" },
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
    revision: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[a-z0-9][a-z0-9._-]*$",
    },
    title: { type: "string", minLength: 1, maxLength: 160 },
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
      pattern: resourcePathPattern,
    },
    resources: {
      type: "array",
      minItems: 1,
      maxItems: 1_024,
      items: resourceSchema,
    },
    environment: exactObject({
      viewport: exactObject({
        width: { type: "integer", minimum: 320, maximum: 3_840 },
        height: { type: "integer", minimum: 240, maximum: 2_160 },
      }),
      device_scale_factor: {
        type: "number",
        minimum: 0.25,
        maximum: 4,
      },
      locale: { type: "string", minLength: 2, maxLength: 32 },
      timezone: { type: "string", minLength: 1, maxLength: 64 },
      color_scheme: { enum: ["light", "dark"] },
    }),
    readiness: exactObject({
      global: {
        type: "string",
        minLength: 1,
        maxLength: 128,
        pattern: "^__[A-Za-z][A-Za-z0-9]*$",
      },
      ready: { type: "boolean" },
      pending_requests: {
        type: "integer",
        minimum: 0,
        maximum: 1_024,
      },
    }),
    network_policy: exactObject({
      connect: { enum: ["deny"] },
      external_resources: { enum: ["deny"] },
      service_worker: { enum: ["absent"] },
    }),
    content_security_policy: {
      type: "string",
      minLength: 1,
      maxLength: 2_048,
    },
    mutation_policy: exactObject({
      style_nonce: {
        type: "string",
        minLength: 1,
        maxLength: 128,
        pattern: testIdPattern,
      },
      inline_styles: { enum: ["nonce-only"] },
    }),
    font: exactObject({
      family: { type: "string", minLength: 1, maxLength: 128 },
      path: {
        type: "string",
        minLength: 1,
        maxLength: 256,
        pattern: resourcePathPattern,
      },
      source_package: { type: "string", minLength: 1, maxLength: 160 },
      license: {
        type: "string",
        minLength: 1,
        maxLength: 64,
        pattern: "^[A-Za-z0-9][A-Za-z0-9.+-]*$",
      },
      license_path: {
        type: "string",
        minLength: 1,
        maxLength: 256,
        pattern: resourcePathPattern,
      },
      sha256: { type: "string", pattern: sha256Pattern },
    }),
    workflows: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: workflowSchema,
    },
  }),
} as const satisfies JSONSchema;

export type PilotFixtureManifest = FromSchema<typeof pilotFixtureManifestSchema>;
export type PilotFixtureWorkflow = PilotFixtureManifest["workflows"][number];
export type PilotFixtureAbi = PilotFixtureWorkflow["abi"];
export type PilotFixtureAction = PilotFixtureWorkflow["actions"][number];
export type PilotFixtureActionRecipe = PilotFixtureAction;
