import { createHash } from "node:crypto";

export const hex = (character: string) => character.repeat(64);
export const id = (prefix: string, character: string) => `${prefix}${hex(character)}`;
export const artifact = (mediaType: string, character: string, byteLength = 128) => ({
  sha256: createHash("sha256")
    .update(`${mediaType}:${character}`, "utf8")
    .digest("hex"),
  byte_length: byteLength,
  media_type: mediaType,
  format_version: 1,
});

export const checkpointId = id("idck1_", "7");
export const stepId = id("idst1_", "8");

export const checkpoint = (character: string) => ({
  checkpoint_id: checkpointId,
  ordinal: 0,
  screenshot: artifact("image/png", character, 4_096),
  accessibility_tree: artifact(
    "application/vnd.impactdiff.accessibility+json",
    character,
  ),
  layout_graph: artifact("application/vnd.impactdiff.layout+json", character),
});

export const evidence = {
  contract: "impactdiff.evidence",
  version: 1,
  evidence_id: id("idev1_", "a"),
  feature_profile_id: id("idfp1_", "b"),
  source_state_id: id("idss1_", "c"),
  task: {
    task_id: id("idtk1_", "d"),
    action_plan: artifact("application/vnd.impactdiff.action-plan+json", "1"),
  },
  environment: {
    environment_id: id("iden1_", "e"),
    capture_spec: artifact("application/vnd.impactdiff.capture-spec+json", "2"),
  },
  pair: {
    baseline: {
      capture_id: id("idcp1_", "f"),
      role: "baseline",
      checkpoints: [checkpoint("3")],
    },
    candidate: {
      capture_id: id("idcp1_", "0"),
      role: "candidate",
      checkpoints: [checkpoint("4")],
    },
  },
} as const;

export const grouping = {
  application_group_id: id("idag1_", "1"),
  source_state_group_id: id("idsg1_", "2"),
  source_task_group_id: id("idtg1_", "3"),
  near_duplicate_group_id: id("idng1_", "4"),
  asset_component_id: id("idac1_", "5"),
  mutation_family_group_id: id("idmg1_", "6"),
} as const;

export const outcome = (taskSuccess: boolean) => ({
  task_success: taskSuccess,
  final_state_oracle: artifact("application/vnd.impactdiff.oracle-result+json", "5"),
  accessibility_oracle: artifact("application/vnd.impactdiff.oracle-result+json", "6"),
  raw_trace: artifact("application/vnd.impactdiff.raw-trace+json", "7"),
  first_unsatisfied_step_id: taskSuccess ? null : stepId,
  recovery_actions: taskSuccess ? 0 : 2,
  virtual_elapsed_ms: 1_250,
});

export const sealedRecord = {
  contract: "impactdiff.sealed-record",
  version: 1,
  sealed_record_id: id("idsr1_", "9"),
  evidence_id: evidence.evidence_id,
  evidence_manifest_sha256: hex("a"),
  label_policy_id: id("idlp1_", "b"),
  grouping,
  intervention: {
    family_id: id("idmf1_", "c"),
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
    baseline: outcome(true),
    candidate: outcome(false),
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

export const splitAssignment = {
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

export const splitAudit = {
  contract: "impactdiff.split-audit",
  version: 1,
  split_audit_id: id("idsa1_", "e"),
  split_id: splitAssignment.split_id,
  assignment_sha256: hex("f"),
  policy_id: id("idpl1_", "0"),
  items: [
    { evidence_id: splitAssignment.partitions.train[0], grouping },
    { evidence_id: splitAssignment.partitions.validation[0], grouping },
    { evidence_id: splitAssignment.partitions.test[0], grouping },
  ],
} as const;
