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

const goldenCatalogId =
  "idoc1_c74d993f8b1fd77caf3e2b192bd74b6d450384764f8fd996211980f1ee7e0b06";

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
  "idop1_40c96674786ac42b9066fcb780f09a1af9d9b745da2861bd96513c3903afc994",
  "idop1_44700f5cc615679396e44bef786d0d50f800e344ff255366a6006c96370458c1",
  "idop1_e4b095924db2c84fbfe673e2f3e2a331aad94cd88f37e2e2b3e29909407bd6c9",
  "idop1_a47c240340a869a189469fda4582ca866a96706ac50ce130350e0c53353c5bb8",
  "idop1_88b830f229465cda9c04f0daaf706a21aed409f918aa2d220fbc9a9772bfce8e",
  "idop1_6c373365cccb98e3b0ccddedd65a36d78a604241d9f53d5957de6534fddd721d",
  "idop1_03c7459a609fa1d48ccf87d20c4114f13ed180d36f729e550f5c3c2494868c3c",
  "idop1_565525778ffbf2b0b06653caa75a53afc05835c047fb9d308865355c75064fc1",
  "idop1_f23e5f77408e4003d14cc86585a3fc4373d60d70a703309f0366eb3597772ce4",
  "idop1_c278d05999ccc082daed7248e3d813a659582c58d9dba650e93cf90a179af969",
  "idop1_50c29c9b984f26e179c7cd596c6a3c32721bbf2bc1d2845f70f75256c4db8ed6",
  "idop1_6fe55abf080626e313f691187e7f227fda13ec6fef9fa6d84900c6250c1fe9f9",
  "idop1_55ebda0fc3a0b78226204503fa5953d8bfb5ab9f3e365c0783a1f32828369fbd",
  "idop1_b0c3d6549e9a9e4ef9cfff21f1a065e5a87af64ce4ad26d16e680a7332bd8a47",
  "idop1_de983531205776799cb5d2bb1b05e8fce8cc0820d3d559cfbb3f086b55a43f6c",
  "idop1_969436c4dfe1493352d564753197913ee68ed390579a4588abde8b1ce5f206cf",
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
