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
  validateResolvedEvidenceBundle,
  validateResolvedInterventionBundle,
} from "./contracts/resolved.js";
export type {
  ResolvedCaptureCheckpoint,
  ResolvedEvidenceBundle,
  ResolvedInterventionBundle,
} from "./contracts/resolved.js";
export { validateResolvedEvidenceRecordBundle } from "./contracts/resolved-record.js";
export type {
  ResolvedEvidenceRecordBundle,
  ResolvedOutcomePayloads,
} from "./contracts/resolved-record.js";
export type { ArtifactRef } from "./contracts/artifacts.js";
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
  computePairedPublicationId,
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
export {
  ARTIFACT_STORE_V1_THREAT_MODEL,
  ArtifactStore,
  assertDisjointArtifactStores,
  auditArtifactStorePair,
  validateArtifactReference,
} from "./artifacts/cas.js";
export type {
  ArtifactAuditEntry,
  ArtifactCodec,
  ArtifactDecoder,
  ArtifactStoreAudit,
} from "./artifacts/cas.js";
export { ArtifactPayloadError, ArtifactStoreError } from "./artifacts/errors.js";
export {
  accessibilityCodec,
  actionPlanCodec,
  captureSpecCodec,
  changedSurfaceCodec,
  layoutCodec,
  localizationCodec,
  mutationPlanCodec,
  oracleResultCodec,
  pilotMutationOperatorCatalogCodec,
  pilotMutationOperatorCodec,
  pngCodec,
  preconditionReportCodec,
  rawTraceCodec,
  sourceStateCodec,
} from "./artifacts/codecs.js";
export { CanonicalPng, canonicalizePng } from "./artifacts/png.js";
export * from "./capture/index.js";
export * from "./mutations/index.js";
export * from "./source/index.js";
export * from "./publication/index.js";
export * from "./sealed/index.js";
export * from "./generation/index.js";
export * from "./benchmark/index.js";
export * from "./pilot/index.js";
