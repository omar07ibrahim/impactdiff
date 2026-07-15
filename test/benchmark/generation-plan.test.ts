import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  canonicalJson,
  computeMutationFamilyId,
  computePilotApplicationGroupId,
  computePilotGenerationPlanId,
  computePilotMutationOperatorId,
  computePilotSplitPlanId,
  computePilotWorkflowId,
  computeSourceStateId,
  computeTaskId,
  ContractValidationError,
  parsePilotGenerationPlan,
  pilotGenerationPlanContract,
  pilotGenerationPlanFamilyKeys,
  pilotGenerationPlanRelationVariants,
  pilotGenerationPlanRoleSchedule,
  pilotGenerationPlanVersion,
  pilotV01ApplicationBlockIds,
  pilotV01ApplicationCatalogEntries,
  pilotV01ApplicationCatalogId,
  pilotV01MutationOperatorCatalog,
  pilotV01ProtocolId,
  validatePilotGenerationPlan,
} from "../../src/index.js";
import type { PilotGenerationPlan } from "../../src/index.js";

type MutablePlan = Record<string, unknown> & {
  generation_plan_id: unknown;
  split: Record<string, unknown> & { split_id: unknown };
};

function digest(label: string): string {
  return createHash("sha256").update(label, "utf8").digest("hex");
}

function id(prefix: string, label: string): string {
  return `${prefix}${digest(label)}`;
}

function artifact<const MediaType extends string>(mediaType: MediaType, label: string) {
  return {
    sha256: digest(`artifact:${label}`),
    byte_length: 128,
    media_type: mediaType,
    format_version: 1,
  } as const;
}

function createValidPlan(): PilotGenerationPlan {
  const auditRefs = {
    resource_audit: artifact(
      "application/vnd.impactdiff.pilot-resource-audit+json",
      "resource-audit",
    ),
    license_audit: artifact(
      "application/vnd.impactdiff.pilot-license-audit+json",
      "license-audit",
    ),
    grouping_audit: artifact(
      "application/vnd.impactdiff.pilot-grouping-audit+json",
      "grouping-audit",
    ),
  } as const;
  const applications = pilotV01ApplicationCatalogEntries.map((catalogEntry) => {
    const sourceState = artifact(
      "application/vnd.impactdiff.source-state+json",
      `source-state:${catalogEntry.application_key}`,
    );
    const sourceStateId = computeSourceStateId(sourceState);
    const workflowBindings = catalogEntry.workflow_keys.map(
      (workflowKey, workflowIndex) => {
        const actionPlan = artifact(
          "application/vnd.impactdiff.action-plan+json",
          `action-plan:${catalogEntry.application_key}:${workflowKey}:${workflowIndex}`,
        );
        const taskId = computeTaskId(actionPlan);
        return {
          workflow_key: workflowKey,
          source_state_id: sourceStateId,
          source_state: sourceState,
          task_id: taskId,
          action_plan: actionPlan,
        };
      },
    );
    const applicationGroupId = computePilotApplicationGroupId({
      application_key: catalogEntry.application_key,
      fixture_key: catalogEntry.fixture_key,
      workflows: workflowBindings,
    });
    const workflows = workflowBindings.map((workflow) => ({
      ...workflow,
      workflow_id: computePilotWorkflowId({
        application_group_id: applicationGroupId,
        workflow_key: workflow.workflow_key,
        source_state_id: workflow.source_state_id,
        task_id: workflow.task_id,
      }),
    }));
    return {
      application_key: catalogEntry.application_key,
      fixture_key: catalogEntry.fixture_key,
      application_group_id: applicationGroupId,
      workflows,
    };
  });

  const mutationFamilies = pilotGenerationPlanFamilyKeys.map((familyKey) => ({
    family_key: familyKey,
    mutation_family_id: computeMutationFamilyId(familyKey),
  }));
  const operators = structuredClone(pilotV01MutationOperatorCatalog.operators);
  const applicationBlocks = pilotV01ApplicationBlockIds.map((blockId) => ({
    block_id: blockId,
    application_group_ids: pilotV01ApplicationCatalogEntries
      .flatMap((entry, applicationIndex) =>
        entry.block_id === blockId
          ? [applications[applicationIndex]?.application_group_id]
          : [],
      )
      .filter((applicationId): applicationId is string => applicationId !== undefined),
  }));
  const splitDraft = {
    split_id: `idps1_${"0".repeat(64)}`,
    application_catalog_id: pilotV01ApplicationCatalogId,
    grouping_audit_sha256: auditRefs.grouping_audit.sha256,
    application_blocks: applicationBlocks,
    role_schedule: structuredClone(pilotGenerationPlanRoleSchedule),
  };
  const split = {
    ...splitDraft,
    split_id: computePilotSplitPlanId(splitDraft),
  };
  const cells = applications.flatMap((application) =>
    application.workflows.flatMap((workflow) =>
      operators.map((operator) => ({
        application_group_id: application.application_group_id,
        workflow_id: workflow.workflow_id,
        source_state_id: workflow.source_state_id,
        mutation_family_id: operator.mutation_family_id,
        operator_id: operator.operator_id,
        declared_relation_variant: operator.declared_relation_variant,
        replicate: 0,
      })),
    ),
  );
  const draft = {
    contract: "impactdiff.pilot-generation-plan",
    version: 1,
    generation_plan_id: `idgp1_${"0".repeat(64)}`,
    protocol_id: pilotV01ProtocolId,
    application_catalog_id: pilotV01ApplicationCatalogId,
    audit_refs: auditRefs,
    applications,
    mutation_families: mutationFamilies,
    operators,
    split,
    cells,
  };
  return validatePilotGenerationPlan({
    ...draft,
    generation_plan_id: computePilotGenerationPlanId(draft),
  });
}

const validPlan = createValidPlan();

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

function mutablePlan(): MutablePlan {
  return structuredClone(validPlan) as unknown as MutablePlan;
}

function replaceAtPath(
  value: unknown,
  path: readonly (string | number)[],
  replacement: unknown,
): void {
  assert.ok(path.length > 0);
  let cursor = value;
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

function reidentify(plan: MutablePlan, splitChanged = false): MutablePlan {
  if (splitChanged) {
    plan.split.split_id = computePilotSplitPlanId(plan.split);
  }
  plan.generation_plan_id = computePilotGenerationPlanId(plan);
  return plan;
}

function expectIssue(value: unknown, expectedCode: string): void {
  assert.throws(
    () => validatePilotGenerationPlan(value),
    (error: unknown) => {
      assert.ok(error instanceof ContractValidationError);
      assert.ok(
        error.issues.some(({ code }) => code === expectedCode),
        `expected ${expectedCode}, received ${error.issues
          .map(({ code }) => code)
          .join(", ")}`,
      );
      return true;
    },
  );
}

test("a complete Pilot generation plan binds 20 apps and exactly 640 cells", () => {
  assert.equal(pilotGenerationPlanContract, "impactdiff.pilot-generation-plan");
  assert.equal(pilotGenerationPlanVersion, 1);
  assert.equal(validPlan.applications.length, 20);
  assert.equal(validPlan.application_catalog_id, pilotV01ApplicationCatalogId);
  assert.deepEqual(
    validPlan.applications.map((application) => application.application_key),
    pilotV01ApplicationCatalogEntries.map((entry) => entry.application_key),
  );
  assert.deepEqual(
    validPlan.applications.map((application) => application.fixture_key),
    pilotV01ApplicationCatalogEntries.map((entry) => entry.fixture_key),
  );
  assert.equal(
    validPlan.applications.flatMap((application) => application.workflows).length,
    40,
  );
  assert.equal(validPlan.mutation_families.length, 8);
  assert.equal(validPlan.operators.length, 16);
  assert.equal(validPlan.cells.length, 640);
  assert.equal(validPlan.split.application_blocks.length, 4);
  assert.equal(validPlan.split.application_catalog_id, pilotV01ApplicationCatalogId);
  assert.equal(
    validPlan.split.grouping_audit_sha256,
    validPlan.audit_refs.grouping_audit.sha256,
  );
  assert.equal(
    validPlan.split.application_blocks.every(
      (block) => block.application_group_ids.length === 5,
    ),
    true,
  );
  assert.equal(
    validPlan.cells.some((cell) => "task_regression" in cell),
    false,
  );
  assertDeepFrozen(validPlan);
});

test("the exported Pilot catalogs cannot be mutated between validations", () => {
  assertDeepFrozen(pilotGenerationPlanFamilyKeys);
  assertDeepFrozen(pilotGenerationPlanRelationVariants);
  assertDeepFrozen(pilotGenerationPlanRoleSchedule);
});

test("the plan, split, and workflow identities are stable canonical commitments", () => {
  assert.match(validPlan.generation_plan_id, /^idgp1_[0-9a-f]{64}$/u);
  assert.match(validPlan.split.split_id, /^idps1_[0-9a-f]{64}$/u);
  assert.equal(computePilotGenerationPlanId(validPlan), validPlan.generation_plan_id);
  assert.equal(computePilotSplitPlanId(validPlan.split), validPlan.split.split_id);
  for (const application of validPlan.applications) {
    assert.equal(
      computePilotApplicationGroupId({
        application_key: application.application_key,
        fixture_key: application.fixture_key,
        workflows: application.workflows,
      }),
      application.application_group_id,
    );
    for (const workflow of application.workflows) {
      assert.equal(
        computePilotWorkflowId({
          application_group_id: application.application_group_id,
          workflow_key: workflow.workflow_key,
          source_state_id: workflow.source_state_id,
          task_id: workflow.task_id,
        }),
        workflow.workflow_id,
      );
    }
  }
  for (const operator of validPlan.operators) {
    assert.equal(computePilotMutationOperatorId(operator), operator.operator_id);
  }

  const reordered = Object.fromEntries(
    Object.entries(structuredClone(validPlan)).toReversed(),
  ) as MutablePlan;
  reordered.generation_plan_id = "excluded";
  assert.equal(computePilotGenerationPlanId(reordered), validPlan.generation_plan_id);
});

test("Pilot family identities preserve the separate legacy runtime identities", () => {
  assert.equal(
    computeMutationFamilyId("pointer_hit_testing"),
    "idmf1_3b8655abdbbe2052fe2ea9ec665943aa099674ff0d853311f1a443c37523cbe9",
  );
  assert.equal(
    computeMutationFamilyId("visual_palette"),
    "idmf1_398e450968f661c89123121efe24d6030bbc3732cd48a4eed893d14736b943a4",
  );
});

test("canonical plan bytes parse and noncanonical bytes are rejected", () => {
  const canonical = canonicalJson(validPlan);
  assert.deepEqual(parsePilotGenerationPlan(canonical), validPlan);
  assert.throws(() => parsePilotGenerationPlan(`${canonical}\n`));
});

test("a stale plan identity and a substituted protocol identity are rejected", () => {
  const stale = mutablePlan();
  replaceAtPath(stale, ["audit_refs", "resource_audit", "byte_length"], 129);
  expectIssue(stale, "pilot_generation.identity");

  const substituted = mutablePlan();
  substituted.protocol_id = id("idpp1_", "substituted-protocol");
  expectIssue(reidentify(substituted), "pilot_generation.protocol_binding");

  const catalog = mutablePlan();
  catalog.application_catalog_id = id("idpc1_", "substituted-catalog");
  expectIssue(reidentify(catalog), "pilot_generation.application_catalog_binding");
});

test("application and workflow catalogs reject key, fixture, and order substitutions", () => {
  const applicationKey = mutablePlan();
  replaceAtPath(
    applicationKey,
    ["applications", 0, "application_key"],
    "unlisted_application",
  );
  expectIssue(reidentify(applicationKey), "pilot_generation.application_catalog");

  const fixtureKey = mutablePlan();
  replaceAtPath(
    fixtureKey,
    ["applications", 0, "fixture_key"],
    "pilot-unlisted-application-v1",
  );
  expectIssue(reidentify(fixtureKey), "pilot_generation.application_catalog");

  const workflowKey = mutablePlan();
  replaceAtPath(
    workflowKey,
    ["applications", 0, "workflows", 0, "workflow_key"],
    "unlisted_workflow",
  );
  expectIssue(reidentify(workflowKey), "pilot_generation.workflow_catalog");
});

test("application-group identities cannot be selected independently", () => {
  const changed = mutablePlan();
  replaceAtPath(
    changed,
    ["applications", 0, "application_group_id"],
    id("idag1_", "arbitrary-application-group"),
  );
  expectIssue(reidentify(changed), "pilot_generation.application_identity");
});

test("application and workflow identities must remain globally unique", () => {
  const duplicateApplication = mutablePlan();
  replaceAtPath(
    duplicateApplication,
    ["applications", 1, "application_group_id"],
    validPlan.applications[0]?.application_group_id,
  );
  expectIssue(
    reidentify(duplicateApplication),
    "pilot_generation.application_duplicate",
  );

  const duplicateWorkflowId = mutablePlan();
  replaceAtPath(
    duplicateWorkflowId,
    ["applications", 0, "workflows", 1, "workflow_id"],
    validPlan.applications[0]?.workflows[0]?.workflow_id,
  );
  expectIssue(reidentify(duplicateWorkflowId), "pilot_generation.workflow_duplicate");

  const duplicateWorkflowKey = mutablePlan();
  replaceAtPath(
    duplicateWorkflowKey,
    ["applications", 0, "workflows", 1, "workflow_key"],
    validPlan.applications[0]?.workflows[0]?.workflow_key,
  );
  expectIssue(
    reidentify(duplicateWorkflowKey),
    "pilot_generation.workflow_key_duplicate",
  );
});

test("source, task, and workflow identities cannot be independently substituted", () => {
  const source = mutablePlan();
  replaceAtPath(
    source,
    ["applications", 0, "workflows", 0, "source_state", "sha256"],
    digest("substituted-source-state"),
  );
  expectIssue(reidentify(source), "pilot_generation.source_state_identity");

  const task = mutablePlan();
  replaceAtPath(
    task,
    ["applications", 0, "workflows", 0, "action_plan", "sha256"],
    digest("substituted-action-plan"),
  );
  expectIssue(reidentify(task), "pilot_generation.task_identity");

  const workflow = mutablePlan();
  replaceAtPath(
    workflow,
    ["applications", 0, "workflows", 0, "workflow_id"],
    id("idwf1_", "substituted-workflow"),
  );
  expectIssue(reidentify(workflow), "pilot_generation.workflow_identity");
});

test("one source state cannot be reassigned to another application", () => {
  const changed = mutablePlan();
  const sourceApplication = validPlan.applications[0];
  const targetApplication = validPlan.applications[1];
  assert.ok(sourceApplication !== undefined && targetApplication !== undefined);
  const sourceWorkflow = sourceApplication.workflows[0];
  const targetWorkflow = targetApplication.workflows[0];
  assert.ok(sourceWorkflow !== undefined && targetWorkflow !== undefined);
  replaceAtPath(
    changed,
    ["applications", 1, "workflows", 0, "source_state_id"],
    sourceWorkflow.source_state_id,
  );
  replaceAtPath(
    changed,
    ["applications", 1, "workflows", 0, "source_state"],
    structuredClone(sourceWorkflow.source_state),
  );
  replaceAtPath(
    changed,
    ["applications", 1, "workflows", 0, "workflow_id"],
    computePilotWorkflowId({
      application_group_id: targetApplication.application_group_id,
      workflow_key: targetWorkflow.workflow_key,
      source_state_id: sourceWorkflow.source_state_id,
      task_id: targetWorkflow.task_id,
    }),
  );
  expectIssue(reidentify(changed), "pilot_generation.source_state_owner");
});

test("family and global operator catalogs reject identity and relation confounds", () => {
  const family = mutablePlan();
  replaceAtPath(
    family,
    ["mutation_families", 0, "mutation_family_id"],
    id("idmf1_", "substituted-family"),
  );
  expectIssue(reidentify(family), "pilot_generation.family_identity");

  const duplicateOperator = mutablePlan();
  replaceAtPath(
    duplicateOperator,
    ["operators", 1, "operator_id"],
    validPlan.operators[0]?.operator_id,
  );
  expectIssue(reidentify(duplicateOperator), "pilot_generation.operator_duplicate");

  const relation = mutablePlan();
  replaceAtPath(
    relation,
    ["operators", 0, "declared_relation_variant"],
    "task_preserving_control",
  );
  expectIssue(reidentify(relation), "pilot_generation.operator_catalog");

  const definition = mutablePlan();
  replaceAtPath(
    definition,
    ["operators", 0, "operator_definition", "sha256"],
    digest("substituted-operator-definition"),
  );
  expectIssue(reidentify(definition), "pilot_generation.operator_identity");

  const reboundDefinition = mutablePlan();
  const reboundOperator = structuredClone(validPlan.operators[0]);
  assert.ok(reboundOperator !== undefined);
  reboundOperator.operator_definition.sha256 = digest(
    "syntactically-valid-substituted-definition",
  );
  reboundOperator.operator_id = computePilotMutationOperatorId(reboundOperator);
  replaceAtPath(reboundDefinition, ["operators", 0], reboundOperator);
  expectIssue(
    reidentify(reboundDefinition),
    "pilot_generation.operator_definition_catalog",
  );

  const duplicateFamily = mutablePlan();
  replaceAtPath(
    duplicateFamily,
    ["mutation_families", 1, "mutation_family_id"],
    validPlan.mutation_families[0]?.mutation_family_id,
  );
  expectIssue(reidentify(duplicateFamily), "pilot_generation.family_duplicate");

  const duplicateDefinition = mutablePlan();
  const firstOperator = validPlan.operators[0];
  const secondOperator = validPlan.operators[1];
  assert.ok(firstOperator !== undefined && secondOperator !== undefined);
  const reboundSecondOperator = {
    ...structuredClone(secondOperator),
    operator_definition: structuredClone(firstOperator.operator_definition),
  };
  replaceAtPath(
    duplicateDefinition,
    ["operators", 1, "operator_definition"],
    reboundSecondOperator.operator_definition,
  );
  replaceAtPath(
    duplicateDefinition,
    ["operators", 1, "operator_id"],
    computePilotMutationOperatorId(reboundSecondOperator),
  );
  expectIssue(
    reidentify(duplicateDefinition),
    "pilot_generation.operator_definition_duplicate",
  );
});

test("the exact ordered matrix rejects source, operator, relation, and order changes", () => {
  for (const [path, replacement] of [
    [["cells", 0, "source_state_id"], id("idss1_", "other-source")],
    [["cells", 0, "operator_id"], id("idop1_", "other-operator")],
    [["cells", 0, "declared_relation_variant"], "task_preserving_control"],
  ] as const) {
    const changed = mutablePlan();
    replaceAtPath(changed, path, replacement);
    expectIssue(reidentify(changed), "pilot_generation.cell_matrix");
  }

  const reordered = mutablePlan();
  const cells = reordered.cells as unknown[];
  const first = cells[0];
  cells[0] = cells[1];
  cells[1] = first;
  expectIssue(reidentify(reordered), "pilot_generation.cell_matrix");
});

test("application blocks must equal the catalog key-to-block mapping", () => {
  const changed = mutablePlan();
  const blockZeroApplication =
    validPlan.split.application_blocks[0]?.application_group_ids[0];
  const blockOneApplication =
    validPlan.split.application_blocks[1]?.application_group_ids[0];
  assert.ok(blockZeroApplication !== undefined && blockOneApplication !== undefined);
  replaceAtPath(
    changed,
    ["split", "application_blocks", 0, "application_group_ids", 0],
    blockOneApplication,
  );
  replaceAtPath(
    changed,
    ["split", "application_blocks", 1, "application_group_ids", 0],
    blockZeroApplication,
  );
  expectIssue(reidentify(changed, true), "pilot_generation.block_catalog");
});

test("the exact fold schedule rejects a different valid-looking rotation", () => {
  const changed = mutablePlan();
  replaceAtPath(changed, ["split", "role_schedule", 0, "train_blocks", 0], "block_0");
  expectIssue(reidentify(changed, true), "schema.const");
});

test("audit payloads must be three distinct canonical commitments", () => {
  const changed = mutablePlan();
  replaceAtPath(
    changed,
    ["audit_refs", "license_audit", "sha256"],
    validPlan.audit_refs.resource_audit.sha256,
  );
  expectIssue(reidentify(changed), "pilot_generation.audit_reference_collision");

  const staleSplit = mutablePlan();
  const substitutedGroupingDigest = digest("substituted-grouping-audit");
  replaceAtPath(
    staleSplit,
    ["audit_refs", "grouping_audit", "sha256"],
    substitutedGroupingDigest,
  );
  replaceAtPath(
    staleSplit,
    ["split", "grouping_audit_sha256"],
    substitutedGroupingDigest,
  );
  expectIssue(reidentify(staleSplit), "pilot_generation.split_identity");

  const splitCatalog = mutablePlan();
  replaceAtPath(
    splitCatalog,
    ["split", "application_catalog_id"],
    id("idpc1_", "substituted-split-catalog"),
  );
  expectIssue(reidentify(splitCatalog, true), "pilot_generation.split_catalog_binding");

  const splitGrouping = mutablePlan();
  replaceAtPath(
    splitGrouping,
    ["split", "grouping_audit_sha256"],
    digest("substituted-split-grouping-audit"),
  );
  expectIssue(
    reidentify(splitGrouping, true),
    "pilot_generation.split_grouping_audit_binding",
  );
});

test("matrix counts and closed relation-only cells fail closed", () => {
  const missingCell = mutablePlan();
  (missingCell.cells as unknown[]).pop();
  expectIssue(missingCell, "schema.minItems");

  const missingOperator = mutablePlan();
  (missingOperator.operators as unknown[]).pop();
  expectIssue(missingOperator, "schema.minItems");

  const labelBearingCell = mutablePlan();
  const firstCell = (labelBearingCell.cells as Record<string, unknown>[])[0];
  assert.ok(firstCell !== undefined);
  firstCell.task_regression = true;
  labelBearingCell.generation_plan_id = computePilotGenerationPlanId(labelBearingCell);
  expectIssue(labelBearingCell, "schema.additionalProperties");
});

test("non-JSON, cyclic, accessor, and exotic inputs fail before schema use", () => {
  for (const value of [undefined, 1n, () => undefined]) {
    expectIssue(value, "input.non_json_value");
  }

  const cyclic = mutablePlan();
  cyclic.self = cyclic;
  expectIssue(cyclic, "input.cycle");

  let getterCalls = 0;
  const accessor = mutablePlan();
  Object.defineProperty(accessor, "contract", {
    enumerable: true,
    get: () => {
      getterCalls += 1;
      return "impactdiff.pilot-generation-plan";
    },
  });
  expectIssue(accessor, "input.hidden_property");
  assert.equal(getterCalls, 0);

  const exotic = mutablePlan();
  Object.setPrototypeOf(exotic, { inherited: true });
  expectIssue(exotic, "input.exotic_object");
});
