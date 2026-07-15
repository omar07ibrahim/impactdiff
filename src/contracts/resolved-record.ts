import type { ArtifactRef } from "./artifacts.js";
import { intrinsicUint8ArrayByteLength, snapshotUint8Array } from "./byte-array.js";
import { canonicalJson, parseCanonicalJson, sha256Hex } from "./canonical.js";
import { ContractValidationError, issue } from "./errors.js";
import {
  validateResolvedEvidenceBundle,
  validateResolvedInterventionBundle,
} from "./resolved.js";
import type { ResolvedEvidenceBundle, ResolvedInterventionBundle } from "./resolved.js";
import type {
  ChangedSurface,
  Localization,
  OracleResult,
  RawTrace,
} from "../sealed/schema.js";
import {
  validateChangedSurface,
  validateLocalization,
  validateOracleResult,
  validateRawTrace,
} from "../sealed/validate.js";

const contract = "impactdiff.resolved-evidence-record/v1";

interface InputRecord {
  readonly [key: string]: unknown;
}

export interface ResolvedOutcomePayloads {
  readonly final_state_oracle: OracleResult;
  readonly accessibility_oracle: OracleResult;
  readonly raw_trace: RawTrace;
}

export interface ResolvedEvidenceRecordBundle {
  readonly evidence: ResolvedEvidenceBundle;
  readonly intervention: ResolvedInterventionBundle;
  readonly changed_surface: ChangedSurface;
  readonly execution: {
    readonly baseline: ResolvedOutcomePayloads;
    readonly candidate: ResolvedOutcomePayloads;
  };
  readonly localization: Localization | null;
}

function fail(code: string, path: string, message: string): never {
  throw new ContractValidationError(contract, [issue(code, path, message)]);
}

function closedRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): InputRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("resolved_record.wrapper", path, "resolved payload wrapper must be an object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(
      "resolved_record.wrapper_prototype",
      path,
      "resolved payload wrapper must use a data-only prototype",
    );
  }
  const expected = new Set(keys);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !expected.has(key))
  ) {
    fail(
      "resolved_record.wrapper_fields",
      path,
      "resolved payload wrapper has unknown or missing fields",
    );
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      fail(
        "resolved_record.wrapper_descriptor",
        `${path}/${key}`,
        "resolved payload fields must be enumerable data properties",
      );
    }
  }
  return value as InputRecord;
}

function snapshotPayload(
  value: unknown,
  reference: ArtifactRef,
  mediaType: string,
  maximumBytes: number,
  path: string,
): Buffer {
  const byteLength = intrinsicUint8ArrayByteLength(value);
  if (byteLength === null) {
    fail("resolved_record.bytes", path, "resolved artifact must be a byte array");
  }
  if (byteLength < 1 || byteLength > maximumBytes) {
    fail(
      "resolved_record.byte_budget",
      path,
      "resolved artifact exceeds its media-type byte budget",
    );
  }
  let bytes: Buffer;
  try {
    bytes = snapshotUint8Array(value as Uint8Array, byteLength);
  } catch {
    fail(
      "resolved_record.unstable_bytes",
      path,
      "resolved artifact bytes could not be snapshotted",
    );
  }
  if (
    reference.media_type !== mediaType ||
    reference.byte_length !== bytes.length ||
    reference.sha256 !== sha256Hex(bytes)
  ) {
    fail(
      "resolved_record.reference",
      path,
      "resolved artifact bytes do not match the sealed reference",
    );
  }
  return bytes;
}

function parsePayload<T>(
  bytes: Buffer,
  maximumBytes: number,
  path: string,
  validate: (value: unknown) => T,
): T {
  try {
    const parsed = validate(
      parseCanonicalJson(bytes, {
        maximumBytes,
        maximumDepth: 32,
        maximumValues: 100_000,
      }),
    );
    if (canonicalJson(parsed) !== bytes.toString("utf8")) {
      fail(
        "resolved_record.noncanonical",
        path,
        "resolved artifact is not represented by its canonical bytes",
      );
    }
    return parsed;
  } catch (error) {
    if (error instanceof ContractValidationError && error.contract === contract) {
      throw error;
    }
    throw new ContractValidationError(contract, [
      issue(
        "resolved_record.payload",
        path,
        error instanceof Error ? error.message : "resolved payload validation failed",
      ),
    ]);
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function assertChangedSurface(
  surface: ChangedSurface,
  intervention: ResolvedInterventionBundle,
): void {
  const plan = intervention.mutation_plan;
  const operation = plan.forward[0];
  const expectedRegion =
    operation?.opcode === "install_pointer_interceptor"
      ? operation.rect_milli_css_px
      : intervention.probe.target.bounds;
  if (
    surface.plan_id !== plan.plan_id ||
    surface.instance_id !== plan.instance_id ||
    surface.affected_node_ids.length !== 1 ||
    surface.affected_node_ids[0] !== plan.request.target.node_id ||
    expectedRegion === null ||
    surface.regions_milli_css_px.length !== 1 ||
    !sameJson(surface.regions_milli_css_px[0], expectedRegion)
  ) {
    fail(
      "resolved_record.changed_surface",
      "/changed_surface",
      "changed surface must be derived from the validated mutation plan and probe",
    );
  }
}

function actionTargetId(evidence: ResolvedEvidenceBundle): string {
  const pointerActions = evidence.action_plan.actions.filter(
    (action) => action.intent === "pointer_click" && action.target_id !== null,
  );
  if (pointerActions.length !== 1 || pointerActions[0]?.target_id === null) {
    fail(
      "resolved_record.action_plan",
      "/action_plan/actions",
      "resolved record policy requires one pointer task action",
    );
  }
  const targetId = pointerActions[0]?.target_id;
  if (targetId === undefined || targetId === null) {
    throw new Error("unreachable resolved pointer action state");
  }
  return targetId;
}

function assertRolePayloads(
  role: "baseline" | "candidate",
  payloads: ResolvedOutcomePayloads,
  evidence: ResolvedEvidenceBundle,
  intervention: ResolvedInterventionBundle,
): void {
  const capture = intervention.manifest.pair[role];
  const outcome = intervention.sealed_record.execution[role];
  const taskId = intervention.manifest.task.task_id;
  const expectedTargetId = actionTargetId(evidence);
  const finalCheckpoint = evidence.pair[role].at(-1);
  if (finalCheckpoint === undefined) {
    fail(
      "resolved_record.checkpoint",
      `/execution/${role}`,
      "resolved role must contain a final checkpoint",
    );
  }
  const expectedState = finalCheckpoint.layout_graph.nodes.some(
    (node) => node.action_target_id === expectedTargetId,
  )
    ? "review"
    : "confirmed";
  const primaryActionCount = finalCheckpoint.accessibility_tree.nodes.filter(
    (node) => node.role === "button" && node.name === "Place order",
  ).length;
  const confirmationCount = finalCheckpoint.accessibility_tree.nodes.filter(
    (node) => node.role === "heading" && node.name === "Thanks, Jordan.",
  ).length;
  const { final_state_oracle: finalOracle, accessibility_oracle: axOracle } = payloads;
  for (const [name, payload] of [
    ["final_state_oracle", finalOracle],
    ["accessibility_oracle", axOracle],
    ["raw_trace", payloads.raw_trace],
  ] as const) {
    if (
      payload.role !== role ||
      payload.capture_id !== capture.capture_id ||
      payload.task_id !== taskId
    ) {
      fail(
        "resolved_record.role_binding",
        `/execution/${role}/${name}`,
        "sealed execution payload must bind its exact role, capture, and task",
      );
    }
  }
  if (
    finalOracle.kind !== "final_state" ||
    finalOracle.observed_state !== expectedState ||
    finalOracle.passed !== outcome.task_success
  ) {
    fail(
      "resolved_record.final_oracle",
      `/execution/${role}/final_state_oracle`,
      "final-state oracle must replay from the final layout checkpoint",
    );
  }
  if (
    axOracle.kind !== "accessibility" ||
    axOracle.primary_action_count !== primaryActionCount ||
    axOracle.confirmation_count !== confirmationCount ||
    axOracle.passed !== outcome.task_success
  ) {
    fail(
      "resolved_record.accessibility_oracle",
      `/execution/${role}/accessibility_oracle`,
      "accessibility oracle must replay from the final accessibility checkpoint",
    );
  }
  const trace = payloads.raw_trace;
  if (
    trace.task_success !== outcome.task_success ||
    trace.first_unsatisfied_step_id !== outcome.first_unsatisfied_step_id ||
    trace.recovery_actions !== outcome.recovery_actions ||
    trace.virtual_elapsed_ms !== outcome.virtual_elapsed_ms ||
    trace.steps.length !== evidence.action_plan.actions.length
  ) {
    fail(
      "resolved_record.trace_outcome",
      `/execution/${role}/raw_trace`,
      "task trace must reproduce the sealed scalar outcome and action count",
    );
  }
  const failedIndex = evidence.action_plan.actions.findIndex(
    (action) => action.action_id === outcome.first_unsatisfied_step_id,
  );
  for (const [index, action] of evidence.action_plan.actions.entries()) {
    const step = trace.steps[index];
    const expectedStatus = outcome.task_success
      ? "satisfied"
      : index < failedIndex
        ? "satisfied"
        : index === failedIndex
          ? "unsatisfied"
          : "not_reached";
    if (
      step?.action_id !== action.action_id ||
      step.ordinal !== action.ordinal ||
      step.status !== expectedStatus
    ) {
      fail(
        "resolved_record.trace_actions",
        `/execution/${role}/raw_trace/steps/${index}`,
        "task trace must replay the exact action plan and first failure",
      );
    }
  }
}

function resolveOutcome(
  role: "baseline" | "candidate",
  value: unknown,
  intervention: ResolvedInterventionBundle,
): ResolvedOutcomePayloads {
  const record = closedRecord(
    value,
    ["final_state_oracle", "accessibility_oracle", "raw_trace"],
    `/execution/${role}`,
  );
  const outcome = intervention.sealed_record.execution[role];
  const finalBytes = snapshotPayload(
    record.final_state_oracle,
    outcome.final_state_oracle,
    "application/vnd.impactdiff.oracle-result+json",
    131_072,
    `/execution/${role}/final_state_oracle`,
  );
  const accessibilityBytes = snapshotPayload(
    record.accessibility_oracle,
    outcome.accessibility_oracle,
    "application/vnd.impactdiff.oracle-result+json",
    131_072,
    `/execution/${role}/accessibility_oracle`,
  );
  const traceBytes = snapshotPayload(
    record.raw_trace,
    outcome.raw_trace,
    "application/vnd.impactdiff.raw-trace+json",
    4_194_304,
    `/execution/${role}/raw_trace`,
  );
  return Object.freeze({
    final_state_oracle: parsePayload(
      finalBytes,
      131_072,
      `/execution/${role}/final_state_oracle`,
      validateOracleResult,
    ),
    accessibility_oracle: parsePayload(
      accessibilityBytes,
      131_072,
      `/execution/${role}/accessibility_oracle`,
      validateOracleResult,
    ),
    raw_trace: parsePayload(
      traceBytes,
      4_194_304,
      `/execution/${role}/raw_trace`,
      validateRawTrace,
    ),
  });
}

export function validateResolvedEvidenceRecordBundle(
  value: unknown,
): ResolvedEvidenceRecordBundle {
  const input = closedRecord(
    value,
    [
      "manifest",
      "sealed_record",
      "action_plan",
      "capture_spec",
      "pair",
      "source_state",
      "mutation_plan",
      "precondition_report",
      "changed_surface",
      "execution",
      "localization",
    ],
    "",
  );
  const evidence = validateResolvedEvidenceBundle({
    manifest: input.manifest,
    action_plan: input.action_plan,
    capture_spec: input.capture_spec,
    pair: input.pair,
  });
  const intervention = validateResolvedInterventionBundle({
    manifest: input.manifest,
    sealed_record: input.sealed_record,
    source_state: input.source_state,
    mutation_plan: input.mutation_plan,
    precondition_report: input.precondition_report,
  });
  const changedBytes = snapshotPayload(
    input.changed_surface,
    intervention.sealed_record.intervention.changed_surface,
    "application/vnd.impactdiff.changed-surface+json",
    1_048_576,
    "/changed_surface",
  );
  const changedSurface = parsePayload(
    changedBytes,
    1_048_576,
    "/changed_surface",
    validateChangedSurface,
  );
  assertChangedSurface(changedSurface, intervention);

  const executionInput = closedRecord(
    input.execution,
    ["baseline", "candidate"],
    "/execution",
  );
  const baseline = resolveOutcome("baseline", executionInput.baseline, intervention);
  const candidate = resolveOutcome("candidate", executionInput.candidate, intervention);
  assertRolePayloads("baseline", baseline, evidence, intervention);
  assertRolePayloads("candidate", candidate, evidence, intervention);

  const localizationReference = intervention.sealed_record.labels.localization;
  let localization: Localization | null = null;
  if (localizationReference === null) {
    if (input.localization !== null) {
      fail(
        "resolved_record.localization",
        "/localization",
        "a record without localization must resolve to null",
      );
    }
  } else {
    const localizationBytes = snapshotPayload(
      input.localization,
      localizationReference,
      "application/vnd.impactdiff.localization+json",
      1_048_576,
      "/localization",
    );
    localization = parsePayload(
      localizationBytes,
      1_048_576,
      "/localization",
      validateLocalization,
    );
    if (
      localization.instance_id !== changedSurface.instance_id ||
      localization.failed_step_id !==
        intervention.sealed_record.labels.first_failed_step_id ||
      localization.changed_surface_sha256 !==
        intervention.sealed_record.intervention.changed_surface.sha256 ||
      !sameJson(localization.affected_node_ids, changedSurface.affected_node_ids) ||
      !sameJson(localization.regions_milli_css_px, changedSurface.regions_milli_css_px)
    ) {
      fail(
        "resolved_record.localization_binding",
        "/localization",
        "regression localization must equal the observed changed surface",
      );
    }
  }

  return Object.freeze({
    evidence,
    intervention,
    changed_surface: changedSurface,
    execution: Object.freeze({ baseline, candidate }),
    localization,
  });
}
