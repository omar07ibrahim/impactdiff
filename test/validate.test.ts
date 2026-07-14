import assert from "node:assert/strict";
import test from "node:test";

import {
  ContractValidationError,
  validateEvidenceManifest,
  validateEvidenceRecordPair,
  validateSealedRecord,
  validateSplitAssignment,
  validateSplitAudit,
  validateSplitBundle,
} from "../src/contracts/validate.js";
import {
  evidence,
  grouping,
  id,
  sealedRecord,
  splitAssignment,
  splitAudit,
} from "./fixtures.js";

const expectIssue = (operation: () => unknown, expectedCode: string): void => {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof ContractValidationError);
    assert.ok(
      error.issues.some((candidate) => candidate.code === expectedCode),
      `expected ${expectedCode}, received ${error.issues.map(({ code }) => code).join(", ")}`,
    );
    return true;
  });
};

const groupingFor = (character: string) => ({
  application_group_id: id("idag1_", character),
  source_state_group_id: id("idsg1_", character),
  source_task_group_id: id("idtg1_", character),
  near_duplicate_group_id: id("idng1_", character),
  asset_component_id: id("idac1_", character),
  mutation_family_group_id: id("idmg1_", character),
});

const disjointSplitAudit = {
  ...splitAudit,
  items: [
    {
      evidence_id: splitAssignment.partitions.train[0],
      grouping: groupingFor("1"),
    },
    {
      evidence_id: splitAssignment.partitions.validation[0],
      grouping: groupingFor("2"),
    },
    {
      evidence_id: splitAssignment.partitions.test[0],
      grouping: groupingFor("3"),
    },
  ],
};

test("semantically consistent contract bundles validate", () => {
  assert.equal(validateEvidenceManifest(evidence), evidence);
  assert.equal(validateSealedRecord(sealedRecord), sealedRecord);
  assert.equal(validateSplitAssignment(splitAssignment), splitAssignment);
  assert.equal(validateSplitAudit(disjointSplitAudit), disjointSplitAudit);
  assert.deepEqual(validateEvidenceRecordPair(evidence, sealedRecord), {
    evidence,
    sealedRecord,
  });
  assert.deepEqual(validateSplitBundle(splitAssignment, disjointSplitAudit), {
    assignment: splitAssignment,
    audit: disjointSplitAudit,
  });
});

test("paired checkpoints must have the same opaque identity", () => {
  const mismatch = {
    ...evidence,
    pair: {
      ...evidence.pair,
      candidate: {
        ...evidence.pair.candidate,
        checkpoints: [
          {
            ...evidence.pair.candidate.checkpoints[0],
            checkpoint_id: id("idck1_", "9"),
          },
        ],
      },
    },
  };

  expectIssue(() => validateEvidenceManifest(mismatch), "evidence.checkpoint_identity");
});

test("one capture identity cannot describe both roles", () => {
  const reused = {
    ...evidence,
    pair: {
      ...evidence.pair,
      candidate: {
        ...evidence.pair.candidate,
        capture_id: evidence.pair.baseline.capture_id,
      },
    },
  };

  expectIssue(() => validateEvidenceManifest(reused), "evidence.capture_id_reuse");
});

test("one content digest cannot claim two artifact identities", () => {
  const conflict = {
    ...evidence,
    pair: {
      ...evidence.pair,
      candidate: {
        ...evidence.pair.candidate,
        checkpoints: [
          {
            ...evidence.pair.candidate.checkpoints[0],
            screenshot: {
              ...evidence.pair.candidate.checkpoints[0].screenshot,
              sha256: evidence.pair.candidate.checkpoints[0].accessibility_tree.sha256,
            },
          },
        ],
      },
    },
  };

  expectIssue(() => validateEvidenceManifest(conflict), "artifact.metadata_conflict");
});

test("task-regression labels are derived from outcomes", () => {
  const contradictory = {
    ...sealedRecord,
    labels: { ...sealedRecord.labels, task_regression: false },
  };

  expectIssue(() => validateSealedRecord(contradictory), "record.derived_regression");
});

test("invalid samples cannot retain benchmark targets", () => {
  const invalidWithLabels = {
    ...sealedRecord,
    labels: {
      ...sealedRecord.labels,
      sample_valid: false,
      invalid_reason: "oracle_inconclusive",
    },
  };

  expectIssue(
    () => validateSealedRecord(invalidWithLabels),
    "record.invalid_has_labels",
  );
});

test("outcome success cannot carry a failed step", () => {
  const inconsistentOutcome = {
    ...sealedRecord,
    execution: {
      ...sealedRecord.execution,
      baseline: {
        ...sealedRecord.execution.baseline,
        first_unsatisfied_step_id: id("idst1_", "f"),
      },
    },
  };

  expectIssue(
    () => validateSealedRecord(inconsistentOutcome),
    "record.success_has_failed_step",
  );
});

test("visible and sealed stores cannot reference the same object", () => {
  const overlappingRecord = {
    ...sealedRecord,
    intervention: {
      ...sealedRecord.intervention,
      parameters: {
        ...sealedRecord.intervention.parameters,
        sha256: evidence.task.action_plan.sha256,
      },
    },
  };

  expectIssue(
    () => validateEvidenceRecordPair(evidence, overlappingRecord),
    "pair.cas_overlap",
  );
});

test("an evidence ID cannot cross assignment partitions", () => {
  const overlap = {
    ...splitAssignment,
    partitions: {
      ...splitAssignment.partitions,
      validation: [splitAssignment.partitions.train[0]],
    },
  };

  expectIssue(
    () => validateSplitAssignment(overlap),
    "split.cross_partition_duplicate",
  );
});

test("split IDs are strictly sorted for canonical review", () => {
  const unsorted = {
    ...splitAssignment,
    partitions: {
      ...splitAssignment.partitions,
      train: [id("idev1_", "2"), id("idev1_", "1")],
    },
  };

  expectIssue(() => validateSplitAssignment(unsorted), "split.noncanonical_order");
});

test("joint holdouts reject grouping overlap", () => {
  assert.deepEqual(splitAudit.items[0]?.grouping, grouping);

  expectIssue(
    () => validateSplitBundle(splitAssignment, splitAudit),
    "split_bundle.group_overlap",
  );
});

test("the sealed audit must cover the exact visible membership", () => {
  const wrongMembership = {
    ...disjointSplitAudit,
    items: [
      disjointSplitAudit.items[0],
      disjointSplitAudit.items[1],
      {
        evidence_id: id("idev1_", "4"),
        grouping: groupingFor("4"),
      },
    ],
  };

  expectIssue(
    () => validateSplitBundle(splitAssignment, wrongMembership),
    "split_bundle.membership",
  );
});
