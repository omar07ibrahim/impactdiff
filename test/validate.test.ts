import assert from "node:assert/strict";
import test from "node:test";

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
import type {
  EvidenceManifest,
  SealedRecord,
  SplitAssignment,
  SplitAudit,
} from "../src/contracts/schema.js";
import { validateDatasetBundle } from "../src/contracts/dataset.js";
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
  artifact,
  checkpoint,
  evidence,
  grouping,
  id,
  outcome,
  sealedRecord,
  sourceState,
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

const reidentifyEvidence = (value: object): EvidenceManifest => {
  const draft = {
    ...(value as EvidenceManifest),
    evidence_id: id("idev1_", "0"),
  };
  return { ...draft, evidence_id: computeEvidenceId(draft) };
};

const sourceStateRefsById = new Map<string, typeof sourceState>([
  [computeSourceStateId(sourceState), sourceState],
]);

const rederiveEvidence = (
  value: EvidenceManifest,
  sourceStateReference: typeof sourceState = sourceState,
): EvidenceManifest => {
  const baselineDraft = {
    ...value.pair.baseline,
    capture_id: id("idcp1_", "0"),
    checkpoints: value.pair.baseline.checkpoints.map((item, ordinal) => ({
      ...item,
      checkpoint_id: computeCheckpointId(value.task.action_plan, ordinal),
    })),
  };
  const candidateDraft = {
    ...value.pair.candidate,
    capture_id: id("idcp1_", "0"),
    checkpoints: value.pair.candidate.checkpoints.map((item, ordinal) => ({
      ...item,
      checkpoint_id: computeCheckpointId(value.task.action_plan, ordinal),
    })),
  };
  const draft = {
    ...value,
    evidence_id: id("idev1_", "0"),
    feature_profile_id: computeFeatureProfileId(value.environment.capture_spec),
    source_state_id: computeSourceStateId(sourceStateReference),
    task: {
      ...value.task,
      task_id: computeTaskId(value.task.action_plan),
    },
    environment: {
      ...value.environment,
      environment_id: computeEnvironmentId(value.environment.capture_spec),
    },
    pair: {
      baseline: {
        ...baselineDraft,
        capture_id: computeCaptureId(baselineDraft),
      },
      candidate: {
        ...candidateDraft,
        capture_id: computeCaptureId(candidateDraft),
      },
    },
  } satisfies EvidenceManifest;
  const identified = { ...draft, evidence_id: computeEvidenceId(draft) };
  sourceStateRefsById.set(identified.source_state_id, sourceStateReference);
  return identified;
};

const reidentifyRecord = (value: SealedRecord): SealedRecord => {
  const draft = { ...value, sealed_record_id: id("idsr1_", "0") };
  return { ...draft, sealed_record_id: computeSealedRecordId(draft) };
};

const reidentifyAssignment = (value: SplitAssignment): SplitAssignment => {
  const draft = { ...value, split_id: id("idsp1_", "0") };
  return { ...draft, split_id: computeSplitId(draft) };
};

const reidentifyAudit = (value: SplitAudit): SplitAudit => {
  const draft = { ...value, split_audit_id: id("idsa1_", "0") };
  return { ...draft, split_audit_id: computeSplitAuditId(draft) };
};

const disjointSplitAuditDraft = {
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
const disjointSplitAudit = reidentifyAudit(disjointSplitAuditDraft);

const evidenceFor = (discriminator: string): EvidenceManifest => {
  const sourceStateReference = artifact(
    "application/vnd.impactdiff.source-state+json",
    `${discriminator}:source-state`,
  );
  return rederiveEvidence(
    {
      ...evidence,
      pair: {
        baseline: {
          ...evidence.pair.baseline,
          checkpoints: [
            {
              ...checkpoint(`${discriminator}:baseline`),
              screenshot: artifact("image/png", `${discriminator}:baseline`, 4_096),
            },
          ],
        },
        candidate: {
          ...evidence.pair.candidate,
          checkpoints: [
            {
              ...checkpoint(`${discriminator}:candidate`),
              screenshot: artifact("image/png", `${discriminator}:candidate`, 4_096),
            },
          ],
        },
      },
    },
    sourceStateReference,
  );
};

const recordFor = (
  manifest: EvidenceManifest,
  itemGrouping: SealedRecord["grouping"],
  discriminator: string,
  familyCharacter: string,
): SealedRecord => {
  const recordFamilyId = id("idmf1_", familyCharacter);
  const sourceStateReference = sourceStateRefsById.get(manifest.source_state_id);
  assert.ok(sourceStateReference, "test manifest source provenance must be known");
  return reidentifyRecord({
    ...sealedRecord,
    evidence_id: manifest.evidence_id,
    evidence_manifest_sha256: canonicalSha256(manifest),
    provenance: {
      source_state: sourceStateReference,
    },
    grouping: {
      ...itemGrouping,
      source_state_group_id: computeSourceStateGroupId(manifest.source_state_id),
      mutation_family_group_id: computeMutationFamilyGroupId(recordFamilyId),
    },
    intervention: {
      ...sealedRecord.intervention,
      family_id: recordFamilyId,
      parameters: artifact(
        "application/vnd.impactdiff.intervention-parameters+json",
        `${discriminator}:parameters`,
      ),
      preconditions: artifact(
        "application/vnd.impactdiff.intervention-preconditions+json",
        `${discriminator}:preconditions`,
      ),
      changed_surface: artifact(
        "application/vnd.impactdiff.changed-surface+json",
        `${discriminator}:surface`,
      ),
    },
    execution: {
      baseline: outcome(true, `${discriminator}:baseline`),
      candidate: outcome(false, `${discriminator}:candidate`),
    },
    labels: {
      ...sealedRecord.labels,
      localization: artifact(
        "application/vnd.impactdiff.localization+json",
        `${discriminator}:localization`,
      ),
    },
  });
};

const datasetFixture = (
  manifests: readonly EvidenceManifest[] = [
    evidenceFor("train"),
    evidenceFor("validation"),
    evidenceFor("test"),
  ],
) => {
  assert.equal(manifests.length, 3);
  const groupings = [groupingFor("1"), groupingFor("2"), groupingFor("3")];
  const records = manifests.map((manifest, index) =>
    recordFor(manifest, groupings[index]!, `record:${index}`, String(index + 1)),
  );
  const assignment = reidentifyAssignment({
    ...splitAssignment,
    feature_profile_id: manifests[0]!.feature_profile_id,
    partitions: {
      train: [manifests[0]!.evidence_id],
      validation: [manifests[1]!.evidence_id],
      test: [manifests[2]!.evidence_id],
    },
  });
  const audit = reidentifyAudit({
    ...splitAudit,
    split_id: assignment.split_id,
    assignment_sha256: canonicalSha256(assignment),
    items: manifests
      .map((manifest, index) => ({
        evidence_id: manifest.evidence_id,
        grouping: records[index]!.grouping,
      }))
      .sort((left, right) => left.evidence_id.localeCompare(right.evidence_id)),
  });
  return { assignment, audit, manifests, records };
};

test("semantically consistent contract bundles validate", () => {
  const validatedEvidence = validateEvidenceManifest(evidence);
  assert.deepEqual(validatedEvidence, evidence);
  assert.notEqual(validatedEvidence, evidence);
  assert.ok(Object.isFrozen(validatedEvidence));
  assert.deepEqual(validateSealedRecord(sealedRecord), sealedRecord);
  assert.deepEqual(validateSplitAssignment(splitAssignment), splitAssignment);
  assert.deepEqual(validateSplitAudit(disjointSplitAudit), disjointSplitAudit);
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
  const overlappingRecord = reidentifyRecord({
    ...sealedRecord,
    intervention: {
      ...sealedRecord.intervention,
      parameters: {
        ...sealedRecord.intervention.parameters,
        sha256: evidence.task.action_plan.sha256,
      },
    },
  });

  expectIssue(
    () => validateEvidenceRecordPair(evidence, overlappingRecord),
    "pair.cas_overlap",
  );

  const overlappingSource = reidentifyRecord({
    ...sealedRecord,
    provenance: {
      source_state: {
        ...sealedRecord.provenance.source_state,
        sha256: evidence.task.action_plan.sha256,
      },
    },
  });
  expectIssue(
    () => validateEvidenceRecordPair(evidence, overlappingSource),
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
  const wrongMembership = reidentifyAudit({
    ...disjointSplitAudit,
    items: [
      disjointSplitAudit.items[0]!,
      disjointSplitAudit.items[1]!,
      {
        evidence_id: id("idev1_", "4"),
        grouping: groupingFor("4"),
      },
    ],
  });

  expectIssue(
    () => validateSplitBundle(splitAssignment, wrongMembership),
    "split_bundle.membership",
  );
});

test("all four content-shaped root identities bind canonical bodies", () => {
  expectIssue(
    () => validateEvidenceManifest({ ...evidence, evidence_id: id("idev1_", "f") }),
    "evidence.identity",
  );
  expectIssue(
    () =>
      validateSealedRecord({
        ...sealedRecord,
        sealed_record_id: id("idsr1_", "f"),
      }),
    "record.identity",
  );
  expectIssue(
    () =>
      validateSplitAssignment({
        ...splitAssignment,
        split_id: id("idsp1_", "f"),
      }),
    "split.identity",
  );
  expectIssue(
    () =>
      validateSplitAudit({
        ...disjointSplitAudit,
        split_audit_id: id("idsa1_", "f"),
      }),
    "split_audit.identity",
  );
});

test("visible routing identities cannot be chosen independently of evidence", () => {
  expectIssue(
    () =>
      validateEvidenceManifest(
        reidentifyEvidence({
          ...evidence,
          task: { ...evidence.task, task_id: id("idtk1_", "f") },
        }),
      ),
    "evidence.task_identity",
  );
  expectIssue(
    () =>
      validateEvidenceManifest(
        reidentifyEvidence({
          ...evidence,
          pair: {
            ...evidence.pair,
            candidate: {
              ...evidence.pair.candidate,
              capture_id: id("idcp1_", "f"),
            },
          },
        }),
      ),
    "evidence.candidate_capture_identity",
  );
});

test("sealed labels bind the exact canonical visible manifest", () => {
  const wrongDigest = reidentifyRecord({
    ...sealedRecord,
    evidence_manifest_sha256: id("", "f"),
  });
  expectIssue(
    () => validateEvidenceRecordPair(evidence, wrongDigest),
    "pair.manifest_digest",
  );
});

test("source identity is resolved at the visible-sealed pair boundary", () => {
  const changedProvenance = reidentifyRecord({
    ...sealedRecord,
    provenance: {
      source_state: {
        ...sealedRecord.provenance.source_state,
        sha256: id("", "f"),
      },
    },
  });

  assert.deepEqual(validateEvidenceManifest(evidence), evidence);
  expectIssue(
    () => validateEvidenceRecordPair(evidence, changedProvenance),
    "pair.source_state_identity",
  );
});

test("sealed grouping cannot disguise canonical source or mutation families", () => {
  const wrongSourceGroup = reidentifyRecord({
    ...sealedRecord,
    grouping: {
      ...sealedRecord.grouping,
      source_state_group_id: id("idsg1_", "f"),
    },
  });
  expectIssue(
    () => validateEvidenceRecordPair(evidence, wrongSourceGroup),
    "pair.source_state_group",
  );

  const wrongFamilyGroup = reidentifyRecord({
    ...sealedRecord,
    grouping: {
      ...sealedRecord.grouping,
      mutation_family_group_id: id("idmg1_", "f"),
    },
  });
  expectIssue(
    () => validateEvidenceRecordPair(evidence, wrongFamilyGroup),
    "pair.mutation_family_group",
  );
});

test("sealed split metadata binds the exact canonical assignment", () => {
  const wrongDigest = reidentifyAudit({
    ...disjointSplitAudit,
    assignment_sha256: id("", "e"),
  });
  expectIssue(
    () => validateSplitBundle(splitAssignment, wrongDigest),
    "split_bundle.assignment_digest",
  );
});

test("baseline_failed is accepted if and only if the baseline failed", () => {
  const spurious = reidentifyRecord({
    ...sealedRecord,
    labels: {
      sample_valid: false,
      invalid_reason: "baseline_failed",
      task_regression: null,
      severity_ordinal: null,
      first_failed_step_id: null,
      localization: null,
    },
  });
  expectIssue(
    () => validateSealedRecord(spurious),
    "record.spurious_baseline_failure_reason",
  );
});

test("different scalar outcomes require different sealed evidence", () => {
  const unsupported = reidentifyRecord({
    ...sealedRecord,
    execution: {
      ...sealedRecord.execution,
      candidate: {
        ...sealedRecord.execution.candidate,
        final_state_oracle: sealedRecord.execution.baseline.final_state_oracle,
        accessibility_oracle: sealedRecord.execution.baseline.accessibility_oracle,
        raw_trace: sealedRecord.execution.baseline.raw_trace,
      },
    },
  });
  expectIssue(
    () => validateSealedRecord(unsupported),
    "record.outcome_artifact_contradiction",
  );
});

test("validators reject inherited and hidden JavaScript fields", () => {
  expectIssue(
    () => validateEvidenceManifest(Object.create(evidence) as unknown),
    "input.exotic_object",
  );

  const hidden = { ...evidence };
  Object.defineProperty(hidden, "task_regression", {
    enumerable: false,
    value: true,
  });
  expectIssue(() => validateEvidenceManifest(hidden), "input.hidden_property");
});

test("multi-checkpoint evidence enforces symmetric order and identity", () => {
  const baselineCheckpoints = [checkpoint("multi:b0", 0), checkpoint("multi:b1", 1)];
  const candidateCheckpoints = [checkpoint("multi:c0", 0), checkpoint("multi:c1", 1)];
  const valid = rederiveEvidence({
    ...evidence,
    pair: {
      baseline: { ...evidence.pair.baseline, checkpoints: baselineCheckpoints },
      candidate: { ...evidence.pair.candidate, checkpoints: candidateCheckpoints },
    },
  });
  assert.deepEqual(validateEvidenceManifest(valid), valid);

  const unequal = reidentifyEvidence({
    ...valid,
    pair: {
      ...valid.pair,
      candidate: {
        ...valid.pair.candidate,
        checkpoints: valid.pair.candidate.checkpoints.slice(0, 1),
      },
    },
  });
  expectIssue(() => validateEvidenceManifest(unequal), "evidence.checkpoint_count");

  const duplicate = reidentifyEvidence({
    ...valid,
    pair: {
      baseline: {
        ...valid.pair.baseline,
        checkpoints: [
          valid.pair.baseline.checkpoints[0]!,
          {
            ...valid.pair.baseline.checkpoints[1]!,
            checkpoint_id: valid.pair.baseline.checkpoints[0]!.checkpoint_id,
          },
        ],
      },
      candidate: {
        ...valid.pair.candidate,
        checkpoints: [
          valid.pair.candidate.checkpoints[0]!,
          {
            ...valid.pair.candidate.checkpoints[1]!,
            checkpoint_id: valid.pair.candidate.checkpoints[0]!.checkpoint_id,
          },
        ],
      },
    },
  });
  expectIssue(
    () => validateEvidenceManifest(duplicate),
    "evidence.duplicate_checkpoint",
  );
});

test("dataset validation binds split, records, groups, policies, and CAS stores", () => {
  const fixture = datasetFixture();
  const pairs = fixture.manifests.map((manifest, index) => ({
    evidence: manifest,
    sealedRecord: fixture.records[index]!,
  }));
  const validated = validateDatasetBundle(
    fixture.assignment,
    fixture.audit,
    pairs.toReversed(),
  );

  assert.deepEqual(
    validated.pairs.map((pair) => pair.evidence.evidence_id),
    [
      ...fixture.assignment.partitions.train,
      ...fixture.assignment.partitions.validation,
      ...fixture.assignment.partitions.test,
    ],
  );
});

test("dataset validation rejects an audit that lies about sealed grouping", () => {
  const fixture = datasetFixture();
  const firstItem = fixture.audit.items[0]!;
  const dishonestAudit = reidentifyAudit({
    ...fixture.audit,
    items: [
      {
        ...firstItem,
        grouping: groupingFor("a"),
      },
      ...fixture.audit.items.slice(1),
    ].sort((left, right) => left.evidence_id.localeCompare(right.evidence_id)),
  });
  const pairs = fixture.manifests.map((manifest, index) => ({
    evidence: manifest,
    sealedRecord: fixture.records[index]!,
  }));

  expectIssue(
    () => validateDatasetBundle(fixture.assignment, dishonestAudit, pairs),
    "dataset.audit_grouping",
  );
});

test("observation artifacts cannot be reused across split partitions", () => {
  const fixture = datasetFixture();
  const leakedTest = rederiveEvidence({
    ...fixture.manifests[2]!,
    pair: {
      ...fixture.manifests[2]!.pair,
      candidate: {
        ...fixture.manifests[2]!.pair.candidate,
        checkpoints: [
          {
            ...fixture.manifests[2]!.pair.candidate.checkpoints[0]!,
            screenshot: fixture.manifests[0]!.pair.candidate.checkpoints[0]!.screenshot,
          },
        ],
      },
    },
  });
  const leakedFixture = datasetFixture([
    fixture.manifests[0]!,
    fixture.manifests[1]!,
    leakedTest,
  ]);
  const pairs = leakedFixture.manifests.map((manifest, index) => ({
    evidence: manifest,
    sealedRecord: leakedFixture.records[index]!,
  }));

  expectIssue(
    () => validateDatasetBundle(leakedFixture.assignment, leakedFixture.audit, pairs),
    "dataset.artifact_partition_overlap",
  );
});

test("global visible and sealed stores cannot overlap across different records", () => {
  const fixture = datasetFixture();
  const overlappingRecord = reidentifyRecord({
    ...fixture.records[2]!,
    intervention: {
      ...fixture.records[2]!.intervention,
      parameters: {
        ...fixture.records[2]!.intervention.parameters,
        sha256: fixture.manifests[0]!.pair.baseline.checkpoints[0]!.screenshot.sha256,
      },
    },
  });
  const pairs = fixture.manifests.map((manifest, index) => ({
    evidence: manifest,
    sealedRecord: index === 2 ? overlappingRecord : fixture.records[index]!,
  }));

  expectIssue(
    () => validateDatasetBundle(fixture.assignment, fixture.audit, pairs),
    "dataset.cas_overlap",
  );
});

test("dataset membership is exact and label policy is uniform", () => {
  const fixture = datasetFixture();
  const missingPair = fixture.manifests.slice(0, 2).map((manifest, index) => ({
    evidence: manifest,
    sealedRecord: fixture.records[index]!,
  }));
  expectIssue(
    () => validateDatasetBundle(fixture.assignment, fixture.audit, missingPair),
    "dataset.membership",
  );

  const mixedPolicyRecord = reidentifyRecord({
    ...fixture.records[2]!,
    label_policy_id: id("idlp1_", "f"),
  });
  const mixedPolicyPairs = fixture.manifests.map((manifest, index) => ({
    evidence: manifest,
    sealedRecord: index === 2 ? mixedPolicyRecord : fixture.records[index]!,
  }));
  expectIssue(
    () => validateDatasetBundle(fixture.assignment, fixture.audit, mixedPolicyPairs),
    "dataset.label_policy",
  );
});

test("dataset pair wrappers fail closed on non-data and sparse inputs", () => {
  const fixture = datasetFixture();
  const invoke = validateDatasetBundle as unknown as (
    assignment: unknown,
    audit: unknown,
    pairs: unknown,
  ) => unknown;

  expectIssue(
    () => invoke(fixture.assignment, fixture.audit, [null]),
    "dataset.pair_shape",
  );
  expectIssue(
    () => invoke(fixture.assignment, fixture.audit, new Array(1)),
    "input.hidden_property",
  );
});
