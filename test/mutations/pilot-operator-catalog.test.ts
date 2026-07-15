import assert from "node:assert/strict";
import test from "node:test";

import {
  pilotMutationOperatorCatalogCodec,
  pilotMutationOperatorCodec,
} from "../../src/artifacts/codecs.js";
import {
  canonicalJson,
  CanonicalJsonError,
  sha256Hex,
} from "../../src/contracts/canonical.js";
import { ContractValidationError } from "../../src/contracts/errors.js";
import { computeMutationFamilyId } from "../../src/mutations/identity.js";
import {
  computePilotMutationOperatorCatalogId,
  computePilotMutationOperatorId,
  computePilotMutationPairId,
} from "../../src/mutations/catalog/identity.js";
import {
  pilotMutationBoundProtocolId,
  pilotMutationLocalPredicateKeys,
  pilotMutationOperatorDefinitionKeys,
  pilotMutationOperatorMediaType,
  pilotMutationRoundtripProbeCodes,
} from "../../src/mutations/catalog/schema.js";
import type {
  PilotMutationOperatorCatalog,
  PilotMutationOperatorDefinition,
} from "../../src/mutations/catalog/schema.js";
import {
  pilotV01MutationOperatorArtifacts,
  pilotV01MutationOperatorCatalog,
  pilotV01MutationOperatorCatalogCanonicalJson,
  pilotV01MutationOperatorCatalogId,
  pilotV01MutationOperatorDefinitions,
} from "../../src/mutations/catalog/pilot-v01.js";
import { pilotMutationDefinitionSpecs } from "../../src/mutations/catalog/spec.js";
import {
  parsePilotMutationOperatorCatalog,
  parsePilotMutationOperatorDefinition,
  validatePilotMutationOperatorCatalog,
  validatePilotMutationOperatorDefinition,
  validatePilotMutationOperatorDefinitionSet,
} from "../../src/mutations/catalog/validate.js";
import { pilotV01ProtocolId } from "../../src/benchmark/pilot-v01.js";

type DeepMutable<Value> = Value extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: DeepMutable<Value[Key]> }
    : Value;

const expectedRows = [
  {
    definitionKey: "pointer_hit_testing.intercept_source_point.v1",
    familyKey: "pointer_hit_testing",
    relation: "declared_breaking",
    effectKind: "pointer_hit_testing",
    predicate: "primary_source_point_dispatches_to_primary",
    state: "fail",
  },
  {
    definitionKey: "pointer_hit_testing.pass_source_point.v1",
    familyKey: "pointer_hit_testing",
    relation: "task_preserving_control",
    effectKind: "pointer_hit_testing",
    predicate: "primary_source_point_dispatches_to_primary",
    state: "pass",
  },
  {
    definitionKey: "overflow_clipping.exclude_source_point.v1",
    familyKey: "overflow_clipping",
    relation: "declared_breaking",
    effectKind: "overflow_clipping",
    predicate: "primary_fully_visible_and_source_hit_testable",
    state: "fail",
  },
  {
    definitionKey: "overflow_clipping.retain_primary.v1",
    familyKey: "overflow_clipping",
    relation: "task_preserving_control",
    effectKind: "overflow_clipping",
    predicate: "primary_fully_visible_and_source_hit_testable",
    state: "pass",
  },
  {
    definitionKey: "target_displacement.beyond_source_point.v1",
    familyKey: "target_displacement",
    relation: "declared_breaking",
    effectKind: "target_displacement",
    predicate: "primary_at_source_bound_hit_point",
    state: "fail",
  },
  {
    definitionKey: "target_displacement.within_source_point.v1",
    familyKey: "target_displacement",
    relation: "task_preserving_control",
    effectKind: "target_displacement",
    predicate: "primary_at_source_bound_hit_point",
    state: "pass",
  },
  {
    definitionKey: "native_control_state.disable_primary.v1",
    familyKey: "native_control_state",
    relation: "declared_breaking",
    effectKind: "native_control_state",
    predicate: "primary_enabled",
    state: "fail",
  },
  {
    definitionKey: "native_control_state.disable_peer.v1",
    familyKey: "native_control_state",
    relation: "task_preserving_control",
    effectKind: "native_control_state",
    predicate: "primary_enabled",
    state: "pass",
  },
  {
    definitionKey: "focus_navigation.insert_before_primary.v1",
    familyKey: "focus_navigation",
    relation: "declared_breaking",
    effectKind: "focus_navigation",
    predicate: "declared_focus_path_reaches_primary",
    state: "fail",
  },
  {
    definitionKey: "focus_navigation.insert_after_primary.v1",
    familyKey: "focus_navigation",
    relation: "task_preserving_control",
    effectKind: "focus_navigation",
    predicate: "declared_focus_path_reaches_primary",
    state: "pass",
  },
  {
    definitionKey: "accessible_naming.empty_primary_name.v1",
    familyKey: "accessible_naming",
    relation: "declared_breaking",
    effectKind: "accessible_naming",
    predicate: "primary_accessible_name_nonempty",
    state: "fail",
  },
  {
    definitionKey: "accessible_naming.copy_primary_name.v1",
    familyKey: "accessible_naming",
    relation: "task_preserving_control",
    effectKind: "accessible_naming",
    predicate: "primary_accessible_name_nonempty",
    state: "pass",
  },
  {
    definitionKey: "content_overflow.unbreakable_pressure.v1",
    familyKey: "content_overflow",
    relation: "declared_breaking",
    effectKind: "content_overflow",
    predicate: "content_pressure_contained",
    state: "fail",
  },
  {
    definitionKey: "content_overflow.breakable_pressure.v1",
    familyKey: "content_overflow",
    relation: "task_preserving_control",
    effectKind: "content_overflow",
    predicate: "content_pressure_contained",
    state: "pass",
  },
  {
    definitionKey: "visual_presentation.low_contrast_primary.v1",
    familyKey: "visual_presentation",
    relation: "declared_breaking",
    effectKind: "visual_presentation",
    predicate: "primary_text_contrast_at_least_4500",
    state: "fail",
  },
  {
    definitionKey: "visual_presentation.high_contrast_primary.v1",
    familyKey: "visual_presentation",
    relation: "task_preserving_control",
    effectKind: "visual_presentation",
    predicate: "primary_text_contrast_at_least_4500",
    state: "pass",
  },
] as const;

const expectedPredicateKeys = [
  "primary_source_point_dispatches_to_primary",
  "primary_fully_visible_and_source_hit_testable",
  "primary_at_source_bound_hit_point",
  "primary_enabled",
  "declared_focus_path_reaches_primary",
  "primary_accessible_name_nonempty",
  "content_pressure_contained",
  "primary_text_contrast_at_least_4500",
] as const;

const expectedPredicatePolicyRows = [
  {
    designated: "primary_source_point_dispatches_to_primary",
    state: "fail",
    correlated: [
      "primary_fully_visible_and_source_hit_testable",
      "primary_at_source_bound_hit_point",
    ],
  },
  {
    designated: "primary_source_point_dispatches_to_primary",
    state: "pass",
    correlated: [],
  },
  {
    designated: "primary_fully_visible_and_source_hit_testable",
    state: "fail",
    correlated: [
      "primary_source_point_dispatches_to_primary",
      "primary_at_source_bound_hit_point",
    ],
  },
  {
    designated: "primary_fully_visible_and_source_hit_testable",
    state: "pass",
    correlated: [],
  },
  {
    designated: "primary_at_source_bound_hit_point",
    state: "fail",
    correlated: [
      "primary_source_point_dispatches_to_primary",
      "primary_fully_visible_and_source_hit_testable",
    ],
  },
  {
    designated: "primary_at_source_bound_hit_point",
    state: "pass",
    correlated: [],
  },
  {
    designated: "primary_enabled",
    state: "fail",
    correlated: ["declared_focus_path_reaches_primary"],
  },
  {
    designated: "primary_enabled",
    state: "pass",
    correlated: [],
  },
  {
    designated: "declared_focus_path_reaches_primary",
    state: "fail",
    correlated: [],
  },
  {
    designated: "declared_focus_path_reaches_primary",
    state: "pass",
    correlated: [],
  },
  {
    designated: "primary_accessible_name_nonempty",
    state: "fail",
    correlated: [],
  },
  {
    designated: "primary_accessible_name_nonempty",
    state: "pass",
    correlated: [],
  },
  {
    designated: "content_pressure_contained",
    state: "fail",
    correlated: [],
  },
  {
    designated: "content_pressure_contained",
    state: "pass",
    correlated: [],
  },
  {
    designated: "primary_text_contrast_at_least_4500",
    state: "fail",
    correlated: [],
  },
  {
    designated: "primary_text_contrast_at_least_4500",
    state: "pass",
    correlated: [],
  },
] as const;

function expectedInstalledPredicatePolicy(
  row: (typeof expectedPredicatePolicyRows)[number],
) {
  const correlated = new Set<string>(row.correlated);
  return {
    policy_version: 1,
    vector: expectedPredicateKeys.map((predicate) => {
      if (predicate === row.designated) {
        return {
          predicate,
          expected_state: row.state,
          role: "designated",
        } as const;
      }
      if (correlated.has(predicate)) {
        return {
          predicate,
          expected_state: "fail",
          role: "correlated",
        } as const;
      }
      return {
        predicate,
        expected_state: "pass",
        role: "preserved",
      } as const;
    }),
  } as const;
}

const goldenCatalogId =
  "idoc1_d426bac2b936eeabc1cc7810746419700f422e372e99f8b8911d8dd331eed8e2";

const goldenPairIds = [
  "idpr1_46ab0919595d623f9a6d5852c0e54feaadd602a1be2390fdcf8ea40cf2aaae1d",
  "idpr1_1890c9e27612b939102d2f9911b79a32f364fa280c262c31bf47d938db255ef2",
  "idpr1_fd3c3481fdcbc1f6abe627a73a7ea1292808e17278db805aaa87dbc7119a683f",
  "idpr1_787975be4e9f2c5f75598f303792f5b6e73ed6d173fed2f7bc0104f32493558c",
  "idpr1_f0972046d38e21ae13583b3f92673f5b0802f6826a3f114f6d37a27f531f199c",
  "idpr1_d29e44c971f42fcd974add2a75471051a9a29d792e4a77a1d9c5dcf8e1ed6fdd",
  "idpr1_a7d2ead1ac73ec32ebf40cbb80776294b2d6a7f0cdd4944dabb4235445731e77",
  "idpr1_1152dda2ccdd4f2689c739fc714f7520ff3df6a90ea2b885551f07125cf3a0d5",
] as const;

const goldenOperatorIds = [
  "idop1_fc6880b068bc0d2ff05be6085fa810aa120f34e386f848b99a16cc30975dc632",
  "idop1_ee2d76c6a3292e1f09fe87486974eccfb0feeb1048ce8b003ad35516d686b758",
  "idop1_de93e6aeaf6aee7322e57810b433bbb05db62ac61f3fae72e7092f90a9bca085",
  "idop1_6a4d8245f3177b5a0b65d04427c0f539eb03f9873644ed4ded446670e9c1021c",
  "idop1_dae731723606747172e0bbf607dae29b132c9ba5c2ef511aac9a67aec4abd0d0",
  "idop1_c39aa5aad4082abd0dee2d19ddb5089179c7fc5cc6c095ae69a3a10e27227a0b",
  "idop1_c440d46d807b2f6cee2734368c82659d6e227c7e2eef9c5d24983e74aca5f71b",
  "idop1_7f229b419d0ceea15a9911825a19d719fbe561a0706d5b2ecb85f566bfcc246b",
  "idop1_c581e05949a2861badb025ce225d3838e66a55c0af561a2303074802c6c9c5d2",
  "idop1_6a0a922d702ffff8681e17a912a77d9129ef34f2828ed7f0620ba7c8d978757c",
  "idop1_8e916db42d5efb9ec072bbaed3582210013453abd719df2eabab35eb2591d26b",
  "idop1_55b9fa9471e4a5481730b733414bfb0d879c3c1f460559cd35b6626a2d078bb3",
  "idop1_a85182f7ecb2efe0bd829bd964a0fc22d9dd3f6b4d635d805b87e087390484d6",
  "idop1_99be600b8e1fe063727712c3e0516c344c84daa21d618b83bf0e39774782a340",
  "idop1_d6a5e40004d8a742bc31bc1591df033dbd3e4e755ea84e89d1eb4d217637a22b",
  "idop1_9b6cadcd9ea3c257414c84a2bbd287786c19d29b4cd01c150e283eb0c8c3f467",
] as const;

function assertDeepFrozen(value: unknown, path = "$", seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return;
  }
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, `${path} must be frozen`);
  for (const key of Reflect.ownKeys(value)) {
    assertDeepFrozen(Reflect.get(value, key), `${path}/${String(key)}`, seen);
  }
}

function mutableDefinition(
  index: number,
): DeepMutable<PilotMutationOperatorDefinition> {
  const definition = pilotV01MutationOperatorDefinitions[index];
  assert.ok(definition !== undefined);
  return structuredClone(definition) as DeepMutable<PilotMutationOperatorDefinition>;
}

function mutableCatalog(): DeepMutable<PilotMutationOperatorCatalog> {
  return structuredClone(
    pilotV01MutationOperatorCatalog,
  ) as DeepMutable<PilotMutationOperatorCatalog>;
}

function expectIssue(operation: () => unknown, code: string): void {
  assert.throws(
    operation,
    (error: unknown) =>
      error instanceof ContractValidationError &&
      error.issues.some((entry) => entry.code === code),
    `expected ${code}`,
  );
}

function reidentifyCatalog(
  catalog: DeepMutable<PilotMutationOperatorCatalog>,
): DeepMutable<PilotMutationOperatorCatalog> {
  catalog.catalog_id = computePilotMutationOperatorCatalogId(catalog);
  return catalog;
}

test("Pilot v0.1 definitions freeze the exact ordered 8 x 2 catalog", () => {
  assert.equal(pilotV01MutationOperatorDefinitions.length, 16);
  assert.equal(pilotV01MutationOperatorArtifacts.length, 16);
  assert.equal(pilotV01MutationOperatorCatalog.operators.length, 16);
  assert.equal(pilotMutationDefinitionSpecs.length, 16);
  assert.equal(pilotMutationBoundProtocolId, pilotV01ProtocolId);
  assert.deepEqual(
    pilotMutationOperatorDefinitionKeys,
    expectedRows.map((row) => row.definitionKey),
  );

  assert.deepEqual(
    pilotV01MutationOperatorDefinitions.map((definition) => ({
      definitionKey: definition.definition_key,
      familyKey: definition.family_key,
      relation: definition.declared_relation_variant,
      effectKind: definition.effect.kind,
      predicate: definition.expected_local_task_predicate.predicate,
      state: definition.expected_local_task_predicate.state,
    })),
    expectedRows,
  );

  const pairCounts = new Map<string, number>();
  for (const definition of pilotV01MutationOperatorDefinitions) {
    pairCounts.set(
      definition.pairing.pair_id,
      (pairCounts.get(definition.pairing.pair_id) ?? 0) + 1,
    );
  }
  assert.equal(pairCounts.size, 8);
  assert.deepEqual(
    [...pairCounts.values()],
    Array.from({ length: 8 }, () => 2),
  );

  for (let index = 0; index < 16; index += 2) {
    const breaking = pilotV01MutationOperatorDefinitions[index];
    const control = pilotV01MutationOperatorDefinitions[index + 1];
    assert.ok(breaking !== undefined && control !== undefined);
    assert.equal(breaking.declared_relation_variant, "declared_breaking");
    assert.equal(control.declared_relation_variant, "task_preserving_control");
    assert.equal(breaking.pairing.pair_id, control.pairing.pair_id);
    assert.deepEqual(breaking.pairing.body, control.pairing.body);
    assert.equal(
      breaking.expected_local_task_predicate.predicate,
      control.expected_local_task_predicate.predicate,
    );
    assert.notDeepEqual(breaking.effect, control.effect);
  }
});

test("installed predicate policies freeze the exact 16-row causal matrix", () => {
  assert.deepEqual(pilotMutationLocalPredicateKeys, expectedPredicateKeys);
  assert.deepEqual(
    pilotV01MutationOperatorDefinitions.map(
      (definition) => definition.installed_predicate_policy,
    ),
    expectedPredicatePolicyRows.map(expectedInstalledPredicatePolicy),
  );

  for (const [index, definition] of pilotV01MutationOperatorDefinitions.entries()) {
    const policy = definition.installed_predicate_policy;
    const designated = policy.vector.filter(({ role }) => role === "designated");
    assert.equal(policy.policy_version, 1, `definition ${index}`);
    assert.equal(designated.length, 1, `definition ${index}`);
    assert.deepEqual(
      designated[0],
      {
        predicate: definition.expected_local_task_predicate.predicate,
        expected_state: definition.expected_local_task_predicate.state,
        role: "designated",
      },
      `definition ${index}`,
    );

    if (definition.declared_relation_variant === "task_preserving_control") {
      assert.equal(
        policy.vector.some(({ role }) => role === "correlated"),
        false,
        `control ${index} cannot declare correlated failures`,
      );
      assert.equal(
        policy.vector.every(({ expected_state }) => expected_state === "pass"),
        true,
        `control ${index} must keep the complete predicate vector passing`,
      );
    }
  }
});

test("installed predicate policies reject malformed rows and semantic rebinding", () => {
  const missing = mutableDefinition(0);
  missing.installed_predicate_policy.vector.pop();
  expectIssue(
    () => validatePilotMutationOperatorDefinition(missing),
    "schema.minItems",
  );

  const extra = mutableDefinition(0);
  const extraRow = extra.installed_predicate_policy.vector[0];
  assert.ok(extraRow !== undefined);
  extra.installed_predicate_policy.vector.push(structuredClone(extraRow));
  expectIssue(() => validatePilotMutationOperatorDefinition(extra), "schema.maxItems");

  const reordered = mutableDefinition(0);
  const first = reordered.installed_predicate_policy.vector[0];
  const second = reordered.installed_predicate_policy.vector[1];
  assert.ok(first !== undefined && second !== undefined);
  reordered.installed_predicate_policy.vector[0] = second;
  reordered.installed_predicate_policy.vector[1] = first;
  expectIssue(
    () => validatePilotMutationOperatorDefinition(reordered),
    "pilot_operator.predicate_policy_catalog",
  );
  expectIssue(
    () => validatePilotMutationOperatorDefinition(reordered),
    "pilot_operator.predicate_policy",
  );

  const duplicate = mutableDefinition(0);
  const duplicateSource = duplicate.installed_predicate_policy.vector[0];
  assert.ok(duplicateSource !== undefined);
  duplicate.installed_predicate_policy.vector[1] = structuredClone(duplicateSource);
  expectIssue(
    () => validatePilotMutationOperatorDefinition(duplicate),
    "pilot_operator.predicate_policy_catalog",
  );
  expectIssue(
    () => validatePilotMutationOperatorDefinition(duplicate),
    "pilot_operator.predicate_policy",
  );

  const wrongRole = mutableDefinition(8);
  const wrongRoleRow = wrongRole.installed_predicate_policy.vector[0];
  assert.ok(wrongRoleRow !== undefined);
  wrongRoleRow.role = "correlated";
  wrongRoleRow.expected_state = "fail";
  expectIssue(
    () => validatePilotMutationOperatorDefinition(wrongRole),
    "pilot_operator.predicate_policy_catalog",
  );

  const wrongState = mutableDefinition(8);
  const wrongStateRow = wrongState.installed_predicate_policy.vector[0];
  assert.ok(wrongStateRow !== undefined);
  wrongStateRow.expected_state = "fail";
  expectIssue(
    () => validatePilotMutationOperatorDefinition(wrongState),
    "pilot_operator.predicate_policy_catalog",
  );
  expectIssue(
    () => validatePilotMutationOperatorDefinition(wrongState),
    "pilot_operator.predicate_policy",
  );

  const reboundDesignated = mutableDefinition(8);
  const originalDesignated = reboundDesignated.installed_predicate_policy.vector[4];
  const replacementDesignated = reboundDesignated.installed_predicate_policy.vector[0];
  assert.ok(originalDesignated !== undefined && replacementDesignated !== undefined);
  originalDesignated.role = "preserved";
  originalDesignated.expected_state = "pass";
  replacementDesignated.role = "designated";
  replacementDesignated.expected_state = "fail";
  expectIssue(
    () => validatePilotMutationOperatorDefinition(reboundDesignated),
    "pilot_operator.predicate_policy_catalog",
  );
  expectIssue(
    () => validatePilotMutationOperatorDefinition(reboundDesignated),
    "pilot_operator.predicate_policy",
  );

  const correlatedControl = mutableDefinition(1);
  const correlatedControlRow = correlatedControl.installed_predicate_policy.vector[1];
  assert.ok(correlatedControlRow !== undefined);
  correlatedControlRow.role = "correlated";
  correlatedControlRow.expected_state = "fail";
  expectIssue(
    () => validatePilotMutationOperatorDefinition(correlatedControl),
    "pilot_operator.predicate_policy_catalog",
  );
  expectIssue(
    () => validatePilotMutationOperatorDefinition(correlatedControl),
    "pilot_operator.predicate_policy",
  );
});

test("pair, operator, artifact, and catalog identities retain golden values", () => {
  assert.equal(pilotV01MutationOperatorCatalogId, goldenCatalogId);
  assert.equal(pilotV01MutationOperatorCatalog.catalog_id, goldenCatalogId);
  assert.deepEqual(
    pilotV01MutationOperatorDefinitions
      .filter((_, index) => index % 2 === 0)
      .map((definition) => definition.pairing.pair_id),
    goldenPairIds,
  );
  assert.deepEqual(
    pilotV01MutationOperatorArtifacts.map((artifact) => artifact.operator_id),
    goldenOperatorIds,
  );

  for (const [index, artifact] of pilotV01MutationOperatorArtifacts.entries()) {
    const definition = pilotV01MutationOperatorDefinitions[index];
    const binding = pilotV01MutationOperatorCatalog.operators[index];
    assert.ok(definition !== undefined && binding !== undefined);
    assert.equal(artifact.definition, definition);
    assert.equal(artifact.canonical_json, canonicalJson(definition));
    assert.equal(artifact.reference.sha256, sha256Hex(artifact.canonical_json));
    assert.equal(
      artifact.reference.byte_length,
      Buffer.byteLength(artifact.canonical_json, "utf8"),
    );
    assert.equal(artifact.reference.media_type, pilotMutationOperatorMediaType);
    assert.equal(
      definition.pairing.pair_id,
      computePilotMutationPairId({
        protocol_id: definition.protocol_id,
        mutation_family_id: definition.mutation_family_id,
        operator_version: definition.operator_version,
        pair_version: definition.pairing.pair_version,
        body: definition.pairing.body,
      }),
    );
    assert.equal(
      artifact.operator_id,
      computePilotMutationOperatorId({
        mutation_family_id: definition.mutation_family_id,
        declared_relation_variant: definition.declared_relation_variant,
        operator_version: definition.operator_version,
        operator_definition: artifact.reference,
      }),
    );
    assert.deepEqual(binding, {
      mutation_family_id: definition.mutation_family_id,
      declared_relation_variant: definition.declared_relation_variant,
      operator_version: definition.operator_version,
      operator_definition: artifact.reference,
      operator_id: artifact.operator_id,
    });
  }

  assert.equal(
    computePilotMutationOperatorCatalogId(pilotV01MutationOperatorCatalog),
    goldenCatalogId,
  );
  assert.equal(
    pilotV01MutationOperatorCatalogCanonicalJson,
    canonicalJson(pilotV01MutationOperatorCatalog),
  );
});

test("every exported catalog structure and code-owned spec is deeply frozen", () => {
  assertDeepFrozen(pilotMutationDefinitionSpecs);
  assertDeepFrozen(pilotV01MutationOperatorDefinitions);
  assertDeepFrozen(pilotV01MutationOperatorArtifacts);
  assertDeepFrozen(pilotV01MutationOperatorCatalog);
  assert.equal(
    Reflect.set(
      pilotV01MutationOperatorCatalog as unknown as Record<string, unknown>,
      "catalog_id",
      `idoc1_${"0".repeat(64)}`,
    ),
    false,
  );
  assert.equal(
    Reflect.set(
      pilotMutationDefinitionSpecs[0] as unknown as Record<string, unknown>,
      "familyKey",
      "visual_presentation",
    ),
    false,
  );
});

test("closed definitions reject executable text and unknown fields", () => {
  const rootCode = mutableDefinition(0) as unknown as Record<string, unknown>;
  rootCode.javascript = "document.body.remove()";
  expectIssue(
    () => validatePilotMutationOperatorDefinition(rootCode),
    "schema.additionalProperties",
  );

  const selector = mutableDefinition(0);
  (
    selector.pairing.body.fixed_parameters as unknown as Record<string, unknown>
  ).selector = "#primary";
  expectIssue(
    () => validatePilotMutationOperatorDefinition(selector),
    "schema.additionalProperties",
  );

  const css = mutableDefinition(0);
  (css.effect as unknown as Record<string, unknown>).css = "pointer-events:auto";
  expectIssue(
    () => validatePilotMutationOperatorDefinition(css),
    "schema.additionalProperties",
  );

  const catalogCode = mutableCatalog() as unknown as Record<string, unknown>;
  catalogCode.loader = "eval";
  expectIssue(
    () => validatePilotMutationOperatorCatalog(catalogCode),
    "schema.additionalProperties",
  );
});

test("definition keys cannot be rebound across families, relations, effects, or predicates", () => {
  const keySwap = mutableDefinition(0);
  keySwap.definition_key = "overflow_clipping.exclude_source_point.v1";
  expectIssue(
    () => validatePilotMutationOperatorDefinition(keySwap),
    "pilot_operator.family_key",
  );

  const familySwap = mutableDefinition(0);
  familySwap.family_key = "visual_presentation";
  familySwap.mutation_family_id = computeMutationFamilyId("visual_presentation");
  expectIssue(
    () => validatePilotMutationOperatorDefinition(familySwap),
    "pilot_operator.family_key",
  );

  const relationSwap = mutableDefinition(0);
  relationSwap.declared_relation_variant = "task_preserving_control";
  relationSwap.expected_local_task_predicate.state = "pass";
  expectIssue(
    () => validatePilotMutationOperatorDefinition(relationSwap),
    "pilot_operator.relation",
  );

  const effectSwap = mutableDefinition(0);
  effectSwap.effect = {
    kind: "content_overflow",
    wrap_mode: "unbreakable",
  };
  expectIssue(
    () => validatePilotMutationOperatorDefinition(effectSwap),
    "pilot_operator.effect",
  );

  const predicateSwap = mutableDefinition(0);
  predicateSwap.expected_local_task_predicate.predicate = "primary_enabled";
  expectIssue(
    () => validatePilotMutationOperatorDefinition(predicateSwap),
    "pilot_operator.local_predicate",
  );
});

test("source probes reject reordering, omission, duplication, and family substitution", () => {
  const reordered = mutableDefinition(2);
  const first = reordered.required_probes.source[0];
  const second = reordered.required_probes.source[1];
  assert.ok(first !== undefined && second !== undefined);
  reordered.required_probes.source[0] = second;
  reordered.required_probes.source[1] = first;
  expectIssue(
    () => validatePilotMutationOperatorDefinition(reordered),
    "pilot_operator.source_probes",
  );

  const omittedExtra = mutableDefinition(2);
  omittedExtra.required_probes.source.pop();
  expectIssue(
    () => validatePilotMutationOperatorDefinition(omittedExtra),
    "pilot_operator.source_probes",
  );

  const omittedCommon = mutableDefinition(0);
  omittedCommon.required_probes.source.pop();
  expectIssue(
    () => validatePilotMutationOperatorDefinition(omittedCommon),
    "schema.minItems",
  );

  const duplicate = mutableDefinition(2);
  duplicate.required_probes.source[7] = "runtime_clean";
  expectIssue(
    () => validatePilotMutationOperatorDefinition(duplicate),
    "schema.uniqueItems",
  );

  const wrongFamily = mutableDefinition(2);
  wrongFamily.required_probes.source[7] = "displacement_clearance";
  expectIssue(
    () => validatePilotMutationOperatorDefinition(wrongFamily),
    "pilot_operator.source_probes",
  );
});

test("visual definitions reject cross-mixed palettes and trusted ratio fields", () => {
  const crossMixed = mutableDefinition(14);
  crossMixed.effect = {
    kind: "visual_presentation",
    foreground_rgb: [119, 126, 136],
    background_rgb: [221, 238, 248],
    ratio_milli: 1_130,
  };
  expectIssue(
    () => validatePilotMutationOperatorDefinition(crossMixed),
    "pilot_operator.effect",
  );
  expectIssue(
    () => validatePilotMutationOperatorDefinition(crossMixed),
    "pilot_operator.contrast_ratio",
  );

  const forgedRatio = mutableDefinition(14);
  assert.equal(forgedRatio.effect.kind, "visual_presentation");
  if (forgedRatio.effect.kind === "visual_presentation") {
    forgedRatio.effect.ratio_milli = 12_126;
  }
  expectIssue(
    () => validatePilotMutationOperatorDefinition(forgedRatio),
    "pilot_operator.effect",
  );
  expectIssue(
    () => validatePilotMutationOperatorDefinition(forgedRatio),
    "pilot_operator.contrast_ratio",
  );
});

test("definition-set validation rejects reordering and duplicate members", () => {
  const reordered = structuredClone(
    pilotV01MutationOperatorDefinitions,
  ) as unknown as DeepMutable<PilotMutationOperatorDefinition>[];
  const first = reordered[0];
  const second = reordered[1];
  assert.ok(first !== undefined && second !== undefined);
  reordered[0] = second;
  reordered[1] = first;
  expectIssue(
    () => validatePilotMutationOperatorDefinitionSet(reordered),
    "pilot_operator.catalog_order",
  );

  const duplicated = structuredClone(
    pilotV01MutationOperatorDefinitions,
  ) as unknown as DeepMutable<PilotMutationOperatorDefinition>[];
  const duplicateSource = duplicated[0];
  assert.ok(duplicateSource !== undefined);
  duplicated[1] = structuredClone(duplicateSource);
  expectIssue(
    () => validatePilotMutationOperatorDefinitionSet(duplicated),
    "pilot_operator.definition_duplicate",
  );
});

test("definition-set wrappers reject sparse, subclassed, overridden-map, and getter inputs", () => {
  const sparse = new Array(16);
  expectIssue(
    () => validatePilotMutationOperatorDefinitionSet(sparse),
    "input.hidden_property",
  );

  class DefinitionArray extends Array<unknown> {}
  const subclassed = DefinitionArray.from(pilotV01MutationOperatorDefinitions);
  expectIssue(
    () => validatePilotMutationOperatorDefinitionSet(subclassed),
    "input.exotic_array",
  );

  let mapCalls = 0;
  const overriddenMap = structuredClone(
    pilotV01MutationOperatorDefinitions,
  ) as unknown[] & { map: unknown };
  Object.defineProperty(overriddenMap, "map", {
    configurable: true,
    enumerable: true,
    value: () => {
      mapCalls += 1;
      return [];
    },
  });
  expectIssue(
    () => validatePilotMutationOperatorDefinitionSet(overriddenMap),
    "input.hidden_property",
  );
  assert.equal(mapCalls, 0);

  let getterCalls = 0;
  const getterInput = structuredClone(pilotV01MutationOperatorDefinitions);
  Object.defineProperty(getterInput, "0", {
    configurable: true,
    enumerable: true,
    get: () => {
      getterCalls += 1;
      return pilotV01MutationOperatorDefinitions[0];
    },
  });
  expectIssue(
    () => validatePilotMutationOperatorDefinitionSet(getterInput),
    "input.hidden_property",
  );
  assert.equal(getterCalls, 0);
});

test("catalog validation rejects reordered and duplicate definition bindings", () => {
  const reordered = mutableCatalog();
  const first = reordered.operators[0];
  const second = reordered.operators[1];
  assert.ok(first !== undefined && second !== undefined);
  reordered.operators[0] = second;
  reordered.operators[1] = first;
  expectIssue(
    () => validatePilotMutationOperatorCatalog(reidentifyCatalog(reordered)),
    "pilot_operator.catalog_binding_order",
  );

  const duplicate = mutableCatalog();
  const source = duplicate.operators[0];
  assert.ok(source !== undefined);
  duplicate.operators[1] = structuredClone(source);
  expectIssue(
    () => validatePilotMutationOperatorCatalog(reidentifyCatalog(duplicate)),
    "pilot_operator.operator_duplicate",
  );
  expectIssue(
    () => validatePilotMutationOperatorCatalog(reidentifyCatalog(duplicate)),
    "pilot_operator.definition_reference_duplicate",
  );
});

test("canonical definition and catalog parsers reject alternate JSON encodings", () => {
  const definition = pilotV01MutationOperatorDefinitions[0];
  assert.ok(definition !== undefined);
  const definitionBytes = Buffer.from(canonicalJson(definition), "utf8");
  assert.deepEqual(parsePilotMutationOperatorDefinition(definitionBytes), definition);
  assert.deepEqual(
    parsePilotMutationOperatorCatalog(
      Buffer.from(pilotV01MutationOperatorCatalogCanonicalJson, "utf8"),
    ),
    pilotV01MutationOperatorCatalog,
  );

  for (const [parser, value] of [
    [parsePilotMutationOperatorDefinition, definition],
    [parsePilotMutationOperatorCatalog, pilotV01MutationOperatorCatalog],
  ] as const) {
    assert.throws(
      () => parser(Buffer.from(JSON.stringify(value, null, 2), "utf8")),
      (error: unknown) =>
        error instanceof CanonicalJsonError && error.code === "json.noncanonical",
    );
  }
});

test("production operator codecs round-trip only canonical closed payloads", async () => {
  const definition = pilotV01MutationOperatorDefinitions[0];
  assert.ok(definition !== undefined);
  const cases = [
    [pilotMutationOperatorCodec, definition],
    [pilotMutationOperatorCatalogCodec, pilotV01MutationOperatorCatalog],
  ] as const;

  for (const [codec, value] of cases) {
    const bytes = Buffer.from(canonicalJson(value), "utf8");
    assert.deepEqual(Buffer.from(await codec.canonicalize(bytes)), bytes);
    assert.deepEqual(await codec.validate(bytes), value);
    await assert.rejects(
      async () => codec.canonicalize(Buffer.from(JSON.stringify(value, null, 2))),
      (error: unknown) =>
        error instanceof CanonicalJsonError && error.code === "json.noncanonical",
    );
  }

  assert.equal(
    pilotMutationOperatorCodec.mediaType,
    "application/vnd.impactdiff.mutation-operator+json",
  );
  assert.equal(
    pilotMutationOperatorCatalogCodec.mediaType,
    "application/vnd.impactdiff.mutation-operator-catalog+json",
  );
  assert.deepEqual(
    pilotV01MutationOperatorDefinitions[0]?.cleanup_audit.required,
    pilotMutationRoundtripProbeCodes,
  );
});
