import { createHash } from "node:crypto";

import { canonicalJson } from "../contracts/canonical.js";
import type { MutationPlan, MutationRequest, SourceProbe } from "./schema.js";

export type MutationOperatorKey = MutationRequest["operator_key"];
export type MutationFamilyKey = "pointer_hit_testing" | "visual_palette";

const domainDigest = (domain: string, body: unknown): string => {
  const hash = createHash("sha256");
  hash.update(domain, "utf8");
  hash.update("\0", "utf8");
  hash.update(canonicalJson(body), "utf8");
  return hash.digest("hex");
};

export function mutationFamilyKey(operatorKey: MutationOperatorKey): MutationFamilyKey {
  switch (operatorKey) {
    case "palette_swap":
      return "visual_palette";
    case "pointer_interceptor":
      return "pointer_hit_testing";
  }
}

export function computeMutationFamilyId(familyKey: MutationFamilyKey): string {
  return `idmf1_${domainDigest("impactdiff:mutation-family:v1", familyKey)}`;
}

export function computeMutationOperatorId(operatorKey: MutationOperatorKey): string {
  return `idop1_${domainDigest("impactdiff:mutation-operator:v1", operatorKey)}`;
}

export function computeMutationTargetNodeId(
  sourceStateId: string,
  locator: MutationRequest["target"]["locator"],
): string {
  return `idnd1_${domainDigest("impactdiff:mutation-target-node:v1", {
    source_state_id: sourceStateId,
    locator,
  })}`;
}

export function computeMutationInstanceId(request: MutationRequest): string {
  return `idmi1_${domainDigest("impactdiff:mutation-instance:v1", request)}`;
}

export function computeMutationSeed(request: MutationRequest): string {
  return domainDigest("impactdiff:mutation-seed:v1", request);
}

export function computeSourceProbeFingerprint(probe: SourceProbe): string {
  const { probe_fingerprint_sha256: excluded, ...body } = probe;
  void excluded;
  return domainDigest("impactdiff:mutation-probe:v1", body);
}

export function computeMutationPlanId(plan: MutationPlan): string {
  const { plan_id: excluded, ...body } = plan;
  void excluded;
  return `idmp1_${domainDigest("impactdiff:mutation-plan:v1", body)}`;
}
