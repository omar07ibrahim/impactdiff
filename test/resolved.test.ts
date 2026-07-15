import assert from "node:assert/strict";
import test from "node:test";

import { PNG } from "pngjs";

import { canonicalizePng } from "../src/artifacts/png.js";
import {
  canonicalJson,
  canonicalSha256,
  computeCaptureId,
  computeCheckpointId,
  computeEnvironmentId,
  computeEvidenceId,
  computeFeatureProfileId,
  computeMutationFamilyGroupId,
  computeSealedRecordId,
  computeSourceStateGroupId,
  computeSourceStateId,
  computeTaskId,
  sha256Hex,
} from "../src/contracts/canonical.js";
import { ContractValidationError } from "../src/contracts/errors.js";
import {
  validateResolvedEvidenceBundle,
  validateResolvedInterventionBundle,
} from "../src/contracts/resolved.js";
import {
  compileMutation,
  computeMutationInstanceId,
  computeMutationTargetNodeId,
  computeSourceProbeFingerprint,
} from "../src/mutations/index.js";
import type { MutationRequest, SourceProbe } from "../src/mutations/index.js";

const digest = (character: string): string => character.repeat(64);
const id = (prefix: string, character: string): string =>
  `${prefix}${digest(character)}`;
const clone = <T>(value: T): T => structuredClone(value);

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value), "utf8");
}

function reference<const MediaType extends string>(
  mediaType: MediaType,
  bytes: Uint8Array,
) {
  return {
    sha256: sha256Hex(bytes),
    byte_length: bytes.byteLength,
    media_type: mediaType,
    format_version: 1 as const,
  };
}

const resolvedSourceState = {
  contract: "impactdiff.source-state",
  version: 1,
  source: {
    kind: "closed_fixture",
    fixture_id: "resolved-fixture-v1",
    revision: "resolved-fixture-v1.0.0",
    license: "Apache-2.0",
    entrypoint: "index.html",
    raw_manifest: {
      sha256: digest("a"),
      byte_length: 512,
    },
    resources: [
      {
        path: "index.html",
        media_type: "text/html; charset=utf-8",
        sha256: digest("b"),
        byte_length: 256,
        license: "Apache-2.0",
      },
    ],
  },
  initial_state: {
    kind: "fixture_default",
    route: "/",
    storage: "empty",
  },
} as const;
const resolvedSourceStateBytes = canonicalBytes(resolvedSourceState);
const resolvedSourceStateRef = reference(
  "application/vnd.impactdiff.source-state+json",
  resolvedSourceStateBytes,
);

const actionTargetId = id("idat1_", "a");

const baseActionPlan = {
  contract: "impactdiff.action-plan",
  version: 1,
  actions: [
    {
      action_id: id("idst1_", "1"),
      ordinal: 0,
      intent: "press_key",
      target_id: null,
      value: { kind: "key", key: "Enter" },
    },
    {
      action_id: id("idst1_", "2"),
      ordinal: 1,
      intent: "pointer_click",
      target_id: actionTargetId,
      value: { kind: "pointer", button: "primary" },
    },
  ],
  checkpoints: [
    { ordinal: 0, after_action_ordinal: -1 },
    { ordinal: 1, after_action_ordinal: 1 },
  ],
} as const;

const captureSpec = {
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
        sha256: digest("4"),
        byte_length: 59_928,
      },
    ],
    loading: "document-fonts-ready",
    fallback_policy: "closed-bundle-only",
  },
  display: {
    viewport: { width: 320, height: 240 },
    screen: { width: 320, height: 240 },
    device_scale_factor: 1,
  },
  internationalization: { locale: "en-US", timezone_id: "UTC" },
  media: {
    color_scheme: "light",
    reduced_motion: "reduce",
    forced_colors: "none",
  },
  clock: { epoch_ms: 1_735_689_600_000, progression: "explicit-only" },
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
} as const;

const style = {
  display: "block",
  position: "static",
  visibility: "visible",
  pointer_events: "auto",
  overflow_x: "visible",
  overflow_y: "visible",
  opacity_milli: 1_000,
  z_index: null,
} as const;

function accessibilitySnapshot(name: string) {
  return {
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
        role: "button",
        name,
        description: null,
        value: null,
        states: [],
        layout_node_index: 1,
      },
    ],
  };
}

function layoutSnapshot(xQ64: number, targetId: string | null = actionTargetId) {
  return {
    contract: "impactdiff.layout",
    version: 1,
    root_index: 0,
    nodes: [
      {
        index: 0,
        parent_index: null,
        child_ordinal: 0,
        kind: "document",
        bounds: {
          x_q64: 0,
          y_q64: 0,
          width_q64: 20_480,
          height_q64: 15_360,
        },
        clip_bounds: {
          x_q64: 0,
          y_q64: 0,
          width_q64: 20_480,
          height_q64: 15_360,
        },
        paint_order: 0,
        computed_style: style,
        action_target_id: null,
      },
      {
        index: 1,
        parent_index: 0,
        child_ordinal: 0,
        kind: "element",
        bounds: {
          x_q64: xQ64,
          y_q64: 6_400,
          width_q64: 7_680,
          height_q64: 3_072,
        },
        clip_bounds: null,
        paint_order: 1,
        computed_style: style,
        action_target_id: targetId,
      },
    ],
  };
}

function screenshot(red: number, width = 320, height = 240): Buffer {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = red;
    image.data[offset + 1] = 80;
    image.data[offset + 2] = 160;
    image.data[offset + 3] = 255;
  }
  return canonicalizePng(PNG.sync.write(image)).bytes;
}

interface CheckpointPayload {
  readonly screenshot: Buffer;
  readonly accessibility_tree: Buffer;
  readonly layout_graph: Buffer;
}

function checkpointPayload(
  discriminator: number,
  dimensions: { readonly width: number; readonly height: number } = {
    width: 320,
    height: 240,
  },
): CheckpointPayload {
  return {
    screenshot: screenshot(20 + discriminator, dimensions.width, dimensions.height),
    accessibility_tree: canonicalBytes(
      accessibilitySnapshot(`Place order ${discriminator}`),
    ),
    layout_graph: canonicalBytes(layoutSnapshot(4_000 + discriminator)),
  };
}

function manifestCheckpoint(
  actionPlanRef: ReturnType<typeof reference>,
  payload: CheckpointPayload,
  ordinal: number,
) {
  return {
    checkpoint_id: computeCheckpointId(actionPlanRef, ordinal),
    ordinal,
    screenshot: reference("image/png", payload.screenshot),
    accessibility_tree: reference(
      "application/vnd.impactdiff.accessibility+json",
      payload.accessibility_tree,
    ),
    layout_graph: reference(
      "application/vnd.impactdiff.layout+json",
      payload.layout_graph,
    ),
  };
}

function capture(
  role: "baseline" | "candidate",
  actionPlanRef: ReturnType<typeof reference>,
  payloads: readonly CheckpointPayload[],
) {
  const draft = {
    capture_id: id("idcp1_", "0"),
    role,
    checkpoints: payloads.map((payload, ordinal) =>
      manifestCheckpoint(actionPlanRef, payload, ordinal),
    ),
  };
  return { ...draft, capture_id: computeCaptureId(draft) };
}

interface EvidenceOptions {
  readonly actionPlan?: unknown;
  readonly mismatchedPng?: boolean;
  readonly baselinePayloads?: readonly CheckpointPayload[];
  readonly candidatePayloads?: readonly CheckpointPayload[];
}

function evidenceBundle(options: EvidenceOptions = {}) {
  const actionPlanValue = options.actionPlan ?? baseActionPlan;
  const actionPlanBytes = canonicalBytes(actionPlanValue);
  const captureSpecBytes = canonicalBytes(captureSpec);
  const actionPlanRef = reference(
    "application/vnd.impactdiff.action-plan+json",
    actionPlanBytes,
  );
  const captureSpecRef = reference(
    "application/vnd.impactdiff.capture-spec+json",
    captureSpecBytes,
  );
  const sourceStateRef = resolvedSourceStateRef;
  const baselinePayloads =
    options.baselinePayloads === undefined
      ? [
          checkpointPayload(
            1,
            options.mismatchedPng
              ? { width: 321, height: 240 }
              : { width: 320, height: 240 },
          ),
          checkpointPayload(2),
        ]
      : [...options.baselinePayloads];
  const candidatePayloads =
    options.candidatePayloads === undefined
      ? [checkpointPayload(3), checkpointPayload(4)]
      : [...options.candidatePayloads];
  const baseline = capture("baseline", actionPlanRef, baselinePayloads);
  const candidate = capture("candidate", actionPlanRef, candidatePayloads);
  const draft = {
    contract: "impactdiff.evidence",
    version: 1,
    evidence_id: id("idev1_", "0"),
    feature_profile_id: computeFeatureProfileId(captureSpecRef),
    source_state_id: computeSourceStateId(sourceStateRef),
    task: {
      task_id: computeTaskId(actionPlanRef),
      action_plan: actionPlanRef,
    },
    environment: {
      environment_id: computeEnvironmentId(captureSpecRef),
      capture_spec: captureSpecRef,
    },
    pair: { baseline, candidate },
  };
  const manifest = {
    ...draft,
    evidence_id: computeEvidenceId(draft),
  };
  return {
    manifest,
    action_plan: actionPlanBytes,
    capture_spec: captureSpecBytes,
    pair: {
      baseline: { checkpoints: baselinePayloads },
      candidate: { checkpoints: candidatePayloads },
    },
  };
}

function highMultiplicityActionPlan() {
  return {
    contract: "impactdiff.action-plan",
    version: 1,
    actions: Array.from({ length: 15 }, (_, ordinal) => ({
      action_id: id("idst1_", ordinal.toString(16)),
      ordinal,
      intent: "press_key",
      target_id: null,
      value: { kind: "key", key: "Enter" },
    })),
    checkpoints: Array.from({ length: 16 }, (_, ordinal) => ({
      ordinal,
      after_action_ordinal: ordinal - 1,
    })),
  };
}

function highMultiplicityEvidence(distinctScreenshotCopies = false) {
  const screenshotBytes = Buffer.alloc(512 * 1_024);
  const accessibilityBytes = canonicalBytes(accessibilitySnapshot("Repeated"));
  const layoutBytes = canonicalBytes(layoutSnapshot(4_000, null));
  const repeated = Array.from({ length: 32 }, (): CheckpointPayload => ({
    screenshot: distinctScreenshotCopies
      ? Buffer.from(screenshotBytes)
      : screenshotBytes,
    accessibility_tree: accessibilityBytes,
    layout_graph: layoutBytes,
  }));
  return evidenceBundle({
    actionPlan: highMultiplicityActionPlan(),
    baselinePayloads: repeated.slice(0, 16),
    candidatePayloads: repeated.slice(16),
  });
}

function arbitraryReference<const MediaType extends string>(
  mediaType: MediaType,
  contents: string,
) {
  return reference(mediaType, Buffer.from(contents, "utf8"));
}

function mutationRequest(
  manifest: ReturnType<typeof evidenceBundle>["manifest"],
  overrides: Partial<
    Pick<MutationRequest, "source_state_id" | "task_id" | "environment_id">
  > = {},
): MutationRequest {
  const sourceStateId = overrides.source_state_id ?? manifest.source_state_id;
  const locator = { strategy: "test_id" as const, value: "place-order" };
  return {
    contract: "impactdiff.mutation-request",
    version: 1,
    source_state_id: sourceStateId,
    task_id: overrides.task_id ?? manifest.task.task_id,
    environment_id: overrides.environment_id ?? manifest.environment.environment_id,
    operator_key: "pointer_interceptor",
    operator_version: 1,
    replicate_index: 0,
    target: {
      node_id: computeMutationTargetNodeId(sourceStateId, locator),
      locator,
    },
  };
}

function sourceProbe(request: MutationRequest): SourceProbe {
  const draft = {
    contract: "impactdiff.mutation-probe",
    version: 1,
    probe_fingerprint_sha256: digest("0"),
    instance_id: computeMutationInstanceId(request),
    source_state_id: request.source_state_id,
    task_id: request.task_id,
    environment_id: request.environment_id,
    runtime_clean: true,
    target: {
      resolution_count: 1,
      resolved_node_id: request.target.node_id,
      visible: true,
      in_viewport: true,
      bounds: {
        x: 10_000,
        y: 20_000,
        width: 120_000,
        height: 48_000,
        scale: 1_000,
      },
      center_hit_node_id: request.target.node_id,
      used_by_task: true,
    },
    palette: {
      source_profile: null,
      candidate_palette_sha256: null,
      contrast_pairs: null,
    },
  } as const satisfies SourceProbe;
  return {
    ...draft,
    probe_fingerprint_sha256: computeSourceProbeFingerprint(draft),
  };
}

interface InterventionOptions {
  readonly request?: Partial<
    Pick<MutationRequest, "source_state_id" | "task_id" | "environment_id">
  >;
  readonly recordIntervention?: Partial<{
    readonly family_id: string;
    readonly operator_id: string;
    readonly operator_version: number;
    readonly instance_id: string;
    readonly expected_task_relation: "preserve" | "break";
  }>;
}

function interventionBundle(
  evidence = evidenceBundle(),
  options: InterventionOptions = {},
) {
  const request = mutationRequest(evidence.manifest, options.request);
  const compilation = compileMutation(request, sourceProbe(request));
  assert.equal(compilation.status, "applicable");
  const mutationPlanBytes = canonicalBytes(compilation.plan);
  const preconditionBytes = canonicalBytes(compilation.preconditions);
  const intervention = {
    family_id:
      options.recordIntervention?.family_id ?? compilation.plan.operator.family_id,
    operator_id:
      options.recordIntervention?.operator_id ?? compilation.plan.operator.operator_id,
    operator_version:
      options.recordIntervention?.operator_version ??
      compilation.plan.operator.operator_version,
    instance_id:
      options.recordIntervention?.instance_id ?? compilation.plan.instance_id,
    parameters: reference(
      "application/vnd.impactdiff.intervention-parameters+json",
      mutationPlanBytes,
    ),
    preconditions: reference(
      "application/vnd.impactdiff.intervention-preconditions+json",
      preconditionBytes,
    ),
    changed_surface: arbitraryReference(
      "application/vnd.impactdiff.changed-surface+json",
      "changed-surface",
    ),
    expected_task_relation:
      options.recordIntervention?.expected_task_relation ??
      compilation.plan.operator.expected_task_relation,
  };
  const outcome = {
    task_success: true,
    final_state_oracle: arbitraryReference(
      "application/vnd.impactdiff.oracle-result+json",
      "final-oracle",
    ),
    accessibility_oracle: arbitraryReference(
      "application/vnd.impactdiff.oracle-result+json",
      "accessibility-oracle",
    ),
    raw_trace: arbitraryReference(
      "application/vnd.impactdiff.raw-trace+json",
      "raw-trace",
    ),
    first_unsatisfied_step_id: null,
    recovery_actions: 0,
    virtual_elapsed_ms: 1_250,
  } as const;
  const recordDraft = {
    contract: "impactdiff.sealed-record",
    version: 1,
    sealed_record_id: id("idsr1_", "0"),
    evidence_id: evidence.manifest.evidence_id,
    evidence_manifest_sha256: canonicalSha256(evidence.manifest),
    label_policy_id: id("idlp1_", "b"),
    provenance: {
      source_state: resolvedSourceStateRef,
    },
    grouping: {
      application_group_id: id("idag1_", "1"),
      source_state_group_id: computeSourceStateGroupId(
        evidence.manifest.source_state_id,
      ),
      source_task_group_id: id("idtg1_", "3"),
      near_duplicate_group_id: id("idng1_", "4"),
      asset_component_id: id("idac1_", "5"),
      mutation_family_group_id: computeMutationFamilyGroupId(intervention.family_id),
    },
    intervention,
    execution: { baseline: outcome, candidate: outcome },
    labels: {
      sample_valid: true,
      invalid_reason: null,
      task_regression: false,
      severity_ordinal: 0,
      first_failed_step_id: null,
      localization: null,
    },
  };
  const sealedRecord = {
    ...recordDraft,
    sealed_record_id: computeSealedRecordId(recordDraft),
  };
  return {
    manifest: evidence.manifest,
    sealed_record: sealedRecord,
    source_state: Buffer.from(resolvedSourceStateBytes),
    mutation_plan: mutationPlanBytes,
    precondition_report: preconditionBytes,
  };
}

function expectIssue(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ContractValidationError);
    assert.ok(
      error.issues.some((candidate) => candidate.code === code),
      `expected ${code}, received ${error.issues.map((item) => item.code).join(", ")}`,
    );
    return true;
  });
}

test("a genuine two-checkpoint 320x240 resolved evidence bundle validates", () => {
  const result = validateResolvedEvidenceBundle(evidenceBundle());

  assert.equal(result.action_plan.checkpoints.length, 2);
  assert.equal(result.capture_spec.display.viewport.width, 320);
  assert.equal(result.pair.baseline[0]?.screenshot.height, 240);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.pair));
  assert.ok(Object.isFrozen(result.pair.candidate));
  assert.ok(Object.isFrozen(result.pair.candidate[1]));
});

test("resolved evidence rejects schedule count and swapped checkpoint bytes", () => {
  const missing = evidenceBundle();
  missing.pair.baseline.checkpoints.pop();
  expectIssue(
    () => validateResolvedEvidenceBundle(missing),
    "resolved.checkpoint_count",
  );

  const original = evidenceBundle();
  const first = original.pair.baseline.checkpoints[0]!;
  const second = original.pair.baseline.checkpoints[1]!;
  const swapped = {
    ...original,
    pair: {
      ...original.pair,
      baseline: {
        checkpoints: [
          { ...first, screenshot: second.screenshot },
          { ...second, screenshot: first.screenshot },
        ],
      },
    },
  };
  expectIssue(() => validateResolvedEvidenceBundle(swapped), "resolved.ref_digest");
});

test("resolved evidence binds PNG dimensions and checkpoint target provenance", () => {
  expectIssue(
    () => validateResolvedEvidenceBundle(evidenceBundle({ mismatchedPng: true })),
    "resolved.png_dimensions",
  );

  const dynamicActionTarget = {
    ...clone(baseActionPlan),
    actions: [
      {
        action_id: id("idst1_", "1"),
        ordinal: 0,
        intent: "focus",
        target_id: id("idat1_", "f"),
        value: { kind: "none" },
      },
      clone(baseActionPlan.actions[1]),
    ],
  };
  assert.doesNotThrow(() =>
    validateResolvedEvidenceBundle(evidenceBundle({ actionPlan: dynamicActionTarget })),
  );

  const undeclaredLayoutTarget = {
    ...clone(baseActionPlan),
    actions: [
      clone(baseActionPlan.actions[0]),
      { ...clone(baseActionPlan.actions[1]), target_id: id("idat1_", "f") },
    ],
  };
  expectIssue(
    () =>
      validateResolvedEvidenceBundle(
        evidenceBundle({ actionPlan: undeclaredLayoutTarget }),
      ),
    "capture_binding.unexpected_action_target",
  );
});

test("resolved wrappers reject extra fields, sparse arrays, and oversized bytes", () => {
  const extra = Object.assign(evidenceBundle(), { path: "/tmp/canary" });
  expectIssue(
    () => validateResolvedEvidenceBundle(extra),
    "resolved.wrapper_extra_property",
  );

  const sparse = evidenceBundle();
  sparse.pair.baseline.checkpoints.length = 16;
  expectIssue(
    () => validateResolvedEvidenceBundle(sparse),
    "resolved.wrapper_sparse_array",
  );

  const hostileLength = evidenceBundle();
  hostileLength.pair.candidate.checkpoints.length = 0xffff_ffff;
  expectIssue(
    () => validateResolvedEvidenceBundle(hostileLength),
    "resolved.wrapper_array_length",
  );

  const oversized = evidenceBundle();
  const shadowedLength = new Uint8Array(131_073);
  Object.defineProperty(shadowedLength, "byteLength", { value: 1 });
  oversized.action_plan = shadowedLength as Buffer;
  expectIssue(
    () => validateResolvedEvidenceBundle(oversized),
    "resolved.wrapper_byte_length",
  );
});

test("resolved evidence rejects manifest and count failures before artifact snapshots", () => {
  const invalidManifestBundle = highMultiplicityEvidence();
  const invalidManifest = {
    ...invalidManifestBundle,
    manifest: { ...invalidManifestBundle.manifest, debug_path: "/tmp/canary" },
  };
  const manifestExternalBefore = process.memoryUsage().external;
  expectIssue(
    () => validateResolvedEvidenceBundle(invalidManifest),
    "schema.additionalProperties",
  );
  const manifestExternalGrowth =
    process.memoryUsage().external - manifestExternalBefore;
  assert.ok(
    manifestExternalGrowth < 4 * 1_024 * 1_024,
    `invalid manifest retained ${manifestExternalGrowth} external bytes`,
  );

  const countMismatch = highMultiplicityEvidence();
  countMismatch.pair.candidate.checkpoints.pop();
  const countExternalBefore = process.memoryUsage().external;
  expectIssue(
    () => validateResolvedEvidenceBundle(countMismatch),
    "resolved.checkpoint_count",
  );
  const countExternalGrowth = process.memoryUsage().external - countExternalBefore;
  assert.ok(
    countExternalGrowth < 4 * 1_024 * 1_024,
    `invalid checkpoint count retained ${countExternalGrowth} external bytes`,
  );
});

test("resolved evidence snapshots high-multiplicity repeated refs only once", () => {
  const bundle = highMultiplicityEvidence(true);

  const externalBefore = process.memoryUsage().external;
  expectIssue(() => validateResolvedEvidenceBundle(bundle), "png.signature");
  const externalGrowth = process.memoryUsage().external - externalBefore;

  assert.ok(
    externalGrowth < 8 * 1_024 * 1_024,
    `repeated artifact snapshots retained ${externalGrowth} external bytes`,
  );
});

test("resolved evidence rejects conflicting bytes for one repeated ref", () => {
  const shared = checkpointPayload(9);
  const bundle = evidenceBundle({
    baselinePayloads: [shared, shared],
    candidatePayloads: [shared, shared],
  });
  const conflictingScreenshot = Buffer.from(shared.screenshot);
  const lastByte = conflictingScreenshot.length - 1;
  conflictingScreenshot[lastByte] = conflictingScreenshot[lastByte]! ^ 1;
  const conflict = {
    ...bundle,
    pair: {
      ...bundle.pair,
      candidate: {
        checkpoints: [
          {
            ...bundle.pair.candidate.checkpoints[0]!,
            screenshot: conflictingScreenshot,
          },
          bundle.pair.candidate.checkpoints[1]!,
        ],
      },
    },
  };

  expectIssue(() => validateResolvedEvidenceBundle(conflict), "resolved.ref_digest");
});

test("resolved intervention accepts canonical plan and precondition bytes", () => {
  const result = validateResolvedInterventionBundle(interventionBundle());

  assert.equal(result.mutation_plan.operator.expected_task_relation, "break");
  assert.deepEqual(result.source_state, resolvedSourceState);
  assert.equal(result.precondition_report.applicable, true);
  assert.equal(result.probe.target.used_by_task, true);
  assert.ok(Object.isFrozen(result));
});

test("resolved intervention rejects every manifest request binding tamper", () => {
  for (const [field, value, code] of [
    ["source_state_id", id("idss1_", "9"), "resolved.request_source_state_id"],
    ["task_id", id("idtk1_", "9"), "resolved.request_task_id"],
    ["environment_id", id("iden1_", "9"), "resolved.request_environment_id"],
  ] as const) {
    expectIssue(
      () =>
        validateResolvedInterventionBundle(
          interventionBundle(evidenceBundle(), { request: { [field]: value } }),
        ),
      code,
    );
  }
});

test("resolved intervention rejects every sealed intervention binding tamper", () => {
  for (const [field, value, code] of [
    ["family_id", id("idmf1_", "9"), "resolved.intervention_family_id"],
    ["operator_id", id("idop1_", "9"), "resolved.intervention_operator_id"],
    ["operator_version", 2, "resolved.intervention_operator_version"],
    ["instance_id", id("idmi1_", "9"), "resolved.intervention_instance_id"],
    [
      "expected_task_relation",
      "preserve",
      "resolved.intervention_expected_task_relation",
    ],
  ] as const) {
    expectIssue(
      () =>
        validateResolvedInterventionBundle(
          interventionBundle(evidenceBundle(), {
            recordIntervention: { [field]: value },
          }),
        ),
      code,
    );
  }
});

test("resolved intervention binds the exact plan and precondition references", () => {
  const bundle = interventionBundle();
  const swapped = {
    ...bundle,
    mutation_plan: bundle.precondition_report,
    precondition_report: bundle.mutation_plan,
  };
  expectIssue(
    () => validateResolvedInterventionBundle(swapped),
    "resolved.ref_byte_length",
  );

  const tamperedPlan = Buffer.from(bundle.mutation_plan);
  tamperedPlan[tamperedPlan.length - 1] = 0x20;
  expectIssue(
    () =>
      validateResolvedInterventionBundle({
        ...bundle,
        mutation_plan: tamperedPlan,
      }),
    "resolved.ref_digest",
  );

  const tamperedSource = Buffer.from(bundle.source_state);
  tamperedSource[tamperedSource.length - 1] = 0x20;
  expectIssue(
    () =>
      validateResolvedInterventionBundle({
        ...bundle,
        source_state: tamperedSource,
      }),
    "resolved.ref_digest",
  );
});
