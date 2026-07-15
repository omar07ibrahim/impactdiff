import { Ajv2020 } from "ajv/dist/2020.js";

import { assertNoIssues, issue } from "../contracts/errors.js";
import type { ContractIssue } from "../contracts/errors.js";
import { normalizedSchemaValue } from "../contracts/input.js";
import {
  changedSurfaceSchema,
  localizationSchema,
  oracleResultSchema,
  rawTraceSchema,
} from "./schema.js";
import type { ChangedSurface, Localization, OracleResult, RawTrace } from "./schema.js";

const ajv = new Ajv2020({ allErrors: true, ownProperties: true, strict: true });
const changedSurfaceValidator = ajv.compile<ChangedSurface>(changedSurfaceSchema);
const oracleResultValidator = ajv.compile<OracleResult>(oracleResultSchema);
const rawTraceValidator = ajv.compile<RawTrace>(rawTraceSchema);
const localizationValidator = ajv.compile<Localization>(localizationSchema);

function checkSortedUnique(
  values: readonly string[],
  path: string,
  issues: ContractIssue[],
): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous !== undefined && current !== undefined && previous >= current) {
      issues.push(
        issue(
          "sealed.noncanonical_order",
          `${path}/${index}`,
          "identity lists must be strictly sorted and unique",
        ),
      );
    }
  }
}

export function validateChangedSurface(value: unknown): ChangedSurface {
  const surface = normalizedSchemaValue(
    "impactdiff.changed-surface/v1",
    changedSurfaceValidator,
    value,
  );
  const issues: ContractIssue[] = [];
  checkSortedUnique(surface.affected_node_ids, "/affected_node_ids", issues);
  assertNoIssues("impactdiff.changed-surface/v1", issues);
  return surface;
}

export function validateOracleResult(value: unknown): OracleResult {
  const result = normalizedSchemaValue(
    "impactdiff.oracle-result/v1",
    oracleResultValidator,
    value,
  );
  const expectedPassed =
    result.kind === "final_state"
      ? result.observed_state === "confirmed"
      : result.primary_action_count === 0 && result.confirmation_count === 1;
  const issues: ContractIssue[] = [];
  if (result.passed !== expectedPassed) {
    issues.push(
      issue(
        "oracle.derived_result",
        "/passed",
        "oracle pass state must be derived from its closed observation",
      ),
    );
  }
  assertNoIssues("impactdiff.oracle-result/v1", issues);
  return result;
}

export function validateRawTrace(value: unknown): RawTrace {
  const trace = normalizedSchemaValue(
    "impactdiff.raw-trace/v1",
    rawTraceValidator,
    value,
  );
  const issues: ContractIssue[] = [];
  let firstUnsatisfied: string | null = null;
  for (const [index, step] of trace.steps.entries()) {
    if (step.ordinal !== index) {
      issues.push(
        issue(
          "trace.ordinal",
          `/steps/${index}/ordinal`,
          "trace step ordinals must be contiguous and zero-based",
        ),
      );
    }
    if (step.status === "unsatisfied") {
      if (firstUnsatisfied === null) {
        firstUnsatisfied = step.action_id;
      } else {
        issues.push(
          issue(
            "trace.multiple_failures",
            `/steps/${index}/status`,
            "one trace can have only one first unsatisfied action",
          ),
        );
      }
    }
    if (firstUnsatisfied !== null && step.action_id !== firstUnsatisfied) {
      if (step.status !== "not_reached") {
        issues.push(
          issue(
            "trace.post_failure_status",
            `/steps/${index}/status`,
            "actions after the first failure must be not_reached",
          ),
        );
      }
    } else if (firstUnsatisfied === null && step.status === "not_reached") {
      issues.push(
        issue(
          "trace.early_not_reached",
          `/steps/${index}/status`,
          "not_reached requires a preceding unsatisfied action",
        ),
      );
    }
  }
  if (trace.task_success !== (firstUnsatisfied === null)) {
    issues.push(
      issue(
        "trace.derived_success",
        "/task_success",
        "task success must be derived from the trace step statuses",
      ),
    );
  }
  if (trace.first_unsatisfied_step_id !== firstUnsatisfied) {
    issues.push(
      issue(
        "trace.derived_failed_step",
        "/first_unsatisfied_step_id",
        "first unsatisfied step must be derived from the trace",
      ),
    );
  }
  assertNoIssues("impactdiff.raw-trace/v1", issues);
  return trace;
}

export function validateLocalization(value: unknown): Localization {
  const localization = normalizedSchemaValue(
    "impactdiff.localization/v1",
    localizationValidator,
    value,
  );
  const issues: ContractIssue[] = [];
  checkSortedUnique(localization.affected_node_ids, "/affected_node_ids", issues);
  assertNoIssues("impactdiff.localization/v1", issues);
  return localization;
}
