import assert from "node:assert/strict";
import test from "node:test";

import {
  computeMutationFamilyGroupId,
  computeSourceStateGroupId,
} from "../../src/contracts/canonical.js";
import type { MutationRuntimeBinding } from "../../src/mutations/index.js";
import {
  deriveDevelopmentGrouping,
  deriveDevelopmentLabelDecision,
  developmentLabelPolicyId,
} from "../../src/generation/policy.js";

const id = (prefix: string, character: string): string =>
  `${prefix}${character.repeat(64)}`;

const binding = Object.freeze({
  source_state_id: id("idss1_", "1"),
  task_id: id("idtk1_", "2"),
  environment_id: id("iden1_", "3"),
  fixture_id: "checkout-card-v1",
  fixture_revision: "checkout-card-v1.0.0",
  fixture_manifest_sha256: "4".repeat(64),
  source_state: {
    sha256: "5".repeat(64),
    byte_length: 100,
    media_type: "application/vnd.impactdiff.source-state+json",
    format_version: 1 as const,
  },
  action_plan: {
    sha256: "6".repeat(64),
    byte_length: 100,
    media_type: "application/vnd.impactdiff.action-plan+json",
    format_version: 1 as const,
  },
  capture_spec: {
    sha256: "7".repeat(64),
    byte_length: 100,
    media_type: "application/vnd.impactdiff.capture-spec+json",
    format_version: 1 as const,
  },
  primary_action_target_id: id("idat1_", "8"),
}) satisfies MutationRuntimeBinding;

test("development grouping and policy identities are deterministic and separated", () => {
  const familyId = id("idmf1_", "9");
  const first = deriveDevelopmentGrouping(binding, familyId);
  const second = deriveDevelopmentGrouping(structuredClone(binding), familyId);

  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.match(developmentLabelPolicyId, /^idlp1_[0-9a-f]{64}$/u);
  assert.equal(
    first.source_state_group_id,
    computeSourceStateGroupId(binding.source_state_id),
  );
  assert.equal(first.mutation_family_group_id, computeMutationFamilyGroupId(familyId));
  assert.equal(new Set(Object.values(first)).size, Object.values(first).length);
});

test("development labels close baseline-invalid, pass, and primary-block branches", () => {
  const failedStep = id("idst1_", "a");
  const invalid = deriveDevelopmentLabelDecision(false, false, failedStep);
  assert.deepEqual(invalid, {
    labels: {
      sample_valid: false,
      invalid_reason: "baseline_failed",
      task_regression: null,
      severity_ordinal: null,
      first_failed_step_id: null,
    },
    requiresLocalization: false,
  });

  const pass = deriveDevelopmentLabelDecision(true, true, null);
  assert.deepEqual(pass, {
    labels: {
      sample_valid: true,
      invalid_reason: null,
      task_regression: false,
      severity_ordinal: 0,
      first_failed_step_id: null,
    },
    requiresLocalization: false,
  });

  const regression = deriveDevelopmentLabelDecision(true, false, failedStep);
  assert.deepEqual(regression, {
    labels: {
      sample_valid: true,
      invalid_reason: null,
      task_regression: true,
      severity_ordinal: 4,
      first_failed_step_id: failedStep,
    },
    requiresLocalization: true,
  });
});
