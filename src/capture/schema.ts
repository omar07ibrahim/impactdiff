import type { FromSchema, JSONSchema } from "json-schema-to-ts";

import { maximumCapturePngBytes } from "./limits.js";

const sha256Pattern = "^[0-9a-f]{64}$";
const digestPattern = "^sha256:[0-9a-f]{64}$";
const sourceRevisionPattern = "^[0-9a-f]{40}$";
const idPattern = (prefix: string) => `^${prefix}[0-9a-f]{64}$`;

const noneValueSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind"],
  properties: {
    kind: {
      const: "none",
    },
  },
} as const satisfies JSONSchema;

const pointerValueSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "button"],
  properties: {
    kind: {
      const: "pointer",
    },
    button: {
      const: "primary",
    },
  },
} as const satisfies JSONSchema;

const textValueSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "text"],
  properties: {
    kind: {
      const: "text",
    },
    text: {
      type: "string",
      maxLength: 512,
    },
  },
} as const satisfies JSONSchema;

const keyValueSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "key"],
  properties: {
    kind: {
      const: "key",
    },
    key: {
      enum: [
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "Enter",
        "Escape",
        "Space",
        "Tab",
      ],
    },
  },
} as const satisfies JSONSchema;

const durationValueSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "milliseconds"],
  properties: {
    kind: {
      const: "duration_ms",
    },
    milliseconds: {
      type: "integer",
      minimum: 0,
      maximum: 60_000,
    },
  },
} as const satisfies JSONSchema;

const actionIdentityProperties = {
  action_id: {
    type: "string",
    pattern: idPattern("idst1_"),
  },
  ordinal: {
    type: "integer",
    minimum: 0,
    maximum: 255,
  },
} as const satisfies Record<string, JSONSchema>;

const pointerClickActionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action_id", "ordinal", "intent", "target_id", "value"],
  properties: {
    ...actionIdentityProperties,
    intent: {
      const: "pointer_click",
    },
    target_id: {
      type: "string",
      pattern: idPattern("idat1_"),
    },
    value: pointerValueSchema,
  },
} as const satisfies JSONSchema;

const focusActionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action_id", "ordinal", "intent", "target_id", "value"],
  properties: {
    ...actionIdentityProperties,
    intent: {
      const: "focus",
    },
    target_id: {
      type: "string",
      pattern: idPattern("idat1_"),
    },
    value: noneValueSchema,
  },
} as const satisfies JSONSchema;

const fillTextActionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action_id", "ordinal", "intent", "target_id", "value"],
  properties: {
    ...actionIdentityProperties,
    intent: {
      const: "fill_text",
    },
    target_id: {
      type: "string",
      pattern: idPattern("idat1_"),
    },
    value: textValueSchema,
  },
} as const satisfies JSONSchema;

const pressKeyActionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action_id", "ordinal", "intent", "target_id", "value"],
  properties: {
    ...actionIdentityProperties,
    intent: {
      const: "press_key",
    },
    target_id: {
      type: "null",
    },
    value: keyValueSchema,
  },
} as const satisfies JSONSchema;

const advanceTimeActionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action_id", "ordinal", "intent", "target_id", "value"],
  properties: {
    ...actionIdentityProperties,
    intent: {
      const: "advance_virtual_time",
    },
    target_id: {
      type: "null",
    },
    value: durationValueSchema,
  },
} as const satisfies JSONSchema;

const checkpointScheduleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ordinal", "after_action_ordinal"],
  properties: {
    ordinal: {
      type: "integer",
      minimum: 0,
      maximum: 15,
    },
    after_action_ordinal: {
      type: "integer",
      minimum: -1,
      maximum: 255,
    },
  },
} as const satisfies JSONSchema;

export const actionPlanSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/action-plan-v1.json",
  title: "ImpactDiff visible non-branching action plan v1",
  type: "object",
  additionalProperties: false,
  required: ["contract", "version", "actions", "checkpoints"],
  properties: {
    contract: {
      const: "impactdiff.action-plan",
    },
    version: {
      const: 1,
    },
    actions: {
      type: "array",
      minItems: 1,
      maxItems: 256,
      items: {
        anyOf: [
          pointerClickActionSchema,
          focusActionSchema,
          fillTextActionSchema,
          pressKeyActionSchema,
          advanceTimeActionSchema,
        ],
      },
    },
    checkpoints: {
      type: "array",
      minItems: 2,
      maxItems: 16,
      items: checkpointScheduleSchema,
    },
  },
} as const satisfies JSONSchema;

const dimensionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["width", "height"],
  properties: {
    width: {
      type: "integer",
      minimum: 320,
      maximum: 3_840,
    },
    height: {
      type: "integer",
      minimum: 240,
      maximum: 2_160,
    },
  },
} as const satisfies JSONSchema;

const playwrightPackageSchema = <const Name extends string>(name: Name) =>
  ({
    type: "object",
    additionalProperties: false,
    required: ["name", "version"],
    properties: {
      name: {
        const: name,
      },
      version: {
        const: "1.61.1",
      },
    },
  }) as const satisfies JSONSchema;

const hostExecutionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "platform"],
  properties: {
    kind: {
      const: "host",
    },
    platform: {
      const: "linux/amd64",
    },
  },
} as const satisfies JSONSchema;

const trustedOrchestratorAttestationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "statement_format", "statement_sha256"],
  properties: {
    kind: {
      const: "trusted-orchestrator",
    },
    statement_format: {
      const: "in-toto-statement-v1",
    },
    statement_sha256: {
      type: "string",
      pattern: sha256Pattern,
      description:
        "SHA-256 of the exact canonical JSON bytes of an in-toto Statement v1 that an external trusted orchestrator verified; its subject digest must equal execution.image_digest.",
    },
  },
  description:
    "The publisher may accept the OCI subject only after a configured trusted orchestrator verifies this in-toto statement and its subject image digest.",
} as const satisfies JSONSchema;

const ociExecutionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "platform", "image_digest", "attestation"],
  properties: {
    kind: {
      const: "oci",
    },
    platform: {
      const: "linux/amd64",
    },
    image_digest: {
      type: "string",
      pattern: digestPattern,
      description:
        "Digest of the immutable base execution image before the repository, fixture, or capture specification is mounted, avoiding a self-referential image identity.",
    },
    attestation: trustedOrchestratorAttestationSchema,
  },
} as const satisfies JSONSchema;

const fontFileSchema = {
  type: "object",
  additionalProperties: false,
  required: ["logical_name", "format", "sha256", "byte_length"],
  properties: {
    logical_name: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[a-z0-9][a-z0-9._-]*$",
    },
    format: {
      const: "woff2",
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
} as const satisfies JSONSchema;

/**
 * This is a deliberate pre-release v1 reset. ImpactDiff is still 0.0.0 and no
 * capture corpus was published under the superseded v1 shape, so carrying an
 * unreleased ambiguous contract forward as v2 would manufacture compatibility.
 */
export const captureSpecSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/capture-spec-v1.json",
  title: "ImpactDiff deterministic capture specification v1",
  description:
    "Pre-release v1 reset: the 0.0.0 project published no capture corpus under the superseded capture-spec shape.",
  type: "object",
  additionalProperties: false,
  required: [
    "contract",
    "version",
    "software",
    "execution",
    "fonts",
    "display",
    "internationalization",
    "media",
    "clock",
    "screenshot",
    "network",
    "budgets",
    "geometry_quantization",
  ],
  properties: {
    contract: {
      const: "impactdiff.capture-spec",
    },
    version: {
      const: 1,
    },
    software: {
      type: "object",
      additionalProperties: false,
      required: ["playwright", "browser"],
      properties: {
        playwright: {
          type: "object",
          additionalProperties: false,
          required: ["packages", "installed_file_tree_sha256"],
          properties: {
            packages: {
              type: "object",
              additionalProperties: false,
              required: ["playwright_test", "playwright", "playwright_core"],
              properties: {
                playwright_test: playwrightPackageSchema("@playwright/test"),
                playwright: playwrightPackageSchema("playwright"),
                playwright_core: playwrightPackageSchema("playwright-core"),
              },
            },
            installed_file_tree_sha256: {
              type: "string",
              pattern: sha256Pattern,
              description:
                "SHA-256 of RFC 8785 canonical JSON {contract:'impactdiff.playwright-installed-file-tree',version:1,packages:[...]}. It covers every regular file in exactly these three installed package roots; packages are sorted by name and files by normalized POSIX-relative path, with name, version, path, byte length, and per-file SHA-256. Symbolic links and special entries are forbidden.",
            },
          },
        },
        browser: {
          type: "object",
          additionalProperties: false,
          required: [
            "engine",
            "distribution",
            "playwright_registry_revision",
            "version",
            "source_revision",
            "executable_sha256",
            "launch_profile_sha256",
          ],
          properties: {
            engine: {
              const: "chromium",
            },
            distribution: {
              const: "chromium_headless_shell",
            },
            playwright_registry_revision: {
              const: "1228",
            },
            version: {
              const: "149.0.7827.55",
            },
            source_revision: {
              type: "string",
              pattern: sourceRevisionPattern,
              description:
                "Lowercase 40-hex Chromium source revision reported live by Browser.getVersion, without its leading @ marker.",
            },
            executable_sha256: {
              type: "string",
              pattern: sha256Pattern,
            },
            launch_profile_sha256: {
              type: "string",
              pattern: sha256Pattern,
              description:
                "SHA-256 of RFC 8785 canonical JSON {contract:'impactdiff.chromium-launch-profile',version:1,argv:[...]}. The live Browser.getBrowserCommandLine argv preserves order and duplicates after replacing argv[0] with $BINARY and its single nonempty --user-data-dir value with $EPHEMERAL.",
            },
          },
        },
      },
    },
    execution: {
      oneOf: [hostExecutionSchema, ociExecutionSchema],
    },
    fonts: {
      type: "object",
      additionalProperties: false,
      required: ["bundle_format", "files", "loading", "fallback_policy"],
      properties: {
        bundle_format: {
          const: "closed-font-file-set-v1",
        },
        files: {
          type: "array",
          minItems: 1,
          maxItems: 64,
          items: fontFileSchema,
          description:
            "The complete font-resource allowlist exposed to document CSS; logical names are stable labels and SHA-256 covers the exact WOFF2 bytes.",
        },
        loading: {
          const: "document-fonts-ready",
        },
        fallback_policy: {
          const: "closed-bundle-only",
        },
      },
    },
    display: {
      type: "object",
      additionalProperties: false,
      required: ["viewport", "screen", "device_scale_factor"],
      properties: {
        viewport: dimensionSchema,
        screen: dimensionSchema,
        device_scale_factor: {
          const: 1,
        },
      },
    },
    internationalization: {
      type: "object",
      additionalProperties: false,
      required: ["locale", "timezone_id"],
      properties: {
        locale: {
          const: "en-US",
        },
        timezone_id: {
          const: "UTC",
        },
      },
    },
    media: {
      type: "object",
      additionalProperties: false,
      required: ["color_scheme", "reduced_motion", "forced_colors"],
      properties: {
        color_scheme: {
          const: "light",
        },
        reduced_motion: {
          const: "reduce",
        },
        forced_colors: {
          const: "none",
        },
      },
    },
    clock: {
      type: "object",
      additionalProperties: false,
      required: ["epoch_ms", "progression"],
      properties: {
        epoch_ms: {
          const: 1_735_689_600_000,
        },
        progression: {
          const: "explicit-only",
        },
      },
    },
    screenshot: {
      type: "object",
      additionalProperties: false,
      required: [
        "format",
        "full_page",
        "animations",
        "caret",
        "scale",
        "omit_background",
      ],
      properties: {
        format: {
          const: "png",
        },
        full_page: {
          const: false,
        },
        animations: {
          const: "disabled",
        },
        caret: {
          const: "hide",
        },
        scale: {
          const: "css",
        },
        omit_background: {
          const: false,
        },
      },
    },
    network: {
      type: "object",
      additionalProperties: false,
      required: [
        "fixture_delivery",
        "external_requests",
        "service_workers",
        "connect_policy",
      ],
      properties: {
        fixture_delivery: {
          const: "memory",
        },
        external_requests: {
          const: "abort",
        },
        service_workers: {
          const: "block",
        },
        connect_policy: {
          const: "none",
        },
      },
    },
    budgets: {
      type: "object",
      additionalProperties: false,
      required: [
        "navigation_timeout_ms",
        "readiness_timeout_ms",
        "action_timeout_ms",
        "maximum_pending_requests",
        "maximum_nodes",
        "maximum_screenshot_bytes",
      ],
      properties: {
        navigation_timeout_ms: {
          type: "integer",
          minimum: 1,
          maximum: 60_000,
        },
        readiness_timeout_ms: {
          type: "integer",
          minimum: 1,
          maximum: 60_000,
        },
        action_timeout_ms: {
          type: "integer",
          minimum: 1,
          maximum: 10_000,
          description:
            "Applied as the Playwright page default timeout before any planned action executes.",
        },
        maximum_pending_requests: {
          const: 0,
        },
        maximum_nodes: {
          const: 4_096,
        },
        maximum_screenshot_bytes: {
          const: maximumCapturePngBytes,
        },
      },
    },
    geometry_quantization: {
      type: "object",
      additionalProperties: false,
      required: ["unit", "denominator", "rounding"],
      properties: {
        unit: {
          const: "css_px_q64",
        },
        denominator: {
          const: 64,
        },
        rounding: {
          const: "nearest-ties-to-even",
        },
      },
    },
  },
} as const satisfies JSONSchema;

const nullableBoundedStringSchema = {
  anyOf: [{ type: "string", maxLength: 512 }, { type: "null" }],
} as const satisfies JSONSchema;

export const accessibilityRoles = [
  "alert",
  "banner",
  "button",
  "cell",
  "checkbox",
  "columnheader",
  "combobox",
  "complementary",
  "contentinfo",
  "definition",
  "dialog",
  "document",
  "form",
  "generic",
  "group",
  "heading",
  "img",
  "link",
  "list",
  "listitem",
  "main",
  "menu",
  "menuitem",
  "navigation",
  "option",
  "paragraph",
  "progressbar",
  "radio",
  "region",
  "row",
  "rowheader",
  "search",
  "separator",
  "slider",
  "spinbutton",
  "status",
  "switch",
  "tab",
  "table",
  "tabpanel",
  "term",
  "text",
  "textbox",
] as const;

export const accessibilityStates = [
  "busy",
  "checked",
  "checked:mixed",
  "collapsed",
  "disabled",
  "editable",
  "expanded",
  "focused",
  "hidden",
  "invalid",
  "modal",
  "multiline",
  "multiselectable",
  "pressed",
  "pressed:mixed",
  "readonly",
  "required",
  "selected",
] as const;

const accessibilityNodeSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "index",
    "parent_index",
    "child_ordinal",
    "role",
    "name",
    "description",
    "value",
    "states",
    "layout_node_index",
  ],
  properties: {
    index: {
      type: "integer",
      minimum: 0,
      maximum: 4_095,
    },
    parent_index: {
      anyOf: [{ type: "integer", minimum: 0, maximum: 4_095 }, { type: "null" }],
    },
    child_ordinal: {
      type: "integer",
      minimum: 0,
      maximum: 4_095,
    },
    role: {
      enum: accessibilityRoles,
    },
    name: {
      type: "string",
      maxLength: 512,
    },
    description: nullableBoundedStringSchema,
    value: nullableBoundedStringSchema,
    states: {
      type: "array",
      maxItems: accessibilityStates.length,
      uniqueItems: true,
      items: {
        enum: accessibilityStates,
      },
    },
    layout_node_index: {
      anyOf: [{ type: "integer", minimum: 0, maximum: 4_095 }, { type: "null" }],
    },
  },
} as const satisfies JSONSchema;

export const accessibilitySnapshotSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/accessibility-v1.json",
  title: "ImpactDiff normalized accessibility snapshot v1",
  type: "object",
  additionalProperties: false,
  required: ["contract", "version", "root_index", "nodes"],
  properties: {
    contract: {
      const: "impactdiff.accessibility",
    },
    version: {
      const: 1,
    },
    root_index: {
      const: 0,
    },
    nodes: {
      type: "array",
      minItems: 1,
      maxItems: 4_096,
      items: accessibilityNodeSchema,
    },
  },
} as const satisfies JSONSchema;

const q64BoxSchema = {
  type: "object",
  additionalProperties: false,
  required: ["x_q64", "y_q64", "width_q64", "height_q64"],
  properties: {
    x_q64: {
      type: "integer",
      minimum: -16_777_216,
      maximum: 16_777_216,
    },
    y_q64: {
      type: "integer",
      minimum: -16_777_216,
      maximum: 16_777_216,
    },
    width_q64: {
      type: "integer",
      minimum: 0,
      maximum: 16_777_216,
    },
    height_q64: {
      type: "integer",
      minimum: 0,
      maximum: 16_777_216,
    },
  },
} as const satisfies JSONSchema;

const computedStyleSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "display",
    "position",
    "visibility",
    "pointer_events",
    "overflow_x",
    "overflow_y",
    "opacity_milli",
    "z_index",
  ],
  properties: {
    display: {
      enum: [
        "block",
        "contents",
        "flex",
        "grid",
        "inline",
        "inline-block",
        "inline-flex",
        "inline-grid",
        "list-item",
        "none",
        "table",
      ],
    },
    position: {
      enum: ["absolute", "fixed", "relative", "static", "sticky"],
    },
    visibility: {
      enum: ["collapse", "hidden", "visible"],
    },
    pointer_events: {
      enum: ["auto", "none"],
    },
    overflow_x: {
      enum: ["auto", "clip", "hidden", "scroll", "visible"],
    },
    overflow_y: {
      enum: ["auto", "clip", "hidden", "scroll", "visible"],
    },
    opacity_milli: {
      type: "integer",
      minimum: 0,
      maximum: 1_000,
    },
    z_index: {
      anyOf: [
        { type: "integer", minimum: -2_147_483_648, maximum: 2_147_483_647 },
        { type: "null" },
      ],
    },
  },
} as const satisfies JSONSchema;

const layoutNodeSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "index",
    "parent_index",
    "child_ordinal",
    "kind",
    "bounds",
    "clip_bounds",
    "paint_order",
    "computed_style",
    "action_target_id",
  ],
  properties: {
    index: {
      type: "integer",
      minimum: 0,
      maximum: 4_095,
    },
    parent_index: {
      anyOf: [{ type: "integer", minimum: 0, maximum: 4_095 }, { type: "null" }],
    },
    child_ordinal: {
      type: "integer",
      minimum: 0,
      maximum: 4_095,
    },
    kind: {
      enum: ["document", "element", "text"],
    },
    bounds: q64BoxSchema,
    clip_bounds: {
      anyOf: [q64BoxSchema, { type: "null" }],
    },
    paint_order: {
      type: "integer",
      minimum: 0,
      maximum: 4_095,
    },
    computed_style: computedStyleSchema,
    action_target_id: {
      anyOf: [{ type: "string", pattern: idPattern("idat1_") }, { type: "null" }],
    },
  },
} as const satisfies JSONSchema;

export const layoutSnapshotSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/layout-v1.json",
  title: "ImpactDiff normalized Q64 layout snapshot v1",
  type: "object",
  additionalProperties: false,
  required: ["contract", "version", "root_index", "nodes"],
  properties: {
    contract: {
      const: "impactdiff.layout",
    },
    version: {
      const: 1,
    },
    root_index: {
      const: 0,
    },
    nodes: {
      type: "array",
      minItems: 1,
      maxItems: 4_096,
      items: layoutNodeSchema,
    },
  },
} as const satisfies JSONSchema;

export type ActionPlan = FromSchema<typeof actionPlanSchema>;
export type CaptureSpec = FromSchema<typeof captureSpecSchema>;
export type AccessibilitySnapshot = FromSchema<typeof accessibilitySnapshotSchema>;
export type AccessibilityNode = AccessibilitySnapshot["nodes"][number];
export type LayoutSnapshot = FromSchema<typeof layoutSnapshotSchema>;
export type LayoutNode = LayoutSnapshot["nodes"][number];
