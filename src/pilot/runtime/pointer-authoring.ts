import type { PilotFixtureAuthoringEnvironment } from "./environment.js";
import { acquirePilotFixtureAuthoringEnvironment } from "./environment.js";
import { PilotFixtureAuthoringRuntimeError } from "./errors.js";
import { selectPilotPointerOperator } from "./pointer-operator.js";
import {
  runPilotFixtureWorkflowAuthoringSession,
  type PilotFixtureWorkflowAuthoringAudit,
} from "./session.js";

export type PilotFixturePointerHitTestingDefinitionKey =
  | "pointer_hit_testing.intercept_source_point.v1"
  | "pointer_hit_testing.pass_source_point.v1";

export type PilotFixturePointerHitTestingCandidateTaskOutcome =
  "exact_success" | "exact_unchanged";

export interface PilotFixturePointerHitTestingBaselineAuthoringRun {
  readonly audit: PilotFixtureWorkflowAuthoringAudit;
  readonly task_outcome: "exact_success";
}

export interface PilotFixturePointerHitTestingCandidateAuthoringRun {
  readonly audit: PilotFixtureWorkflowAuthoringAudit;
  readonly task_outcome: PilotFixturePointerHitTestingCandidateTaskOutcome;
}

export interface PilotFixturePointerHitTestingPairAuthoringResult {
  readonly kind: "pilot_fixture_pointer_hit_testing_pair_authoring_result";
  readonly official: false;
  readonly definition_key: PilotFixturePointerHitTestingDefinitionKey;
  readonly baseline: PilotFixturePointerHitTestingBaselineAuthoringRun;
  readonly candidate: PilotFixturePointerHitTestingCandidateAuthoringRun;
}

function fail(message: string): never {
  throw new PilotFixtureAuthoringRuntimeError(
    "pilot_runtime.pointer_definition_key",
    message,
  );
}

function selectDefinition(definitionKey: unknown): {
  readonly key: PilotFixturePointerHitTestingDefinitionKey;
  readonly selected: ReturnType<typeof selectPilotPointerOperator>;
} {
  if (typeof definitionKey !== "string") {
    fail("Pilot pointer authoring requires one exact primitive definition key");
  }
  if (definitionKey === "pointer_hit_testing.intercept_source_point.v1") {
    return Object.freeze({
      key: definitionKey,
      selected: selectPilotPointerOperator("intercept"),
    });
  }
  if (definitionKey === "pointer_hit_testing.pass_source_point.v1") {
    return Object.freeze({
      key: definitionKey,
      selected: selectPilotPointerOperator("pass"),
    });
  }
  return fail(
    "Pilot pointer authoring accepts only the exact intercept or pass-through definition key",
  );
}

/**
 * Authors one fresh baseline/candidate pair for a code-owned pointer definition.
 * Predicate, checkpoint, intervention, and cleanup evidence remains private; a
 * result is returned only after both fresh contexts and their leases are closed.
 */
export async function authorPilotFixturePointerHitTestingPair(
  environment: PilotFixtureAuthoringEnvironment,
  workflowKey: string,
  definitionKey: PilotFixturePointerHitTestingDefinitionKey,
): Promise<PilotFixturePointerHitTestingPairAuthoringResult> {
  const definition = selectDefinition(definitionKey);
  const baselineLease = acquirePilotFixtureAuthoringEnvironment(environment);
  const baseline = await runPilotFixtureWorkflowAuthoringSession(
    baselineLease,
    workflowKey,
    "pointer_baseline",
  );
  const candidateLease = acquirePilotFixtureAuthoringEnvironment(environment);
  const candidate = await runPilotFixtureWorkflowAuthoringSession(
    candidateLease,
    workflowKey,
    "pointer_candidate",
    {
      selected: definition.selected,
      sourcePredicates: baseline.source_predicates,
      baseline: baseline.pointer_baseline,
    },
  );
  return Object.freeze({
    kind: "pilot_fixture_pointer_hit_testing_pair_authoring_result",
    official: false,
    definition_key: definition.key,
    baseline: Object.freeze({
      audit: baseline.audit,
      task_outcome: "exact_success" as const,
    }),
    candidate: Object.freeze({
      audit: candidate.audit,
      task_outcome: candidate.task_outcome,
    }),
  });
}
