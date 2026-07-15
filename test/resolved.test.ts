import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  parseCanonicalJson,
  sha256Hex,
} from "../src/contracts/canonical.js";
import { ContractValidationError } from "../src/contracts/errors.js";
import { validateResolvedEvidenceRecordBundle } from "../src/contracts/resolved-record.js";
import type { ArtifactRef } from "../src/contracts/artifacts.js";
import { validateEvidenceRecordPair } from "../src/contracts/validate.js";
import {
  validateResolvedEvidenceBundle,
  validateResolvedInterventionBundle,
} from "../src/contracts/resolved.js";
import {
  compileMutation,
  computeMutationInstanceId,
  computeMutationTargetNodeId,
  computeSourceProbeFingerprint,
  validateMutationPlan,
} from "../src/mutations/index.js";
import type { MutationRequest, SourceProbe } from "../src/mutations/index.js";
import {
  PairedPublicationError,
  PairedReleasePublisher,
  verifyPairedRelease,
} from "../src/publication/index.js";
import type {
  PairedReleaseArtifactInput,
  PairedReleaseInput,
} from "../src/publication/index.js";

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

function completeResolvedRecordBundle() {
  const visible = evidenceBundle();
  const intervention = interventionBundle(visible);
  const plan = validateMutationPlan(parseCanonicalJson(intervention.mutation_plan));
  const operation = plan.forward[0];
  assert.equal(operation?.opcode, "install_pointer_interceptor");
  if (operation?.opcode !== "install_pointer_interceptor") {
    throw new Error("expected pointer plan");
  }
  const changedSurface = {
    contract: "impactdiff.changed-surface",
    version: 1,
    plan_id: plan.plan_id,
    instance_id: plan.instance_id,
    affected_node_ids: [plan.request.target.node_id],
    regions_milli_css_px: [operation.rect_milli_css_px],
  } as const;
  const changedSurfaceBytes = canonicalBytes(changedSurface);
  const failedStepId = baseActionPlan.actions[1].action_id;

  const rolePayloads = (role: "baseline" | "candidate") => {
    const captureId = visible.manifest.pair[role].capture_id;
    const finalState = canonicalBytes({
      contract: "impactdiff.oracle-result",
      version: 1,
      role,
      capture_id: captureId,
      task_id: visible.manifest.task.task_id,
      kind: "final_state",
      passed: false,
      observed_state: "review",
    });
    const accessibility = canonicalBytes({
      contract: "impactdiff.oracle-result",
      version: 1,
      role,
      capture_id: captureId,
      task_id: visible.manifest.task.task_id,
      kind: "accessibility",
      passed: false,
      primary_action_count: 0,
      confirmation_count: 0,
    });
    const rawTrace = canonicalBytes({
      contract: "impactdiff.raw-trace",
      version: 1,
      role,
      capture_id: captureId,
      task_id: visible.manifest.task.task_id,
      task_success: false,
      steps: [
        {
          action_id: baseActionPlan.actions[0].action_id,
          ordinal: 0,
          status: "satisfied",
        },
        {
          action_id: failedStepId,
          ordinal: 1,
          status: "unsatisfied",
        },
      ],
      first_unsatisfied_step_id: failedStepId,
      recovery_actions: 0,
      virtual_elapsed_ms: 0,
    });
    return { finalState, accessibility, rawTrace };
  };
  const baseline = rolePayloads("baseline");
  const candidate = rolePayloads("candidate");
  const outcome = (payloads: ReturnType<typeof rolePayloads>) => ({
    task_success: false,
    final_state_oracle: reference(
      "application/vnd.impactdiff.oracle-result+json",
      payloads.finalState,
    ),
    accessibility_oracle: reference(
      "application/vnd.impactdiff.oracle-result+json",
      payloads.accessibility,
    ),
    raw_trace: reference(
      "application/vnd.impactdiff.raw-trace+json",
      payloads.rawTrace,
    ),
    first_unsatisfied_step_id: failedStepId,
    recovery_actions: 0,
    virtual_elapsed_ms: 0,
  });
  const recordDraft = {
    ...intervention.sealed_record,
    sealed_record_id: id("idsr1_", "0"),
    intervention: {
      ...intervention.sealed_record.intervention,
      changed_surface: reference(
        "application/vnd.impactdiff.changed-surface+json",
        changedSurfaceBytes,
      ),
    },
    execution: {
      baseline: outcome(baseline),
      candidate: outcome(candidate),
    },
    labels: {
      sample_valid: false,
      invalid_reason: "baseline_failed",
      task_regression: null,
      severity_ordinal: null,
      first_failed_step_id: null,
      localization: null,
    },
  } as const;
  const sealedRecord = {
    ...recordDraft,
    sealed_record_id: computeSealedRecordId(recordDraft),
  };
  return {
    manifest: visible.manifest,
    sealed_record: sealedRecord,
    action_plan: visible.action_plan,
    capture_spec: visible.capture_spec,
    pair: visible.pair,
    source_state: intervention.source_state,
    mutation_plan: intervention.mutation_plan,
    precondition_report: intervention.precondition_report,
    changed_surface: changedSurfaceBytes,
    execution: {
      baseline: {
        final_state_oracle: baseline.finalState,
        accessibility_oracle: baseline.accessibility,
        raw_trace: baseline.rawTrace,
      },
      candidate: {
        final_state_oracle: candidate.finalState,
        accessibility_oracle: candidate.accessibility,
        raw_trace: candidate.rawTrace,
      },
    },
    localization: null,
  };
}

function addReleaseArtifact(
  artifacts: Map<string, PairedReleaseArtifactInput>,
  referenceValue: ArtifactRef,
  bytes: Uint8Array,
): void {
  assert.equal(sha256Hex(bytes), referenceValue.sha256);
  assert.equal(bytes.byteLength, referenceValue.byte_length);
  const prior = artifacts.get(referenceValue.sha256);
  if (prior === undefined) {
    artifacts.set(referenceValue.sha256, {
      reference: referenceValue,
      bytes,
    });
    return;
  }
  assert.deepEqual(prior.reference, referenceValue);
  assert.deepEqual(Buffer.from(prior.bytes), Buffer.from(bytes));
}

function pairedReleaseInput(
  bundle: ReturnType<
    typeof completeResolvedRecordBundle
  > = completeResolvedRecordBundle(),
): PairedReleaseInput {
  const visible = new Map<string, PairedReleaseArtifactInput>();
  const sealed = new Map<string, PairedReleaseArtifactInput>();
  addReleaseArtifact(visible, bundle.manifest.task.action_plan, bundle.action_plan);
  addReleaseArtifact(
    visible,
    bundle.manifest.environment.capture_spec,
    bundle.capture_spec,
  );
  for (const role of ["baseline", "candidate"] as const) {
    const references = bundle.manifest.pair[role].checkpoints;
    const payloads = bundle.pair[role].checkpoints;
    assert.equal(references.length, payloads.length);
    for (let ordinal = 0; ordinal < references.length; ordinal += 1) {
      const checkpoint = references[ordinal]!;
      const payload = payloads[ordinal]!;
      addReleaseArtifact(visible, checkpoint.screenshot, payload.screenshot);
      addReleaseArtifact(
        visible,
        checkpoint.accessibility_tree,
        payload.accessibility_tree,
      );
      addReleaseArtifact(visible, checkpoint.layout_graph, payload.layout_graph);
    }
  }

  addReleaseArtifact(
    sealed,
    bundle.sealed_record.provenance.source_state,
    bundle.source_state,
  );
  addReleaseArtifact(
    sealed,
    bundle.sealed_record.intervention.parameters,
    bundle.mutation_plan,
  );
  addReleaseArtifact(
    sealed,
    bundle.sealed_record.intervention.preconditions,
    bundle.precondition_report,
  );
  addReleaseArtifact(
    sealed,
    bundle.sealed_record.intervention.changed_surface,
    bundle.changed_surface,
  );
  for (const role of ["baseline", "candidate"] as const) {
    const references = bundle.sealed_record.execution[role];
    const payloads = bundle.execution[role];
    addReleaseArtifact(
      sealed,
      references.final_state_oracle,
      payloads.final_state_oracle,
    );
    addReleaseArtifact(
      sealed,
      references.accessibility_oracle,
      payloads.accessibility_oracle,
    );
    addReleaseArtifact(sealed, references.raw_trace, payloads.raw_trace);
  }
  if (bundle.sealed_record.labels.localization !== null) {
    assert.notEqual(bundle.localization, null);
    if (bundle.localization === null) {
      throw new Error("localization bytes are required by the sealed record");
    }
    addReleaseArtifact(
      sealed,
      bundle.sealed_record.labels.localization,
      bundle.localization,
    );
  } else {
    assert.equal(bundle.localization, null);
  }
  const records = validateEvidenceRecordPair(bundle.manifest, bundle.sealed_record);

  return {
    evidence: records.evidence,
    sealed_record: records.sealedRecord,
    visible_artifacts: [...visible.values()],
    sealed_artifacts: [...sealed.values()],
  };
}

function expectPublicationError(code: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert.ok(error instanceof PairedPublicationError);
    assert.equal(error.code, code);
    return true;
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

test("resolved evidence records replay sealed outcome payloads", () => {
  const result = validateResolvedEvidenceRecordBundle(completeResolvedRecordBundle());

  assert.equal(result.execution.baseline.raw_trace.task_success, false);
  assert.equal(result.execution.candidate.final_state_oracle.kind, "final_state");
  assert.equal(result.localization, null);
  assert.ok(Object.isFrozen(result));
});

test("resolved evidence records reject a rehashed but false changed surface", () => {
  const bundle = completeResolvedRecordBundle();
  const falseSurface = {
    ...JSON.parse(bundle.changed_surface.toString("utf8")),
    affected_node_ids: [id("idnd1_", "f")],
  };
  const falseSurfaceBytes = canonicalBytes(falseSurface);
  const recordDraft = {
    ...bundle.sealed_record,
    sealed_record_id: id("idsr1_", "0"),
    intervention: {
      ...bundle.sealed_record.intervention,
      changed_surface: reference(
        "application/vnd.impactdiff.changed-surface+json",
        falseSurfaceBytes,
      ),
    },
  };
  const tampered = {
    ...bundle,
    sealed_record: {
      ...recordDraft,
      sealed_record_id: computeSealedRecordId(recordDraft),
    },
    changed_surface: falseSurfaceBytes,
  };

  expectIssue(
    () => validateResolvedEvidenceRecordBundle(tampered),
    "resolved_record.changed_surface",
  );
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

test("paired publication is concurrent, idempotent, and owns caller bytes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "impactdiff-publication-"));
  await chmod(root, 0o700);
  t.after(async () => rm(root, { force: true, recursive: true }));
  const input = pairedReleaseInput();
  const [firstPublisher, secondPublisher] = await Promise.all([
    PairedReleasePublisher.open(root),
    PairedReleasePublisher.open(root),
  ]);

  const pending = Array.from({ length: 8 }, (_, index) =>
    (index % 2 === 0 ? firstPublisher : secondPublisher).publish(input),
  );
  const callerBytes = input.visible_artifacts[0]!.bytes;
  const originalFirstByte = callerBytes[0]!;
  callerBytes[0] = originalFirstByte ^ 0xff;
  const publications = await Promise.all(pending);
  callerBytes[0] = originalFirstByte;

  const publicationIds = new Set(
    publications.map((publication) => publication.commit.publication_id),
  );
  const releasePaths = new Set(
    publications.map((publication) => publication.paths.releasePath),
  );
  assert.equal(publicationIds.size, 1);
  assert.equal(releasePaths.size, 1);
  const releasePath = join(root, "releases", input.evidence.evidence_id);
  assert.deepEqual(await readdir(join(releasePath, "visible")), ["cas", "evidence"]);
  assert.deepEqual(await readdir(join(releasePath, "sealed")), ["cas", "records"]);

  const reopened = await verifyPairedRelease(releasePath);
  assert.equal(reopened.paths.releasePath, releasePath);
  assert.equal(reopened.audits.visible.entries.size, input.visible_artifacts.length);
  assert.equal(reopened.audits.sealed.entries.size, input.sealed_artifacts.length);
  assert.equal(
    reopened.sealedRecord.sealed_record_id,
    input.sealed_record.sealed_record_id,
  );
});

test("paired publication rejects incomplete input without filesystem residue", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "impactdiff-publication-"));
  await chmod(root, 0o700);
  t.after(async () => rm(root, { force: true, recursive: true }));
  const publisher = await PairedReleasePublisher.open(root);
  const input = pairedReleaseInput();

  await assert.rejects(
    publisher.publish({
      ...input,
      visible_artifacts: input.visible_artifacts.slice(1),
    }),
    expectPublicationError("publication.input_missing_artifact"),
  );
  assert.deepEqual(await readdir(join(root, "releases")), []);
});

test("paired publication rejects hostile input wrappers and artifact substitutions", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "impactdiff-publication-"));
  await chmod(root, 0o700);
  t.after(async () => rm(root, { force: true, recursive: true }));
  const publisher = await PairedReleasePublisher.open(root);
  const input = pairedReleaseInput();
  const first = input.visible_artifacts[0]!;
  const alternateMediaType =
    first.reference.media_type === "application/vnd.impactdiff.layout+json"
      ? "application/vnd.impactdiff.accessibility+json"
      : "application/vnd.impactdiff.layout+json";
  const conflicting = {
    reference: { ...first.reference, media_type: alternateMediaType },
    bytes: first.bytes,
  };
  const accessorWrapper = { ...input };
  Object.defineProperty(accessorWrapper, "evidence", {
    enumerable: true,
    get: () => input.evidence,
  });
  const sparseArtifacts = [...input.visible_artifacts];
  delete sparseArtifacts[0];
  const shortBytes = first.bytes.slice(1);
  const tamperedBytes = Uint8Array.from(first.bytes);
  const finalByteIndex = tamperedBytes.length - 1;
  tamperedBytes[finalByteIndex] = tamperedBytes[finalByteIndex]! ^ 0xff;
  const sharedBytes = new Uint8Array(new SharedArrayBuffer(first.bytes.byteLength));
  sharedBytes.set(first.bytes);
  const cases = [
    ["accessor wrapper", accessorWrapper, "publication.input_wrapper_descriptor"],
    [
      "sparse array",
      { ...input, visible_artifacts: sparseArtifacts },
      "publication.input_array_fields",
    ],
    [
      "duplicate artifact",
      {
        ...input,
        visible_artifacts: [...input.visible_artifacts, first],
      },
      "publication.input_duplicate_artifact",
    ],
    [
      "conflicting duplicate metadata",
      {
        ...input,
        visible_artifacts: [...input.visible_artifacts, conflicting],
      },
      "publication.input_metadata_conflict",
    ],
    [
      "unexpected sealed artifact",
      {
        ...input,
        visible_artifacts: [...input.visible_artifacts, input.sealed_artifacts[0]!],
      },
      "publication.input_unexpected_artifact",
    ],
    [
      "reference metadata substitution",
      {
        ...input,
        visible_artifacts: [conflicting, ...input.visible_artifacts.slice(1)],
      },
      "publication.input_reference_mismatch",
    ],
    [
      "shared backing memory",
      {
        ...input,
        visible_artifacts: [
          { reference: first.reference, bytes: sharedBytes },
          ...input.visible_artifacts.slice(1),
        ],
      },
      "publication.input_bytes",
    ],
    [
      "short artifact bytes",
      {
        ...input,
        visible_artifacts: [
          { reference: first.reference, bytes: shortBytes },
          ...input.visible_artifacts.slice(1),
        ],
      },
      "publication.input_byte_length",
    ],
    [
      "same-length digest substitution",
      {
        ...input,
        visible_artifacts: [
          { reference: first.reference, bytes: tamperedBytes },
          ...input.visible_artifacts.slice(1),
        ],
      },
      "publication.input_digest",
    ],
  ] as const;

  for (const [name, invalid, code] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        publisher.publish(invalid as PairedReleaseInput),
        expectPublicationError(code),
      );
      assert.deepEqual(await readdir(join(root, "releases")), []);
    });
  }
});

test("paired publication remains atomic under a restrictive umask", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "impactdiff-publication-"));
  await chmod(root, 0o700);
  t.after(async () => rm(root, { force: true, recursive: true }));
  const publisher = await PairedReleasePublisher.open(root);
  const previousUmask = process.umask(0o777);
  let publication: Awaited<ReturnType<PairedReleasePublisher["publish"]>>;
  try {
    publication = await publisher.publish(pairedReleaseInput());
  } finally {
    process.umask(previousUmask);
  }

  const reopened = await verifyPairedRelease(publication.paths.releasePath);
  assert.equal(reopened.commit.publication_id, publication.commit.publication_id);
});

test("publisher startup removes only a bounded owned staging tree", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "impactdiff-publication-"));
  await chmod(root, 0o700);
  t.after(async () => rm(root, { force: true, recursive: true }));
  const releasesPath = join(root, "releases");
  const stagePath = join(releasesPath, `.impactdiff-stage-${"a".repeat(32)}.tmp`);
  const leafPath = join(stagePath, "visible", "evidence");
  await mkdir(leafPath, { mode: 0o700, recursive: true });
  await writeFile(join(leafPath, "partial.json"), "partial", { mode: 0o400 });

  await PairedReleasePublisher.open(root);

  assert.deepEqual(await readdir(releasesPath), []);
});

test("one visible identity cannot be rebound to another sealed record", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "impactdiff-publication-"));
  await chmod(root, 0o700);
  t.after(async () => rm(root, { force: true, recursive: true }));
  const publisher = await PairedReleasePublisher.open(root);
  const bundle = completeResolvedRecordBundle();
  const original = pairedReleaseInput(bundle);
  await publisher.publish(original);

  const alternateDraft = {
    ...bundle.sealed_record,
    sealed_record_id: id("idsr1_", "0"),
    grouping: {
      ...bundle.sealed_record.grouping,
      near_duplicate_group_id: id("idng1_", "9"),
    },
  };
  const alternateRecord = {
    ...alternateDraft,
    sealed_record_id: computeSealedRecordId(alternateDraft),
  };
  const alternate = pairedReleaseInput({
    ...bundle,
    sealed_record: alternateRecord,
  });

  await assert.rejects(
    publisher.publish(alternate),
    expectPublicationError("publication.conflict"),
  );
  const reopened = await verifyPairedRelease(
    join(root, "releases", original.evidence.evidence_id),
  );
  assert.equal(
    reopened.sealedRecord.sealed_record_id,
    original.sealed_record.sealed_record_id,
  );
});

test("committed metadata tampering fails closed on reopen", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "impactdiff-publication-"));
  await chmod(root, 0o700);
  t.after(async () => rm(root, { force: true, recursive: true }));
  const publisher = await PairedReleasePublisher.open(root);
  const publication = await publisher.publish(pairedReleaseInput());
  const original = await readFile(publication.paths.evidencePath);
  await chmod(publication.paths.evidencePath, 0o600);
  await writeFile(
    publication.paths.evidencePath,
    Buffer.concat([original, Buffer.from("\n", "utf8")]),
  );
  await chmod(publication.paths.evidencePath, 0o400);

  await assert.rejects(verifyPairedRelease(publication.paths.releasePath));
});

test("semantic staging failure rolls back completely and permits retry", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "impactdiff-publication-"));
  await chmod(root, 0o700);
  t.after(async () => rm(root, { force: true, recursive: true }));
  const publisher = await PairedReleasePublisher.open(root);
  const bundle = completeResolvedRecordBundle();
  const falseSurface = {
    ...JSON.parse(bundle.changed_surface.toString("utf8")),
    affected_node_ids: [id("idnd1_", "f")],
  };
  const falseSurfaceBytes = canonicalBytes(falseSurface);
  const invalidDraft = {
    ...bundle.sealed_record,
    sealed_record_id: id("idsr1_", "0"),
    intervention: {
      ...bundle.sealed_record.intervention,
      changed_surface: reference(
        "application/vnd.impactdiff.changed-surface+json",
        falseSurfaceBytes,
      ),
    },
  };
  const invalidRecord = {
    ...invalidDraft,
    sealed_record_id: computeSealedRecordId(invalidDraft),
  };
  const invalidInput = pairedReleaseInput({
    ...bundle,
    sealed_record: invalidRecord,
    changed_surface: falseSurfaceBytes,
  });

  await assert.rejects(publisher.publish(invalidInput), (error: unknown) => {
    assert.ok(error instanceof ContractValidationError);
    assert.ok(
      error.issues.some(
        (candidate) => candidate.code === "resolved_record.changed_surface",
      ),
    );
    return true;
  });
  assert.deepEqual(await readdir(join(root, "releases")), []);

  const recovered = await publisher.publish(pairedReleaseInput());
  assert.equal(recovered.evidence.evidence_id, bundle.manifest.evidence_id);
});

test("final release directory names are cryptographically bound", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "impactdiff-publication-"));
  await chmod(root, 0o700);
  t.after(async () => rm(root, { force: true, recursive: true }));
  const publisher = await PairedReleasePublisher.open(root);
  const publication = await publisher.publish(pairedReleaseInput());
  const movedPath = join(root, "releases", id("idev1_", "f"));
  await rename(publication.paths.releasePath, movedPath);

  await assert.rejects(
    verifyPairedRelease(movedPath),
    expectPublicationError("publication.path_binding"),
  );
  await assert.rejects(
    PairedReleasePublisher.open(root),
    expectPublicationError("publication.path_binding"),
  );
});
