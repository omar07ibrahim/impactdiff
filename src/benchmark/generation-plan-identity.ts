import { createHash } from "node:crypto";

import { canonicalJson } from "../contracts/canonical.js";
import type { ArtifactRef } from "../contracts/artifacts.js";

const domainDigest = (domain: string, body: unknown): string => {
  const hash = createHash("sha256");
  hash.update(domain, "utf8");
  hash.update("\0", "utf8");
  hash.update(canonicalJson(body), "utf8");
  return hash.digest("hex");
};

export interface PilotApplicationWorkflowBinding {
  readonly workflow_key: string;
  readonly source_state_id: string;
  readonly task_id: string;
}

export interface PilotApplicationGroupIdentityInput {
  readonly application_key: string;
  readonly fixture_key: string;
  readonly workflows: readonly PilotApplicationWorkflowBinding[];
}

export interface PilotWorkflowIdentityInput {
  readonly application_group_id: string;
  readonly workflow_key: string;
  readonly source_state_id: string;
  readonly task_id: string;
}

export interface PilotMutationOperatorIdentityInput {
  readonly mutation_family_id: string;
  readonly declared_relation_variant: "declared_breaking" | "task_preserving_control";
  readonly operator_version: number;
  readonly operator_definition: ArtifactRef;
}

export function computePilotApplicationGroupId(
  input: PilotApplicationGroupIdentityInput,
): string {
  const body = {
    application_key: input.application_key,
    fixture_key: input.fixture_key,
    workflows: input.workflows.map((workflow) => ({
      workflow_key: workflow.workflow_key,
      source_state_id: workflow.source_state_id,
      task_id: workflow.task_id,
    })),
  };
  return `idag1_${domainDigest("impactdiff:pilot-application-group:v1", body)}`;
}

export function computePilotWorkflowId(input: PilotWorkflowIdentityInput): string {
  const body = {
    application_group_id: input.application_group_id,
    workflow_key: input.workflow_key,
    source_state_id: input.source_state_id,
    task_id: input.task_id,
  };
  return `idwf1_${domainDigest("impactdiff:pilot-workflow:v1", body)}`;
}

export function computePilotMutationOperatorId(
  input: PilotMutationOperatorIdentityInput,
): string {
  const body = {
    mutation_family_id: input.mutation_family_id,
    declared_relation_variant: input.declared_relation_variant,
    operator_version: input.operator_version,
    operator_definition: {
      sha256: input.operator_definition.sha256,
      byte_length: input.operator_definition.byte_length,
      media_type: input.operator_definition.media_type,
      format_version: input.operator_definition.format_version,
    },
  };
  return `idop1_${domainDigest("impactdiff:pilot-mutation-operator:v1", body)}`;
}

export function computePilotSplitPlanId<
  const Split extends { readonly split_id: unknown },
>(split: Split): string {
  const { split_id: excluded, ...body } = split;
  void excluded;
  return `idps1_${domainDigest("impactdiff:pilot-split-plan:v1", body)}`;
}

export function computePilotGenerationPlanId<
  const Plan extends { readonly generation_plan_id: unknown },
>(plan: Plan): string {
  const { generation_plan_id: excluded, ...body } = plan;
  void excluded;
  return `idgp1_${domainDigest("impactdiff:pilot-generation-plan:v1", body)}`;
}
