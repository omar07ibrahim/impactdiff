import assert from "node:assert/strict";
import test from "node:test";

import {
  computePilotMutationOperatorCatalogId,
  computePilotMutationOperatorId,
  computePilotMutationPairId,
} from "../../src/mutations/catalog/identity.js";

const protocolId = `idpp1_${"c".repeat(64)}`;
const mutationFamilyId = `idmf1_${"a".repeat(64)}`;
const operatorDefinition = Object.freeze({
  sha256: "b".repeat(64),
  byte_length: 123,
  media_type: "application/vnd.impactdiff.mutation-operator+json",
  format_version: 1 as const,
});
const operator = Object.freeze({
  mutation_family_id: mutationFamilyId,
  declared_relation_variant: "declared_breaking" as const,
  operator_version: 1,
  operator_definition: operatorDefinition,
});

test("Pilot mutation identities retain their frozen domain-separated values", () => {
  assert.equal(
    computePilotMutationOperatorId(operator),
    "idop1_5f034b6f44a44b15e90d1e953ce7c08439f56c19b468ec94be5fc4a8a245e25b",
  );
  assert.equal(
    computePilotMutationPairId({
      protocol_id: protocolId,
      mutation_family_id: mutationFamilyId,
      operator_version: 1,
      pair_version: 1,
      body: {
        changed_surface: "hit_region",
        primitive: "owned_overlay",
      },
    }),
    "idpr1_b597a816d9be72f448692ff5b3a2dfafe3f4f7cbcc8f610cc322f487c1b7b9b3",
  );
  assert.equal(
    computePilotMutationOperatorCatalogId({
      protocol_id: protocolId,
      pilot_release: "pilot-v0.1",
      operators: [operator],
    }),
    "idoc1_933c1e9f02aaf89650f8c7193f6fa4b976c31a1a25f6fd80959454971ba97424",
  );
});

test("pair and catalog identities project only their non-circular inputs", () => {
  const pair = {
    protocol_id: protocolId,
    mutation_family_id: mutationFamilyId,
    operator_version: 1,
    pair_version: 1,
    body: { primitive: "owned_overlay" },
  };
  const pairWithSelfId = {
    ...pair,
    pair_id: `idpr1_${"d".repeat(64)}`,
  };
  assert.equal(
    computePilotMutationPairId(pair),
    computePilotMutationPairId(pairWithSelfId),
  );

  const catalog = {
    protocol_id: protocolId,
    pilot_release: "pilot-v0.1",
    operators: [operator],
  };
  const catalogWithSelfIds = {
    ...catalog,
    catalog_id: `idoc1_${"e".repeat(64)}`,
    operators: [
      {
        ...operator,
        operator_id: computePilotMutationOperatorId(operator),
      },
    ],
  };
  assert.equal(
    computePilotMutationOperatorCatalogId(catalog),
    computePilotMutationOperatorCatalogId(catalogWithSelfIds),
  );

  assert.notEqual(
    computePilotMutationPairId(pair),
    computePilotMutationPairId({
      ...pair,
      protocol_id: `idpp1_${"f".repeat(64)}`,
    }),
  );
  assert.notEqual(
    computePilotMutationOperatorCatalogId(catalog),
    computePilotMutationOperatorCatalogId({
      ...catalog,
      protocol_id: `idpp1_${"f".repeat(64)}`,
    }),
  );
});
