import { createHash } from "node:crypto";

import type { ArtifactRef } from "../../contracts/artifacts.js";
import { canonicalJson } from "../../contracts/canonical.js";

export type PilotMutationDeclaredRelationVariant =
  "declared_breaking" | "task_preserving_control";

export interface PilotMutationPairIdentityInput<Body = unknown> {
  readonly protocol_id: string;
  readonly mutation_family_id: string;
  readonly operator_version: number;
  readonly pair_version: number;
  readonly body: Body;
}

export interface PilotMutationOperatorIdentityInput {
  readonly mutation_family_id: string;
  readonly declared_relation_variant: PilotMutationDeclaredRelationVariant;
  readonly operator_version: number;
  readonly operator_definition: ArtifactRef;
}

export type PilotMutationOperatorCatalogEntryIdentityInput =
  PilotMutationOperatorIdentityInput;

export interface PilotMutationOperatorCatalogIdentityInput {
  readonly protocol_id: string;
  readonly pilot_release: string;
  readonly operators: readonly PilotMutationOperatorCatalogEntryIdentityInput[];
}

const domainDigest = (domain: string, body: unknown): string => {
  const hash = createHash("sha256");
  hash.update(domain, "utf8");
  hash.update("\0", "utf8");
  hash.update(canonicalJson(body), "utf8");
  return hash.digest("hex");
};

function artifactIdentity(reference: ArtifactRef): ArtifactRef {
  return {
    sha256: reference.sha256,
    byte_length: reference.byte_length,
    media_type: reference.media_type,
    format_version: reference.format_version,
  };
}

export function computePilotMutationPairId<Body>(
  input: PilotMutationPairIdentityInput<Body>,
): string {
  const body = {
    protocol_id: input.protocol_id,
    mutation_family_id: input.mutation_family_id,
    operator_version: input.operator_version,
    pair_version: input.pair_version,
    body: input.body,
  };
  return `idpr1_${domainDigest("impactdiff:pilot-operator-pair:v1", body)}`;
}

export function computePilotMutationOperatorId(
  input: PilotMutationOperatorIdentityInput,
): string {
  const body = {
    mutation_family_id: input.mutation_family_id,
    declared_relation_variant: input.declared_relation_variant,
    operator_version: input.operator_version,
    operator_definition: artifactIdentity(input.operator_definition),
  };
  return `idop1_${domainDigest("impactdiff:pilot-mutation-operator:v1", body)}`;
}

export function computePilotMutationOperatorCatalogId(
  input: PilotMutationOperatorCatalogIdentityInput,
): string {
  const body = {
    protocol_id: input.protocol_id,
    pilot_release: input.pilot_release,
    operators: input.operators.map((operator) => ({
      mutation_family_id: operator.mutation_family_id,
      declared_relation_variant: operator.declared_relation_variant,
      operator_version: operator.operator_version,
      operator_definition: artifactIdentity(operator.operator_definition),
    })),
  };
  return `idoc1_${domainDigest("impactdiff:pilot-operator-catalog:v1", body)}`;
}
