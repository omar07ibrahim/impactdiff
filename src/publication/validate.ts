import { Ajv2020 } from "ajv/dist/2020.js";

import {
  canonicalJson,
  canonicalSha256,
  computePairedPublicationId,
} from "../contracts/canonical.js";
import { assertNoIssues, issue } from "../contracts/errors.js";
import type { ContractIssue } from "../contracts/errors.js";
import { normalizedSchemaValue } from "../contracts/input.js";
import type { EvidenceManifest, SealedRecord } from "../contracts/schema.js";
import { validateEvidenceRecordPair } from "../contracts/validate.js";
import { pairedPublicationCommitSchema } from "./schema.js";
import type { PairedPublicationCommit } from "./schema.js";

const ajv = new Ajv2020({ allErrors: true, ownProperties: true, strict: true });
const commitValidator = ajv.compile<PairedPublicationCommit>(
  pairedPublicationCommitSchema,
);

function canonicalByteLength(value: unknown): number {
  return Buffer.byteLength(canonicalJson(value), "utf8");
}

export function validatePairedPublicationCommit(
  value: unknown,
): PairedPublicationCommit {
  const commit = normalizedSchemaValue(
    "impactdiff.paired-publication-commit/v1",
    commitValidator,
    value,
  );
  const issues: ContractIssue[] = [];
  if (commit.publication_id !== computePairedPublicationId(commit)) {
    issues.push(
      issue(
        "publication.identity",
        "/publication_id",
        "publication_id must bind both canonical record files",
      ),
    );
  }
  assertNoIssues("impactdiff.paired-publication-commit/v1", issues);
  return commit;
}

export function createPairedPublicationCommit(
  evidenceValue: unknown,
  sealedRecordValue: unknown,
): PairedPublicationCommit {
  const { evidence, sealedRecord } = validateEvidenceRecordPair(
    evidenceValue,
    sealedRecordValue,
  );
  const draft = {
    contract: "impactdiff.paired-publication-commit",
    version: 1,
    publication_id: "idpb1_" + "0".repeat(64),
    evidence_manifest: {
      id: evidence.evidence_id,
      sha256: canonicalSha256(evidence),
      byte_length: canonicalByteLength(evidence),
    },
    sealed_record: {
      id: sealedRecord.sealed_record_id,
      sha256: canonicalSha256(sealedRecord),
      byte_length: canonicalByteLength(sealedRecord),
    },
  } as const;
  return validatePairedPublicationCommit({
    ...draft,
    publication_id: computePairedPublicationId(draft),
  });
}

export interface PairedPublicationRecords {
  readonly commit: PairedPublicationCommit;
  readonly evidence: EvidenceManifest;
  readonly sealedRecord: SealedRecord;
}

export function validatePairedPublicationRecords(
  commitValue: unknown,
  evidenceValue: unknown,
  sealedRecordValue: unknown,
): PairedPublicationRecords {
  const commit = validatePairedPublicationCommit(commitValue);
  const { evidence, sealedRecord } = validateEvidenceRecordPair(
    evidenceValue,
    sealedRecordValue,
  );
  const issues: ContractIssue[] = [];
  for (const [path, actual, expected] of [
    ["/evidence_manifest/id", commit.evidence_manifest.id, evidence.evidence_id],
    [
      "/evidence_manifest/sha256",
      commit.evidence_manifest.sha256,
      canonicalSha256(evidence),
    ],
    [
      "/evidence_manifest/byte_length",
      commit.evidence_manifest.byte_length,
      canonicalByteLength(evidence),
    ],
    ["/sealed_record/id", commit.sealed_record.id, sealedRecord.sealed_record_id],
    [
      "/sealed_record/sha256",
      commit.sealed_record.sha256,
      canonicalSha256(sealedRecord),
    ],
    [
      "/sealed_record/byte_length",
      commit.sealed_record.byte_length,
      canonicalByteLength(sealedRecord),
    ],
  ] as const) {
    if (actual !== expected) {
      issues.push(
        issue(
          "publication.record_binding",
          path,
          "publication commit does not match its canonical record file",
        ),
      );
    }
  }
  assertNoIssues("impactdiff.paired-publication-records/v1", issues);
  return Object.freeze({ commit, evidence, sealedRecord });
}
