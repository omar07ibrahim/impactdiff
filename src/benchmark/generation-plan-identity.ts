import { createHash } from "node:crypto";

import { canonicalJson } from "../contracts/canonical.js";

export { computePilotMutationOperatorId } from "../mutations/catalog/identity.js";
export type { PilotMutationOperatorIdentityInput } from "../mutations/catalog/identity.js";

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
