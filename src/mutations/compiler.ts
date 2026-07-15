import { Ajv2020 } from "ajv/dist/2020.js";

import { canonicalSha256 } from "../contracts/canonical.js";
import { ContractValidationError, assertNoIssues, issue } from "../contracts/errors.js";
import type { ContractIssue } from "../contracts/errors.js";
import { normalizedSchemaValue } from "../contracts/input.js";
import {
  computeMutationFamilyId,
  computeMutationInstanceId,
  computeMutationOperatorId,
  computeMutationPlanId,
  computeMutationSeed,
  computeMutationTargetNodeId,
  computeSourceProbeFingerprint,
  mutationFamilyKey,
} from "./identity.js";
import {
  mutationPlanSchema,
  mutationRequestSchema,
  preconditionReportSchema,
  sourceProbeSchema,
} from "./schema.js";
import type {
  MutationPlan,
  MutationRequest,
  PreconditionCode,
  PreconditionReport,
  SourceProbe,
} from "./schema.js";
import {
  contrastRatioMilli,
  oceanPaletteDefinition,
  oceanPaletteSha256,
} from "./palette.js";
import type { Rgb } from "./palette.js";

const ajv = new Ajv2020({ allErrors: true, ownProperties: true, strict: true });
const requestValidator = ajv.compile<MutationRequest>(mutationRequestSchema);
const probeValidator = ajv.compile<SourceProbe>(sourceProbeSchema);
const preconditionValidator = ajv.compile<PreconditionReport>(preconditionReportSchema);
const planValidator = ajv.compile<MutationPlan>(mutationPlanSchema);

const placeholderPlanId = `idmp1_${"0".repeat(64)}`;

interface OperatorDescriptor {
  readonly operatorKey: MutationRequest["operator_key"];
  readonly familyId: string;
  readonly operatorId: string;
  readonly operatorVersion: 1;
  readonly expectedTaskRelation: "break" | "preserve";
}

function operatorDescriptor(
  operatorKey: MutationRequest["operator_key"],
): OperatorDescriptor {
  return {
    operatorKey,
    familyId: computeMutationFamilyId(mutationFamilyKey(operatorKey)),
    operatorId: computeMutationOperatorId(operatorKey),
    operatorVersion: 1,
    expectedTaskRelation: operatorKey === "palette_swap" ? "preserve" : "break",
  };
}

function pointerProbeCarriesPalette(
  request: MutationRequest,
  probe: SourceProbe,
): boolean {
  return (
    request.operator_key === "pointer_interceptor" &&
    (probe.palette.source_profile !== null ||
      probe.palette.candidate_palette_sha256 !== null ||
      probe.palette.contrast_pairs !== null)
  );
}

export function validateMutationRequest(value: unknown): MutationRequest {
  const request = normalizedSchemaValue(
    "impactdiff.mutation-request/v1",
    requestValidator,
    value,
  );
  const expectedNodeId = computeMutationTargetNodeId(
    request.source_state_id,
    request.target.locator,
  );
  if (request.target.node_id !== expectedNodeId) {
    throw new ContractValidationError("impactdiff.mutation-request/v1", [
      issue(
        "mutation.target_identity",
        "/target/node_id",
        "target node identity must be derived from source state and locator",
      ),
    ]);
  }
  return request;
}

export function validateSourceProbe(value: unknown): SourceProbe {
  const probe = normalizedSchemaValue(
    "impactdiff.mutation-probe/v1",
    probeValidator,
    value,
  );
  const issues: ContractIssue[] = [];
  const target = probe.target;
  const targetObservations = [
    target.resolved_node_id,
    target.visible,
    target.in_viewport,
    target.bounds,
    target.center_hit_node_id,
    target.used_by_task,
  ];

  if (probe.probe_fingerprint_sha256 !== computeSourceProbeFingerprint(probe)) {
    issues.push(
      issue(
        "mutation.probe_identity",
        "/probe_fingerprint_sha256",
        "the probe fingerprint must bind the canonical probe body",
      ),
    );
  }

  if (target.resolution_count === 1) {
    if (
      target.resolved_node_id === null ||
      target.visible === null ||
      target.in_viewport === null ||
      target.used_by_task === null
    ) {
      issues.push(
        issue(
          "mutation.probe_single_target",
          "/target",
          "a uniquely resolved target must include identity and boolean observations",
        ),
      );
    }
    if (
      target.visible === true &&
      target.in_viewport === true &&
      (target.bounds === null || target.center_hit_node_id === null)
    ) {
      issues.push(
        issue(
          "mutation.probe_visible_target",
          "/target",
          "a visible in-viewport target must include bounds and its center hit-test result",
        ),
      );
    }
  } else if (targetObservations.some((observation) => observation !== null)) {
    issues.push(
      issue(
        "mutation.probe_ambiguous_target",
        "/target",
        "unresolved or ambiguous targets cannot carry selected target observations",
      ),
    );
  }

  const paletteValues = [
    probe.palette.source_profile,
    probe.palette.candidate_palette_sha256,
    probe.palette.contrast_pairs,
  ];
  const presentPaletteValues = paletteValues.filter((value) => value !== null).length;
  if (presentPaletteValues !== 0 && presentPaletteValues !== paletteValues.length) {
    issues.push(
      issue(
        "mutation.probe_palette_pair",
        "/palette",
        "palette provenance and contrast observations must be all present or all null",
      ),
    );
  }
  const contrastPairs = probe.palette.contrast_pairs;
  if (contrastPairs !== null) {
    const pairIds = contrastPairs.map((pair) => pair.pair_id);
    const sortedPairIds = [...pairIds].sort();
    if (
      new Set(pairIds).size !== pairIds.length ||
      pairIds.some((pairId, index) => pairId !== sortedPairIds[index])
    ) {
      issues.push(
        issue(
          "mutation.probe_palette_order",
          "/palette/contrast_pairs",
          "palette contrast pairs must be unique and sorted by pair_id",
        ),
      );
    }
    for (const [index, pair] of contrastPairs.entries()) {
      if (
        pair.ratio_milli !==
        contrastRatioMilli(
          pair.foreground_rgb as unknown as Rgb,
          pair.background_rgb as unknown as Rgb,
        )
      ) {
        issues.push(
          issue(
            "mutation.probe_contrast_ratio",
            `/palette/contrast_pairs/${index}/ratio_milli`,
            "palette contrast ratios must be derived from the recorded colors",
          ),
        );
      }
    }
  }

  assertNoIssues("impactdiff.mutation-probe/v1", issues);
  return probe;
}

export function validatePreconditionReport(value: unknown): PreconditionReport {
  const report = normalizedSchemaValue(
    "impactdiff.intervention-preconditions/v1",
    preconditionValidator,
    value,
  );
  const request = validateMutationRequest(report.request);
  const probe = validateSourceProbe(report.probe);
  const issues: ContractIssue[] = [];
  const codes = report.checks.map((check) => check.code);
  const sortedCodes = [...codes].sort();

  if (new Set(codes).size !== codes.length) {
    issues.push(
      issue(
        "mutation.precondition_duplicate",
        "/checks",
        "precondition codes must be unique",
      ),
    );
  }
  if (codes.some((code, index) => code !== sortedCodes[index])) {
    issues.push(
      issue(
        "mutation.precondition_order",
        "/checks",
        "precondition checks must be sorted by code",
      ),
    );
  }

  const derivedApplicable = report.checks.every((check) => check.passed);
  if (report.applicable !== derivedApplicable) {
    issues.push(
      issue(
        "mutation.precondition_applicability",
        "/applicable",
        "applicability must equal the conjunction of every precondition",
      ),
    );
  }
  const expectedInstanceId = computeMutationInstanceId(request);
  if (
    report.instance_id !== expectedInstanceId ||
    probe.instance_id !== expectedInstanceId
  ) {
    issues.push(
      issue(
        "mutation.precondition_instance",
        "/instance_id",
        "the report and embedded probe must bind the exact mutation request",
      ),
    );
  }
  if (report.probe_fingerprint_sha256 !== probe.probe_fingerprint_sha256) {
    issues.push(
      issue(
        "mutation.precondition_probe",
        "/probe_fingerprint_sha256",
        "the report must bind its embedded source probe",
      ),
    );
  }
  for (const [field, requestId, probeId] of [
    ["instance_id", computeMutationInstanceId(request), probe.instance_id],
    ["source_state_id", request.source_state_id, probe.source_state_id],
    ["task_id", request.task_id, probe.task_id],
    ["environment_id", request.environment_id, probe.environment_id],
  ] as const) {
    if (requestId !== probeId) {
      issues.push(
        issue(
          "mutation.precondition_binding",
          `/probe/${field}`,
          `the embedded probe ${field} must match the mutation request`,
        ),
      );
    }
  }
  if (pointerProbeCarriesPalette(request, probe)) {
    issues.push(
      issue(
        "mutation.probe_operator_surface",
        "/probe/palette",
        "pointer-interceptor probes cannot carry palette observations",
      ),
    );
  }

  const expectedChecks = checksFromObservations(
    preconditionObservations(request, probe),
  );
  if (canonicalSha256(report.checks) !== canonicalSha256(expectedChecks)) {
    issues.push(
      issue(
        "mutation.precondition_derivation",
        "/checks",
        "precondition checks must be derived from the embedded request and probe",
      ),
    );
  }

  assertNoIssues("impactdiff.intervention-preconditions/v1", issues);
  return report;
}

export function validateMutationPlan(value: unknown): MutationPlan {
  const plan = normalizedSchemaValue(
    "impactdiff.intervention-parameters/v1",
    planValidator,
    value,
  );
  validateMutationRequest(plan.request);
  const issues: ContractIssue[] = [];
  const descriptor = operatorDescriptor(plan.request.operator_key);
  const forward = plan.forward[0];
  const inverse = plan.inverse[0];

  if (plan.instance_id !== computeMutationInstanceId(plan.request)) {
    issues.push(
      issue(
        "mutation.instance_identity",
        "/instance_id",
        "instance_id must be derived only from the canonical mutation request",
      ),
    );
  }
  if (plan.seed_sha256 !== computeMutationSeed(plan.request)) {
    issues.push(
      issue(
        "mutation.seed_identity",
        "/seed_sha256",
        "the deterministic seed must be derived from the canonical mutation request",
      ),
    );
  }
  if (
    plan.operator.operator_key !== descriptor.operatorKey ||
    plan.operator.operator_version !== descriptor.operatorVersion ||
    plan.operator.family_id !== descriptor.familyId ||
    plan.operator.operator_id !== descriptor.operatorId ||
    plan.operator.expected_task_relation !== descriptor.expectedTaskRelation
  ) {
    issues.push(
      issue(
        "mutation.operator_descriptor",
        "/operator",
        "the operator descriptor must be derived from the requested operator",
      ),
    );
  }

  if (forward !== undefined) {
    const expectedOpcode =
      plan.request.operator_key === "palette_swap"
        ? "install_palette_layer"
        : "install_pointer_interceptor";
    if (forward.opcode !== expectedOpcode) {
      issues.push(
        issue(
          "mutation.operator_opcode",
          "/forward/0/opcode",
          "the forward opcode must match the requested operator",
        ),
      );
    }
    if (forward.target_node_id !== plan.request.target.node_id) {
      issues.push(
        issue(
          "mutation.target_binding",
          "/forward/0/target_node_id",
          "the forward operation must target the requested opaque node",
        ),
      );
    }
    if (
      forward.opcode === "install_palette_layer" &&
      forward.palette_sha256 !== oceanPaletteSha256
    ) {
      issues.push(
        issue(
          "mutation.palette_identity",
          "/forward/0/palette_sha256",
          "the palette operation must bind the exact versioned palette definition",
        ),
      );
    }
    if (inverse !== undefined && inverse.handle !== forward.handle) {
      issues.push(
        issue(
          "mutation.inverse_handle",
          "/inverse/0/handle",
          "the inverse operation must remove the exact forward-owned handle",
        ),
      );
    }
  }

  if (plan.plan_id !== computeMutationPlanId(plan)) {
    issues.push(
      issue(
        "mutation.plan_identity",
        "/plan_id",
        "plan_id must bind the canonical mutation plan body",
      ),
    );
  }

  assertNoIssues("impactdiff.intervention-parameters/v1", issues);
  return plan;
}

interface PreconditionObservation {
  readonly code: PreconditionCode;
  readonly passed: boolean;
  readonly observed: unknown;
}

function compareCode(
  left: { readonly code: string },
  right: { readonly code: string },
): number {
  return left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
}

function checksFromObservations(
  observations: readonly PreconditionObservation[],
): PreconditionReport["checks"] {
  return observations
    .map(({ code, passed, observed }) => ({
      code,
      passed,
      observed_sha256: canonicalSha256(observed),
    }))
    .sort(compareCode);
}

function reportFromObservations(
  request: MutationRequest,
  instanceId: string,
  probe: SourceProbe,
  observations: readonly PreconditionObservation[],
): PreconditionReport {
  const checks = checksFromObservations(observations);

  return validatePreconditionReport({
    contract: "impactdiff.intervention-preconditions",
    version: 1,
    instance_id: instanceId,
    probe_fingerprint_sha256: probe.probe_fingerprint_sha256,
    request,
    probe,
    applicable: checks.every((check) => check.passed),
    checks,
  });
}

function commonObservations(
  request: MutationRequest,
  probe: SourceProbe,
): PreconditionObservation[] {
  const target = probe.target;
  return [
    {
      code: "runtime.clean",
      passed: probe.runtime_clean,
      observed: probe.runtime_clean,
    },
    {
      code: "target.exactly_one",
      passed: target.resolution_count === 1,
      observed: target.resolution_count,
    },
    {
      code: "target.identity",
      passed: target.resolved_node_id === request.target.node_id,
      observed: {
        requested: request.target.node_id,
        resolved: target.resolved_node_id,
      },
    },
    {
      code: "target.in_viewport",
      passed: target.in_viewport === true,
      observed: target.in_viewport,
    },
    {
      code: "target.nonempty_bounds",
      passed: target.bounds !== null,
      observed: target.bounds,
    },
    {
      code: "target.used_by_task",
      passed: target.used_by_task === true,
      observed: target.used_by_task,
    },
    {
      code: "target.visible",
      passed: target.visible === true,
      observed: target.visible,
    },
  ];
}

function preconditionObservations(
  request: MutationRequest,
  probe: SourceProbe,
): PreconditionObservation[] {
  const observations = commonObservations(request, probe);
  if (request.operator_key === "palette_swap") {
    const contrastPairs = probe.palette.contrast_pairs;
    observations.push(
      {
        code: "palette.profile_match",
        passed: probe.palette.source_profile === "default",
        observed: probe.palette.source_profile,
      },
      {
        code: "palette.definition_match",
        passed: probe.palette.candidate_palette_sha256 === oceanPaletteSha256,
        observed: probe.palette.candidate_palette_sha256,
      },
      {
        code: "palette.pairs_complete",
        passed:
          contrastPairs !== null &&
          canonicalSha256(contrastPairs) ===
            canonicalSha256(oceanPaletteDefinition.contrast_pairs),
        observed: contrastPairs,
      },
      {
        code: "palette.contrast_safe",
        passed:
          contrastPairs !== null &&
          contrastPairs.every((pair) => pair.ratio_milli >= 4_500),
        observed:
          contrastPairs?.map(({ pair_id, ratio_milli }) => ({
            pair_id,
            ratio_milli,
          })) ?? null,
      },
    );
  } else {
    observations.push({
      code: "target.center_hit_testable",
      passed: probe.target.center_hit_node_id === request.target.node_id,
      observed: {
        requested: request.target.node_id,
        hit: probe.target.center_hit_node_id,
      },
    });
  }
  return observations;
}

export type MutationCompileResult =
  | {
      readonly status: "applicable";
      readonly request: MutationRequest;
      readonly probe: SourceProbe;
      readonly preconditions: PreconditionReport;
      readonly plan: MutationPlan;
    }
  | {
      readonly status: "not_applicable";
      readonly request: MutationRequest;
      readonly probe: SourceProbe;
      readonly preconditions: PreconditionReport;
    };

export interface MutationCompilationBundle {
  readonly plan: MutationPlan;
  readonly preconditions: PreconditionReport;
  readonly probe: SourceProbe;
}

export function compileMutation(
  requestValue: unknown,
  probeValue: unknown,
): MutationCompileResult {
  const request = validateMutationRequest(requestValue);
  const probe = validateSourceProbe(probeValue);
  const bindingIssues: ContractIssue[] = [];

  for (const [field, requestId, probeId] of [
    ["instance_id", computeMutationInstanceId(request), probe.instance_id],
    ["source_state_id", request.source_state_id, probe.source_state_id],
    ["task_id", request.task_id, probe.task_id],
    ["environment_id", request.environment_id, probe.environment_id],
  ] as const) {
    if (requestId !== probeId) {
      bindingIssues.push(
        issue(
          "mutation.probe_binding",
          `/probe/${field}`,
          `the probe ${field} must match the mutation request`,
        ),
      );
    }
  }
  if (pointerProbeCarriesPalette(request, probe)) {
    bindingIssues.push(
      issue(
        "mutation.probe_operator_surface",
        "/probe/palette",
        "pointer-interceptor probes cannot carry palette observations",
      ),
    );
  }
  assertNoIssues("impactdiff.mutation-compile/v1", bindingIssues);

  const observations = preconditionObservations(request, probe);

  const instanceId = computeMutationInstanceId(request);
  const preconditions = reportFromObservations(
    request,
    instanceId,
    probe,
    observations,
  );
  if (!preconditions.applicable) {
    return Object.freeze({
      status: "not_applicable",
      request,
      probe,
      preconditions,
    });
  }

  const descriptor = operatorDescriptor(request.operator_key);
  const planBase = {
    contract: "impactdiff.intervention-parameters",
    version: 1,
    plan_id: placeholderPlanId,
    instance_id: instanceId,
    request,
    seed_sha256: computeMutationSeed(request),
    phase: "before_task",
    operator: {
      operator_key: descriptor.operatorKey,
      family_id: descriptor.familyId,
      operator_id: descriptor.operatorId,
      operator_version: descriptor.operatorVersion,
      expected_task_relation: descriptor.expectedTaskRelation,
    },
    probe_fingerprint_sha256: probe.probe_fingerprint_sha256,
    precondition_report_sha256: canonicalSha256(preconditions),
  } as const;

  let planDraft: MutationPlan;
  if (request.operator_key === "palette_swap") {
    planDraft = {
      ...planBase,
      forward: [
        {
          opcode: "install_palette_layer",
          handle: "h0",
          target_node_id: request.target.node_id,
          palette: "ocean",
          palette_sha256: oceanPaletteSha256,
        },
      ],
      inverse: [{ opcode: "remove_inserted_node", handle: "h0" }],
    };
  } else {
    const bounds = probe.target.bounds;
    if (bounds === null) {
      throw new Error("applicable pointer mutation is missing target bounds");
    }
    planDraft = {
      ...planBase,
      forward: [
        {
          opcode: "install_pointer_interceptor",
          handle: "h0",
          target_node_id: request.target.node_id,
          rect_milli_css_px: bounds,
        },
      ],
      inverse: [{ opcode: "remove_inserted_node", handle: "h0" }],
    };
  }

  const plan = validateMutationPlan({
    ...planDraft,
    plan_id: computeMutationPlanId(planDraft),
  });
  return Object.freeze({
    status: "applicable",
    request,
    probe,
    preconditions,
    plan,
  });
}

export function validateMutationCompilation(
  planValue: unknown,
  preconditionValue: unknown,
): MutationCompilationBundle {
  const plan = validateMutationPlan(planValue);
  const preconditions = validatePreconditionReport(preconditionValue);
  const probe = preconditions.probe;
  const issues: ContractIssue[] = [];

  if (preconditions.instance_id !== plan.instance_id) {
    issues.push(
      issue(
        "mutation.compilation_instance",
        "/preconditions/instance_id",
        "the precondition report must describe the compiled mutation instance",
      ),
    );
  }
  if (canonicalSha256(plan.request) !== canonicalSha256(preconditions.request)) {
    issues.push(
      issue(
        "mutation.compilation_request",
        "/preconditions/request",
        "the plan and precondition report must bind the same mutation request",
      ),
    );
  }
  if (
    preconditions.probe_fingerprint_sha256 !== probe.probe_fingerprint_sha256 ||
    plan.probe_fingerprint_sha256 !== probe.probe_fingerprint_sha256
  ) {
    issues.push(
      issue(
        "mutation.compilation_probe",
        "/probe/probe_fingerprint_sha256",
        "the plan and precondition report must bind the exact source probe",
      ),
    );
  }
  if (plan.precondition_report_sha256 !== canonicalSha256(preconditions)) {
    issues.push(
      issue(
        "mutation.compilation_preconditions",
        "/plan/precondition_report_sha256",
        "the plan must bind the exact canonical precondition report",
      ),
    );
  }
  if (!preconditions.applicable) {
    issues.push(
      issue(
        "mutation.compilation_not_applicable",
        "/preconditions/applicable",
        "a mutation plan cannot exist for a non-applicable request",
      ),
    );
  }

  const expected = compileMutation(preconditions.request, probe);
  if (expected.status !== "applicable") {
    issues.push(
      issue(
        "mutation.compilation_not_applicable",
        "/plan",
        "the bound request and probe do not compile to an applicable plan",
      ),
    );
  } else {
    if (canonicalSha256(expected.preconditions) !== canonicalSha256(preconditions)) {
      issues.push(
        issue(
          "mutation.compilation_checks",
          "/preconditions/checks",
          "preconditions must be deterministically derived from the request and probe",
        ),
      );
    }
    if (canonicalSha256(expected.plan) !== canonicalSha256(plan)) {
      issues.push(
        issue(
          "mutation.compilation_plan",
          "/plan",
          "the plan must be deterministically derived from the request and probe",
        ),
      );
    }
  }

  assertNoIssues("impactdiff.mutation-compilation/v1", issues);
  return Object.freeze({ plan, preconditions, probe });
}
