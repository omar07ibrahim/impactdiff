import assert from "node:assert/strict";
import test from "node:test";

import { computePairedPublicationId } from "../../src/contracts/canonical.js";
import { ContractValidationError } from "../../src/contracts/errors.js";
import {
  createPairedPublicationCommit,
  validatePairedPublicationCommit,
  validatePairedPublicationRecords,
} from "../../src/publication/validate.js";
import { evidence, sealedRecord } from "../fixtures.js";

function expectIssue(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ContractValidationError);
    assert.ok(error.issues.some((candidate) => candidate.code === code));
    return true;
  });
}

test("paired publication commits bind both canonical record files", () => {
  const commit = createPairedPublicationCommit(evidence, sealedRecord);
  const records = validatePairedPublicationRecords(commit, evidence, sealedRecord);

  assert.equal(commit.evidence_manifest.id, evidence.evidence_id);
  assert.equal(commit.sealed_record.id, sealedRecord.sealed_record_id);
  assert.equal(records.commit.publication_id, commit.publication_id);
  assert.ok(Object.isFrozen(commit));
  assert.ok(Object.isFrozen(records));
});

test("paired publication commits reject a false identity", () => {
  const commit = createPairedPublicationCommit(evidence, sealedRecord);
  expectIssue(
    () =>
      validatePairedPublicationCommit({
        ...commit,
        publication_id: "idpb1_" + "0".repeat(64),
      }),
    "publication.identity",
  );
});

test("paired publication commits reject record substitution after identity recomputation", () => {
  const commit = createPairedPublicationCommit(evidence, sealedRecord);
  const substitutedDraft = {
    ...commit,
    evidence_manifest: {
      ...commit.evidence_manifest,
      sha256: "0".repeat(64),
    },
  };
  const substituted = {
    ...substitutedDraft,
    publication_id: computePairedPublicationId(substitutedDraft),
  };
  expectIssue(
    () => validatePairedPublicationRecords(substituted, evidence, sealedRecord),
    "publication.record_binding",
  );
});
