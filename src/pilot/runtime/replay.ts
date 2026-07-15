import type { PilotFixtureAuthoringEnvironment } from "./environment.js";
import { acquirePilotFixtureAuthoringEnvironment } from "./environment.js";
import {
  runPilotFixtureWorkflowAuthoringSession,
  type PilotFixtureWorkflowAuthoringAudit,
} from "./session.js";

export type { PilotFixtureWorkflowAuthoringAudit } from "./session.js";

/**
 * Replays one manifest-bound workflow in a fresh, in-memory browser context.
 * The returned value is a success-only authoring audit, never an outcome or
 * capture artifact.
 */
export async function replayPilotFixtureAuthoringWorkflow(
  environment: PilotFixtureAuthoringEnvironment,
  workflowKey: string,
): Promise<PilotFixtureWorkflowAuthoringAudit> {
  const lease = acquirePilotFixtureAuthoringEnvironment(environment);
  return runPilotFixtureWorkflowAuthoringSession(lease, workflowKey);
}
