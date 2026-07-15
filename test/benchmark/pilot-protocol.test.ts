import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalJson,
  computePilotProtocolId,
  ContractValidationError,
  parseCanonicalJson,
  pilotProtocolContract,
  pilotProtocolVersion,
  pilotV01Protocol,
  pilotV01ProtocolCanonicalJson,
  pilotV01ProtocolId,
  validatePilotProtocol,
} from "../../src/index.js";

type MutableIdentifiedProtocol = {
  protocol_id: unknown;
  [key: string]: unknown;
};

interface LeafMutation {
  readonly path: readonly (string | number)[];
  readonly replacement: unknown;
}

const pilotV01GoldenId =
  "idpp1_d6b3e033f59d51b17b29d6fb51c74368a8489f9f9284778cb39e856a73b29309";

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

function collectLeafMutations(
  value: unknown,
  path: readonly (string | number)[] = [],
): LeafMutation[] {
  if (Array.isArray(value)) {
    return [
      { path, replacement: [...value, value[0] ?? "tampered"] },
      ...value.flatMap((child, index) => collectLeafMutations(child, [...path, index])),
    ];
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      key === "protocol_id" ? [] : collectLeafMutations(child, [...path, key]),
    );
  }
  if (typeof value === "boolean") {
    return [{ path, replacement: !value }];
  }
  if (typeof value === "number") {
    return [{ path, replacement: value + 1 }];
  }
  if (typeof value === "string") {
    return [{ path, replacement: `${value}__tampered` }];
  }
  throw new TypeError(`unsupported protocol leaf at /${path.join("/")}`);
}

function replaceAtPath(
  value: MutableIdentifiedProtocol,
  path: readonly (string | number)[],
  replacement: unknown,
): void {
  assert.ok(path.length > 0);
  let cursor: unknown = value;
  for (const segment of path.slice(0, -1)) {
    if (typeof segment === "number") {
      assert.ok(Array.isArray(cursor));
      cursor = cursor[segment];
    } else {
      assert.ok(cursor !== null && typeof cursor === "object");
      cursor = (cursor as Record<string, unknown>)[segment];
    }
  }
  const last = path.at(-1);
  assert.ok(last !== undefined);
  if (typeof last === "number") {
    assert.ok(Array.isArray(cursor));
    cursor[last] = replacement;
  } else {
    assert.ok(cursor !== null && typeof cursor === "object");
    (cursor as Record<string, unknown>)[last] = replacement;
  }
}

function identifiedMutation(mutation: LeafMutation): MutableIdentifiedProtocol {
  const draft = structuredClone(
    pilotV01Protocol,
  ) as unknown as MutableIdentifiedProtocol;
  replaceAtPath(draft, mutation.path, mutation.replacement);
  draft.protocol_id = computePilotProtocolId(draft);
  return draft;
}

function expectIssue(value: unknown, expectedCode: string, context?: string): void {
  assert.throws(
    () => validatePilotProtocol(value),
    (error: unknown) => {
      assert.ok(error instanceof ContractValidationError, context);
      assert.ok(
        error.issues.some(({ code }) => code === expectedCode),
        `${context ?? "validation"}: expected ${expectedCode}, received ${error.issues
          .map(({ code }) => code)
          .join(", ")}`,
      );
      return true;
    },
  );
}

test("Pilot v0.1 freezes the complete 640-pair grouped-outer design", () => {
  assert.equal(pilotProtocolContract, "impactdiff.pilot-protocol");
  assert.equal(pilotProtocolVersion, 1);
  assert.equal(pilotV01Protocol.contract, pilotProtocolContract);
  assert.equal(pilotV01Protocol.version, pilotProtocolVersion);
  assert.equal(pilotV01Protocol.protocol_release, "pilot-v0.1");

  const { design, split } = pilotV01Protocol;
  const matrixCardinality =
    design.application_count *
    design.tasks_per_application *
    design.family_ids.length *
    design.declared_relation_variants.length *
    design.replicates.length;
  assert.equal(matrixCardinality, 20 * 2 * 8 * 2 * 1);
  assert.equal(matrixCardinality, 640);
  assert.equal(design.planned_pair_count, matrixCardinality);
  assert.equal(design.pre_outcome_generation_plan.expected_cell_count, 640);

  const partitions = [
    ["train", split.per_fold_partitions.train, 10, 320, 160],
    ["validation", split.per_fold_partitions.validation, 5, 160, 80],
    ["test", split.per_fold_partitions.test, 5, 160, 80],
  ] as const;
  let applicationTotal = 0;
  let pairTotal = 0;
  for (const [name, partition, applications, pairs, relationCount] of partitions) {
    assert.equal(partition.application_count, applications, name);
    assert.equal(partition.planned_pair_count, pairs, name);
    assert.equal(partition.planned_relation_counts.declared_breaking, relationCount);
    assert.equal(
      partition.planned_relation_counts.task_preserving_control,
      relationCount,
    );
    assert.equal(
      partition.planned_relation_counts.declared_breaking +
        partition.planned_relation_counts.task_preserving_control,
      pairs,
      name,
    );
    applicationTotal += partition.application_count;
    pairTotal += partition.planned_pair_count;
  }
  assert.equal(applicationTotal, design.application_count);
  assert.equal(pairTotal, design.planned_pair_count);

  assert.equal(split.application_block_count, 4);
  assert.equal(split.applications_per_block, 5);
  assert.equal(split.outer_fold_count, 4);
  assert.equal(split.role_schedule.length, 4);
  const expectedBlocks = ["block_0", "block_1", "block_2", "block_3"];
  const testBlocks: string[] = [];
  const validationBlocks: string[] = [];
  for (const [ordinal, fold] of split.role_schedule.entries()) {
    assert.equal(fold.fold_id, `outer_${ordinal}`);
    assert.equal(fold.train_blocks.length, 2);
    assert.equal(fold.validation_blocks.length, 1);
    assert.equal(fold.test_blocks.length, 1);
    assert.deepEqual(
      [...fold.train_blocks, ...fold.validation_blocks, ...fold.test_blocks].toSorted(),
      expectedBlocks,
    );
    testBlocks.push(...fold.test_blocks);
    validationBlocks.push(...fold.validation_blocks);
  }
  assert.deepEqual(testBlocks.toSorted(), expectedBlocks);
  assert.deepEqual(validationBlocks.toSorted(), expectedBlocks);
  assert.equal(split.outer_test_coverage.application_count, 20);
  assert.equal(split.outer_test_coverage.planned_pair_count, 640);
  assert.equal(split.outer_test_coverage.each_application_test_exactly_once, true);
  assert.equal(
    split.outer_test_coverage.each_planned_pair_predicted_exactly_once_per_model,
    true,
  );

  assert.equal(design.outcome_dependent_resampling, false);
  assert.equal(design.outcome_dependent_replacement, false);
  assert.equal(pilotV01Protocol.labels.declared_relation_is_not_label, true);
  assert.equal(
    pilotV01Protocol.evaluation.eligibility_gates.per_fold_validation
      .minimum_measured_task_regressions,
    50,
  );
  assert.equal(
    pilotV01Protocol.evaluation.eligibility_gates.per_fold_test
      .minimum_measured_task_non_regressions,
    50,
  );
  assert.equal(
    pilotV01Protocol.evaluation.eligibility_gates.pooled_outer_test
      .minimum_measured_task_regressions,
    200,
  );
  assert.equal(pilotV01Protocol.evaluation.population.common_row_set_required, true);
  assert.equal(pilotV01Protocol.evaluation.population.model_specific_filtering, false);
  assert.equal(
    pilotV01Protocol.evaluation.population
      .supervised_fit_calibration_and_threshold_population,
    "common_baseline_valid_rows_only",
  );
  assert.equal(pilotV01Protocol.evaluation.claim_temporal_view, "all_checkpoints");
  assert.equal(
    pilotV01Protocol.evaluation.fusion_training.architecture,
    "late_logit_fusion",
  );
  assert.equal(
    pilotV01Protocol.evaluation.fusion_training.stacker_model,
    "l2_logistic_regression",
  );
  assert.equal(
    pilotV01Protocol.evaluation.fusion_training.in_sample_base_model_logits,
    "forbidden",
  );
  assert.equal(
    pilotV01Protocol.evaluation.outer_fold_orchestration.fold_model_test_label_access,
    "forbidden",
  );
  assert.equal(
    pilotV01Protocol.evaluation.outer_fold_orchestration
      .cross_fold_label_or_metric_feedback,
    "forbidden",
  );
  assert.equal(
    pilotV01Protocol.evaluation.eligibility_gates.each_outer_test_application
      .minimum_measured_task_regressions,
    8,
  );
  assert.equal(pilotV01Protocol.data_boundary.raw_visible_store_mount, "absent");
  assert.equal(
    pilotV01Protocol.release_gates.release_preconditions
      .isolated_feature_runner_required_for_benchmark_claim,
    true,
  );
  assert.equal(
    pilotV01Protocol.release_gates.fused_bundle_scope,
    "pixel_expert_structured_expert_stacker_and_preprocessors",
  );
  assert.equal(
    design.pre_outcome_generation_plan.source_state_binding,
    "fixed_per_application_workflow_across_all_operators",
  );
  assert.equal(
    design.pre_outcome_generation_plan.operator_binding,
    "fixed_per_family_relation_across_all_applications_workflows",
  );
  assert.deepEqual(pilotV01Protocol.fusion_claim_gate.comparators, [
    "learned_pixel_only",
    "learned_structured_only",
  ]);
  assert.equal(
    pilotV01Protocol.fusion_claim_gate.decision_rule,
    "every_comparison_lower_bound_strictly_greater_than_zero",
  );
  assert.equal(pilotV01Protocol.fusion_claim_gate.temporal_view, "all_checkpoints");
  assert.equal(
    pilotV01Protocol.fusion_claim_gate.full_data_retrain_metrics_claim_eligible,
    false,
  );
});

test("the exported protocol has a stable canonical identity and is deeply frozen", () => {
  assert.match(pilotV01ProtocolId, /^idpp1_[0-9a-f]{64}$/u);
  assert.equal(pilotV01ProtocolId, pilotV01GoldenId);
  assert.equal(pilotV01Protocol.protocol_id, pilotV01ProtocolId);
  assert.equal(computePilotProtocolId(pilotV01Protocol), pilotV01ProtocolId);
  assert.equal(pilotV01ProtocolCanonicalJson, canonicalJson(pilotV01Protocol));
  assert.deepEqual(parseCanonicalJson(pilotV01ProtocolCanonicalJson), pilotV01Protocol);
  assertDeepFrozen(pilotV01Protocol);

  const input = structuredClone(pilotV01Protocol);
  const validated = validatePilotProtocol(input);
  assert.notEqual(validated, input);
  assert.deepEqual(validated, pilotV01Protocol);
  assertDeepFrozen(validated);

  const reordered = Object.fromEntries(
    Object.entries(input).toReversed(),
  ) as MutableIdentifiedProtocol;
  reordered.protocol_id = "ignored-by-identity";
  assert.equal(computePilotProtocolId(reordered), pilotV01ProtocolId);

  const changed = structuredClone(pilotV01Protocol) as unknown as {
    protocol_id: unknown;
    environment: { locale: string };
  };
  changed.environment.locale = "fr-FR";
  changed.protocol_id = computePilotProtocolId(changed);
  assert.notEqual(changed.protocol_id, pilotV01ProtocolId);
});

test("a syntactically valid substituted protocol identity is rejected", () => {
  expectIssue(
    {
      ...structuredClone(pilotV01Protocol),
      protocol_id: `idpp1_${"0".repeat(64)}`,
    },
    "pilot.identity",
  );
  expectIssue(
    { ...structuredClone(pilotV01Protocol), protocol_id: "not-an-id" },
    "schema.pattern",
  );
});

test("every frozen protocol leaf rejects mutation even with a recomputed identity", () => {
  const mutations = collectLeafMutations(pilotV01Protocol);
  assert.ok(mutations.length >= 80, "expected broad leaf-level invariant coverage");

  const requiredAreas = [
    "design",
    "environment",
    "labels",
    "data_boundary",
    "split",
    "evaluation",
    "release_gates",
    "release_reproducibility",
    "fusion_claim_gate",
    "nonclaims",
  ];
  const coveredAreas = new Set(mutations.map(({ path }) => path[0]));
  for (const area of requiredAreas) {
    assert.equal(coveredAreas.has(area), true, `${area} must be mutation-tested`);
  }

  for (const mutation of mutations) {
    const path = `/${mutation.path.join("/")}`;
    expectIssue(identifiedMutation(mutation), "schema.const", path);
  }
});

test("missing and unknown fields fail closed", () => {
  const missing = structuredClone(pilotV01Protocol) as unknown as Record<
    string,
    unknown
  >;
  delete missing.nonclaims;
  expectIssue(missing, "schema.required");

  const extra = {
    ...structuredClone(pilotV01Protocol),
    undocumented_override: true,
  };
  expectIssue(extra, "schema.additionalProperties");
});

test("non-JSON, cyclic, accessor, symbolic, and exotic inputs fail closed", () => {
  for (const [name, value] of [
    ["undefined", undefined],
    ["bigint", 1n],
    ["function", () => undefined],
  ] as const) {
    expectIssue(value, "input.non_json_value", name);
  }

  const cyclic: Record<string, unknown> = {
    ...structuredClone(pilotV01Protocol),
  };
  cyclic.self = cyclic;
  expectIssue(cyclic, "input.cycle", "cycle");

  const symbolic = structuredClone(pilotV01Protocol) as unknown as Record<
    string | symbol,
    unknown
  >;
  symbolic[Symbol("sealed")] = true;
  expectIssue(symbolic, "input.hidden_property", "symbol property");

  let getterCalls = 0;
  const accessor = structuredClone(pilotV01Protocol) as unknown as Record<
    string,
    unknown
  >;
  Object.defineProperty(accessor, "contract", {
    enumerable: true,
    get: () => {
      getterCalls += 1;
      return "impactdiff.pilot-protocol";
    },
  });
  expectIssue(accessor, "input.hidden_property", "accessor property");
  assert.equal(getterCalls, 0);

  const exotic = structuredClone(pilotV01Protocol) as unknown as object;
  Object.setPrototypeOf(exotic, { inherited: true });
  expectIssue(exotic, "input.exotic_object", "exotic prototype");
});
