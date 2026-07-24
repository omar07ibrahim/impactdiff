import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { canonicalizePng } from "../../src/artifacts/png.js";
import {
  assertCaptureGraphBindings,
  parseAccessibilitySnapshot,
  parseActionPlan,
  parseCaptureSpec,
  parseLayoutSnapshot,
} from "../../src/capture/validate.js";
import {
  canonicalJson,
  computeCheckpointId,
  sha256Hex,
} from "../../src/contracts/canonical.js";
import { pilotMutationLocalPredicateKeys } from "../../src/mutations/catalog/schema.js";
import { loadPilotFixtureAuthoringPackage } from "../../src/pilot/fixture/package.js";
import { capturePilotFixtureAuthoringWorkflow } from "../../src/pilot/runtime/capture.js";
import {
  acquirePilotFixtureAuthoringEnvironment,
  launchPilotFixtureAuthoringEnvironment,
  type PilotFixtureAuthoringEnvironment,
} from "../../src/pilot/runtime/environment.js";
import { measurePilotFixtureAuthoringWorkflowPredicates } from "../../src/pilot/runtime/predicate-authoring.js";
import { replayPilotFixtureAuthoringWorkflow } from "../../src/pilot/runtime/replay.js";

const fixtureDirectory = resolve("fixtures/pilot-incident-command-v1");
const expectedResourceRequests = Object.freeze([
  Object.freeze({ path: "app.js", request_count: 1 }),
  Object.freeze({
    path: "fonts/noto-sans-latin-standard-normal.woff2",
    request_count: 1,
  }),
  Object.freeze({ path: "glyphs/severity.svg", request_count: 1 }),
  Object.freeze({ path: "index.html", request_count: 1 }),
  Object.freeze({ path: "styles.css", request_count: 1 }),
]);
const expectedPredicateVector = Object.freeze(
  pilotMutationLocalPredicateKeys.map((predicate) =>
    Object.freeze({ predicate, state: "pass" as const }),
  ),
);

type CaptureResult = Awaited<ReturnType<typeof capturePilotFixtureAuthoringWorkflow>>;

function ownedContextCount(environment: PilotFixtureAuthoringEnvironment): number {
  const lease = acquirePilotFixtureAuthoringEnvironment(environment);
  try {
    return lease.browser.contexts().length;
  } finally {
    lease.release();
  }
}

function assertDefensiveBytes(
  read: () => Buffer,
  validate: (bytes: Buffer) => void,
): void {
  const first = read();
  const second = read();
  assert.notEqual(first, second);
  assert.notEqual(first.buffer, second.buffer);
  assert.equal(first.byteOffset, 0);
  assert.equal(second.byteOffset, 0);
  assert.equal(first.buffer.byteLength, first.byteLength);
  assert.equal(second.buffer.byteLength, second.byteLength);
  assert.deepEqual(first, second);
  validate(second);

  first.fill(0);
  const protectedBytes = read();
  assert.notEqual(protectedBytes.buffer, first.buffer);
  assert.deepEqual(protectedBytes, second);
  validate(protectedBytes);
}

function assertAudit(
  audit: CaptureResult["audit"],
  workflowKey: string,
  taskId: string,
): void {
  assert.equal(audit.kind, "pilot_fixture_workflow_authoring_audit");
  assert.equal(audit.official, false);
  assert.equal(audit.fixture_key, "pilot-incident-command-v1");
  assert.equal(audit.fixture_revision, "pilot-incident-command-v1.0.0-authoring.1");
  assert.equal(
    audit.source_state_id,
    "idss1_7a515aacaa462bfd3d0059976d838a3d5d86073fced9f244b7056d7749036198",
  );
  assert.equal(audit.workflow_key, workflowKey);
  assert.equal(audit.task_id, taskId);
  assert.match(audit.environment_id, /^iden1_[0-9a-f]{64}$/u);
  assert.equal(audit.actions_executed, 4);
  assert.deepEqual(audit.checkpoint_after_action_ordinals, [-1, 2, 3]);
  assert.deepEqual(audit.resource_requests, expectedResourceRequests);
  assert.deepEqual(audit.blocked_external_requests, []);
  assert.deepEqual(audit.unexpected_fixture_requests, []);
}

test(
  "Incident Command browser replay and source predicates stay application-generic",
  { concurrency: false },
  async () => {
    const authoringPackage = await loadPilotFixtureAuthoringPackage(fixtureDirectory);
    const environment = await launchPilotFixtureAuthoringEnvironment(fixtureDirectory);
    let closed = false;
    try {
      assert.equal(ownedContextCount(environment), 0);
      for (const workflow of authoringPackage.workflows) {
        const first = await replayPilotFixtureAuthoringWorkflow(
          environment,
          workflow.workflow_key,
        );
        const second = await replayPilotFixtureAuthoringWorkflow(
          environment,
          workflow.workflow_key,
        );
        assert.deepEqual(first, second);
        assertAudit(first, workflow.workflow_key, workflow.task_id);
        assert.equal(Object.isFrozen(first), true);
        assert.equal(ownedContextCount(environment), 0);

        const predicates = await measurePilotFixtureAuthoringWorkflowPredicates(
          environment,
          workflow.workflow_key,
        );
        assert.equal(
          predicates.kind,
          "pilot_fixture_workflow_predicate_authoring_result",
        );
        assert.equal(predicates.official, false);
        assertAudit(predicates.audit, workflow.workflow_key, workflow.task_id);
        assert.deepEqual(predicates.source_predicates, expectedPredicateVector);
        assert.equal(Object.isFrozen(predicates), true);
        assert.equal(Object.isFrozen(predicates.source_predicates), true);
        assert.ok(predicates.source_predicates.every(Object.isFrozen));
        assert.equal(ownedContextCount(environment), 0);
      }
      await environment.close();
      closed = true;
    } finally {
      if (!closed) {
        try {
          await environment.close();
        } catch {
          // Preserve the replay assertion after best-effort browser cleanup.
        }
      }
    }
  },
);

test(
  "Incident Command emits three byte-identical canonical capture attempts",
  { concurrency: false },
  async () => {
    const authoringPackage = await loadPilotFixtureAuthoringPackage(fixtureDirectory);
    const environment = await launchPilotFixtureAuthoringEnvironment(fixtureDirectory);
    const captureSpec = parseCaptureSpec(environment.capture_spec.bytes);
    let closed = false;
    try {
      assert.equal(ownedContextCount(environment), 0);
      for (const workflow of authoringPackage.workflows) {
        const actionPlan = parseActionPlan(workflow.action_plan.bytes);
        const primaryTargetId = actionPlan.actions.at(-1)?.target_id;
        assert.equal(typeof primaryTargetId, "string");

        const attempts: CaptureResult[] = [];
        for (let replicate = 0; replicate < 3; replicate += 1) {
          const result = await capturePilotFixtureAuthoringWorkflow(
            environment,
            workflow.workflow_key,
          );
          assert.equal(result.kind, "pilot_fixture_workflow_capture_authoring_result");
          assert.equal(result.official, false);
          assert.equal(Object.isFrozen(result), true);
          assert.equal(Object.isFrozen(result.audit), true);
          assert.equal(Object.isFrozen(result.checkpoints), true);
          assert.equal(result.checkpoints.length, 3);
          assertAudit(result.audit, workflow.workflow_key, workflow.task_id);
          assert.equal(ownedContextCount(environment), 0);

          for (const [ordinal, checkpoint] of result.checkpoints.entries()) {
            assert.equal(checkpoint.ordinal, ordinal);
            assert.equal(
              checkpoint.checkpoint_id,
              computeCheckpointId(workflow.action_plan.reference, ordinal),
            );
            const screenshot = checkpoint.screenshot;
            const accessibilityBytes = checkpoint.accessibility_tree;
            const layoutBytes = checkpoint.layout_graph;
            assert.deepEqual(
              canonicalizePng(screenshot, captureSpec.display.viewport).bytes,
              screenshot,
            );
            const accessibility = parseAccessibilitySnapshot(accessibilityBytes);
            const layout = parseLayoutSnapshot(layoutBytes);
            assert.equal(
              accessibilityBytes.toString("utf8"),
              canonicalJson(accessibility),
            );
            assert.equal(layoutBytes.toString("utf8"), canonicalJson(layout));
            assertCaptureGraphBindings(actionPlan, accessibility, layout);
            assert.equal(
              layout.nodes.filter((node) => node.action_target_id === primaryTargetId)
                .length,
              1,
            );
          }
          attempts.push(result);
        }

        for (const ordinal of [0, 1, 2] as const) {
          const first = attempts[0]?.checkpoints[ordinal];
          assert.ok(first !== undefined);
          for (const attempt of attempts.slice(1)) {
            assert.deepEqual(attempt.checkpoints[ordinal].screenshot, first.screenshot);
            assert.deepEqual(
              attempt.checkpoints[ordinal].accessibility_tree,
              first.accessibility_tree,
            );
            assert.deepEqual(
              attempt.checkpoints[ordinal].layout_graph,
              first.layout_graph,
            );
          }
        }

        const firstAttempt = attempts[0];
        assert.ok(firstAttempt !== undefined);
        const boundaryDigests = firstAttempt.checkpoints.map((checkpoint) =>
          sha256Hex(
            Buffer.concat([
              checkpoint.screenshot,
              checkpoint.accessibility_tree,
              checkpoint.layout_graph,
            ]),
          ),
        );
        assert.equal(new Set(boundaryDigests).size, 3);

        const firstCheckpoint = firstAttempt.checkpoints[0];
        assertDefensiveBytes(
          () => firstCheckpoint.screenshot,
          (bytes) => {
            canonicalizePng(bytes, captureSpec.display.viewport);
          },
        );
        assertDefensiveBytes(
          () => firstCheckpoint.accessibility_tree,
          (bytes) => {
            parseAccessibilitySnapshot(bytes);
          },
        );
        assertDefensiveBytes(
          () => firstCheckpoint.layout_graph,
          (bytes) => {
            parseLayoutSnapshot(bytes);
          },
        );
      }
      await environment.close();
      closed = true;
    } finally {
      if (!closed) {
        try {
          await environment.close();
        } catch {
          // Preserve the capture assertion after best-effort browser cleanup.
        }
      }
    }
  },
);
