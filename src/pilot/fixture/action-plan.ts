import { parseActionPlan } from "../../capture/validate.js";
import { computeFixtureActionTargetId } from "../../capture/identity.js";
import type { ArtifactRef } from "../../contracts/artifacts.js";
import { canonicalJson, computeTaskId, sha256Hex } from "../../contracts/canonical.js";
import { computePilotFixtureActionStepId } from "./identity.js";
import type {
  PilotFixtureActionRecipe,
  PilotFixtureManifest,
  PilotFixtureWorkflow,
} from "./schema.js";

const actionPlanMediaType = "application/vnd.impactdiff.action-plan+json" as const;
const sha256Pattern = /^[0-9a-f]{64}$/u;

export interface PilotFixtureActionPlanArtifact {
  readonly workflow_key: PilotFixtureWorkflow["workflow_key"];
  readonly bytes: Uint8Array;
  readonly reference: ArtifactRef;
  readonly task_id: string;
}

function standaloneBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function actionLocator(
  workflow: PilotFixtureWorkflow,
  recipe: PilotFixtureActionRecipe,
): PilotFixtureActionStepIdentityLocator {
  if (recipe.target === null) return null;
  const binding = workflow.abi[recipe.target];
  return Object.freeze({
    strategy: binding.strategy,
    value: binding.value,
  });
}

type PilotFixtureActionStepIdentityLocator = {
  readonly strategy: "test_id";
  readonly value: string;
} | null;

function actionTargetId(
  manifest: PilotFixtureManifest,
  fixtureManifestSha256: string,
  locator: PilotFixtureActionStepIdentityLocator,
): string | null {
  if (locator === null) return null;
  return computeFixtureActionTargetId({
    fixture_id: manifest.fixture_key,
    fixture_revision: manifest.revision,
    fixture_manifest_sha256: fixtureManifestSha256,
    locator,
  });
}

function immutableArtifact(
  workflowKey: PilotFixtureWorkflow["workflow_key"],
  bytes: Buffer,
): PilotFixtureActionPlanArtifact {
  const privateBytes = Buffer.from(bytes);
  const reference = Object.freeze({
    sha256: sha256Hex(privateBytes),
    byte_length: privateBytes.byteLength,
    media_type: actionPlanMediaType,
    format_version: 1 as const,
  });
  const artifact = {} as PilotFixtureActionPlanArtifact;
  Object.defineProperties(artifact, {
    workflow_key: {
      configurable: false,
      enumerable: true,
      value: workflowKey,
      writable: false,
    },
    bytes: {
      configurable: false,
      enumerable: true,
      get: () => standaloneBytes(privateBytes),
    },
    reference: {
      configurable: false,
      enumerable: true,
      value: reference,
      writable: false,
    },
    task_id: {
      configurable: false,
      enumerable: true,
      value: computeTaskId(reference),
      writable: false,
    },
  });
  return Object.freeze(artifact);
}

function workflowArtifact(
  manifest: PilotFixtureManifest,
  fixtureManifestSha256: string,
  workflow: PilotFixtureWorkflow,
): PilotFixtureActionPlanArtifact {
  const actions = workflow.actions.map((recipe, ordinal) => {
    const locator = actionLocator(workflow, recipe);
    return {
      action_id: computePilotFixtureActionStepId({
        protocol_id: manifest.protocol_id,
        fixture_id: manifest.fixture_key,
        fixture_revision: manifest.revision,
        fixture_manifest_sha256: fixtureManifestSha256,
        workflow_key: workflow.workflow_key,
        ordinal,
        intent: recipe.intent,
        locator,
        value: recipe.value,
        pointer_source_point: recipe.pointer_source_point,
      }),
      ordinal,
      intent: recipe.intent,
      target_id: actionTargetId(manifest, fixtureManifestSha256, locator),
      value: recipe.value,
    };
  });
  const checkpoints = workflow.checkpoints.map((checkpoint, ordinal) => ({
    ordinal,
    after_action_ordinal: checkpoint.after_action_ordinal,
  }));
  const bytes = Buffer.from(
    canonicalJson({
      contract: "impactdiff.action-plan",
      version: 1,
      actions,
      checkpoints,
    }),
    "utf8",
  );
  parseActionPlan(bytes);
  return immutableArtifact(workflow.workflow_key, bytes);
}

/**
 * Builds the two canonical authoring ActionPlans in memory. The plans are not
 * fixture resources: their target and step IDs already commit to the exact raw
 * fixture-manifest digest.
 */
export function buildPilotFixtureActionPlanArtifacts(
  manifest: PilotFixtureManifest,
  fixtureManifestSha256: string,
): readonly PilotFixtureActionPlanArtifact[] {
  if (
    typeof fixtureManifestSha256 !== "string" ||
    !sha256Pattern.test(fixtureManifestSha256)
  ) {
    throw new TypeError("fixture manifest SHA-256 must be 64 lowercase hex digits");
  }
  return Object.freeze(
    manifest.workflows.map((workflow) =>
      workflowArtifact(manifest, fixtureManifestSha256, workflow),
    ),
  );
}
