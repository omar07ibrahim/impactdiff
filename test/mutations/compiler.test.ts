import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson, canonicalSha256 } from "../../src/contracts/canonical.js";
import { ContractValidationError } from "../../src/contracts/errors.js";
import {
  compileMutation,
  contrastRatioMilli,
  computeMutationFamilyId,
  computeMutationInstanceId,
  computeMutationOperatorId,
  computeMutationPlanId,
  computeMutationSeed,
  computeSourceProbeFingerprint,
  computeMutationTargetNodeId,
  mutationFamilyKey,
  oceanPaletteDefinition,
  oceanPaletteSha256,
  validateMutationCompilation,
  validateMutationPlan,
  validateMutationRequest,
  validatePreconditionReport,
  validateSourceProbe,
} from "../../src/mutations/index.js";
import type {
  FixedRect,
  MutationPlan,
  MutationRequest,
  SourceProbe,
} from "../../src/mutations/index.js";

const hex = (character: string): string => character.repeat(64);
const id = (prefix: string, character: string): string => `${prefix}${hex(character)}`;

function mutationRequest(
  operatorKey: MutationRequest["operator_key"],
  replicateIndex = 0,
): MutationRequest {
  const sourceStateId = id("idss1_", "1");
  const locator = {
    strategy: "test_id" as const,
    value: operatorKey === "palette_swap" ? "app-root" : "place-order",
  };
  return validateMutationRequest({
    contract: "impactdiff.mutation-request",
    version: 1,
    source_state_id: sourceStateId,
    task_id: id("idtk1_", "2"),
    environment_id: id("iden1_", "3"),
    operator_key: operatorKey,
    operator_version: 1,
    replicate_index: replicateIndex,
    target: {
      node_id: computeMutationTargetNodeId(sourceStateId, locator),
      locator,
    },
  });
}

interface ProbeOptions {
  readonly runtimeClean?: boolean;
  readonly resolutionCount?: number;
  readonly resolvedNodeId?: string;
  readonly visible?: boolean;
  readonly inViewport?: boolean;
  readonly centerHitNodeId?: string;
  readonly usedByTask?: boolean;
  readonly bounds?: FixedRect;
  readonly paletteProfile?: "default" | "other" | null;
  readonly paletteSha256?: string | null;
  readonly palettePairs?: SourceProbe["palette"]["contrast_pairs"];
}

function sourceProbe(
  request: MutationRequest,
  options: ProbeOptions = {},
): SourceProbe {
  const resolutionCount = options.resolutionCount ?? 1;
  const resolved = resolutionCount === 1;
  const draft = {
    contract: "impactdiff.mutation-probe",
    version: 1,
    probe_fingerprint_sha256: hex("0"),
    instance_id: computeMutationInstanceId(request),
    source_state_id: request.source_state_id,
    task_id: request.task_id,
    environment_id: request.environment_id,
    runtime_clean: options.runtimeClean ?? true,
    target: {
      resolution_count: resolutionCount,
      resolved_node_id: resolved
        ? (options.resolvedNodeId ?? request.target.node_id)
        : null,
      visible: resolved ? (options.visible ?? true) : null,
      in_viewport: resolved ? (options.inViewport ?? true) : null,
      bounds: resolved
        ? (options.bounds ?? {
            x: 10_000,
            y: 20_000,
            width: 120_000,
            height: 48_000,
            scale: 1_000,
          })
        : null,
      center_hit_node_id: resolved
        ? (options.centerHitNodeId ?? request.target.node_id)
        : null,
      used_by_task: resolved ? (options.usedByTask ?? true) : null,
    },
    palette: {
      source_profile:
        options.paletteProfile === undefined
          ? request.operator_key === "palette_swap"
            ? "default"
            : null
          : options.paletteProfile,
      candidate_palette_sha256:
        options.paletteSha256 === undefined
          ? request.operator_key === "palette_swap"
            ? oceanPaletteSha256
            : null
          : options.paletteSha256,
      contrast_pairs:
        options.palettePairs === undefined
          ? request.operator_key === "palette_swap"
            ? oceanPaletteDefinition.contrast_pairs.map((pair) => ({
                pair_id: pair.pair_id,
                foreground_rgb: [...pair.foreground_rgb],
                background_rgb: [...pair.background_rgb],
                ratio_milli: pair.ratio_milli,
              }))
            : null
          : options.palettePairs,
    },
  } as const satisfies SourceProbe;

  return validateSourceProbe({
    ...draft,
    probe_fingerprint_sha256: computeSourceProbeFingerprint(draft),
  });
}

function expectIssue(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ContractValidationError);
    assert.ok(
      error.issues.some((candidate) => candidate.code === code),
      `expected ${code}, received ${error.issues.map((issue) => issue.code).join(", ")}`,
    );
    return true;
  });
}

function reidentifyPlan(value: MutationPlan): MutationPlan {
  return {
    ...value,
    plan_id: computeMutationPlanId(value),
  };
}

test("palette compilation is canonical, deterministic, and reversible", () => {
  const request = mutationRequest("palette_swap");
  const probe = sourceProbe(request);
  const first = compileMutation(request, probe);
  const second = compileMutation(structuredClone(request), structuredClone(probe));

  assert.equal(first.status, "applicable");
  assert.equal(second.status, "applicable");
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(first.plan.instance_id, computeMutationInstanceId(request));
  assert.equal(first.plan.seed_sha256, computeMutationSeed(request));
  assert.equal(first.plan.plan_id, computeMutationPlanId(first.plan));
  assert.equal(first.plan.operator.expected_task_relation, "preserve");
  assert.equal(first.plan.forward[0]?.opcode, "install_palette_layer");
  assert.equal(first.plan.inverse[0]?.opcode, "remove_inserted_node");
  assert.equal(first.plan.forward[0]?.handle, first.plan.inverse[0]?.handle);
  assert.deepEqual(
    first.preconditions.checks.map((check) => check.code),
    [...first.preconditions.checks.map((check) => check.code)].sort(),
  );
  assert.ok(Object.isFrozen(first.plan));
  assert.ok(Object.isFrozen(first.plan.forward));
  assert.deepEqual(validateMutationCompilation(first.plan, first.preconditions), {
    plan: first.plan,
    preconditions: first.preconditions,
    probe,
  });
});

test("pointer compilation binds exact fixed-point bounds and a breaking descriptor", () => {
  const request = mutationRequest("pointer_interceptor");
  const probe = sourceProbe(request);
  const result = compileMutation(request, probe);

  assert.equal(result.status, "applicable");
  assert.equal(result.plan.operator.expected_task_relation, "break");
  assert.equal(
    result.plan.operator.family_id,
    computeMutationFamilyId(mutationFamilyKey("pointer_interceptor")),
  );
  assert.equal(
    result.plan.operator.operator_id,
    computeMutationOperatorId("pointer_interceptor"),
  );
  const operation = result.plan.forward[0];
  assert.equal(operation?.opcode, "install_pointer_interceptor");
  if (operation?.opcode === "install_pointer_interceptor") {
    assert.deepEqual(operation.rect_milli_css_px, probe.target.bounds);
    assert.equal(operation.rect_milli_css_px.scale, 1_000);
  }
});

test("instance identity and seed change only with the pre-outcome request", () => {
  const first = mutationRequest("palette_swap", 0);
  const replicate = mutationRequest("palette_swap", 1);
  const otherOperator = mutationRequest("pointer_interceptor", 0);

  assert.notEqual(
    computeMutationInstanceId(first),
    computeMutationInstanceId(replicate),
  );
  assert.notEqual(computeMutationSeed(first), computeMutationSeed(replicate));
  assert.notEqual(
    computeMutationInstanceId(first),
    computeMutationInstanceId(otherOperator),
  );
  assert.notEqual(
    computeMutationFamilyId(mutationFamilyKey(first.operator_key)),
    computeMutationFamilyId(mutationFamilyKey(otherOperator.operator_key)),
  );

  const result = compileMutation(first, sourceProbe(first));
  assert.equal(result.status, "applicable");
  const serialized = canonicalJson(result.plan);
  for (const forbidden of [
    "task_success",
    "first_unsatisfied_step_id",
    "task_regression",
    "severity_ordinal",
    "invalid_reason",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("failed preconditions return an explicit result without fallback or a plan", () => {
  const request = mutationRequest("pointer_interceptor");
  const probe = sourceProbe(request, { resolutionCount: 0 });
  const result = compileMutation(request, probe);

  assert.equal(result.status, "not_applicable");
  assert.equal("plan" in result, false);
  assert.equal(result.request.operator_key, "pointer_interceptor");
  assert.equal(result.preconditions.applicable, false);
  assert.equal(
    result.preconditions.checks.find((check) => check.code === "target.exactly_one")
      ?.passed,
    false,
  );
});

test("palette safety is a compile-time precondition", () => {
  const request = mutationRequest("palette_swap");
  const unsafeForeground: [number, number, number] = [120, 120, 120];
  const unsafeBackground: [number, number, number] = [125, 125, 125];
  const unsafePairs: NonNullable<SourceProbe["palette"]["contrast_pairs"]> = [
    {
      pair_id: "body",
      foreground_rgb: unsafeForeground,
      background_rgb: unsafeBackground,
      ratio_milli: contrastRatioMilli(unsafeForeground, unsafeBackground),
    },
    {
      pair_id: oceanPaletteDefinition.contrast_pairs[1]!.pair_id,
      foreground_rgb: [...oceanPaletteDefinition.contrast_pairs[1]!.foreground_rgb],
      background_rgb: [...oceanPaletteDefinition.contrast_pairs[1]!.background_rgb],
      ratio_milli: oceanPaletteDefinition.contrast_pairs[1]!.ratio_milli,
    },
  ];
  const unsafeContrast = compileMutation(
    request,
    sourceProbe(request, { palettePairs: unsafePairs }),
  );
  const wrongProfile = compileMutation(
    request,
    sourceProbe(request, { paletteProfile: "other" }),
  );

  assert.equal(unsafeContrast.status, "not_applicable");
  assert.equal(wrongProfile.status, "not_applicable");
  assert.equal(
    unsafeContrast.preconditions.checks.find(
      (check) => check.code === "palette.contrast_safe",
    )?.passed,
    false,
  );
  assert.equal(
    unsafeContrast.preconditions.checks.find(
      (check) => check.code === "palette.pairs_complete",
    )?.passed,
    false,
  );
  assert.equal(
    wrongProfile.preconditions.checks.find(
      (check) => check.code === "palette.profile_match",
    )?.passed,
    false,
  );
});

test("compiler rejects a probe from another immutable source", () => {
  const request = mutationRequest("pointer_interceptor");
  const probe = structuredClone(sourceProbe(request));
  probe.source_state_id = id("idss1_", "a");
  probe.probe_fingerprint_sha256 = computeSourceProbeFingerprint(probe);

  expectIssue(() => compileMutation(request, probe), "mutation.probe_binding");
});

test("source probes cannot be reused after any request identity change", () => {
  const request = mutationRequest("pointer_interceptor");
  const probe = sourceProbe(request);
  const differentLocator = {
    strategy: "test_id" as const,
    value: "different-target",
  };
  const changedLocator = validateMutationRequest({
    ...request,
    target: {
      ...request.target,
      node_id: computeMutationTargetNodeId(request.source_state_id, differentLocator),
      locator: differentLocator,
    },
  });
  const changedReplicate = validateMutationRequest({
    ...request,
    replicate_index: request.replicate_index + 1,
  });
  const changedOperator = mutationRequest("palette_swap");

  for (const changedRequest of [changedLocator, changedReplicate, changedOperator]) {
    expectIssue(() => compileMutation(changedRequest, probe), "mutation.probe_binding");
  }
});

test("request and plan schemas reject extension and code injection surfaces", () => {
  const request = structuredClone(mutationRequest("palette_swap"));
  const withLabel = { ...request, task_regression: false };
  expectIssue(() => validateMutationRequest(withLabel), "schema.additionalProperties");

  const arbitraryNodeIdentity = structuredClone(request);
  arbitraryNodeIdentity.target.node_id = id("idnd1_", "f");
  expectIssue(
    () => validateMutationRequest(arbitraryNodeIdentity),
    "mutation.target_identity",
  );

  const arbitrarySelector = structuredClone(request) as unknown as {
    target: { locator: { strategy: string; value: string } };
  };
  arbitrarySelector.target.locator.strategy = "css";
  arbitrarySelector.target.locator.value = "body > button:last-child";
  expectIssue(() => validateMutationRequest(arbitrarySelector), "schema.const");

  const compiled = compileMutation(request, sourceProbe(request));
  assert.equal(compiled.status, "applicable");
  const arbitraryCode = structuredClone(compiled.plan) as unknown as {
    forward: Array<Record<string, unknown>>;
  };
  arbitraryCode.forward[0] = {
    opcode: "evaluate_javascript",
    handle: "h0",
    source: "globalThis.pwned = true",
  };
  expectIssue(() => validateMutationPlan(arbitraryCode), "schema.anyOf");
});

test("source probes bind their bytes and reject ambiguous selected targets", () => {
  const request = mutationRequest("pointer_interceptor");
  const stale = structuredClone(sourceProbe(request));
  stale.runtime_clean = false;
  expectIssue(() => validateSourceProbe(stale), "mutation.probe_identity");

  const ambiguous = structuredClone(sourceProbe(request));
  ambiguous.target.resolution_count = 2;
  ambiguous.probe_fingerprint_sha256 = computeSourceProbeFingerprint(ambiguous);
  expectIssue(() => validateSourceProbe(ambiguous), "mutation.probe_ambiguous_target");

  const unpairedPalette = structuredClone(sourceProbe(request));
  unpairedPalette.palette.source_profile = "default";
  unpairedPalette.probe_fingerprint_sha256 =
    computeSourceProbeFingerprint(unpairedPalette);
  expectIssue(
    () => validateSourceProbe(unpairedPalette),
    "mutation.probe_palette_pair",
  );

  const incompleteUniqueTarget = structuredClone(sourceProbe(request));
  incompleteUniqueTarget.target.used_by_task = null;
  incompleteUniqueTarget.probe_fingerprint_sha256 =
    computeSourceProbeFingerprint(incompleteUniqueTarget);
  expectIssue(
    () => validateSourceProbe(incompleteUniqueTarget),
    "mutation.probe_single_target",
  );

  const visibleWithoutGeometry = structuredClone(sourceProbe(request));
  visibleWithoutGeometry.target.bounds = null;
  visibleWithoutGeometry.target.center_hit_node_id = null;
  visibleWithoutGeometry.probe_fingerprint_sha256 =
    computeSourceProbeFingerprint(visibleWithoutGeometry);
  expectIssue(
    () => validateSourceProbe(visibleWithoutGeometry),
    "mutation.probe_visible_target",
  );
});

test("precondition reports require unique sorted checks and derived applicability", () => {
  const request = mutationRequest("palette_swap");
  const result = compileMutation(request, sourceProbe(request));
  assert.equal(result.status, "applicable");

  const reversed = structuredClone(result.preconditions);
  reversed.checks.reverse();
  expectIssue(
    () => validatePreconditionReport(reversed),
    "mutation.precondition_order",
  );

  const duplicate = structuredClone(result.preconditions);
  duplicate.checks[1] = duplicate.checks[0]!;
  duplicate.checks.sort((left, right) =>
    left.code < right.code ? -1 : left.code > right.code ? 1 : 0,
  );
  expectIssue(
    () => validatePreconditionReport(duplicate),
    "mutation.precondition_duplicate",
  );

  const truncated = structuredClone(result.preconditions);
  truncated.checks.pop();
  truncated.applicable = truncated.checks.every((check) => check.passed);
  expectIssue(
    () => validatePreconditionReport(truncated),
    "mutation.precondition_derivation",
  );

  const falseApplicability = {
    ...result.preconditions,
    applicable: false,
  };
  expectIssue(
    () => validatePreconditionReport(falseApplicability),
    "mutation.precondition_applicability",
  );

  const pointerRequest = mutationRequest("pointer_interceptor");
  const pointerResult = compileMutation(pointerRequest, sourceProbe(pointerRequest));
  assert.equal(pointerResult.status, "applicable");
  const impossiblePointerReport = structuredClone(pointerResult.preconditions);
  impossiblePointerReport.probe.palette = {
    source_profile: "default",
    candidate_palette_sha256: oceanPaletteSha256,
    contrast_pairs: oceanPaletteDefinition.contrast_pairs.map((pair) => ({
      pair_id: pair.pair_id,
      foreground_rgb: [...pair.foreground_rgb],
      background_rgb: [...pair.background_rgb],
      ratio_milli: pair.ratio_milli,
    })),
  };
  impossiblePointerReport.probe.probe_fingerprint_sha256 =
    computeSourceProbeFingerprint(impossiblePointerReport.probe);
  impossiblePointerReport.probe_fingerprint_sha256 =
    impossiblePointerReport.probe.probe_fingerprint_sha256;
  expectIssue(
    () => validatePreconditionReport(impossiblePointerReport),
    "mutation.probe_operator_surface",
  );
});

test("plan semantics bind descriptor, target, inverse, seed, and opcode", () => {
  const request = mutationRequest("palette_swap");
  const result = compileMutation(request, sourceProbe(request));
  assert.equal(result.status, "applicable");

  const wrongDescriptor = structuredClone(result.plan);
  wrongDescriptor.operator.expected_task_relation = "break";
  expectIssue(
    () => validateMutationPlan(reidentifyPlan(wrongDescriptor)),
    "mutation.operator_descriptor",
  );

  const wrongPalette = structuredClone(result.plan);
  const paletteOperation = wrongPalette.forward[0];
  assert.equal(paletteOperation?.opcode, "install_palette_layer");
  if (paletteOperation?.opcode === "install_palette_layer") {
    paletteOperation.palette_sha256 = hex("d");
  }
  expectIssue(
    () => validateMutationPlan(reidentifyPlan(wrongPalette)),
    "mutation.palette_identity",
  );

  const wrongTarget = structuredClone(result.plan);
  wrongTarget.forward[0]!.target_node_id = id("idnd1_", "b");
  expectIssue(
    () => validateMutationPlan(reidentifyPlan(wrongTarget)),
    "mutation.target_binding",
  );

  const forgedRequestTarget = structuredClone(result.plan);
  forgedRequestTarget.request.target.node_id = id("idnd1_", "b");
  forgedRequestTarget.forward[0]!.target_node_id =
    forgedRequestTarget.request.target.node_id;
  forgedRequestTarget.instance_id = computeMutationInstanceId(
    forgedRequestTarget.request,
  );
  forgedRequestTarget.seed_sha256 = computeMutationSeed(forgedRequestTarget.request);
  forgedRequestTarget.plan_id = computeMutationPlanId(forgedRequestTarget);
  expectIssue(
    () => validateMutationPlan(forgedRequestTarget),
    "mutation.target_identity",
  );

  const wrongInverse = structuredClone(result.plan) as unknown as {
    inverse: Array<{ handle: string }>;
  };
  wrongInverse.inverse[0]!.handle = "h1";
  expectIssue(() => validateMutationPlan(wrongInverse), "schema.const");

  const pairedHandleChange = structuredClone(result.plan) as unknown as {
    forward: Array<{ handle: string }>;
    inverse: Array<{ handle: string }>;
  };
  pairedHandleChange.forward[0]!.handle = "h9";
  pairedHandleChange.inverse[0]!.handle = "h9";
  expectIssue(() => validateMutationPlan(pairedHandleChange), "schema.const");

  const wrongSeed = structuredClone(result.plan);
  wrongSeed.seed_sha256 = hex("f");
  expectIssue(
    () => validateMutationPlan(reidentifyPlan(wrongSeed)),
    "mutation.seed_identity",
  );

  const wrongInstance = structuredClone(result.plan);
  wrongInstance.instance_id = id("idmi1_", "e");
  expectIssue(
    () => validateMutationPlan(reidentifyPlan(wrongInstance)),
    "mutation.instance_identity",
  );

  const stalePlanId = structuredClone(result.plan);
  stalePlanId.plan_id = id("idmp1_", "0");
  expectIssue(() => validateMutationPlan(stalePlanId), "mutation.plan_identity");

  const pointerOpcode = structuredClone(result.plan) as unknown as MutationPlan;
  pointerOpcode.forward = [
    {
      opcode: "install_pointer_interceptor",
      handle: "h0",
      target_node_id: request.target.node_id,
      rect_milli_css_px: {
        x: 0,
        y: 0,
        width: 1_000,
        height: 1_000,
        scale: 1_000,
      },
    },
  ];
  expectIssue(
    () => validateMutationPlan(reidentifyPlan(pointerOpcode)),
    "mutation.operator_opcode",
  );
});

test("compilation bundle rejects swapped or tampered sealed evidence", () => {
  const request = mutationRequest("pointer_interceptor");
  const probe = sourceProbe(request);
  const result = compileMutation(request, probe);
  assert.equal(result.status, "applicable");

  const tamperedChecks = structuredClone(result.preconditions);
  tamperedChecks.checks[0]!.observed_sha256 = hex("a");
  expectIssue(
    () => validateMutationCompilation(result.plan, tamperedChecks),
    "mutation.precondition_derivation",
  );

  const reboundPlan = structuredClone(result.plan);
  reboundPlan.precondition_report_sha256 = canonicalSha256(tamperedChecks);
  reboundPlan.plan_id = computeMutationPlanId(reboundPlan);
  expectIssue(
    () => validateMutationCompilation(reboundPlan, tamperedChecks),
    "mutation.precondition_derivation",
  );

  const changedGeometry = structuredClone(result.plan);
  const operation = changedGeometry.forward[0];
  assert.equal(operation?.opcode, "install_pointer_interceptor");
  if (operation?.opcode === "install_pointer_interceptor") {
    operation.rect_milli_css_px.width += 1_000;
  }
  changedGeometry.plan_id = computeMutationPlanId(changedGeometry);
  expectIssue(
    () => validateMutationCompilation(changedGeometry, result.preconditions),
    "mutation.compilation_plan",
  );

  const otherInstanceRequest = mutationRequest("pointer_interceptor", 1);
  const otherInstance = compileMutation(
    otherInstanceRequest,
    sourceProbe(otherInstanceRequest),
  );
  assert.equal(otherInstance.status, "applicable");
  expectIssue(
    () => validateMutationCompilation(result.plan, otherInstance.preconditions),
    "mutation.compilation_instance",
  );

  const blockedProbe = sourceProbe(request, {
    centerHitNodeId: id("idnd1_", "d"),
  });
  const blocked = compileMutation(request, blockedProbe);
  assert.equal(blocked.status, "not_applicable");
  const impossiblePlan = structuredClone(result.plan);
  impossiblePlan.probe_fingerprint_sha256 = blockedProbe.probe_fingerprint_sha256;
  impossiblePlan.precondition_report_sha256 = canonicalSha256(blocked.preconditions);
  impossiblePlan.plan_id = computeMutationPlanId(impossiblePlan);
  expectIssue(
    () => validateMutationCompilation(impossiblePlan, blocked.preconditions),
    "mutation.compilation_not_applicable",
  );

  const movedProbe = sourceProbe(request, {
    bounds: {
      x: 10_000,
      y: 20_000,
      width: 121_000,
      height: 48_000,
      scale: 1_000,
    },
  });
  const moved = compileMutation(request, movedProbe);
  assert.equal(moved.status, "applicable");
  expectIssue(
    () => validateMutationCompilation(result.plan, moved.preconditions),
    "mutation.compilation_probe",
  );
});
