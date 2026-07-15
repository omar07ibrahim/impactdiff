import assert from "node:assert/strict";
import test from "node:test";

import * as publicApi from "../src/index.js";
import type {
  ArtifactRef,
  MutationFixtureAudit,
  MutationFixtureCheckpointBytes,
  MutationFixtureCaptureSpecArtifact,
  MutationFixtureSourceStateArtifact,
  MutationFixtureTaskRun,
  ResolvedEvidenceBundle,
  SourceState,
} from "../src/index.js";

function acceptsPublicTypes(
  _reference: ArtifactRef,
  _audit: MutationFixtureAudit,
  _checkpoint: MutationFixtureCheckpointBytes,
  _captureSpec: MutationFixtureCaptureSpecArtifact,
  _sourceArtifact: MutationFixtureSourceStateArtifact,
  _taskRun: MutationFixtureTaskRun,
  _bundle: ResolvedEvidenceBundle,
  _sourceState: SourceState,
): void {}

void acceptsPublicTypes;

test("the package root exposes the capture, storage, mutation, and resolver API", () => {
  const expectedFunctions = [
    "ArtifactStore",
    "canonicalJson",
    "canonicalizePng",
    "compileMutation",
    "computeFixtureActionTargetId",
    "executeMutationFixtureTask",
    "loadVerifiedMutationFixtureSourceState",
    "launchMutationFixtureEnvironment",
    "MutationFixtureCheckpointBytes",
    "MutationFixtureEnvironment",
    "openMutationFixtureSession",
    "parseActionPlan",
    "parseSourceState",
    "prepareMutationFixtureTask",
    "validateDatasetBundle",
    "validateResolvedEvidenceBundle",
    "validateResolvedInterventionBundle",
  ] as const satisfies readonly (keyof typeof publicApi)[];

  for (const name of expectedFunctions) {
    assert.equal(typeof publicApi[name], "function", `${name} must be exported`);
  }

  assert.equal(publicApi.contractVersion, 1);
  assert.equal(publicApi.evidenceContract, "impactdiff.evidence");
  assert.equal(typeof publicApi.actionPlanCodec, "object");
  assert.equal(typeof publicApi.sourceStateCodec, "object");
  assert.equal(typeof publicApi.ARTIFACT_STORE_V1_THREAT_MODEL, "object");
  assert.equal(
    publicApi.ARTIFACT_STORE_V1_THREAT_MODEL.writers,
    "one same-process ArtifactStore instance",
  );
});
