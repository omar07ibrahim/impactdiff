import assert from "node:assert/strict";
import test from "node:test";

import {
  accessibilityCodec,
  actionPlanCodec,
  captureSpecCodec,
  layoutCodec,
} from "../../src/artifacts/codecs.js";
import {
  accessibilitySnapshotSchema,
  actionPlanSchema,
  assertCaptureGraphBindings,
  captureSpecSchema,
  layoutSnapshotSchema,
  parseAccessibilitySnapshot,
  parseActionPlan,
  parseCaptureSpec,
  parseLayoutSnapshot,
} from "../../src/capture/index.js";
import { CanonicalJsonError, canonicalJson } from "../../src/contracts/canonical.js";
import { ContractValidationError } from "../../src/contracts/errors.js";

const digest = (character: string): string => character.repeat(64);
const id = (prefix: string, character: string): string =>
  `${prefix}${digest(character)}`;

const clone = <T>(value: T): T => structuredClone(value);

const actionPlanFixture = {
  contract: "impactdiff.action-plan",
  version: 1,
  actions: [
    {
      action_id: id("idst1_", "1"),
      ordinal: 0,
      intent: "focus",
      target_id: id("idat1_", "a"),
      value: { kind: "none" },
    },
    {
      action_id: id("idst1_", "2"),
      ordinal: 1,
      intent: "fill_text",
      target_id: id("idat1_", "a"),
      value: { kind: "text", text: "Omar" },
    },
    {
      action_id: id("idst1_", "3"),
      ordinal: 2,
      intent: "press_key",
      target_id: null,
      value: { kind: "key", key: "Enter" },
    },
    {
      action_id: id("idst1_", "4"),
      ordinal: 3,
      intent: "advance_virtual_time",
      target_id: null,
      value: { kind: "duration_ms", milliseconds: 250 },
    },
    {
      action_id: id("idst1_", "5"),
      ordinal: 4,
      intent: "pointer_click",
      target_id: id("idat1_", "b"),
      value: { kind: "pointer", button: "primary" },
    },
  ],
  checkpoints: [
    {
      ordinal: 0,
      after_action_ordinal: -1,
    },
    {
      ordinal: 1,
      after_action_ordinal: 4,
    },
  ],
};

const captureSpecFixture = {
  contract: "impactdiff.capture-spec",
  version: 1,
  software: {
    playwright: {
      packages: {
        playwright_test: {
          name: "@playwright/test",
          version: "1.61.1",
        },
        playwright: {
          name: "playwright",
          version: "1.61.1",
        },
        playwright_core: {
          name: "playwright-core",
          version: "1.61.1",
        },
      },
      installed_file_tree_sha256: digest("1"),
    },
    browser: {
      engine: "chromium",
      distribution: "chromium_headless_shell",
      playwright_registry_revision: "1228",
      version: "149.0.7827.55",
      source_revision: "3188f8a607ae7e067593be8aab7f02d2451fec07",
      installation_file_tree_sha256: digest("9"),
      executable_sha256: digest("2"),
      launch_profile_sha256: digest("3"),
    },
  },
  execution: {
    kind: "host",
    platform: "linux/amd64",
  },
  fonts: {
    bundle_format: "closed-font-file-set-v1",
    files: [
      {
        logical_name: "noto-sans-latin-variable-normal",
        format: "woff2",
        sha256: "df8c8215937ab2a4270c0cd997101b3fb8cdd444c9903d342200d6179ebcc097",
        byte_length: 59_928,
      },
    ],
    loading: "document-fonts-ready",
    fallback_policy: "closed-bundle-only",
  },
  display: {
    viewport: { width: 800, height: 600 },
    screen: { width: 800, height: 600 },
    device_scale_factor: 1,
  },
  internationalization: {
    locale: "en-US",
    timezone_id: "UTC",
  },
  media: {
    color_scheme: "light",
    reduced_motion: "reduce",
    forced_colors: "none",
  },
  clock: {
    epoch_ms: 1_735_689_600_000,
    progression: "explicit-only",
  },
  screenshot: {
    format: "png",
    full_page: false,
    animations: "disabled",
    caret: "hide",
    scale: "css",
    omit_background: false,
  },
  network: {
    fixture_delivery: "memory",
    external_requests: "abort",
    service_workers: "block",
    connect_policy: "none",
  },
  budgets: {
    navigation_timeout_ms: 10_000,
    readiness_timeout_ms: 5_000,
    action_timeout_ms: 2_000,
    maximum_pending_requests: 0,
    maximum_nodes: 4_096,
    maximum_screenshot_bytes: 8_388_608,
  },
  geometry_quantization: {
    unit: "css_px_q64",
    denominator: 64,
    rounding: "nearest-ties-to-even",
  },
};

const style = () => ({
  display: "block",
  position: "static",
  visibility: "visible",
  pointer_events: "auto",
  overflow_x: "visible",
  overflow_y: "visible",
  opacity_milli: 1_000,
  z_index: null,
});

const box = (x: number, y: number, width: number, height: number) => ({
  x_q64: x,
  y_q64: y,
  width_q64: width,
  height_q64: height,
});

const layoutFixture = {
  contract: "impactdiff.layout",
  version: 1,
  root_index: 0,
  nodes: [
    {
      index: 0,
      parent_index: null,
      child_ordinal: 0,
      kind: "document",
      bounds: box(0, 0, 51_200, 38_400),
      clip_bounds: box(0, 0, 51_200, 38_400),
      paint_order: 0,
      computed_style: style(),
      action_target_id: null,
    },
    {
      index: 1,
      parent_index: 0,
      child_ordinal: 0,
      kind: "element",
      bounds: box(6_400, 6_400, 38_400, 25_600),
      clip_bounds: null,
      paint_order: 1,
      computed_style: style(),
      action_target_id: null,
    },
    {
      index: 2,
      parent_index: 1,
      child_ordinal: 0,
      kind: "element",
      bounds: box(12_800, 12_800, 12_800, 2_560),
      clip_bounds: null,
      paint_order: 2,
      computed_style: style(),
      action_target_id: id("idat1_", "a"),
    },
    {
      index: 3,
      parent_index: 1,
      child_ordinal: 1,
      kind: "element",
      bounds: box(12_800, 19_200, 8_192, 2_560),
      clip_bounds: null,
      paint_order: 3,
      computed_style: style(),
      action_target_id: id("idat1_", "b"),
    },
    {
      index: 4,
      parent_index: 3,
      child_ordinal: 0,
      kind: "text",
      bounds: box(13_056, 19_456, 4_096, 1_280),
      clip_bounds: null,
      paint_order: 4,
      computed_style: style(),
      action_target_id: null,
    },
  ],
};

const accessibilityFixture = {
  contract: "impactdiff.accessibility",
  version: 1,
  root_index: 0,
  nodes: [
    {
      index: 0,
      parent_index: null,
      child_ordinal: 0,
      role: "document",
      name: "Checkout",
      description: null,
      value: null,
      states: [],
      layout_node_index: 0,
    },
    {
      index: 1,
      parent_index: 0,
      child_ordinal: 0,
      role: "main",
      name: "Checkout form",
      description: null,
      value: null,
      states: [],
      layout_node_index: 1,
    },
    {
      index: 2,
      parent_index: 1,
      child_ordinal: 0,
      role: "textbox",
      name: "Name",
      description: null,
      value: "Omar",
      states: ["editable", "focused", "required"],
      layout_node_index: 2,
    },
    {
      index: 3,
      parent_index: 1,
      child_ordinal: 1,
      role: "button",
      name: "Pay",
      description: null,
      value: null,
      states: [],
      layout_node_index: 3,
    },
    {
      index: 4,
      parent_index: 3,
      child_ordinal: 0,
      role: "text",
      name: "Pay",
      description: null,
      value: null,
      states: [],
      layout_node_index: 4,
    },
  ],
};

function assertContractIssue(callback: () => unknown, code: string): void {
  assert.throws(callback, (error: unknown) => {
    assert.ok(error instanceof ContractValidationError);
    assert.ok(
      error.issues.some((candidate) => candidate.code === code),
      `expected issue ${code}, received ${error.issues.map((issue) => issue.code).join(", ")}`,
    );
    return true;
  });
}

function assertClosedObjectSchemas(value: unknown, path = "$schema"): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertClosedObjectSchemas(item, `${path}/${index}`);
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;
  if (record.type === "object") {
    assert.equal(
      record.additionalProperties,
      false,
      `${path} must reject unknown object keys`,
    );
  }
  for (const [key, item] of Object.entries(record)) {
    assertClosedObjectSchemas(item, `${path}/${key}`);
  }
}

test("all four payload schemas close every object boundary", () => {
  for (const schema of [
    actionPlanSchema,
    captureSpecSchema,
    accessibilitySnapshotSchema,
    layoutSnapshotSchema,
  ]) {
    assertClosedObjectSchemas(schema);
  }
});

test("canonical v1 payloads parse into frozen typed data", () => {
  const actionPlan = parseActionPlan(canonicalJson(actionPlanFixture));
  const captureSpec = parseCaptureSpec(canonicalJson(captureSpecFixture));
  const accessibility = parseAccessibilitySnapshot(canonicalJson(accessibilityFixture));
  const layout = parseLayoutSnapshot(canonicalJson(layoutFixture));

  assert.equal(actionPlan.actions.length, 5);
  assert.equal(captureSpec.display.device_scale_factor, 1);
  assert.equal(accessibility.nodes[2]?.role, "textbox");
  assert.equal(layout.nodes[3]?.action_target_id, id("idat1_", "b"));
  assert.ok(Object.isFrozen(actionPlan));
  assert.ok(Object.isFrozen(actionPlan.actions[0]?.value));
  assertCaptureGraphBindings(actionPlan, accessibility, layout);
});

test("action plan rejects branching and browser-control canaries", () => {
  const canaries = ["selector", "url", "oracle", "status", "retry", "outcome"];
  for (const canary of canaries) {
    const candidate = clone(actionPlanFixture);
    Object.assign(candidate.actions[0] as object, { [canary]: "canary" });
    assert.throws(() => parseActionPlan(canonicalJson(candidate)), {
      name: "ContractValidationError",
    });
  }
});

test("action plan enforces exact variants, identities, and ordering", () => {
  const badValue = clone(actionPlanFixture);
  badValue.actions[0]!.value = {
    kind: "pointer",
    button: "primary",
  } as (typeof badValue.actions)[0]["value"];
  assert.throws(() => parseActionPlan(canonicalJson(badValue)), {
    name: "ContractValidationError",
  });

  const badOrdinal = clone(actionPlanFixture);
  badOrdinal.actions[1]!.ordinal = 0;
  assertContractIssue(
    () => parseActionPlan(canonicalJson(badOrdinal)),
    "action_plan.action_order",
  );

  const duplicateId = clone(actionPlanFixture);
  duplicateId.actions[1]!.action_id = duplicateId.actions[0]!.action_id;
  assertContractIssue(
    () => parseActionPlan(canonicalJson(duplicateId)),
    "action_plan.duplicate_action_id",
  );

  const resultDependentSchedule = clone(actionPlanFixture);
  resultDependentSchedule.checkpoints[1]!.after_action_ordinal = -1;
  assertContractIssue(
    () => parseActionPlan(canonicalJson(resultDependentSchedule)),
    "action_plan.checkpoint_schedule_order",
  );
});

test("capture spec pins software, display, timeouts, and forbids machine paths", () => {
  const browserDrift = clone(captureSpecFixture);
  browserDrift.software.browser.version = "149.0.7827.56";
  assert.throws(() => parseCaptureSpec(canonicalJson(browserDrift)), {
    name: "ContractValidationError",
  });

  const screenDrift = clone(captureSpecFixture);
  screenDrift.display.screen.width = 801;
  assertContractIssue(
    () => parseCaptureSpec(canonicalJson(screenDrift)),
    "capture_spec.screen_mismatch",
  );

  const oversizedViewport = clone(captureSpecFixture);
  oversizedViewport.display.viewport = { width: 3_840, height: 2_160 };
  oversizedViewport.display.screen = { width: 3_840, height: 2_160 };
  assertContractIssue(
    () => parseCaptureSpec(canonicalJson(oversizedViewport)),
    "capture_spec.pixel_budget",
  );

  const timeoutDrift = clone(captureSpecFixture);
  timeoutDrift.budgets.action_timeout_ms = 6_000;
  assertContractIssue(
    () => parseCaptureSpec(canonicalJson(timeoutDrift)),
    "capture_spec.action_timeout",
  );

  for (const canary of ["source", "operator", "seed", "run", "host", "path"]) {
    const candidate = clone(captureSpecFixture);
    Object.assign(candidate.execution, { [canary]: "canary" });
    assert.throws(() => parseCaptureSpec(canonicalJson(candidate)), {
      name: "ContractValidationError",
    });
  }
});

test("capture spec names the complete Playwright closure and live browser identity", () => {
  const renamedPackage = clone(captureSpecFixture);
  renamedPackage.software.playwright.packages.playwright_core.name = "driver";
  assert.throws(() => parseCaptureSpec(canonicalJson(renamedPackage)), {
    name: "ContractValidationError",
  });

  const omittedPackage = clone(captureSpecFixture);
  Reflect.deleteProperty(
    omittedPackage.software.playwright.packages,
    "playwright_core",
  );
  assert.throws(() => parseCaptureSpec(canonicalJson(omittedPackage)), {
    name: "ContractValidationError",
  });

  const packageVersionDrift = clone(captureSpecFixture);
  packageVersionDrift.software.playwright.packages.playwright.version = "1.61.2";
  assert.throws(() => parseCaptureSpec(canonicalJson(packageVersionDrift)), {
    name: "ContractValidationError",
  });

  const malformedTreeDigest = clone(captureSpecFixture);
  malformedTreeDigest.software.playwright.installed_file_tree_sha256 = digest("A");
  assert.throws(() => parseCaptureSpec(canonicalJson(malformedTreeDigest)), {
    name: "ContractValidationError",
  });

  const registryRevisionAsSourceRevision = clone(captureSpecFixture);
  registryRevisionAsSourceRevision.software.browser.source_revision = "1228";
  assert.throws(
    () => parseCaptureSpec(canonicalJson(registryRevisionAsSourceRevision)),
    { name: "ContractValidationError" },
  );

  const distributionDrift = clone(captureSpecFixture);
  distributionDrift.software.browser.distribution = "chromium";
  assert.throws(() => parseCaptureSpec(canonicalJson(distributionDrift)), {
    name: "ContractValidationError",
  });

  const registryRevisionDrift = clone(captureSpecFixture);
  registryRevisionDrift.software.browser.playwright_registry_revision = "1229";
  assert.throws(() => parseCaptureSpec(canonicalJson(registryRevisionDrift)), {
    name: "ContractValidationError",
  });

  const unboundLaunch = clone(captureSpecFixture);
  Reflect.deleteProperty(unboundLaunch.software.browser, "launch_profile_sha256");
  assert.throws(() => parseCaptureSpec(canonicalJson(unboundLaunch)), {
    name: "ContractValidationError",
  });

  const unboundBrowserFiles = clone(captureSpecFixture);
  Reflect.deleteProperty(
    unboundBrowserFiles.software.browser,
    "installation_file_tree_sha256",
  );
  assert.throws(() => parseCaptureSpec(canonicalJson(unboundBrowserFiles)), {
    name: "ContractValidationError",
  });

  const ambiguousLegacyDigest = clone(captureSpecFixture);
  Object.assign(ambiguousLegacyDigest.software, {
    playwright_package_sha256: digest("8"),
  });
  assert.throws(() => parseCaptureSpec(canonicalJson(ambiguousLegacyDigest)), {
    name: "ContractValidationError",
  });
});

test("capture spec separates honest host execution from attested OCI execution", () => {
  const fakeHostDigest = clone(captureSpecFixture);
  Object.assign(fakeHostDigest.execution, {
    image_digest: `sha256:${digest("4")}`,
  });
  assert.throws(() => parseCaptureSpec(canonicalJson(fakeHostDigest)), {
    name: "ContractValidationError",
  });

  const oci = clone(captureSpecFixture) as Omit<
    typeof captureSpecFixture,
    "execution"
  > & {
    execution: {
      kind: string;
      platform: string;
      image_digest: string;
      attestation: {
        kind: string;
        statement_format: string;
        statement_sha256: string;
      };
    };
  };
  oci.execution = {
    kind: "oci",
    platform: "linux/amd64",
    image_digest: `sha256:${digest("4")}`,
    attestation: {
      kind: "trusted-orchestrator",
      statement_format: "in-toto-statement-v1",
      statement_sha256: digest("5"),
    },
  };
  assert.equal(parseCaptureSpec(canonicalJson(oci)).execution.kind, "oci");

  const unattested = clone(oci);
  Reflect.deleteProperty(unattested.execution, "attestation");
  assert.throws(() => parseCaptureSpec(canonicalJson(unattested)), {
    name: "ContractValidationError",
  });
});

test("capture spec defines a complete, sorted font file set", () => {
  const secondFont = {
    logical_name: "symbols-variable-normal",
    format: "woff2",
    sha256: digest("6"),
    byte_length: 32_768,
  };
  const sorted = clone(captureSpecFixture);
  sorted.fonts.files.push(secondFont);
  assert.equal(parseCaptureSpec(canonicalJson(sorted)).fonts.files.length, 2);

  const duplicate = clone(sorted);
  duplicate.fonts.files[1]!.logical_name = duplicate.fonts.files[0]!.logical_name;
  assertContractIssue(
    () => parseCaptureSpec(canonicalJson(duplicate)),
    "capture_spec.duplicate_font",
  );

  const unsorted = clone(captureSpecFixture);
  unsorted.fonts.files.unshift(secondFont);
  assertContractIssue(
    () => parseCaptureSpec(canonicalJson(unsorted)),
    "capture_spec.font_order",
  );

  const opaqueBundleDigest = clone(captureSpecFixture);
  Object.assign(opaqueBundleDigest.fonts, { bundle_sha256: digest("7") });
  assert.throws(() => parseCaptureSpec(canonicalJson(opaqueBundleDigest)), {
    name: "ContractValidationError",
  });
});

test("capture spec keeps v1 only as an explicit pre-release reset", () => {
  assert.match(captureSpecSchema.description, /Pre-release v1 reset/u);
  const v2 = clone(captureSpecFixture);
  v2.version = 2;
  assert.throws(() => parseCaptureSpec(canonicalJson(v2)), {
    name: "ContractValidationError",
  });
});

test("capture spec byte budget is enforced before schema validation", () => {
  const oversized = clone(captureSpecFixture) as typeof captureSpecFixture & {
    canary: string;
  };
  oversized.canary = "x".repeat(70_000);
  assert.throws(
    () => parseCaptureSpec(canonicalJson(oversized)),
    (error: unknown) =>
      error instanceof CanonicalJsonError && error.code === "json.byte_length",
  );
});

test("accessibility graph rejects raw CDP canaries and unsorted state", () => {
  for (const canary of ["nodeId", "backendDOMNodeId", "selector", "className"]) {
    const candidate = clone(accessibilityFixture);
    Object.assign(candidate.nodes[1] as object, { [canary]: "canary" });
    assert.throws(() => parseAccessibilitySnapshot(canonicalJson(candidate)), {
      name: "ContractValidationError",
    });
  }

  const unsorted = clone(accessibilityFixture);
  unsorted.nodes[2]!.states = ["required", "focused"];
  assertContractIssue(
    () => parseAccessibilitySnapshot(canonicalJson(unsorted)),
    "accessibility.state_order",
  );

  const oversizedName = clone(accessibilityFixture);
  oversizedName.nodes[2]!.name = "x".repeat(513);
  assert.throws(() => parseAccessibilitySnapshot(canonicalJson(oversizedName)), {
    name: "ContractValidationError",
  });
});

test("accessibility graph rejects dangling, reopened, and overdeep trees", () => {
  const dangling = clone(accessibilityFixture);
  dangling.nodes[2]!.parent_index = 99;
  assertContractIssue(
    () => parseAccessibilitySnapshot(canonicalJson(dangling)),
    "accessibility.dangling_parent",
  );

  const reopened = clone(accessibilityFixture);
  reopened.nodes[2]!.parent_index = 0;
  reopened.nodes[2]!.child_ordinal = 1;
  reopened.nodes[3]!.parent_index = 1;
  reopened.nodes[3]!.child_ordinal = 0;
  assertContractIssue(
    () => parseAccessibilitySnapshot(canonicalJson(reopened)),
    "accessibility.preorder",
  );

  const overdeep = {
    contract: "impactdiff.accessibility",
    version: 1,
    root_index: 0,
    nodes: Array.from({ length: 66 }, (_, index) => ({
      index,
      parent_index: index === 0 ? null : index - 1,
      child_ordinal: 0,
      role: index === 0 ? "document" : "generic",
      name: "",
      description: null,
      value: null,
      states: [],
      layout_node_index: null,
    })),
  };
  assertContractIssue(
    () => parseAccessibilitySnapshot(canonicalJson(overdeep)),
    "accessibility.depth",
  );
});

test("layout graph rejects raw DOM canaries and ambiguous targets", () => {
  for (const canary of ["attributes", "selector", "className", "outerHTML", "path"]) {
    const candidate = clone(layoutFixture);
    Object.assign(candidate.nodes[1] as object, { [canary]: "canary" });
    assert.throws(() => parseLayoutSnapshot(canonicalJson(candidate)), {
      name: "ContractValidationError",
    });
  }

  const duplicateTarget = clone(layoutFixture);
  duplicateTarget.nodes[1]!.action_target_id = id("idat1_", "a");
  assertContractIssue(
    () => parseLayoutSnapshot(canonicalJson(duplicateTarget)),
    "layout.duplicate_action_target",
  );

  const textTarget = clone(layoutFixture);
  textTarget.nodes[4]!.action_target_id = id("idat1_", "c");
  assertContractIssue(
    () => parseLayoutSnapshot(canonicalJson(textTarget)),
    "layout.action_target_kind",
  );

  const rawComputedStyle = clone(layoutFixture);
  Object.assign(rawComputedStyle.nodes[1]!.computed_style, {
    color: "rgb(0 0 0)",
  });
  assert.throws(() => parseLayoutSnapshot(canonicalJson(rawComputedStyle)), {
    name: "ContractValidationError",
  });
});

test("cross-graph binding permits dynamic targets but rejects undeclared IDs and dangling AX links", () => {
  const actionPlan = parseActionPlan(canonicalJson(actionPlanFixture));
  const accessibility = parseAccessibilitySnapshot(canonicalJson(accessibilityFixture));
  const layout = parseLayoutSnapshot(canonicalJson(layoutFixture));

  const dynamicTargetFixture = clone(layoutFixture);
  dynamicTargetFixture.nodes[2]!.action_target_id = null;
  dynamicTargetFixture.nodes[3]!.action_target_id = null;
  const dynamicTargetCheckpoint = parseLayoutSnapshot(
    canonicalJson(dynamicTargetFixture),
  );
  assert.doesNotThrow(() =>
    assertCaptureGraphBindings(actionPlan, accessibility, dynamicTargetCheckpoint),
  );

  const extraTargetFixture = clone(layoutFixture);
  extraTargetFixture.nodes[1]!.action_target_id = id("idat1_", "c");
  const extraTarget = parseLayoutSnapshot(canonicalJson(extraTargetFixture));
  assertContractIssue(
    () => assertCaptureGraphBindings(actionPlan, accessibility, extraTarget),
    "capture_binding.unexpected_action_target",
  );

  const danglingLinkFixture = clone(accessibilityFixture);
  danglingLinkFixture.nodes[4]!.layout_node_index = 99;
  const danglingLink = parseAccessibilitySnapshot(canonicalJson(danglingLinkFixture));
  assertContractIssue(
    () => assertCaptureGraphBindings(actionPlan, danglingLink, layout),
    "capture_binding.dangling_layout_link",
  );
});

test("fractional and noncanonical JSON never reach a payload schema", () => {
  const fractional = JSON.stringify({
    ...accessibilityFixture,
    nodes: [
      { ...accessibilityFixture.nodes[0], index: 0.5 },
      ...accessibilityFixture.nodes.slice(1),
    ],
  });
  assert.throws(
    () => parseAccessibilitySnapshot(fractional),
    (error: unknown) =>
      error instanceof CanonicalJsonError && error.code === "json.non_integer_number",
  );

  assert.throws(
    () => parseActionPlan(JSON.stringify(actionPlanFixture, null, 2)),
    (error: unknown) =>
      error instanceof CanonicalJsonError && error.code === "json.noncanonical",
  );
});

test("production capture codecs preserve only strict canonical payloads", async () => {
  for (const [codec, fixture] of [
    [actionPlanCodec, actionPlanFixture],
    [captureSpecCodec, captureSpecFixture],
    [accessibilityCodec, accessibilityFixture],
    [layoutCodec, layoutFixture],
  ] as const) {
    const bytes = Buffer.from(canonicalJson(fixture), "utf8");
    const canonical = Buffer.from(await codec.canonicalize(bytes));
    const decoded = await codec.validate(canonical);

    assert.deepEqual(canonical, bytes);
    assert.equal(canonicalJson(decoded), canonicalJson(fixture));
    assert.throws(
      () => codec.canonicalize(Buffer.from(JSON.stringify(fixture, null, 2))),
      (error: unknown) =>
        error instanceof CanonicalJsonError && error.code === "json.noncanonical",
    );
  }
});
