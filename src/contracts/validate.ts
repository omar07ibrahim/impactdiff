import { Ajv2020 } from "ajv/dist/2020.js";

import { checkArtifactSet, sealedArtifacts, visibleArtifacts } from "./artifacts.js";
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
} from "./canonical.js";
import { assertNoIssues, issue } from "./errors.js";
import type { ContractIssue } from "./errors.js";
import { normalizedSchemaValue } from "./input.js";
import {
  evidenceManifestSchema,
  sealedRecordSchema,
  splitAssignmentSchema,
  splitAuditSchema,
} from "./schema.js";
import type {
  EvidenceManifest,
  SealedRecord,
  SplitAssignment,
  SplitAudit,
} from "./schema.js";

export { ContractValidationError } from "./errors.js";
export type { ContractIssue } from "./errors.js";

const ajv = new Ajv2020({ allErrors: true, ownProperties: true, strict: true });
const evidenceValidator = ajv.compile<EvidenceManifest>(evidenceManifestSchema);
const sealedRecordValidator = ajv.compile<SealedRecord>(sealedRecordSchema);
const splitAssignmentValidator = ajv.compile<SplitAssignment>(splitAssignmentSchema);
const splitAuditValidator = ajv.compile<SplitAudit>(splitAuditSchema);
const maximumVisibleUniqueBytes = 67_108_864;
const maximumSealedUniqueBytes = 8_388_608;

export function validateEvidenceManifest(value: unknown): EvidenceManifest {
  const manifest = normalizedSchemaValue(
    "impactdiff.evidence/v1",
    evidenceValidator,
    value,
  );

  const issues: ContractIssue[] = [];
  const baseline = manifest.pair.baseline;
  const candidate = manifest.pair.candidate;

  if (baseline.capture_id === candidate.capture_id) {
    issues.push(
      issue(
        "evidence.capture_id_reuse",
        "/pair",
        "baseline and candidate capture IDs must differ",
      ),
    );
  }

  if (baseline.checkpoints.length !== candidate.checkpoints.length) {
    issues.push(
      issue(
        "evidence.checkpoint_count",
        "/pair",
        "baseline and candidate checkpoint counts must match",
      ),
    );
  }

  const checkpointCount = Math.min(
    baseline.checkpoints.length,
    candidate.checkpoints.length,
  );
  const checkpointIds = new Set<string>();

  for (let index = 0; index < checkpointCount; index += 1) {
    const baselineCheckpoint = baseline.checkpoints[index];
    const candidateCheckpoint = candidate.checkpoints[index];
    if (baselineCheckpoint === undefined || candidateCheckpoint === undefined) {
      continue;
    }

    if (baselineCheckpoint.ordinal !== index) {
      issues.push(
        issue(
          "evidence.baseline_ordinal",
          `/pair/baseline/checkpoints/${index}/ordinal`,
          "checkpoint ordinals must be contiguous and zero-based",
        ),
      );
    }
    if (candidateCheckpoint.ordinal !== index) {
      issues.push(
        issue(
          "evidence.candidate_ordinal",
          `/pair/candidate/checkpoints/${index}/ordinal`,
          "checkpoint ordinals must be contiguous and zero-based",
        ),
      );
    }
    if (baselineCheckpoint.checkpoint_id !== candidateCheckpoint.checkpoint_id) {
      issues.push(
        issue(
          "evidence.checkpoint_identity",
          `/pair/candidate/checkpoints/${index}/checkpoint_id`,
          "paired checkpoint IDs must match",
        ),
      );
    }
    if (checkpointIds.has(baselineCheckpoint.checkpoint_id)) {
      issues.push(
        issue(
          "evidence.duplicate_checkpoint",
          `/pair/baseline/checkpoints/${index}/checkpoint_id`,
          "checkpoint IDs must be unique within an action plan",
        ),
      );
    }
    checkpointIds.add(baselineCheckpoint.checkpoint_id);

    const expectedCheckpointId = computeCheckpointId(manifest.task.action_plan, index);
    if (baselineCheckpoint.checkpoint_id !== expectedCheckpointId) {
      issues.push(
        issue(
          "evidence.checkpoint_derivation",
          `/pair/baseline/checkpoints/${index}/checkpoint_id`,
          "checkpoint IDs must be derived from the action plan and ordinal",
        ),
      );
    }
  }

  checkArtifactSet(visibleArtifacts(manifest), maximumVisibleUniqueBytes, "/", issues);
  if (manifest.task.task_id !== computeTaskId(manifest.task.action_plan)) {
    issues.push(
      issue(
        "evidence.task_identity",
        "/task/task_id",
        "task_id must be derived from the action-plan reference",
      ),
    );
  }
  if (
    manifest.feature_profile_id !==
    computeFeatureProfileId(manifest.environment.capture_spec)
  ) {
    issues.push(
      issue(
        "evidence.feature_profile_identity",
        "/feature_profile_id",
        "feature_profile_id must be derived from the capture-spec reference",
      ),
    );
  }
  if (
    manifest.environment.environment_id !==
    computeEnvironmentId(manifest.environment.capture_spec)
  ) {
    issues.push(
      issue(
        "evidence.environment_identity",
        "/environment/environment_id",
        "environment_id must be derived from the capture-spec reference",
      ),
    );
  }
  if (baseline.capture_id !== computeCaptureId(baseline)) {
    issues.push(
      issue(
        "evidence.baseline_capture_identity",
        "/pair/baseline/capture_id",
        "capture_id must be derived from the canonical baseline capture body",
      ),
    );
  }
  if (candidate.capture_id !== computeCaptureId(candidate)) {
    issues.push(
      issue(
        "evidence.candidate_capture_identity",
        "/pair/candidate/capture_id",
        "capture_id must be derived from the canonical candidate capture body",
      ),
    );
  }
  if (manifest.evidence_id !== computeEvidenceId(manifest)) {
    issues.push(
      issue(
        "evidence.identity",
        "/evidence_id",
        "evidence_id must be derived from the canonical manifest body",
      ),
    );
  }
  assertNoIssues("impactdiff.evidence/v1", issues);
  return manifest;
}

type Outcome = SealedRecord["execution"]["baseline"];

function checkOutcome(
  name: "baseline" | "candidate",
  outcome: Outcome,
  issues: ContractIssue[],
): void {
  if (outcome.task_success && outcome.first_unsatisfied_step_id !== null) {
    issues.push(
      issue(
        "record.success_has_failed_step",
        `/execution/${name}/first_unsatisfied_step_id`,
        "a successful outcome cannot have an unsatisfied step",
      ),
    );
  }
  if (!outcome.task_success && outcome.first_unsatisfied_step_id === null) {
    issues.push(
      issue(
        "record.failure_missing_step",
        `/execution/${name}/first_unsatisfied_step_id`,
        "a failed outcome must identify its first unsatisfied step",
      ),
    );
  }
}

export function validateSealedRecord(value: unknown): SealedRecord {
  const record = normalizedSchemaValue(
    "impactdiff.sealed-record/v1",
    sealedRecordValidator,
    value,
  );

  const issues: ContractIssue[] = [];
  const { baseline, candidate } = record.execution;
  const labels = record.labels;
  checkOutcome("baseline", baseline, issues);
  checkOutcome("candidate", candidate, issues);

  if (!labels.sample_valid) {
    if (labels.invalid_reason === null) {
      issues.push(
        issue(
          "record.invalid_without_reason",
          "/labels/invalid_reason",
          "an invalid sample must have a reason",
        ),
      );
    }
    if (
      labels.task_regression !== null ||
      labels.severity_ordinal !== null ||
      labels.first_failed_step_id !== null ||
      labels.localization !== null
    ) {
      issues.push(
        issue(
          "record.invalid_has_labels",
          "/labels",
          "an invalid sample cannot carry benchmark labels",
        ),
      );
    }
    if (!baseline.task_success && labels.invalid_reason !== "baseline_failed") {
      issues.push(
        issue(
          "record.baseline_failure_reason",
          "/labels/invalid_reason",
          "a failed baseline must use the baseline_failed reason",
        ),
      );
    }
    if (baseline.task_success && labels.invalid_reason === "baseline_failed") {
      issues.push(
        issue(
          "record.spurious_baseline_failure_reason",
          "/labels/invalid_reason",
          "baseline_failed is valid only when the baseline task failed",
        ),
      );
    }
  } else {
    if (labels.invalid_reason !== null) {
      issues.push(
        issue(
          "record.valid_has_reason",
          "/labels/invalid_reason",
          "a valid sample cannot have an invalid reason",
        ),
      );
    }
    if (!baseline.task_success) {
      issues.push(
        issue(
          "record.valid_failed_baseline",
          "/execution/baseline/task_success",
          "a valid sample requires a successful baseline",
        ),
      );
    }

    const expectedRegression = !candidate.task_success;
    if (labels.task_regression !== expectedRegression) {
      issues.push(
        issue(
          "record.derived_regression",
          "/labels/task_regression",
          "task_regression must be derived from the candidate outcome",
        ),
      );
    }

    if (expectedRegression) {
      if (labels.severity_ordinal === null || labels.severity_ordinal < 1) {
        issues.push(
          issue(
            "record.regression_severity",
            "/labels/severity_ordinal",
            "a task regression must have non-zero severity",
          ),
        );
      }
      if (
        labels.first_failed_step_id === null ||
        labels.first_failed_step_id !== candidate.first_unsatisfied_step_id
      ) {
        issues.push(
          issue(
            "record.derived_failed_step",
            "/labels/first_failed_step_id",
            "the failed-step label must match the candidate outcome",
          ),
        );
      }
      if (labels.localization === null) {
        issues.push(
          issue(
            "record.regression_localization",
            "/labels/localization",
            "a task regression must have localization ground truth",
          ),
        );
      }
    } else if (
      labels.severity_ordinal !== 0 ||
      labels.first_failed_step_id !== null ||
      labels.localization !== null
    ) {
      issues.push(
        issue(
          "record.non_regression_labels",
          "/labels",
          "a passing candidate must have zero severity and no failure labels",
        ),
      );
    }
  }

  const outcomeFieldsDiffer =
    baseline.task_success !== candidate.task_success ||
    baseline.first_unsatisfied_step_id !== candidate.first_unsatisfied_step_id ||
    baseline.recovery_actions !== candidate.recovery_actions ||
    baseline.virtual_elapsed_ms !== candidate.virtual_elapsed_ms;
  if (
    outcomeFieldsDiffer &&
    baseline.final_state_oracle.sha256 === candidate.final_state_oracle.sha256 &&
    baseline.accessibility_oracle.sha256 === candidate.accessibility_oracle.sha256 &&
    baseline.raw_trace.sha256 === candidate.raw_trace.sha256
  ) {
    issues.push(
      issue(
        "record.outcome_artifact_contradiction",
        "/execution",
        "different outcomes must be supported by different oracle or trace artifacts",
      ),
    );
  }

  checkArtifactSet(sealedArtifacts(record), maximumSealedUniqueBytes, "/", issues);
  if (record.sealed_record_id !== computeSealedRecordId(record)) {
    issues.push(
      issue(
        "record.identity",
        "/sealed_record_id",
        "sealed_record_id must be derived from the canonical record body",
      ),
    );
  }
  assertNoIssues("impactdiff.sealed-record/v1", issues);
  return record;
}

const partitionNames = ["train", "validation", "test"] as const;
type PartitionName = (typeof partitionNames)[number];

function checkSortedUnique(
  values: readonly string[],
  path: string,
  issues: ContractIssue[],
): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous !== undefined && current !== undefined && previous >= current) {
      issues.push(
        issue(
          "split.noncanonical_order",
          `${path}/${index}`,
          "IDs must be strictly sorted",
        ),
      );
    }
  }
}

export function validateSplitAssignment(value: unknown): SplitAssignment {
  const assignment = normalizedSchemaValue(
    "impactdiff.split-assignment/v1",
    splitAssignmentValidator,
    value,
  );

  const issues: ContractIssue[] = [];
  const globallySeen = new Set<string>();
  for (const partition of partitionNames) {
    const ids = assignment.partitions[partition];
    checkSortedUnique(ids, `/partitions/${partition}`, issues);
    for (const evidenceId of ids) {
      if (globallySeen.has(evidenceId)) {
        issues.push(
          issue(
            "split.cross_partition_duplicate",
            `/partitions/${partition}`,
            "an evidence ID can occur in only one partition",
          ),
        );
      }
      globallySeen.add(evidenceId);
    }
  }

  if (globallySeen.size > 1_000_000) {
    issues.push(
      issue(
        "split.total_items",
        "/partitions",
        "a split cannot contain more than 1000000 evidence IDs",
      ),
    );
  }

  if (assignment.split_id !== computeSplitId(assignment)) {
    issues.push(
      issue(
        "split.identity",
        "/split_id",
        "split_id must be derived from the canonical assignment body",
      ),
    );
  }
  assertNoIssues("impactdiff.split-assignment/v1", issues);
  return assignment;
}

export function validateSplitAudit(value: unknown): SplitAudit {
  const audit = normalizedSchemaValue(
    "impactdiff.split-audit/v1",
    splitAuditValidator,
    value,
  );

  const issues: ContractIssue[] = [];
  const ids = audit.items.map((item) => item.evidence_id);
  checkSortedUnique(ids, "/items", issues);
  if (audit.split_audit_id !== computeSplitAuditId(audit)) {
    issues.push(
      issue(
        "split_audit.identity",
        "/split_audit_id",
        "split_audit_id must be derived from the canonical audit body",
      ),
    );
  }
  assertNoIssues("impactdiff.split-audit/v1", issues);
  return audit;
}

export interface EvidenceRecordPair {
  readonly evidence: EvidenceManifest;
  readonly sealedRecord: SealedRecord;
}

export function validateEvidenceRecordPair(
  evidenceValue: unknown,
  sealedRecordValue: unknown,
): EvidenceRecordPair {
  const evidence = validateEvidenceManifest(evidenceValue);
  const sealedRecord = validateSealedRecord(sealedRecordValue);
  const issues: ContractIssue[] = [];

  if (evidence.evidence_id !== sealedRecord.evidence_id) {
    issues.push(
      issue(
        "pair.evidence_id",
        "/evidence_id",
        "visible and sealed records must use the same evidence ID",
      ),
    );
  }

  if (sealedRecord.evidence_manifest_sha256 !== canonicalSha256(evidence)) {
    issues.push(
      issue(
        "pair.manifest_digest",
        "/evidence_manifest_sha256",
        "the sealed record must bind the exact canonical evidence manifest",
      ),
    );
  }

  if (
    evidence.source_state_id !==
    computeSourceStateId(sealedRecord.provenance.source_state)
  ) {
    issues.push(
      issue(
        "pair.source_state_identity",
        "/provenance/source_state",
        "visible source_state_id must be derived from sealed source-state provenance",
      ),
    );
  }

  if (
    sealedRecord.grouping.source_state_group_id !==
    computeSourceStateGroupId(evidence.source_state_id)
  ) {
    issues.push(
      issue(
        "pair.source_state_group",
        "/grouping/source_state_group_id",
        "source-state grouping must be derived from the visible source identity",
      ),
    );
  }
  if (
    sealedRecord.grouping.mutation_family_group_id !==
    computeMutationFamilyGroupId(sealedRecord.intervention.family_id)
  ) {
    issues.push(
      issue(
        "pair.mutation_family_group",
        "/grouping/mutation_family_group_id",
        "mutation-family grouping must be derived from intervention family_id",
      ),
    );
  }

  const visibleDigests = new Set(visibleArtifacts(evidence).map((ref) => ref.sha256));
  if (sealedArtifacts(sealedRecord).some((ref) => visibleDigests.has(ref.sha256))) {
    issues.push(
      issue(
        "pair.cas_overlap",
        "/",
        "visible and sealed artifacts must not share content digests",
      ),
    );
  }

  assertNoIssues("impactdiff.evidence-record-pair/v1", issues);
  return { evidence, sealedRecord };
}

type Grouping = SplitAudit["items"][number]["grouping"];
type GroupingKey = keyof Grouping;

const alwaysDisjointGroups: readonly GroupingKey[] = [
  "source_state_group_id",
  "source_task_group_id",
  "near_duplicate_group_id",
  "asset_component_id",
];

function groupsForProtocol(protocol: SplitAssignment["protocol"]): GroupingKey[] {
  const keys = [...alwaysDisjointGroups];
  if (
    protocol === "application_holdout" ||
    protocol === "joint_application_and_family_holdout"
  ) {
    keys.push("application_group_id");
  }
  if (
    protocol === "mutation_family_holdout" ||
    protocol === "joint_application_and_family_holdout"
  ) {
    keys.push("mutation_family_group_id");
  }
  return keys;
}

export interface SplitBundle {
  readonly assignment: SplitAssignment;
  readonly audit: SplitAudit;
}

export function validateSplitBundle(
  assignmentValue: unknown,
  auditValue: unknown,
): SplitBundle {
  const assignment = validateSplitAssignment(assignmentValue);
  const audit = validateSplitAudit(auditValue);
  const issues: ContractIssue[] = [];

  if (assignment.split_id !== audit.split_id) {
    issues.push(
      issue(
        "split_bundle.split_id",
        "/split_id",
        "assignment and audit split IDs must match",
      ),
    );
  }

  if (audit.assignment_sha256 !== canonicalSha256(assignment)) {
    issues.push(
      issue(
        "split_bundle.assignment_digest",
        "/assignment_sha256",
        "the sealed audit must bind the exact canonical split assignment",
      ),
    );
  }

  const partitionByEvidence = new Map<string, PartitionName>();
  for (const partition of partitionNames) {
    for (const evidenceId of assignment.partitions[partition]) {
      partitionByEvidence.set(evidenceId, partition);
    }
  }

  const auditIds = new Set(audit.items.map((item) => item.evidence_id));
  if (
    auditIds.size !== partitionByEvidence.size ||
    [...partitionByEvidence.keys()].some((evidenceId) => !auditIds.has(evidenceId))
  ) {
    issues.push(
      issue(
        "split_bundle.membership",
        "/items",
        "the audit must contain exactly the assigned evidence IDs",
      ),
    );
  }

  for (const groupingKey of groupsForProtocol(assignment.protocol)) {
    const ownerByGroup = new Map<string, PartitionName>();
    for (const item of audit.items) {
      const partition = partitionByEvidence.get(item.evidence_id);
      if (partition === undefined) {
        continue;
      }
      const groupId = item.grouping[groupingKey];
      const owner = ownerByGroup.get(groupId);
      if (owner !== undefined && owner !== partition) {
        issues.push(
          issue(
            "split_bundle.group_overlap",
            `/items/${item.evidence_id}/${groupingKey}`,
            `${groupingKey} crosses a partition boundary`,
          ),
        );
      } else {
        ownerByGroup.set(groupId, partition);
      }
    }
  }

  assertNoIssues("impactdiff.split-bundle/v1", issues);
  return { assignment, audit };
}
