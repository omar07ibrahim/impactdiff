import { createHash } from "node:crypto";

import { canonicalJson } from "../contracts/canonical.js";

export interface FixtureActionTargetIdentity {
  readonly fixture_id: string;
  readonly fixture_revision: string;
  readonly fixture_manifest_sha256: string;
  readonly locator: {
    readonly strategy: "test_id";
    readonly value: string;
  };
}

/**
 * Gives an action target a stable identity without depending on a capture made
 * from that target. The fixture revision and its exact manifest digest are the
 * authority; source-state IDs are deliberately absent to avoid a circular ID.
 */
export function computeFixtureActionTargetId(
  identity: FixtureActionTargetIdentity,
): string {
  const hash = createHash("sha256");
  hash.update("impactdiff:fixture-action-target:v1", "utf8");
  hash.update("\0", "utf8");
  hash.update(canonicalJson(identity), "utf8");
  return `idat1_${hash.digest("hex")}`;
}
