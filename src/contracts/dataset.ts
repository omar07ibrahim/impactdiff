import {
  checkArtifactSet,
  observationArtifacts,
  sealedArtifacts,
  visibleArtifacts,
} from "./artifacts.js";
import type { ArtifactRef } from "./artifacts.js";
import { assertNoIssues, issue } from "./errors.js";
import type { ContractIssue } from "./errors.js";
import { inputFailure, normalizedJsonValue } from "./input.js";
import type { SplitAudit } from "./schema.js";
import { validateEvidenceRecordPair, validateSplitBundle } from "./validate.js";
import type { EvidenceRecordPair, SplitBundle } from "./validate.js";

const partitionNames = ["train", "validation", "test"] as const;
type PartitionName = (typeof partitionNames)[number];
type Grouping = SplitAudit["items"][number]["grouping"];
type GroupingKey = keyof Grouping;

const allGroupingKeys: readonly GroupingKey[] = [
  "application_group_id",
  "source_state_group_id",
  "source_task_group_id",
  "near_duplicate_group_id",
  "asset_component_id",
  "mutation_family_group_id",
];

export interface DatasetPairInput {
  readonly evidence: unknown;
  readonly sealedRecord: unknown;
}

export interface DatasetBundle extends SplitBundle {
  readonly pairs: readonly EvidenceRecordPair[];
}

export function validateDatasetBundle(
  assignmentValue: unknown,
  auditValue: unknown,
  pairValues: readonly DatasetPairInput[],
): DatasetBundle;
export function validateDatasetBundle(
  assignmentValue: unknown,
  auditValue: unknown,
  pairValues: unknown,
): DatasetBundle {
  const { assignment, audit } = validateSplitBundle(assignmentValue, auditValue);
  const normalizedPairs = normalizedJsonValue(
    "impactdiff.dataset-bundle/v1",
    pairValues,
  );
  if (!Array.isArray(normalizedPairs)) {
    inputFailure(
      "impactdiff.dataset-bundle/v1",
      "dataset.pair_count",
      "/pairs",
      "pairs must be an array with at most 1000000 items",
    );
  }

  const pairs = normalizedPairs.map((pair, index) => {
    if (
      pair === null ||
      Array.isArray(pair) ||
      typeof pair !== "object" ||
      Object.keys(pair).length !== 2 ||
      !("evidence" in pair) ||
      !("sealedRecord" in pair)
    ) {
      inputFailure(
        "impactdiff.dataset-bundle/v1",
        "dataset.pair_shape",
        `/pairs/${index}`,
        "each pair must contain exactly evidence and sealedRecord",
      );
    }
    return validateEvidenceRecordPair(pair.evidence, pair.sealedRecord);
  });
  const issues: ContractIssue[] = [];
  const partitionByEvidence = new Map<string, PartitionName>();
  const assignmentOrder: string[] = [];
  for (const partition of partitionNames) {
    for (const evidenceId of assignment.partitions[partition]) {
      partitionByEvidence.set(evidenceId, partition);
      assignmentOrder.push(evidenceId);
    }
  }

  const auditByEvidence = new Map(
    audit.items.map((item) => [item.evidence_id, item] as const),
  );
  const pairByEvidence = new Map<string, EvidenceRecordPair>();
  const visibleRefs: ArtifactRef[] = [];
  const sealedRefs: ArtifactRef[] = [];
  const observationOwner = new Map<string, PartitionName>();
  const sourceStateOwner = new Map<string, PartitionName>();
  const mutationFamilyOwner = new Map<string, PartitionName>();
  const holdsOutMutationFamily =
    assignment.protocol === "mutation_family_holdout" ||
    assignment.protocol === "joint_application_and_family_holdout";
  let labelPolicyId: string | undefined;

  for (const pair of pairs) {
    const evidenceId = pair.evidence.evidence_id;
    if (pairByEvidence.has(evidenceId)) {
      issues.push(
        issue(
          "dataset.duplicate_pair",
          `/pairs/${evidenceId}`,
          "each evidence ID must have exactly one evidence-record pair",
        ),
      );
    } else {
      pairByEvidence.set(evidenceId, pair);
    }

    const partition = partitionByEvidence.get(evidenceId);
    if (partition === undefined) {
      issues.push(
        issue(
          "dataset.membership",
          `/pairs/${evidenceId}`,
          "every pair must belong to the split assignment",
        ),
      );
    }

    if (pair.evidence.feature_profile_id !== assignment.feature_profile_id) {
      issues.push(
        issue(
          "dataset.feature_profile",
          `/pairs/${evidenceId}/evidence/feature_profile_id`,
          "every evidence manifest must use the split feature profile",
        ),
      );
    }

    const auditItem = auditByEvidence.get(evidenceId);
    if (
      auditItem !== undefined &&
      allGroupingKeys.some(
        (key) => auditItem.grouping[key] !== pair.sealedRecord.grouping[key],
      )
    ) {
      issues.push(
        issue(
          "dataset.audit_grouping",
          `/pairs/${evidenceId}/sealedRecord/grouping`,
          "the split audit grouping must equal the sealed record grouping",
        ),
      );
    }

    if (labelPolicyId === undefined) {
      labelPolicyId = pair.sealedRecord.label_policy_id;
    } else if (labelPolicyId !== pair.sealedRecord.label_policy_id) {
      issues.push(
        issue(
          "dataset.label_policy",
          `/pairs/${evidenceId}/sealedRecord/label_policy_id`,
          "one split cannot mix label policies",
        ),
      );
    }

    visibleRefs.push(...visibleArtifacts(pair.evidence));
    sealedRefs.push(...sealedArtifacts(pair.sealedRecord));
    if (partition !== undefined) {
      const sourceOwner = sourceStateOwner.get(pair.evidence.source_state_id);
      if (sourceOwner !== undefined && sourceOwner !== partition) {
        issues.push(
          issue(
            "dataset.source_state_overlap",
            `/pairs/${evidenceId}/evidence/source_state_id`,
            "one canonical source state cannot cross partitions",
          ),
        );
      } else {
        sourceStateOwner.set(pair.evidence.source_state_id, partition);
      }

      if (holdsOutMutationFamily) {
        const familyId = pair.sealedRecord.intervention.family_id;
        const familyOwner = mutationFamilyOwner.get(familyId);
        if (familyOwner !== undefined && familyOwner !== partition) {
          issues.push(
            issue(
              "dataset.mutation_family_overlap",
              `/pairs/${evidenceId}/sealedRecord/intervention/family_id`,
              "one canonical mutation family cannot cross partitions",
            ),
          );
        } else {
          mutationFamilyOwner.set(familyId, partition);
        }
      }

      for (const ref of observationArtifacts(pair.evidence)) {
        const owner = observationOwner.get(ref.sha256);
        if (owner !== undefined && owner !== partition) {
          issues.push(
            issue(
              "dataset.artifact_partition_overlap",
              `/pairs/${evidenceId}/evidence`,
              "screenshot, accessibility, and layout artifacts cannot cross partitions",
            ),
          );
        } else {
          observationOwner.set(ref.sha256, partition);
        }
      }
    }
  }

  if (
    pairByEvidence.size !== partitionByEvidence.size ||
    assignmentOrder.some((evidenceId) => !pairByEvidence.has(evidenceId))
  ) {
    issues.push(
      issue(
        "dataset.membership",
        "/pairs",
        "pairs must cover exactly the split assignment membership",
      ),
    );
  }

  const visibleDigests = checkArtifactSet(
    visibleRefs,
    Number.MAX_SAFE_INTEGER,
    "/pairs/visible",
    issues,
  );
  const sealedDigests = checkArtifactSet(
    sealedRefs,
    Number.MAX_SAFE_INTEGER,
    "/pairs/sealed",
    issues,
  );
  if ([...visibleDigests].some((digest) => sealedDigests.has(digest))) {
    issues.push(
      issue(
        "dataset.cas_overlap",
        "/pairs",
        "visible and sealed stores cannot share a content digest across records",
      ),
    );
  }

  assertNoIssues("impactdiff.dataset-bundle/v1", issues);
  return Object.freeze({
    assignment,
    audit,
    pairs: Object.freeze(
      assignmentOrder.map((evidenceId) => pairByEvidence.get(evidenceId)!),
    ),
  });
}
