import { sha256Hex } from "../../contracts/canonical.js";
import { computeMutationFamilyId } from "../identity.js";
import {
  computePilotMutationOperatorCatalogId,
  computePilotMutationOperatorId,
  computePilotMutationPairId,
} from "./identity.js";
import {
  pilotMutationBoundProtocolId,
  pilotMutationInstalledProbeCodes,
  pilotMutationOperatorMediaType,
  pilotMutationRoundtripProbeCodes,
} from "./schema.js";
import {
  validatePilotMutationOperatorCatalog,
  validatePilotMutationOperatorDefinitionSet,
} from "./validate.js";
import {
  installedPredicatePolicyForSpec,
  pilotMutationDefinitionSpecs,
} from "./spec.js";
import { canonicalJson } from "../../contracts/canonical.js";

const inverse = Object.freeze({
  opcode: "remove_owned_intervention" as const,
  handle: "h0" as const,
  restore_preimage: "exact" as const,
});

const relationSemantics = Object.freeze({
  provenance_only: true as const,
  measured_label_source: "independent_task_replay" as const,
  preservation_scope: "declared_workflow_only" as const,
});

const definitionDrafts = pilotMutationDefinitionSpecs.map((spec) => {
  const mutationFamilyId = computeMutationFamilyId(spec.familyKey);
  return {
    contract: "impactdiff.pilot-mutation-operator",
    version: 1,
    protocol_id: pilotMutationBoundProtocolId,
    pilot_release: "pilot-v0.1",
    definition_key: spec.definitionKey,
    operator_version: 1,
    family_key: spec.familyKey,
    mutation_family_id: mutationFamilyId,
    declared_relation_variant: spec.relation,
    pairing: {
      pair_id: computePilotMutationPairId({
        protocol_id: pilotMutationBoundProtocolId,
        mutation_family_id: mutationFamilyId,
        operator_version: 1,
        pair_version: 1,
        body: spec.pairBody,
      }),
      pair_version: 1,
      body: spec.pairBody,
    },
    phase: "before_task",
    required_probes: {
      source: spec.sourceProbes,
      installed: pilotMutationInstalledProbeCodes,
      inverse_roundtrip: pilotMutationRoundtripProbeCodes,
    },
    effect: spec.effect,
    expected_local_task_predicate: {
      predicate: spec.predicate,
      state: spec.predicateState,
    },
    installed_predicate_policy: installedPredicatePolicyForSpec(spec),
    inverse,
    cleanup_audit: { required: pilotMutationRoundtripProbeCodes },
    relation_semantics: relationSemantics,
  };
});

export const pilotV01MutationOperatorDefinitions =
  validatePilotMutationOperatorDefinitionSet(definitionDrafts);

export const pilotV01MutationOperatorArtifacts = Object.freeze(
  pilotV01MutationOperatorDefinitions.map((definition) => {
    const canonicalJsonValue = canonicalJson(definition);
    const reference = Object.freeze({
      sha256: sha256Hex(canonicalJsonValue),
      byte_length: Buffer.byteLength(canonicalJsonValue, "utf8"),
      media_type: pilotMutationOperatorMediaType,
      format_version: 1 as const,
    });
    return Object.freeze({
      definition,
      canonical_json: canonicalJsonValue,
      reference,
      operator_id: computePilotMutationOperatorId({
        mutation_family_id: definition.mutation_family_id,
        declared_relation_variant: definition.declared_relation_variant,
        operator_version: definition.operator_version,
        operator_definition: reference,
      }),
    });
  }),
);

const operatorBindings = pilotV01MutationOperatorArtifacts.map((artifact) => ({
  mutation_family_id: artifact.definition.mutation_family_id,
  declared_relation_variant: artifact.definition.declared_relation_variant,
  operator_version: artifact.definition.operator_version,
  operator_definition: artifact.reference,
  operator_id: artifact.operator_id,
}));

const catalogDraft = {
  contract: "impactdiff.pilot-mutation-operator-catalog",
  version: 1,
  protocol_id: pilotMutationBoundProtocolId,
  pilot_release: "pilot-v0.1",
  catalog_id: `idoc1_${"0".repeat(64)}`,
  operators: operatorBindings,
};

export const pilotV01MutationOperatorCatalog = validatePilotMutationOperatorCatalog({
  ...catalogDraft,
  catalog_id: computePilotMutationOperatorCatalogId(catalogDraft),
});

export const pilotV01MutationOperatorCatalogId =
  pilotV01MutationOperatorCatalog.catalog_id;
export const pilotV01MutationOperatorCatalogCanonicalJson = canonicalJson(
  pilotV01MutationOperatorCatalog,
);
