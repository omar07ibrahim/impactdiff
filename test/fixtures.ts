import { createHash } from "node:crypto";

import {
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
  computeSplitAuditId,
  computeSplitId,
  computeTaskId,
} from "../src/contracts/canonical.js";

export const hex = (character: string) => character.repeat(64);
export const id = (prefix: string, character: string) => `${prefix}${hex(character)}`;
export const artifact = <const MediaType extends string>(
  mediaType: MediaType,
  character: string,
  byteLength = 128,
) => ({
  sha256: createHash("sha256")
    .update(`${mediaType}:${character}`, "utf8")
    .digest("hex"),
  byte_length: byteLength,
  media_type: mediaType,
  format_version: 1 as const,
});

export const stepId = id("idst1_", "8");
export const actionPlan = artifact("application/vnd.impactdiff.action-plan+json", "1");
export const captureSpec = artifact(
  "application/vnd.impactdiff.capture-spec+json",
  "2",
);
export const checkpointId = computeCheckpointId(actionPlan, 0);

export const checkpoint = (character: string, ordinal = 0) => ({
  checkpoint_id: computeCheckpointId(actionPlan, ordinal),
  ordinal,
  screenshot: artifact("image/png", character, 4_096),
  accessibility_tree: artifact(
    "application/vnd.impactdiff.accessibility+json",
    character,
  ),
  layout_graph: artifact("application/vnd.impactdiff.layout+json", character),
});

const baselineDraft = {
  capture_id: id("idcp1_", "f"),
  role: "baseline",
  checkpoints: [checkpoint("3")],
} as const;
const baseline = {
  ...baselineDraft,
  capture_id: computeCaptureId(baselineDraft),
} as const;
const candidateDraft = {
  capture_id: id("idcp1_", "0"),
  role: "candidate",
  checkpoints: [checkpoint("4")],
} as const;
const candidate = {
  ...candidateDraft,
  capture_id: computeCaptureId(candidateDraft),
} as const;
const evidenceWithoutSourceIdentity = {
  contract: "impactdiff.evidence",
  version: 1,
  evidence_id: id("idev1_", "a"),
  feature_profile_id: computeFeatureProfileId(captureSpec),
  source_state_id: id("idss1_", "c"),
  task: {
    task_id: computeTaskId(actionPlan),
    action_plan: actionPlan,
  },
  environment: {
    environment_id: computeEnvironmentId(captureSpec),
    capture_spec: captureSpec,
  },
  pair: {
    baseline,
    candidate,
  },
} as const;

const evidenceDraft = {
  ...evidenceWithoutSourceIdentity,
  source_state_id: computeSourceStateId(evidenceWithoutSourceIdentity),
} as const;

export const evidence = {
  ...evidenceDraft,
  evidence_id: computeEvidenceId(evidenceDraft),
} as const;

export const familyId = id("idmf1_", "c");

export const grouping = {
  application_group_id: id("idag1_", "1"),
  source_state_group_id: computeSourceStateGroupId(evidence.source_state_id),
  source_task_group_id: id("idtg1_", "3"),
  near_duplicate_group_id: id("idng1_", "4"),
  asset_component_id: id("idac1_", "5"),
  mutation_family_group_id: computeMutationFamilyGroupId(familyId),
} as const;

export const outcome = (taskSuccess: boolean, discriminator = "default") => ({
  task_success: taskSuccess,
  final_state_oracle: artifact(
    "application/vnd.impactdiff.oracle-result+json",
    `${discriminator}:final`,
  ),
  accessibility_oracle: artifact(
    "application/vnd.impactdiff.oracle-result+json",
    `${discriminator}:accessibility`,
  ),
  raw_trace: artifact(
    "application/vnd.impactdiff.raw-trace+json",
    `${discriminator}:trace`,
  ),
  first_unsatisfied_step_id: taskSuccess ? null : stepId,
  recovery_actions: taskSuccess ? 0 : 2,
  virtual_elapsed_ms: 1_250,
});

const sealedRecordDraft = {
  contract: "impactdiff.sealed-record",
  version: 1,
  sealed_record_id: id("idsr1_", "9"),
  evidence_id: evidence.evidence_id,
  evidence_manifest_sha256: canonicalSha256(evidence),
  label_policy_id: id("idlp1_", "b"),
  grouping,
  intervention: {
    family_id: familyId,
    operator_id: id("idop1_", "d"),
    operator_version: 1,
    instance_id: id("idmi1_", "e"),
    parameters: artifact(
      "application/vnd.impactdiff.intervention-parameters+json",
      "8",
    ),
    preconditions: artifact(
      "application/vnd.impactdiff.intervention-preconditions+json",
      "9",
    ),
    changed_surface: artifact("application/vnd.impactdiff.changed-surface+json", "a"),
    expected_task_relation: "break",
  },
  execution: {
    baseline: outcome(true, "baseline"),
    candidate: outcome(false, "candidate"),
  },
  labels: {
    sample_valid: true,
    invalid_reason: null,
    task_regression: true,
    severity_ordinal: 2,
    first_failed_step_id: stepId,
    localization: artifact("application/vnd.impactdiff.localization+json", "b"),
  },
} as const;

export const sealedRecord = {
  ...sealedRecordDraft,
  sealed_record_id: computeSealedRecordId(sealedRecordDraft),
} as const;

const splitAssignmentDraft = {
  contract: "impactdiff.split-assignment",
  version: 1,
  split_id: id("idsp1_", "c"),
  dataset_id: id("idds1_", "d"),
  feature_profile_id: evidence.feature_profile_id,
  protocol: "joint_application_and_family_holdout",
  partitions: {
    train: [id("idev1_", "1")],
    validation: [id("idev1_", "2")],
    test: [id("idev1_", "3")],
  },
} as const;

export const splitAssignment = {
  ...splitAssignmentDraft,
  split_id: computeSplitId(splitAssignmentDraft),
} as const;

const splitAuditDraft = {
  contract: "impactdiff.split-audit",
  version: 1,
  split_audit_id: id("idsa1_", "e"),
  split_id: splitAssignment.split_id,
  assignment_sha256: canonicalSha256(splitAssignment),
  policy_id: id("idpl1_", "0"),
  items: [
    { evidence_id: splitAssignment.partitions.train[0], grouping },
    { evidence_id: splitAssignment.partitions.validation[0], grouping },
    { evidence_id: splitAssignment.partitions.test[0], grouping },
  ],
} as const;

export const splitAudit = {
  ...splitAuditDraft,
  split_audit_id: computeSplitAuditId(splitAuditDraft),
} as const;
