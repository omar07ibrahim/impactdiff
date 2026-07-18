import type { PilotFixtureAuthoringEnvironment } from "./environment.js";
import { acquirePilotFixtureAuthoringEnvironment } from "./environment.js";
import type { PilotMutationPredicateObservationTuple } from "./predicates.js";
import {
  runPilotFixtureWorkflowAuthoringSession,
  type PilotFixtureWorkflowAuthoringAudit,
} from "./session.js";

export interface PilotFixtureWorkflowPredicateAuthoringResult {
  readonly kind: "pilot_fixture_workflow_predicate_authoring_result";
  readonly official: false;
  readonly audit: PilotFixtureWorkflowAuthoringAudit;
  readonly source_predicates: PilotMutationPredicateObservationTuple;
}

/**
 * Measures the closed eight-predicate Pilot vector at the pre-primary boundary.
 * The private checkpoint used for Chromium accessibility evidence is not exposed.
 * A result becomes observable only after task success and browser cleanup complete.
 */
export async function measurePilotFixtureAuthoringWorkflowPredicates(
  environment: PilotFixtureAuthoringEnvironment,
  workflowKey: string,
): Promise<PilotFixtureWorkflowPredicateAuthoringResult> {
  const lease = acquirePilotFixtureAuthoringEnvironment(environment);
  const completed = await runPilotFixtureWorkflowAuthoringSession(
    lease,
    workflowKey,
    "predicate",
  );
  return Object.freeze({
    kind: "pilot_fixture_workflow_predicate_authoring_result",
    official: false,
    audit: completed.audit,
    source_predicates: completed.source_predicates,
  });
}
