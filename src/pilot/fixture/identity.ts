import { createHash } from "node:crypto";

import { canonicalJson } from "../../contracts/canonical.js";
import type { PilotFixtureActionRecipe } from "./schema.js";

export interface PilotFixtureActionStepIdentity {
  readonly protocol_id: string;
  readonly fixture_id: string;
  readonly fixture_revision: string;
  readonly fixture_manifest_sha256: string;
  readonly workflow_key: string;
  readonly ordinal: number;
  readonly intent: PilotFixtureActionRecipe["intent"];
  readonly locator: {
    readonly strategy: "test_id";
    readonly value: string;
  } | null;
  readonly value: PilotFixtureActionRecipe["value"];
  readonly pointer_source_point: PilotFixtureActionRecipe["pointer_source_point"];
}

/**
 * Derives one visible action-step identity without depending on an ActionPlan
 * reference. The raw fixture-manifest digest and declarative recipe are the
 * authority, which keeps fixture and task identities acyclic.
 */
export function computePilotFixtureActionStepId(
  identity: PilotFixtureActionStepIdentity,
): string {
  const body = {
    protocol_id: identity.protocol_id,
    fixture_id: identity.fixture_id,
    fixture_revision: identity.fixture_revision,
    fixture_manifest_sha256: identity.fixture_manifest_sha256,
    workflow_key: identity.workflow_key,
    ordinal: identity.ordinal,
    intent: identity.intent,
    locator: identity.locator,
    value: identity.value,
    pointer_source_point: identity.pointer_source_point,
  };
  const hash = createHash("sha256");
  hash.update("impactdiff:pilot-fixture-action-step:v1", "utf8");
  hash.update("\0", "utf8");
  hash.update(canonicalJson(body), "utf8");
  return `idst1_${hash.digest("hex")}`;
}
