import { Ajv2020 } from "ajv/dist/2020.js";

import { canonicalJson, parseCanonicalJson } from "../../contracts/canonical.js";
import type { ParseLimits } from "../../contracts/canonical.js";
import {
  ContractValidationError,
  assertNoIssues,
  issue,
} from "../../contracts/errors.js";
import type { ContractIssue } from "../../contracts/errors.js";
import { normalizedJsonValue, normalizedSchemaValue } from "../../contracts/input.js";
import { computeMutationFamilyId } from "../identity.js";
import { contrastRatioMilli } from "../palette.js";
import type { Rgb } from "../palette.js";
import {
  computePilotMutationOperatorCatalogId,
  computePilotMutationOperatorId,
  computePilotMutationPairId,
} from "./identity.js";
import {
  pilotMutationBoundProtocolId,
  pilotMutationOperatorCatalogSchema,
  pilotMutationOperatorDefinitionSchema,
} from "./schema.js";
import type {
  PilotMutationOperatorCatalog,
  PilotMutationOperatorDefinition,
} from "./schema.js";
import { pilotMutationDefinitionSpecs } from "./spec.js";

const definitionContract = "impactdiff.pilot-mutation-operator/v1";
const catalogContract = "impactdiff.pilot-mutation-operator-catalog/v1";
const definitionLimits = {
  maximumBytes: 131_072,
  maximumDepth: 16,
  maximumValues: 4_096,
} as const satisfies ParseLimits;
const catalogLimits = {
  maximumBytes: 131_072,
  maximumDepth: 12,
  maximumValues: 2_048,
} as const satisfies ParseLimits;

const ajv = new Ajv2020({ allErrors: true, ownProperties: true, strict: true });
const definitionValidator = ajv.compile<PilotMutationOperatorDefinition>(
  pilotMutationOperatorDefinitionSchema,
);
const catalogValidator = ajv.compile<PilotMutationOperatorCatalog>(
  pilotMutationOperatorCatalogSchema,
);

function exactValueIssue(
  issues: ContractIssue[],
  code: string,
  path: string,
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    issues.push(issue(code, path, message));
  }
}

export function validatePilotMutationOperatorDefinition(
  value: unknown,
): PilotMutationOperatorDefinition {
  const definition = normalizedSchemaValue(
    definitionContract,
    definitionValidator,
    value,
  );
  const issues: ContractIssue[] = [];
  const spec = pilotMutationDefinitionSpecs.find(
    ({ definitionKey }) => definitionKey === definition.definition_key,
  );

  if (spec === undefined) {
    issues.push(
      issue(
        "pilot_operator.definition_key",
        "/definition_key",
        "definition key must identify one exact code-owned Pilot operator",
      ),
    );
    assertNoIssues(definitionContract, issues);
    return definition;
  }

  const expectedFamilyId = computeMutationFamilyId(spec.familyKey);
  if (definition.family_key !== spec.familyKey) {
    issues.push(
      issue(
        "pilot_operator.family_key",
        "/family_key",
        "definition key must map to its exact Pilot mutation family",
      ),
    );
  }
  if (definition.mutation_family_id !== expectedFamilyId) {
    issues.push(
      issue(
        "pilot_operator.family_identity",
        "/mutation_family_id",
        "mutation_family_id must be derived from the exact family key",
      ),
    );
  }
  if (definition.declared_relation_variant !== spec.relation) {
    issues.push(
      issue(
        "pilot_operator.relation",
        "/declared_relation_variant",
        "definition key must map to its exact declared relation",
      ),
    );
  }

  exactValueIssue(
    issues,
    "pilot_operator.pair_body",
    "/pairing/body",
    definition.pairing.body,
    spec.pairBody,
    "pair body must equal the closed family primitive and parameter profile",
  );
  const expectedPairId = computePilotMutationPairId({
    protocol_id: pilotMutationBoundProtocolId,
    mutation_family_id: expectedFamilyId,
    operator_version: definition.operator_version,
    pair_version: definition.pairing.pair_version,
    body: spec.pairBody,
  });
  if (definition.pairing.pair_id !== expectedPairId) {
    issues.push(
      issue(
        "pilot_operator.pair_identity",
        "/pairing/pair_id",
        "pair_id must bind the protocol, family, versions, and exact shared body",
      ),
    );
  }

  exactValueIssue(
    issues,
    "pilot_operator.source_probes",
    "/required_probes/source",
    definition.required_probes.source,
    spec.sourceProbes,
    "source probes must use the exact code-owned sequence for this family",
  );
  exactValueIssue(
    issues,
    "pilot_operator.effect",
    "/effect",
    definition.effect,
    spec.effect,
    "definition key must map to its exact closed effect",
  );
  if (
    definition.expected_local_task_predicate.predicate !== spec.predicate ||
    definition.expected_local_task_predicate.state !== spec.predicateState
  ) {
    issues.push(
      issue(
        "pilot_operator.local_predicate",
        "/expected_local_task_predicate",
        "definition must bind its exact local predicate and predeclared state",
      ),
    );
  }
  if (
    (definition.declared_relation_variant === "declared_breaking" &&
      definition.expected_local_task_predicate.state !== "fail") ||
    (definition.declared_relation_variant === "task_preserving_control" &&
      definition.expected_local_task_predicate.state !== "pass")
  ) {
    issues.push(
      issue(
        "pilot_operator.relation_predicate",
        "/expected_local_task_predicate/state",
        "breaking definitions predeclare fail and preserving controls predeclare pass",
      ),
    );
  }

  if (definition.effect.kind === "visual_presentation") {
    const ratio = contrastRatioMilli(
      definition.effect.foreground_rgb as unknown as Rgb,
      definition.effect.background_rgb as unknown as Rgb,
    );
    if (definition.effect.ratio_milli !== ratio) {
      issues.push(
        issue(
          "pilot_operator.contrast_ratio",
          "/effect/ratio_milli",
          "visual contrast ratio must be recomputed from the exact sRGB tuples",
        ),
      );
    }
  }

  assertNoIssues(definitionContract, issues);
  return definition;
}

function pairCommonBody(definition: PilotMutationOperatorDefinition): unknown {
  return {
    protocol_id: definition.protocol_id,
    pilot_release: definition.pilot_release,
    operator_version: definition.operator_version,
    family_key: definition.family_key,
    mutation_family_id: definition.mutation_family_id,
    pairing: definition.pairing,
    phase: definition.phase,
    required_probes: definition.required_probes,
    predicate: definition.expected_local_task_predicate.predicate,
    inverse: definition.inverse,
    cleanup_audit: definition.cleanup_audit,
    relation_semantics: definition.relation_semantics,
  };
}

export function validatePilotMutationOperatorDefinitionSet(
  value: unknown,
): readonly PilotMutationOperatorDefinition[] {
  const values = normalizedJsonValue(definitionContract, value);
  if (!Array.isArray(values) || values.length !== pilotMutationDefinitionSpecs.length) {
    throw new ContractValidationError(definitionContract, [
      issue(
        "pilot_operator.catalog_cardinality",
        "/",
        "the Pilot operator set must contain exactly 16 definitions",
      ),
    ]);
  }
  const definitions = values.map(validatePilotMutationOperatorDefinition);
  const issues: ContractIssue[] = [];
  const definitionBytes = new Set<string>();
  const pairCounts = new Map<string, number>();

  for (const [index, definition] of definitions.entries()) {
    const expectedKey = pilotMutationDefinitionSpecs[index]?.definitionKey;
    if (definition.definition_key !== expectedKey) {
      issues.push(
        issue(
          "pilot_operator.catalog_order",
          `/${index}/definition_key`,
          "definitions must use exact family-major, relation-minor order",
        ),
      );
    }
    const bytes = canonicalJson(definition);
    if (definitionBytes.has(bytes)) {
      issues.push(
        issue(
          "pilot_operator.definition_duplicate",
          `/${index}`,
          "every operator definition must have distinct canonical bytes",
        ),
      );
    }
    definitionBytes.add(bytes);
    pairCounts.set(
      definition.pairing.pair_id,
      (pairCounts.get(definition.pairing.pair_id) ?? 0) + 1,
    );

    if (index % 2 === 1) {
      const breaking = definitions[index - 1];
      if (
        breaking === undefined ||
        canonicalJson(pairCommonBody(breaking)) !==
          canonicalJson(pairCommonBody(definition))
      ) {
        issues.push(
          issue(
            "pilot_operator.pair_common_body",
            `/${index - 1}`,
            "each breaking/control pair must share all non-effect operational semantics",
          ),
        );
      }
    }
  }

  if (pairCounts.size !== 8 || [...pairCounts.values()].some((count) => count !== 2)) {
    issues.push(
      issue(
        "pilot_operator.pair_cardinality",
        "/",
        "the catalog must contain eight pair identities with two definitions each",
      ),
    );
  }

  assertNoIssues(definitionContract, issues);
  return Object.freeze(definitions);
}

export function validatePilotMutationOperatorCatalog(
  value: unknown,
): PilotMutationOperatorCatalog {
  const catalog = normalizedSchemaValue(catalogContract, catalogValidator, value);
  const issues: ContractIssue[] = [];
  const operatorIds = new Set<string>();
  const definitionDigests = new Set<string>();

  for (const [index, operator] of catalog.operators.entries()) {
    const spec = pilotMutationDefinitionSpecs[index];
    const expectedFamilyId =
      spec === undefined ? undefined : computeMutationFamilyId(spec.familyKey);
    if (
      spec === undefined ||
      operator.mutation_family_id !== expectedFamilyId ||
      operator.declared_relation_variant !== spec.relation
    ) {
      issues.push(
        issue(
          "pilot_operator.catalog_binding_order",
          `/operators/${index}`,
          "catalog bindings must use exact family-major, relation-minor order",
        ),
      );
    }
    if (operator.operator_id !== computePilotMutationOperatorId(operator)) {
      issues.push(
        issue(
          "pilot_operator.operator_identity",
          `/operators/${index}/operator_id`,
          "operator_id must bind family, relation, version, and definition reference",
        ),
      );
    }
    if (operatorIds.has(operator.operator_id)) {
      issues.push(
        issue(
          "pilot_operator.operator_duplicate",
          `/operators/${index}/operator_id`,
          "operator identities must be unique",
        ),
      );
    }
    operatorIds.add(operator.operator_id);
    if (definitionDigests.has(operator.operator_definition.sha256)) {
      issues.push(
        issue(
          "pilot_operator.definition_reference_duplicate",
          `/operators/${index}/operator_definition/sha256`,
          "operator definitions must bind distinct payload digests",
        ),
      );
    }
    definitionDigests.add(operator.operator_definition.sha256);
  }

  if (catalog.catalog_id !== computePilotMutationOperatorCatalogId(catalog)) {
    issues.push(
      issue(
        "pilot_operator.catalog_identity",
        "/catalog_id",
        "catalog_id must bind the protocol and exact ordered definition references",
      ),
    );
  }

  assertNoIssues(catalogContract, issues);
  return catalog;
}

export function parsePilotMutationOperatorDefinition(
  input: Uint8Array,
): PilotMutationOperatorDefinition {
  return validatePilotMutationOperatorDefinition(
    parseCanonicalJson(input, definitionLimits),
  );
}

export function parsePilotMutationOperatorCatalog(
  input: Uint8Array,
): PilotMutationOperatorCatalog {
  return validatePilotMutationOperatorCatalog(parseCanonicalJson(input, catalogLimits));
}
