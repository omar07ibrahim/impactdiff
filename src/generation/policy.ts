import { createHash } from "node:crypto";

import {
  canonicalJson,
  computeMutationFamilyGroupId,
  computeSourceStateGroupId,
} from "../contracts/canonical.js";
import type { SealedRecord } from "../contracts/schema.js";
import type { MutationRuntimeBinding } from "../mutations/runtime.js";

type Grouping = SealedRecord["grouping"];
type Labels = SealedRecord["labels"];

const developmentLabelPolicy = Object.freeze({
  contract: "impactdiff.development-label-policy",
  version: 1,
  baseline_failure: "invalid",
  regression: "successful_baseline_and_failed_candidate",
  regression_severity_ordinal: 4,
  pass_severity_ordinal: 0,
});

function domainDigest(domain: string, body: unknown): string {
  const hash = createHash("sha256");
  hash.update(domain, "utf8");
  hash.update("\0", "utf8");
  hash.update(canonicalJson(body), "utf8");
  return hash.digest("hex");
}

export const developmentLabelPolicyId = `idlp1_${domainDigest(
  "impactdiff:development-label-policy:v1",
  developmentLabelPolicy,
)}` as const;

export function deriveDevelopmentGrouping(
  binding: MutationRuntimeBinding,
  familyId: string,
): Grouping {
  return Object.freeze({
    application_group_id: `idag1_${domainDigest(
      "impactdiff:development-application-group:v1",
      { fixture_id: binding.fixture_id },
    )}`,
    source_state_group_id: computeSourceStateGroupId(binding.source_state_id),
    source_task_group_id: `idtg1_${domainDigest(
      "impactdiff:development-source-task-group:v1",
      {
        source_state_id: binding.source_state_id,
        task_id: binding.task_id,
      },
    )}`,
    near_duplicate_group_id: `idng1_${domainDigest(
      "impactdiff:development-near-duplicate-group:v1",
      {
        fixture_id: binding.fixture_id,
        fixture_revision: binding.fixture_revision,
        source_state_id: binding.source_state_id,
      },
    )}`,
    asset_component_id: `idac1_${domainDigest(
      "impactdiff:development-asset-component:v1",
      { fixture_manifest_sha256: binding.fixture_manifest_sha256 },
    )}`,
    mutation_family_group_id: computeMutationFamilyGroupId(familyId),
  });
}

export interface DevelopmentLabelDecision {
  readonly labels: Omit<Labels, "localization">;
  readonly requiresLocalization: boolean;
}

export function deriveDevelopmentLabelDecision(
  baselineTaskSuccess: boolean,
  candidateTaskSuccess: boolean,
  candidateFailedStepId: string | null,
): DevelopmentLabelDecision {
  if (!baselineTaskSuccess) {
    return Object.freeze({
      labels: Object.freeze({
        sample_valid: false,
        invalid_reason: "baseline_failed",
        task_regression: null,
        severity_ordinal: null,
        first_failed_step_id: null,
      }),
      requiresLocalization: false,
    });
  }

  if (candidateTaskSuccess) {
    return Object.freeze({
      labels: Object.freeze({
        sample_valid: true,
        invalid_reason: null,
        task_regression: false,
        severity_ordinal: 0,
        first_failed_step_id: null,
      }),
      requiresLocalization: false,
    });
  }

  return Object.freeze({
    labels: Object.freeze({
      sample_valid: true,
      invalid_reason: null,
      task_regression: true,
      severity_ordinal: 4,
      first_failed_step_id: candidateFailedStepId,
    }),
    requiresLocalization: true,
  });
}
