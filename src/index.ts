export const contractVersion = 1 as const;
export const evidenceContract = "impactdiff.evidence" as const;
export const sealedRecordContract = "impactdiff.sealed-record" as const;
export const splitAssignmentContract = "impactdiff.split-assignment" as const;
export const splitAuditContract = "impactdiff.split-audit" as const;

export {
  evidenceManifestSchema,
  sealedRecordSchema,
  splitAssignmentSchema,
  splitAuditSchema,
} from "./contracts/schema.js";
export type {
  EvidenceManifest,
  SealedRecord,
  SplitAssignment,
  SplitAudit,
} from "./contracts/schema.js";
export {
  ContractValidationError,
  validateEvidenceManifest,
  validateEvidenceRecordPair,
  validateSealedRecord,
  validateSplitAssignment,
  validateSplitAudit,
  validateSplitBundle,
} from "./contracts/validate.js";
export type {
  ContractIssue,
  EvidenceRecordPair,
  SplitBundle,
} from "./contracts/validate.js";
export { validateDatasetBundle } from "./contracts/dataset.js";
export type { DatasetBundle, DatasetPairInput } from "./contracts/dataset.js";
export {
  canonicalJson,
  canonicalSha256,
  CanonicalJsonError,
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
  JsonDataError,
  normalizeJsonData,
  parseCanonicalJson,
  sha256Hex,
} from "./contracts/canonical.js";
export type { JsonValue, ParseLimits } from "./contracts/canonical.js";
