import { validateArtifactReference } from "../artifacts/cas.js";
import {
  parseAccessibilitySnapshot,
  parseActionPlan,
  parseCaptureSpec,
  parseLayoutSnapshot,
} from "../capture/validate.js";
import type { ActionPlan } from "../capture/schema.js";
import type { ArtifactRef } from "../contracts/artifacts.js";
import {
  canonicalJson,
  canonicalSha256,
  computeCaptureId,
  computeCheckpointId,
  computeEnvironmentId,
  computeEvidenceId,
  computeFeatureProfileId,
  computeSealedRecordId,
  computeSourceStateId,
  computeTaskId,
  sha256Hex,
} from "../contracts/canonical.js";
import {
  intrinsicUint8ArrayByteLength,
  snapshotUint8Array,
} from "../contracts/byte-array.js";
import { validateResolvedEvidenceRecordBundle } from "../contracts/resolved-record.js";
import type { ResolvedEvidenceRecordBundle } from "../contracts/resolved-record.js";
import type { SealedRecord } from "../contracts/schema.js";
import {
  validateEvidenceManifest,
  validateEvidenceRecordPair,
  validateSealedRecord,
} from "../contracts/validate.js";
import type { MutationFixtureCaptureSpecArtifact } from "../mutations/environment.js";
import { validateMutationCompilation } from "../mutations/compiler.js";
import type { MutationCompilationBundle } from "../mutations/compiler.js";
import type {
  MutationFixtureActionPlanArtifact,
  MutationFixtureSourceStateArtifact,
  MutationRuntimeBinding,
} from "../mutations/runtime.js";
import type {
  PairedReleaseArtifactInput,
  PairedReleaseInput,
} from "../publication/input.js";
import { parseSourceState } from "../source/validate.js";
import { FixturePairGenerationError } from "./errors.js";
import type { FixturePairGenerationErrorCode } from "./errors.js";
import {
  deriveDevelopmentGrouping,
  deriveDevelopmentLabelDecision,
  developmentLabelPolicyId,
} from "./policy.js";

const zeroCaptureId = `idcp1_${"0".repeat(64)}`;
const zeroEvidenceId = `idev1_${"0".repeat(64)}`;
const zeroSealedRecordId = `idsr1_${"0".repeat(64)}`;

export interface AuditedFixtureCheckpoint {
  readonly checkpoint_id: string;
  readonly ordinal: 0 | 1;
  readonly screenshot: Uint8Array;
  readonly accessibility_tree: Uint8Array;
  readonly layout_graph: Uint8Array;
}

export interface AuditedFixtureRoleRun {
  readonly checkpoints: readonly [AuditedFixtureCheckpoint, AuditedFixtureCheckpoint];
  readonly task_success: boolean;
  readonly first_unsatisfied_step_id: string | null;
  readonly virtual_elapsed_ms: number;
}

export interface MutationFixturePairDerivationInput {
  readonly sourceState: MutationFixtureSourceStateArtifact;
  readonly actionPlan: MutationFixtureActionPlanArtifact;
  readonly captureSpec: MutationFixtureCaptureSpecArtifact;
  readonly binding: MutationRuntimeBinding;
  readonly compilation: MutationCompilationBundle;
  readonly baseline: AuditedFixtureRoleRun;
  readonly candidate: AuditedFixtureRoleRun;
}

export interface DerivedMutationFixturePair {
  readonly publicationInput: PairedReleaseInput;
  readonly resolved: ResolvedEvidenceRecordBundle;
}

type Role = "baseline" | "candidate";

interface OwnedCheckpoint {
  readonly checkpoint_id: string;
  readonly ordinal: 0 | 1;
  readonly screenshot: Buffer;
  readonly accessibility_tree: Buffer;
  readonly layout_graph: Buffer;
}

interface OwnedRoleRun {
  readonly checkpoints: readonly [OwnedCheckpoint, OwnedCheckpoint];
  readonly task_success: boolean;
  readonly first_unsatisfied_step_id: string | null;
  readonly virtual_elapsed_ms: number;
}

interface OwnedArtifact<T> {
  readonly reference: ArtifactRef;
  readonly bytes: Buffer;
  readonly value: T;
}

interface ArtifactPayload<MediaType extends string = string> {
  readonly reference: ArtifactRef & { readonly media_type: MediaType };
  readonly bytes: Buffer;
}

interface DerivedRolePayloads {
  readonly finalState: ArtifactPayload<"application/vnd.impactdiff.oracle-result+json">;
  readonly accessibility: ArtifactPayload<"application/vnd.impactdiff.oracle-result+json">;
  readonly rawTrace: ArtifactPayload<"application/vnd.impactdiff.raw-trace+json">;
  readonly outcome: SealedRecord["execution"]["baseline"];
}

function fail(
  code: FixturePairGenerationErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new FixturePairGenerationError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function sameReference(left: ArtifactRef, right: ArtifactRef): boolean {
  return (
    left.sha256 === right.sha256 &&
    left.byte_length === right.byte_length &&
    left.media_type === right.media_type &&
    left.format_version === right.format_version
  );
}

function snapshotBytes(
  value: unknown,
  maximumBytes: number,
  label: string,
  code: FixturePairGenerationErrorCode = "generation.artifact",
): Buffer {
  const byteLength = intrinsicUint8ArrayByteLength(value);
  if (byteLength === null || byteLength < 1 || byteLength > maximumBytes) {
    fail(code, `${label} must be a non-empty bounded fixed-memory byte array`);
  }
  try {
    return snapshotUint8Array(value as Uint8Array, byteLength);
  } catch (error) {
    fail(code, `${label} could not be snapshotted`, error);
  }
}

function resolveArtifact<T>(
  input: { readonly reference: ArtifactRef; readonly bytes: Uint8Array },
  mediaType: string,
  maximumBytes: number,
  label: string,
  parse: (bytes: Buffer) => T,
): OwnedArtifact<T> {
  let reference: ArtifactRef;
  try {
    reference = validateArtifactReference(input.reference, maximumBytes);
  } catch (error) {
    fail("generation.artifact", `${label} has an invalid artifact reference`, error);
  }
  if (reference.media_type !== mediaType) {
    fail("generation.artifact", `${label} must use media type ${mediaType}`);
  }
  const bytes = snapshotBytes(input.bytes, maximumBytes, label);
  if (
    reference.byte_length !== bytes.byteLength ||
    reference.sha256 !== sha256Hex(bytes)
  ) {
    fail("generation.artifact", `${label} bytes do not match their reference`);
  }
  let value: T;
  try {
    value = parse(bytes);
  } catch (error) {
    fail("generation.artifact", `${label} is not a canonical validated payload`, error);
  }
  return Object.freeze({ reference, bytes, value });
}

function reference<const MediaType extends string>(
  mediaType: MediaType,
  bytes: Uint8Array,
): ArtifactRef & { readonly media_type: MediaType } {
  return Object.freeze({
    sha256: sha256Hex(bytes),
    byte_length: bytes.byteLength,
    media_type: mediaType,
    format_version: 1,
  });
}

function jsonPayload<const MediaType extends string>(
  mediaType: MediaType,
  value: unknown,
): ArtifactPayload<MediaType> {
  const bytes = Buffer.from(canonicalJson(value), "utf8");
  return Object.freeze({ reference: reference(mediaType, bytes), bytes });
}

function assertBinding(
  input: MutationFixturePairDerivationInput,
  sourceState: OwnedArtifact<ReturnType<typeof parseSourceState>>,
  actionPlan: OwnedArtifact<ActionPlan>,
  captureSpec: OwnedArtifact<ReturnType<typeof parseCaptureSpec>>,
): void {
  const { binding } = input;
  if (
    !sameReference(binding.source_state, sourceState.reference) ||
    !sameReference(binding.action_plan, actionPlan.reference) ||
    !sameReference(binding.capture_spec, captureSpec.reference) ||
    binding.source_state_id !== computeSourceStateId(sourceState.reference) ||
    binding.task_id !== computeTaskId(actionPlan.reference) ||
    binding.environment_id !== computeEnvironmentId(captureSpec.reference)
  ) {
    fail(
      "generation.binding",
      "runtime binding does not match the verified source, action, and capture artifacts",
    );
  }
  const source = sourceState.value.source;
  if (
    source.fixture_id !== binding.fixture_id ||
    source.revision !== binding.fixture_revision ||
    source.raw_manifest.sha256 !== binding.fixture_manifest_sha256
  ) {
    fail(
      "generation.binding",
      "source-state fixture identity differs from the binding",
    );
  }
  const action = actionPlan.value.actions[0];
  const checkpoints = actionPlan.value.checkpoints;
  if (
    actionPlan.value.actions.length !== 1 ||
    action === undefined ||
    action.ordinal !== 0 ||
    action.intent !== "pointer_click" ||
    action.target_id !== binding.primary_action_target_id ||
    action.value.kind !== "pointer" ||
    action.value.button !== "primary" ||
    checkpoints.length !== 2 ||
    checkpoints[0]?.ordinal !== 0 ||
    checkpoints[0]?.after_action_ordinal !== -1 ||
    checkpoints[1]?.ordinal !== 1 ||
    checkpoints[1]?.after_action_ordinal !== 0
  ) {
    fail("generation.binding", "action plan is not the fixed fixture task schedule");
  }
}

function resolveCompilation(
  compilation: MutationCompilationBundle,
  binding: MutationRuntimeBinding,
): MutationCompilationBundle {
  let validated: MutationCompilationBundle;
  try {
    validated = validateMutationCompilation(
      compilation.plan,
      compilation.preconditions,
    );
  } catch (error) {
    fail("generation.compilation", "mutation compilation is not applicable", error);
  }
  if (canonicalJson(compilation.probe) !== canonicalJson(validated.probe)) {
    fail(
      "generation.compilation",
      "compilation probe differs from the precondition report's bound probe",
    );
  }
  const request = validated.plan.request;
  if (
    request.source_state_id !== binding.source_state_id ||
    request.task_id !== binding.task_id ||
    request.environment_id !== binding.environment_id
  ) {
    fail("generation.compilation", "mutation request differs from the runtime binding");
  }
  return validated;
}

function snapshotRoleRun(
  role: Role,
  input: AuditedFixtureRoleRun,
  actionPlanReference: ArtifactRef,
  actionPlan: ActionPlan,
): OwnedRoleRun {
  if (!Array.isArray(input.checkpoints) || input.checkpoints.length !== 2) {
    fail("generation.checkpoint", `${role} must contain exactly two checkpoints`);
  }
  const checkpoints = input.checkpoints.map((checkpoint, index) => {
    if (
      checkpoint.ordinal !== index ||
      checkpoint.checkpoint_id !== computeCheckpointId(actionPlanReference, index)
    ) {
      fail(
        "generation.checkpoint",
        `${role} checkpoint ${index} does not match the action-plan schedule`,
      );
    }
    return Object.freeze({
      checkpoint_id: checkpoint.checkpoint_id,
      ordinal: checkpoint.ordinal,
      screenshot: snapshotBytes(
        checkpoint.screenshot,
        8_388_608,
        `${role} checkpoint ${index} screenshot`,
        "generation.checkpoint",
      ),
      accessibility_tree: snapshotBytes(
        checkpoint.accessibility_tree,
        2_097_152,
        `${role} checkpoint ${index} accessibility tree`,
        "generation.checkpoint",
      ),
      layout_graph: snapshotBytes(
        checkpoint.layout_graph,
        4_194_304,
        `${role} checkpoint ${index} layout graph`,
        "generation.checkpoint",
      ),
    });
  });
  const actionIds = new Set(actionPlan.actions.map((action) => action.action_id));
  if (
    typeof input.task_success !== "boolean" ||
    input.virtual_elapsed_ms !== 0 ||
    (input.task_success && input.first_unsatisfied_step_id !== null) ||
    (!input.task_success &&
      (input.first_unsatisfied_step_id === null ||
        !actionIds.has(input.first_unsatisfied_step_id)))
  ) {
    fail("generation.outcome", `${role} task outcome is internally inconsistent`);
  }
  const first = checkpoints[0];
  const second = checkpoints[1];
  if (first === undefined || second === undefined) {
    throw new Error("unreachable fixed checkpoint state");
  }
  return Object.freeze({
    checkpoints: Object.freeze([first, second] as const),
    task_success: input.task_success,
    first_unsatisfied_step_id: input.first_unsatisfied_step_id,
    virtual_elapsed_ms: input.virtual_elapsed_ms,
  });
}

function captureForRole(
  role: Role,
  run: OwnedRoleRun,
): ReturnType<typeof validateEvidenceManifest>["pair"][Role] {
  const checkpoints = run.checkpoints.map((checkpoint) => ({
    checkpoint_id: checkpoint.checkpoint_id,
    ordinal: checkpoint.ordinal,
    screenshot: reference("image/png", checkpoint.screenshot),
    accessibility_tree: reference(
      "application/vnd.impactdiff.accessibility+json",
      checkpoint.accessibility_tree,
    ),
    layout_graph: reference(
      "application/vnd.impactdiff.layout+json",
      checkpoint.layout_graph,
    ),
  }));
  const draft = { capture_id: zeroCaptureId, role, checkpoints };
  return { ...draft, capture_id: computeCaptureId(draft) };
}

function deriveRolePayloads(
  role: Role,
  run: OwnedRoleRun,
  captureId: string,
  taskId: string,
  actionPlan: ActionPlan,
): DerivedRolePayloads {
  const pointerActions = actionPlan.actions.filter(
    (action) => action.intent === "pointer_click" && action.target_id !== null,
  );
  const targetId = pointerActions[0]?.target_id;
  if (pointerActions.length !== 1 || targetId === undefined || targetId === null) {
    fail("generation.binding", "oracles require one pointer action target");
  }
  const finalCheckpoint = run.checkpoints[1];
  let layout: ReturnType<typeof parseLayoutSnapshot>;
  let accessibility: ReturnType<typeof parseAccessibilitySnapshot>;
  try {
    layout = parseLayoutSnapshot(finalCheckpoint.layout_graph);
    accessibility = parseAccessibilitySnapshot(finalCheckpoint.accessibility_tree);
  } catch (error) {
    fail("generation.artifact", `${role} final checkpoint could not be decoded`, error);
  }
  const observedState = layout.nodes.some((node) => node.action_target_id === targetId)
    ? "review"
    : "confirmed";
  const finalPassed = observedState === "confirmed";
  const primaryActionCount = accessibility.nodes.filter(
    (node) => node.role === "button" && node.name === "Place order",
  ).length;
  const confirmationCount = accessibility.nodes.filter(
    (node) => node.role === "heading" && node.name === "Thanks, Jordan.",
  ).length;
  const accessibilityPassed = primaryActionCount === 0 && confirmationCount === 1;
  if (finalPassed !== run.task_success || accessibilityPassed !== run.task_success) {
    fail(
      "generation.oracle_contradiction",
      `${role} runtime outcome contradicts its final layout or accessibility oracle`,
    );
  }

  const finalState = jsonPayload("application/vnd.impactdiff.oracle-result+json", {
    contract: "impactdiff.oracle-result",
    version: 1,
    role,
    capture_id: captureId,
    task_id: taskId,
    kind: "final_state",
    passed: finalPassed,
    observed_state: observedState,
  });
  const accessibilityPayload = jsonPayload(
    "application/vnd.impactdiff.oracle-result+json",
    {
      contract: "impactdiff.oracle-result",
      version: 1,
      role,
      capture_id: captureId,
      task_id: taskId,
      kind: "accessibility",
      passed: accessibilityPassed,
      primary_action_count: primaryActionCount,
      confirmation_count: confirmationCount,
    },
  );
  const failedIndex = actionPlan.actions.findIndex(
    (action) => action.action_id === run.first_unsatisfied_step_id,
  );
  const steps = actionPlan.actions.map((action, index) => ({
    action_id: action.action_id,
    ordinal: action.ordinal,
    status: run.task_success
      ? "satisfied"
      : index < failedIndex
        ? "satisfied"
        : index === failedIndex
          ? "unsatisfied"
          : "not_reached",
  }));
  const rawTrace = jsonPayload("application/vnd.impactdiff.raw-trace+json", {
    contract: "impactdiff.raw-trace",
    version: 1,
    role,
    capture_id: captureId,
    task_id: taskId,
    task_success: run.task_success,
    steps,
    first_unsatisfied_step_id: run.first_unsatisfied_step_id,
    recovery_actions: 0,
    virtual_elapsed_ms: run.virtual_elapsed_ms,
  });
  return Object.freeze({
    finalState,
    accessibility: accessibilityPayload,
    rawTrace,
    outcome: Object.freeze({
      task_success: run.task_success,
      final_state_oracle: finalState.reference,
      accessibility_oracle: accessibilityPayload.reference,
      raw_trace: rawTrace.reference,
      first_unsatisfied_step_id: run.first_unsatisfied_step_id,
      recovery_actions: 0,
      virtual_elapsed_ms: run.virtual_elapsed_ms,
    }),
  });
}

function addArtifact(
  artifacts: Map<string, ArtifactPayload>,
  payload: ArtifactPayload,
): void {
  const prior = artifacts.get(payload.reference.sha256);
  if (prior === undefined) {
    artifacts.set(
      payload.reference.sha256,
      Object.freeze({
        reference: payload.reference,
        bytes: Buffer.from(payload.bytes),
      }),
    );
    return;
  }
  if (
    !sameReference(prior.reference, payload.reference) ||
    !prior.bytes.equals(payload.bytes)
  ) {
    fail(
      "generation.artifact",
      "one content digest is bound to conflicting artifact bytes or metadata",
    );
  }
}

function publicationArtifacts(
  artifacts: ReadonlyMap<string, ArtifactPayload>,
): readonly PairedReleaseArtifactInput[] {
  return Object.freeze(
    [...artifacts.values()]
      .sort((left, right) =>
        left.reference.sha256 < right.reference.sha256
          ? -1
          : left.reference.sha256 > right.reference.sha256
            ? 1
            : 0,
      )
      .map((payload) =>
        Object.freeze({
          reference: payload.reference,
          bytes: Buffer.from(payload.bytes),
        }),
      ),
  );
}

function derivePair(
  input: MutationFixturePairDerivationInput,
): DerivedMutationFixturePair {
  if (typeof input !== "object" || input === null) {
    fail("generation.input", "pair derivation input must be an object");
  }
  const sourceState = resolveArtifact(
    input.sourceState,
    "application/vnd.impactdiff.source-state+json",
    1_048_576,
    "source state",
    parseSourceState,
  );
  const actionPlan = resolveArtifact(
    input.actionPlan,
    "application/vnd.impactdiff.action-plan+json",
    131_072,
    "action plan",
    parseActionPlan,
  );
  const captureSpec = resolveArtifact(
    input.captureSpec,
    "application/vnd.impactdiff.capture-spec+json",
    65_536,
    "capture specification",
    parseCaptureSpec,
  );
  assertBinding(input, sourceState, actionPlan, captureSpec);
  const compilation = resolveCompilation(input.compilation, input.binding);
  const baselineRun = snapshotRoleRun(
    "baseline",
    input.baseline,
    actionPlan.reference,
    actionPlan.value,
  );
  const candidateRun = snapshotRoleRun(
    "candidate",
    input.candidate,
    actionPlan.reference,
    actionPlan.value,
  );

  const baselineCapture = captureForRole("baseline", baselineRun);
  const candidateCapture = captureForRole("candidate", candidateRun);
  const evidenceDraft = {
    contract: "impactdiff.evidence",
    version: 1,
    evidence_id: zeroEvidenceId,
    feature_profile_id: computeFeatureProfileId(captureSpec.reference),
    source_state_id: input.binding.source_state_id,
    task: {
      task_id: input.binding.task_id,
      action_plan: actionPlan.reference,
    },
    environment: {
      environment_id: input.binding.environment_id,
      capture_spec: captureSpec.reference,
    },
    pair: { baseline: baselineCapture, candidate: candidateCapture },
  };
  const evidence = validateEvidenceManifest({
    ...evidenceDraft,
    evidence_id: computeEvidenceId(evidenceDraft),
  });

  const planBytes = Buffer.from(canonicalJson(compilation.plan), "utf8");
  const preconditionBytes = Buffer.from(
    canonicalJson(compilation.preconditions),
    "utf8",
  );
  const planReference = reference(
    "application/vnd.impactdiff.intervention-parameters+json",
    planBytes,
  );
  const preconditionReference = reference(
    "application/vnd.impactdiff.intervention-preconditions+json",
    preconditionBytes,
  );
  const operation = compilation.plan.forward[0];
  if (operation === undefined) {
    fail("generation.compilation", "applicable mutation plan has no operation");
  }
  const changedRegion =
    operation.opcode === "install_pointer_interceptor"
      ? operation.rect_milli_css_px
      : compilation.probe.target.bounds;
  if (changedRegion === null) {
    fail("generation.compilation", "mutation probe has no changed-surface bounds");
  }
  const changedSurface = jsonPayload(
    "application/vnd.impactdiff.changed-surface+json",
    {
      contract: "impactdiff.changed-surface",
      version: 1,
      plan_id: compilation.plan.plan_id,
      instance_id: compilation.plan.instance_id,
      affected_node_ids: [compilation.plan.request.target.node_id],
      regions_milli_css_px: [changedRegion],
    },
  );
  const baselinePayloads = deriveRolePayloads(
    "baseline",
    baselineRun,
    evidence.pair.baseline.capture_id,
    evidence.task.task_id,
    actionPlan.value,
  );
  const candidatePayloads = deriveRolePayloads(
    "candidate",
    candidateRun,
    evidence.pair.candidate.capture_id,
    evidence.task.task_id,
    actionPlan.value,
  );

  const decision = deriveDevelopmentLabelDecision(
    baselineRun.task_success,
    candidateRun.task_success,
    candidateRun.first_unsatisfied_step_id,
  );
  let localization: ArtifactPayload | null = null;
  if (decision.requiresLocalization) {
    const failedStepId = candidateRun.first_unsatisfied_step_id;
    if (failedStepId === null) {
      fail("generation.outcome", "regression localization requires a failed step");
    }
    localization = jsonPayload("application/vnd.impactdiff.localization+json", {
      contract: "impactdiff.localization",
      version: 1,
      instance_id: compilation.plan.instance_id,
      failed_step_id: failedStepId,
      changed_surface_sha256: changedSurface.reference.sha256,
      affected_node_ids: [compilation.plan.request.target.node_id],
      regions_milli_css_px: [changedRegion],
    });
  }

  const recordDraft = {
    contract: "impactdiff.sealed-record",
    version: 1,
    sealed_record_id: zeroSealedRecordId,
    evidence_id: evidence.evidence_id,
    evidence_manifest_sha256: canonicalSha256(evidence),
    label_policy_id: developmentLabelPolicyId,
    provenance: { source_state: sourceState.reference },
    grouping: deriveDevelopmentGrouping(
      input.binding,
      compilation.plan.operator.family_id,
    ),
    intervention: {
      family_id: compilation.plan.operator.family_id,
      operator_id: compilation.plan.operator.operator_id,
      operator_version: compilation.plan.operator.operator_version,
      instance_id: compilation.plan.instance_id,
      parameters: planReference,
      preconditions: preconditionReference,
      changed_surface: changedSurface.reference,
      expected_task_relation: compilation.plan.operator.expected_task_relation,
    },
    execution: {
      baseline: baselinePayloads.outcome,
      candidate: candidatePayloads.outcome,
    },
    labels: {
      ...decision.labels,
      localization: localization?.reference ?? null,
    },
  };
  const sealedRecord = validateSealedRecord({
    ...recordDraft,
    sealed_record_id: computeSealedRecordId(recordDraft),
  });
  const pair = validateEvidenceRecordPair(evidence, sealedRecord);

  const visibleArtifacts = new Map<string, ArtifactPayload>();
  addArtifact(visibleArtifacts, actionPlan);
  addArtifact(visibleArtifacts, captureSpec);
  for (const run of [baselineRun, candidateRun]) {
    for (const checkpoint of run.checkpoints) {
      addArtifact(visibleArtifacts, {
        reference: reference("image/png", checkpoint.screenshot),
        bytes: checkpoint.screenshot,
      });
      addArtifact(visibleArtifacts, {
        reference: reference(
          "application/vnd.impactdiff.accessibility+json",
          checkpoint.accessibility_tree,
        ),
        bytes: checkpoint.accessibility_tree,
      });
      addArtifact(visibleArtifacts, {
        reference: reference(
          "application/vnd.impactdiff.layout+json",
          checkpoint.layout_graph,
        ),
        bytes: checkpoint.layout_graph,
      });
    }
  }
  const sealedArtifacts = new Map<string, ArtifactPayload>();
  for (const payload of [
    sourceState,
    { reference: planReference, bytes: planBytes },
    { reference: preconditionReference, bytes: preconditionBytes },
    changedSurface,
    baselinePayloads.finalState,
    baselinePayloads.accessibility,
    baselinePayloads.rawTrace,
    candidatePayloads.finalState,
    candidatePayloads.accessibility,
    candidatePayloads.rawTrace,
  ]) {
    addArtifact(sealedArtifacts, payload);
  }
  if (localization !== null) addArtifact(sealedArtifacts, localization);
  for (const digest of visibleArtifacts.keys()) {
    if (sealedArtifacts.has(digest)) {
      fail(
        "generation.artifact_overlap",
        "visible and sealed artifacts share a content digest",
      );
    }
  }

  const resolved = validateResolvedEvidenceRecordBundle({
    manifest: pair.evidence,
    sealed_record: pair.sealedRecord,
    action_plan: actionPlan.bytes,
    capture_spec: captureSpec.bytes,
    pair: {
      baseline: {
        checkpoints: baselineRun.checkpoints.map((checkpoint) => ({
          screenshot: checkpoint.screenshot,
          accessibility_tree: checkpoint.accessibility_tree,
          layout_graph: checkpoint.layout_graph,
        })),
      },
      candidate: {
        checkpoints: candidateRun.checkpoints.map((checkpoint) => ({
          screenshot: checkpoint.screenshot,
          accessibility_tree: checkpoint.accessibility_tree,
          layout_graph: checkpoint.layout_graph,
        })),
      },
    },
    source_state: sourceState.bytes,
    mutation_plan: planBytes,
    precondition_report: preconditionBytes,
    changed_surface: changedSurface.bytes,
    execution: {
      baseline: {
        final_state_oracle: baselinePayloads.finalState.bytes,
        accessibility_oracle: baselinePayloads.accessibility.bytes,
        raw_trace: baselinePayloads.rawTrace.bytes,
      },
      candidate: {
        final_state_oracle: candidatePayloads.finalState.bytes,
        accessibility_oracle: candidatePayloads.accessibility.bytes,
        raw_trace: candidatePayloads.rawTrace.bytes,
      },
    },
    localization: localization?.bytes ?? null,
  });
  const publicationInput = Object.freeze({
    evidence: pair.evidence,
    sealed_record: pair.sealedRecord,
    visible_artifacts: publicationArtifacts(visibleArtifacts),
    sealed_artifacts: publicationArtifacts(sealedArtifacts),
  });
  return Object.freeze({ publicationInput, resolved });
}

export function deriveMutationFixturePair(
  input: MutationFixturePairDerivationInput,
): DerivedMutationFixturePair {
  try {
    return derivePair(input);
  } catch (error) {
    if (error instanceof FixturePairGenerationError) throw error;
    fail("generation.validation", "derived fixture pair failed full replay", error);
  }
}
