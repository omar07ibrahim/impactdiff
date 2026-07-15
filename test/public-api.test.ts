import assert from "node:assert/strict";
import test from "node:test";

import * as publicApi from "../src/index.js";
import type {
  ArtifactRef,
  FreshMutationFixturePairOptions,
  MutationFixtureAudit,
  MutationFixtureCheckpointBytes,
  MutationFixtureCaptureSpecArtifact,
  MutationFixtureSourceStateArtifact,
  MutationFixtureTaskRun,
  PairedReleaseArtifactInput,
  PairedReleaseInput,
  PilotApplicationGroupIdentityInput,
  PilotFixtureActionStepIdentity,
  PilotFixtureAuthoringCaptureSpecArtifact,
  PilotFixtureAuthoringEnvironment,
  PilotFixtureAuthoringPackage,
  PilotFixtureManifest,
  PilotFixtureResourceRequestAudit,
  PilotFixtureWorkflowAuthoringAudit,
  PilotGenerationPlan,
  PilotMutationFamilyKey,
  PilotMutationOperatorCatalog,
  PilotMutationOperatorDefinition,
  PilotMutationOperatorIdentityInput,
  PilotProtocol,
  PilotWorkflowIdentityInput,
  ResolvedEvidenceBundle,
  SourceState,
  VerifiedPairedRelease,
} from "../src/index.js";

function acceptsPublicTypes(
  _reference: ArtifactRef,
  _freshPairOptions: FreshMutationFixturePairOptions,
  _audit: MutationFixtureAudit,
  _checkpoint: MutationFixtureCheckpointBytes,
  _captureSpec: MutationFixtureCaptureSpecArtifact,
  _sourceArtifact: MutationFixtureSourceStateArtifact,
  _taskRun: MutationFixtureTaskRun,
  _bundle: ResolvedEvidenceBundle,
  _sourceState: SourceState,
  _publicationArtifact: PairedReleaseArtifactInput,
  _publicationInput: PairedReleaseInput,
  _pilotApplicationGroupIdentity: PilotApplicationGroupIdentityInput,
  _pilotFixtureActionStepIdentity: PilotFixtureActionStepIdentity,
  _pilotFixtureAuthoringCaptureSpec: PilotFixtureAuthoringCaptureSpecArtifact,
  _pilotFixtureAuthoringEnvironment: PilotFixtureAuthoringEnvironment,
  _pilotFixtureAuthoringPackage: PilotFixtureAuthoringPackage,
  _pilotFixtureManifest: PilotFixtureManifest,
  _pilotFixtureResourceRequestAudit: PilotFixtureResourceRequestAudit,
  _pilotFixtureWorkflowAuthoringAudit: PilotFixtureWorkflowAuthoringAudit,
  _pilotGenerationPlan: PilotGenerationPlan,
  _pilotMutationFamilyKey: PilotMutationFamilyKey,
  _pilotMutationOperatorCatalog: PilotMutationOperatorCatalog,
  _pilotMutationOperatorDefinition: PilotMutationOperatorDefinition,
  _pilotMutationOperatorIdentity: PilotMutationOperatorIdentityInput,
  _pilotProtocol: PilotProtocol,
  _pilotWorkflowIdentity: PilotWorkflowIdentityInput,
  _verifiedRelease: VerifiedPairedRelease,
): void {}

void acceptsPublicTypes;

test("the package root exposes the capture, storage, mutation, and resolver API", () => {
  const expectedFunctions = [
    "ArtifactStore",
    "canonicalJson",
    "canonicalizePng",
    "compileMutation",
    "computePilotApplicationCatalogId",
    "computePilotApplicationGroupId",
    "computePilotGenerationPlanId",
    "computePilotMutationOperatorId",
    "computePilotMutationOperatorCatalogId",
    "computePilotMutationPairId",
    "computePilotProtocolId",
    "computePilotSplitPlanId",
    "computePilotWorkflowId",
    "computeFixtureActionTargetId",
    "computePilotFixtureActionStepId",
    "executeMutationFixtureTask",
    "FixturePairGenerationError",
    "loadVerifiedMutationFixtureSourceState",
    "launchMutationFixtureEnvironment",
    "loadVerifiedMutationFixtureActionPlan",
    "loadPilotFixtureAuthoringPackage",
    "launchPilotFixtureAuthoringEnvironment",
    "MutationFixtureCheckpointBytes",
    "MutationFixtureEnvironment",
    "openMutationFixtureSession",
    "PairedPublicationError",
    "PairedReleasePublisher",
    "parseActionPlan",
    "parsePilotFixtureManifest",
    "parsePilotGenerationPlan",
    "parsePilotMutationOperatorCatalog",
    "parsePilotMutationOperatorDefinition",
    "parseSourceState",
    "PilotFixtureAuthoringEnvironment",
    "PilotFixtureAuthoringRuntimeError",
    "prepareMutationFixtureTask",
    "publishFreshMutationFixturePair",
    "replayPilotFixtureAuthoringWorkflow",
    "validateDatasetBundle",
    "validatePilotGenerationPlan",
    "validatePilotFixtureManifest",
    "validatePilotMutationOperatorCatalog",
    "validatePilotMutationOperatorDefinition",
    "validatePilotMutationOperatorDefinitionSet",
    "validatePilotProtocol",
    "validateResolvedEvidenceBundle",
    "validateResolvedInterventionBundle",
    "validateResolvedEvidenceRecordBundle",
    "verifyPairedRelease",
  ] as const satisfies readonly (keyof typeof publicApi)[];

  for (const name of expectedFunctions) {
    assert.equal(typeof publicApi[name], "function", `${name} must be exported`);
  }

  assert.equal(
    "buildPilotFixtureActionPlanArtifacts" in publicApi,
    false,
    "unchecked ActionPlan construction must remain package-internal",
  );
  for (const internalName of [
    "acquirePilotFixtureAuthoringEnvironment",
    "assertClosedChromiumFonts",
    "loadPilotFixtureAuthoringSnapshot",
    "runPilotFixtureWorkflowAuthoringSession",
  ]) {
    assert.equal(
      internalName in publicApi,
      false,
      `${internalName} must remain package-internal`,
    );
  }

  assert.equal(publicApi.contractVersion, 1);
  assert.equal(publicApi.evidenceContract, "impactdiff.evidence");
  assert.equal(
    publicApi.pilotGenerationPlanContract,
    "impactdiff.pilot-generation-plan",
  );
  assert.equal(publicApi.pilotGenerationPlanVersion, 1);
  assert.equal(
    publicApi.pilotFixtureManifestContract,
    "impactdiff.pilot-fixture-manifest",
  );
  assert.equal(publicApi.pilotFixtureManifestVersion, 1);
  assert.equal(publicApi.pilotMutationOperatorVersion, 1);
  assert.equal(publicApi.pilotMutationOperatorCatalogVersion, 1);
  assert.equal(publicApi.pilotV01MutationOperatorDefinitions.length, 16);
  assert.equal(
    publicApi.pilotV01MutationOperatorCatalog.catalog_id,
    publicApi.pilotV01MutationOperatorCatalogId,
  );
  assert.equal(
    publicApi.pilotV01MutationOperatorCatalogCanonicalJson,
    publicApi.canonicalJson(publicApi.pilotV01MutationOperatorCatalog),
  );
  assert.equal(
    publicApi.pilotV01ApplicationCatalog.catalog_id,
    publicApi.pilotV01ApplicationCatalogId,
  );
  assert.equal(
    publicApi.pilotV01ApplicationCatalogCanonicalJson,
    publicApi.canonicalJson(publicApi.pilotV01ApplicationCatalog),
  );
  assert.equal(publicApi.pilotProtocolContract, "impactdiff.pilot-protocol");
  assert.equal(publicApi.pilotProtocolRelease, "pilot-v0.1");
  assert.equal(publicApi.pilotProtocolVersion, 1);
  assert.equal(publicApi.pilotV01Protocol.protocol_id, publicApi.pilotV01ProtocolId);
  assert.equal(typeof publicApi.pilotV01ProtocolCanonicalJson, "string");
  assert.equal(typeof publicApi.actionPlanCodec, "object");
  assert.equal(typeof publicApi.sourceStateCodec, "object");
  assert.equal(typeof publicApi.pilotMutationOperatorCodec, "object");
  assert.equal(typeof publicApi.pilotMutationOperatorCatalogCodec, "object");
  assert.equal(typeof publicApi.ARTIFACT_STORE_V1_THREAT_MODEL, "object");
  assert.equal(typeof publicApi.PAIRED_PUBLICATION_V1_THREAT_MODEL, "object");
  assert.equal(
    publicApi.ARTIFACT_STORE_V1_THREAT_MODEL.writers,
    "one same-process ArtifactStore instance",
  );
});
