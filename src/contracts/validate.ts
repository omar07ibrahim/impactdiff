import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";

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

export interface ContractIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export class ContractValidationError extends Error {
  readonly contract: string;
  readonly issues: readonly ContractIssue[];

  constructor(contract: string, issues: readonly ContractIssue[]) {
    super(`${contract} failed validation with ${issues.length} issue(s)`);
    this.name = "ContractValidationError";
    this.contract = contract;
    this.issues = issues;
  }
}

interface ArtifactRef {
  readonly sha256: string;
  readonly byte_length: number;
  readonly media_type: string;
  readonly format_version: 1;
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const evidenceValidator = ajv.compile<EvidenceManifest>(evidenceManifestSchema);
const sealedRecordValidator = ajv.compile<SealedRecord>(sealedRecordSchema);
const splitAssignmentValidator = ajv.compile<SplitAssignment>(splitAssignmentSchema);
const splitAuditValidator = ajv.compile<SplitAudit>(splitAuditSchema);

const schemaIssues = (errors: ErrorObject[] | null | undefined): ContractIssue[] =>
  (errors ?? []).map((error) => ({
    code: `schema.${error.keyword}`,
    path: error.instancePath || "/",
    message: error.message ?? "schema constraint failed",
  }));

function assertSchema<T>(
  contract: string,
  validator: ValidateFunction<T>,
  value: unknown,
): asserts value is T {
  if (!validator(value)) {
    throw new ContractValidationError(contract, schemaIssues(validator.errors));
  }
}

const issue = (code: string, path: string, message: string): ContractIssue => ({
  code,
  path,
  message,
});

function assertNoIssues(contract: string, issues: ContractIssue[]): void {
  if (issues.length > 0) {
    throw new ContractValidationError(contract, issues);
  }
}

function checkArtifactSet(
  refs: readonly ArtifactRef[],
  maximumUniqueBytes: number,
  path: string,
  issues: ContractIssue[],
): Set<string> {
  const seen = new Map<string, ArtifactRef>();
  let uniqueBytes = 0;

  for (const ref of refs) {
    const prior = seen.get(ref.sha256);
    if (prior === undefined) {
      seen.set(ref.sha256, ref);
      uniqueBytes += ref.byte_length;
      continue;
    }

    if (
      prior.byte_length !== ref.byte_length ||
      prior.media_type !== ref.media_type ||
      prior.format_version !== ref.format_version
    ) {
      issues.push(
        issue(
          "artifact.metadata_conflict",
          path,
          "one digest has conflicting artifact metadata",
        ),
      );
    }
  }

  if (uniqueBytes > maximumUniqueBytes) {
    issues.push(
      issue(
        "artifact.total_bytes",
        path,
        `unique artifact bytes exceed ${maximumUniqueBytes}`,
      ),
    );
  }

  return new Set(seen.keys());
}

function visibleArtifacts(manifest: EvidenceManifest): ArtifactRef[] {
  const refs: ArtifactRef[] = [
    manifest.task.action_plan,
    manifest.environment.capture_spec,
  ];

  for (const capture of [manifest.pair.baseline, manifest.pair.candidate]) {
    for (const checkpoint of capture.checkpoints) {
      refs.push(
        checkpoint.screenshot,
        checkpoint.accessibility_tree,
        checkpoint.layout_graph,
      );
    }
  }

  return refs;
}

function sealedArtifacts(record: SealedRecord): ArtifactRef[] {
  const refs: ArtifactRef[] = [
    record.intervention.parameters,
    record.intervention.preconditions,
    record.intervention.changed_surface,
  ];

  for (const outcome of [record.execution.baseline, record.execution.candidate]) {
    refs.push(
      outcome.final_state_oracle,
      outcome.accessibility_oracle,
      outcome.raw_trace,
    );
  }

  if (record.labels.localization !== null) {
    refs.push(record.labels.localization);
  }

  return refs;
}

export function validateEvidenceManifest(value: unknown): EvidenceManifest {
  assertSchema("impactdiff.evidence/v1", evidenceValidator, value);

  const issues: ContractIssue[] = [];
  const baseline = value.pair.baseline;
  const candidate = value.pair.candidate;

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
  }

  checkArtifactSet(visibleArtifacts(value), 67_108_864, "/", issues);
  assertNoIssues("impactdiff.evidence/v1", issues);
  return value;
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
  assertSchema("impactdiff.sealed-record/v1", sealedRecordValidator, value);

  const issues: ContractIssue[] = [];
  const { baseline, candidate } = value.execution;
  const labels = value.labels;
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

  checkArtifactSet(sealedArtifacts(value), 33_554_432, "/", issues);
  assertNoIssues("impactdiff.sealed-record/v1", issues);
  return value;
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
  assertSchema("impactdiff.split-assignment/v1", splitAssignmentValidator, value);

  const issues: ContractIssue[] = [];
  const globallySeen = new Set<string>();
  for (const partition of partitionNames) {
    const ids = value.partitions[partition];
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

  assertNoIssues("impactdiff.split-assignment/v1", issues);
  return value;
}

export function validateSplitAudit(value: unknown): SplitAudit {
  assertSchema("impactdiff.split-audit/v1", splitAuditValidator, value);

  const issues: ContractIssue[] = [];
  const ids = value.items.map((item) => item.evidence_id);
  checkSortedUnique(ids, "/items", issues);
  assertNoIssues("impactdiff.split-audit/v1", issues);
  return value;
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
