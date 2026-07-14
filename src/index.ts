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
