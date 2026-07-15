export {
  compileMutation,
  validateMutationCompilation,
  validateMutationPlan,
  validateMutationRequest,
  validatePreconditionReport,
  validateSourceProbe,
} from "./compiler.js";
export type { MutationCompilationBundle, MutationCompileResult } from "./compiler.js";
export {
  computeMutationFamilyId,
  computeMutationInstanceId,
  computeMutationOperatorId,
  computeMutationPlanId,
  computeMutationSeed,
  computeMutationTargetNodeId,
  computeSourceProbeFingerprint,
  mutationFamilyKey,
} from "./identity.js";
export type { MutationFamilyKey, MutationOperatorKey } from "./identity.js";
export {
  contrastRatioMilli,
  oceanPaletteDefinition,
  oceanPaletteSha256,
} from "./palette.js";
export type { PaletteContrastPair, Rgb } from "./palette.js";
export {
  mutationPlanSchema,
  mutationPreconditionCodes,
  mutationRequestSchema,
  preconditionReportSchema,
  sourceProbeSchema,
} from "./schema.js";
export type {
  FixedRect,
  MutationPlan,
  MutationRequest,
  PreconditionCode,
  PreconditionReport,
  SourceProbe,
} from "./schema.js";
export {
  applyCompiledMutation,
  MutationFixtureSession,
  MutationRuntimeError,
  openMutationFixtureSession,
  probeMutation,
  validateMutationRuntimeBinding,
} from "./runtime.js";
export type {
  MutationCleanup,
  MutationFixtureAudit,
  MutationFixtureUpstreamEvidence,
  MutationRuntimeBinding,
} from "./runtime.js";
