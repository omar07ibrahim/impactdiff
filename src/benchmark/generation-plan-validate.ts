import { Ajv2020 } from "ajv/dist/2020.js";

import {
  canonicalJson,
  computeSourceStateId,
  computeTaskId,
  parseCanonicalJson,
} from "../contracts/canonical.js";
import type { ParseLimits } from "../contracts/canonical.js";
import { assertNoIssues, issue } from "../contracts/errors.js";
import type { ContractIssue } from "../contracts/errors.js";
import { normalizedSchemaValue } from "../contracts/input.js";
import { computeMutationFamilyId } from "../mutations/identity.js";
import {
  pilotV01ApplicationBlockIds,
  pilotV01ApplicationCatalogEntries,
  pilotV01ApplicationCatalogId,
} from "./application-catalog.js";
import {
  computePilotApplicationGroupId,
  computePilotGenerationPlanId,
  computePilotMutationOperatorId,
  computePilotSplitPlanId,
  computePilotWorkflowId,
} from "./generation-plan-identity.js";
import {
  pilotGenerationPlanFamilyKeys,
  pilotGenerationPlanRelationVariants,
  pilotGenerationPlanRoleSchedule,
  pilotGenerationPlanSchema,
} from "./generation-plan-schema.js";
import type { PilotGenerationPlan } from "./generation-plan-schema.js";
import { pilotV01Protocol, pilotV01ProtocolId } from "./pilot-v01.js";

const contractName = "impactdiff.pilot-generation-plan/v1";
const planLimits = {
  maximumBytes: 2_097_152,
  maximumDepth: 12,
  maximumValues: 20_000,
} as const satisfies ParseLimits;
const ajv = new Ajv2020({ allErrors: true, ownProperties: true, strict: true });
const planValidator = ajv.compile<PilotGenerationPlan>(pilotGenerationPlanSchema);

function auditReferenceIssues(
  plan: PilotGenerationPlan,
  issues: ContractIssue[],
): void {
  const references = Object.values(plan.audit_refs);
  const digests = new Set(references.map((reference) => reference.sha256));
  if (digests.size !== references.length) {
    issues.push(
      issue(
        "pilot_generation.audit_reference_collision",
        "/audit_refs",
        "resource, license, and grouping audits must bind distinct payloads",
      ),
    );
  }
}

function applicationIssues(plan: PilotGenerationPlan, issues: ContractIssue[]): void {
  const applicationGroupIds = new Set<string>();
  const applicationKeys = new Set<string>();
  const fixtureKeys = new Set<string>();
  const workflowIds = new Set<string>();
  const qualifiedWorkflowKeys = new Set<string>();
  const sourceOwner = new Map<string, string>();
  for (const [applicationIndex, application] of plan.applications.entries()) {
    const applicationPath = `/applications/${applicationIndex}`;
    const catalogEntry = pilotV01ApplicationCatalogEntries[applicationIndex];
    if (
      catalogEntry === undefined ||
      application.application_key !== catalogEntry.application_key ||
      application.fixture_key !== catalogEntry.fixture_key
    ) {
      issues.push(
        issue(
          "pilot_generation.application_catalog",
          applicationPath,
          "applications must match the exact catalog key, fixture, and order",
        ),
      );
    }
    if (
      applicationGroupIds.has(application.application_group_id) ||
      applicationKeys.has(application.application_key) ||
      fixtureKeys.has(application.fixture_key)
    ) {
      issues.push(
        issue(
          "pilot_generation.application_duplicate",
          applicationPath,
          "application group, application key, and fixture key must be globally unique",
        ),
      );
    }
    applicationGroupIds.add(application.application_group_id);
    applicationKeys.add(application.application_key);
    fixtureKeys.add(application.fixture_key);

    for (const [workflowIndex, workflow] of application.workflows.entries()) {
      const workflowPath = `${applicationPath}/workflows/${workflowIndex}`;
      if (workflow.workflow_key !== catalogEntry?.workflow_keys[workflowIndex]) {
        issues.push(
          issue(
            "pilot_generation.workflow_catalog",
            `${workflowPath}/workflow_key`,
            "workflow keys must match the exact application-catalog order",
          ),
        );
      }
      const qualifiedWorkflowKey = `${application.application_key}.${workflow.workflow_key}`;
      if (workflowIds.has(workflow.workflow_id)) {
        issues.push(
          issue(
            "pilot_generation.workflow_duplicate",
            `${workflowPath}/workflow_id`,
            "workflow identities must be globally unique",
          ),
        );
      }
      workflowIds.add(workflow.workflow_id);
      if (qualifiedWorkflowKeys.has(qualifiedWorkflowKey)) {
        issues.push(
          issue(
            "pilot_generation.workflow_key_duplicate",
            `${workflowPath}/workflow_key`,
            "qualified workflow keys must be globally unique",
          ),
        );
      }
      qualifiedWorkflowKeys.add(qualifiedWorkflowKey);

      const owner = sourceOwner.get(workflow.source_state_id);
      if (owner !== undefined && owner !== application.application_key) {
        issues.push(
          issue(
            "pilot_generation.source_state_owner",
            `${workflowPath}/source_state_id`,
            "one source state cannot belong to different application groups",
          ),
        );
      } else {
        sourceOwner.set(workflow.source_state_id, application.application_key);
      }

      if (workflow.source_state_id !== computeSourceStateId(workflow.source_state)) {
        issues.push(
          issue(
            "pilot_generation.source_state_identity",
            `${workflowPath}/source_state_id`,
            "source_state_id must be derived from the exact source-state reference",
          ),
        );
      }
      if (workflow.task_id !== computeTaskId(workflow.action_plan)) {
        issues.push(
          issue(
            "pilot_generation.task_identity",
            `${workflowPath}/task_id`,
            "task_id must be derived from the exact action-plan reference",
          ),
        );
      }
      if (
        workflow.workflow_id !==
        computePilotWorkflowId({
          application_group_id: application.application_group_id,
          workflow_key: workflow.workflow_key,
          source_state_id: workflow.source_state_id,
          task_id: workflow.task_id,
        })
      ) {
        issues.push(
          issue(
            "pilot_generation.workflow_identity",
            `${workflowPath}/workflow_id`,
            "workflow_id must bind its application, source state, and task",
          ),
        );
      }
    }

    if (
      application.application_group_id !==
      computePilotApplicationGroupId({
        application_key: application.application_key,
        fixture_key: application.fixture_key,
        workflows: application.workflows.map((workflow) => ({
          workflow_key: workflow.workflow_key,
          source_state_id: workflow.source_state_id,
          task_id: workflow.task_id,
        })),
      })
    ) {
      issues.push(
        issue(
          "pilot_generation.application_identity",
          `${applicationPath}/application_group_id`,
          "application_group_id must bind its catalog keys and ordered workflows",
        ),
      );
    }
  }
}

function familyAndOperatorIssues(
  plan: PilotGenerationPlan,
  issues: ContractIssue[],
): void {
  if (
    canonicalJson(pilotGenerationPlanFamilyKeys) !==
      canonicalJson(pilotV01Protocol.design.family_ids) ||
    canonicalJson(pilotGenerationPlanRelationVariants) !==
      canonicalJson(pilotV01Protocol.design.declared_relation_variants)
  ) {
    issues.push(
      issue(
        "pilot_generation.protocol_catalog",
        "/protocol_id",
        "generation-plan catalogs must equal the bound Pilot protocol catalogs",
      ),
    );
  }

  const familyIds = new Set<string>();
  for (const [index, family] of plan.mutation_families.entries()) {
    const expectedKey = pilotGenerationPlanFamilyKeys[index];
    if (family.family_key !== expectedKey) {
      issues.push(
        issue(
          "pilot_generation.family_catalog",
          `/mutation_families/${index}/family_key`,
          "mutation families must use the exact frozen Pilot order",
        ),
      );
    }
    if (family.mutation_family_id !== computeMutationFamilyId(family.family_key)) {
      issues.push(
        issue(
          "pilot_generation.family_identity",
          `/mutation_families/${index}/mutation_family_id`,
          "mutation_family_id must be derived from family_key",
        ),
      );
    }
    if (familyIds.has(family.mutation_family_id)) {
      issues.push(
        issue(
          "pilot_generation.family_duplicate",
          `/mutation_families/${index}/mutation_family_id`,
          "mutation-family identities must be unique",
        ),
      );
    }
    familyIds.add(family.mutation_family_id);
  }

  const operatorIds = new Set<string>();
  const definitionDigests = new Set<string>();
  for (const [index, operator] of plan.operators.entries()) {
    const familyIndex = Math.floor(index / pilotGenerationPlanRelationVariants.length);
    const relationIndex = index % pilotGenerationPlanRelationVariants.length;
    const expectedFamily = plan.mutation_families[familyIndex];
    const expectedRelation = pilotGenerationPlanRelationVariants[relationIndex];
    if (
      expectedFamily === undefined ||
      operator.mutation_family_id !== expectedFamily.mutation_family_id ||
      operator.declared_relation_variant !== expectedRelation
    ) {
      issues.push(
        issue(
          "pilot_generation.operator_catalog",
          `/operators/${index}`,
          "operators must contain one global binding per family and relation in frozen order",
        ),
      );
    }
    if (operator.operator_id !== computePilotMutationOperatorId(operator)) {
      issues.push(
        issue(
          "pilot_generation.operator_identity",
          `/operators/${index}/operator_id`,
          "operator_id must bind its family, relation, version, and exact definition",
        ),
      );
    }
    if (operatorIds.has(operator.operator_id)) {
      issues.push(
        issue(
          "pilot_generation.operator_duplicate",
          `/operators/${index}/operator_id`,
          "operator identities must be unique",
        ),
      );
    }
    operatorIds.add(operator.operator_id);
    if (definitionDigests.has(operator.operator_definition.sha256)) {
      issues.push(
        issue(
          "pilot_generation.operator_definition_duplicate",
          `/operators/${index}/operator_definition/sha256`,
          "each operator binding must name a distinct canonical definition",
        ),
      );
    }
    definitionDigests.add(operator.operator_definition.sha256);
  }
}

function splitIssues(plan: PilotGenerationPlan, issues: ContractIssue[]): void {
  if (
    plan.split.application_catalog_id !== plan.application_catalog_id ||
    plan.split.application_catalog_id !== pilotV01ApplicationCatalogId
  ) {
    issues.push(
      issue(
        "pilot_generation.split_catalog_binding",
        "/split/application_catalog_id",
        "the split must bind the exact root application catalog",
      ),
    );
  }
  if (plan.split.grouping_audit_sha256 !== plan.audit_refs.grouping_audit.sha256) {
    issues.push(
      issue(
        "pilot_generation.split_grouping_audit_binding",
        "/split/grouping_audit_sha256",
        "the split must bind the exact unresolved grouping-audit payload",
      ),
    );
  }
  if (plan.split.split_id !== computePilotSplitPlanId(plan.split)) {
    issues.push(
      issue(
        "pilot_generation.split_identity",
        "/split/split_id",
        "split_id must bind the catalog, grouping audit, blocks, and role schedule",
      ),
    );
  }
  if (
    canonicalJson(plan.split.role_schedule) !==
      canonicalJson(pilotGenerationPlanRoleSchedule) ||
    canonicalJson(plan.split.role_schedule) !==
      canonicalJson(pilotV01Protocol.split.role_schedule)
  ) {
    issues.push(
      issue(
        "pilot_generation.role_schedule",
        "/split/role_schedule",
        "the role schedule must equal the exact frozen Pilot fold schedule",
      ),
    );
  }

  for (const [index, block] of plan.split.application_blocks.entries()) {
    const expectedBlockId = pilotV01ApplicationBlockIds[index];
    const expectedApplicationIds = pilotV01ApplicationCatalogEntries
      .flatMap((entry, applicationIndex) =>
        entry.block_id === expectedBlockId
          ? [plan.applications[applicationIndex]?.application_group_id]
          : [],
      )
      .filter((applicationId): applicationId is string => applicationId !== undefined);
    if (
      block.block_id !== expectedBlockId ||
      canonicalJson(block.application_group_ids) !==
        canonicalJson(expectedApplicationIds)
    ) {
      issues.push(
        issue(
          "pilot_generation.block_catalog",
          `/split/application_blocks/${index}`,
          "application blocks must equal the catalog key-to-block mapping",
        ),
      );
    }
  }
}

function cellIssues(plan: PilotGenerationPlan, issues: ContractIssue[]): void {
  const expectedCells = pilotV01ApplicationCatalogEntries.flatMap(
    (_catalogEntry, applicationIndex) => {
      const application = plan.applications[applicationIndex];
      return application === undefined
        ? []
        : application.workflows.flatMap((workflow) =>
            plan.operators.map((operator) => ({
              application_group_id: application.application_group_id,
              workflow_id: workflow.workflow_id,
              source_state_id: workflow.source_state_id,
              mutation_family_id: operator.mutation_family_id,
              operator_id: operator.operator_id,
              declared_relation_variant: operator.declared_relation_variant,
              replicate: 0,
            })),
          );
    },
  );

  if (expectedCells.length !== 640) {
    issues.push(
      issue(
        "pilot_generation.matrix_cardinality",
        "/cells",
        "the catalog product must contain exactly 640 planned cells",
      ),
    );
    return;
  }
  for (const [index, expected] of expectedCells.entries()) {
    const actual = plan.cells[index];
    if (actual === undefined || canonicalJson(actual) !== canonicalJson(expected)) {
      issues.push(
        issue(
          "pilot_generation.cell_matrix",
          `/cells/${index}`,
          "cells must equal the ordered workflow-by-global-operator Cartesian product",
        ),
      );
      break;
    }
  }
}

/**
 * Validates the structural pre-outcome plan and its content-addressed references.
 * Referenced audits, operator definitions, source states, and action plans remain
 * unresolved; a future resolved verifier is required before corpus execution.
 */
export function validatePilotGenerationPlan(value: unknown): PilotGenerationPlan {
  const plan = normalizedSchemaValue(contractName, planValidator, value);
  const issues: ContractIssue[] = [];

  if (plan.protocol_id !== pilotV01ProtocolId) {
    issues.push(
      issue(
        "pilot_generation.protocol_binding",
        "/protocol_id",
        "protocol_id must name the exact frozen Pilot v0.1 protocol",
      ),
    );
  }
  if (plan.application_catalog_id !== pilotV01ApplicationCatalogId) {
    issues.push(
      issue(
        "pilot_generation.application_catalog_binding",
        "/application_catalog_id",
        "application_catalog_id must name the exact Pilot v0.1 catalog",
      ),
    );
  }
  auditReferenceIssues(plan, issues);
  applicationIssues(plan, issues);
  familyAndOperatorIssues(plan, issues);
  splitIssues(plan, issues);
  cellIssues(plan, issues);
  if (plan.generation_plan_id !== computePilotGenerationPlanId(plan)) {
    issues.push(
      issue(
        "pilot_generation.identity",
        "/generation_plan_id",
        "generation_plan_id must bind the complete canonical plan body",
      ),
    );
  }

  assertNoIssues(contractName, issues);
  return plan;
}

export function parsePilotGenerationPlan(
  input: string | Uint8Array,
): PilotGenerationPlan {
  return validatePilotGenerationPlan(parseCanonicalJson(input, planLimits));
}
