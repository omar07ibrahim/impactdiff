import type { PilotFixtureAuthoringCheckpointBytes } from "./checkpoint.js";
import type { PilotFixtureAuthoringEnvironment } from "./environment.js";
import { acquirePilotFixtureAuthoringEnvironment } from "./environment.js";
import {
  runPilotFixtureWorkflowAuthoringSession,
  type PilotFixtureWorkflowAuthoringAudit,
} from "./session.js";

export interface PilotFixtureWorkflowCaptureAuthoringResult {
  readonly kind: "pilot_fixture_workflow_capture_authoring_result";
  readonly official: false;
  readonly audit: PilotFixtureWorkflowAuthoringAudit;
  readonly checkpoints: readonly [
    PilotFixtureAuthoringCheckpointBytes,
    PilotFixtureAuthoringCheckpointBytes,
    PilotFixtureAuthoringCheckpointBytes,
  ];
}

/**
 * Captures the three manifest-bound authoring checkpoints in one fresh replay.
 * Results are exposed only after the success oracle and owned browser lifecycle
 * have both completed.
 */
export async function capturePilotFixtureAuthoringWorkflow(
  environment: PilotFixtureAuthoringEnvironment,
  workflowKey: string,
): Promise<PilotFixtureWorkflowCaptureAuthoringResult> {
  const lease = acquirePilotFixtureAuthoringEnvironment(environment);
  const completed = await runPilotFixtureWorkflowAuthoringSession(
    lease,
    workflowKey,
    "capture",
  );
  return Object.freeze({
    kind: "pilot_fixture_workflow_capture_authoring_result",
    official: false,
    audit: completed.audit,
    checkpoints: completed.checkpoints,
  });
}
