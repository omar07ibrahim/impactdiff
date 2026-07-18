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
import { loadPilotFixtureAuthoringPackage } from "../../src/pilot/fixture/package.js";
import { capturePilotFixtureAuthoringWorkflow } from "../../src/pilot/runtime/capture.js";
import {
  capturePilotFixtureAuthoringObservation,
  PilotFixtureAuthoringCheckpointBytes,
  type PilotFixtureAuthoringObservationBytes,
} from "../../src/pilot/runtime/checkpoint.js";
import {
  acquirePilotFixtureAuthoringEnvironment,
  launchPilotFixtureAuthoringEnvironment,
  type PilotFixtureAuthoringEnvironment,
} from "../../src/pilot/runtime/environment.js";
import { PilotFixtureAuthoringRuntimeError } from "../../src/pilot/runtime/errors.js";
import { replayPilotFixtureAuthoringWorkflow } from "../../src/pilot/runtime/replay.js";

const fixtureDirectory = resolve("fixtures/pilot-market-basket-v1");
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
  assert.notEqual(protectedBytes.buffer, second.buffer);
  assert.equal(protectedBytes.byteOffset, 0);
  assert.equal(protectedBytes.buffer.byteLength, protectedBytes.byteLength);
  assert.deepEqual(protectedBytes, second);
  validate(protectedBytes);
}

async function captureInitialIdFreeObservation(
  environment: PilotFixtureAuthoringEnvironment,
  workflowKey: string,
): Promise<PilotFixtureAuthoringObservationBytes> {
  const lease = acquirePilotFixtureAuthoringEnvironment(environment);
  const authoringPackage = lease.authoring_snapshot.authoring_package;
  const manifest = authoringPackage.manifest;
  const packagedWorkflow = authoringPackage.workflows.find(
    ({ workflow_key: key }) => key === workflowKey,
  );
  const workflow = manifest.workflows.find(
    ({ workflow_key: key }) => key === workflowKey,
  );
  assert.ok(packagedWorkflow !== undefined);
  assert.ok(workflow !== undefined);
  const actionPlan = parseActionPlan(packagedWorkflow.action_plan.bytes);
  const primaryActionTargetId = actionPlan.actions.at(-1)?.target_id;
  if (typeof primaryActionTargetId !== "string") {
    throw new Error("the fixture primary action must bind one target ID");
  }

  let context: Awaited<ReturnType<typeof lease.browser.newContext>> | undefined;
  let reusable = false;
  try {
    const captureSpec = lease.capture_spec;
    context = await lease.browser.newContext({
      viewport: { ...captureSpec.display.viewport },
      screen: { ...captureSpec.display.screen },
      deviceScaleFactor: captureSpec.display.device_scale_factor,
      locale: captureSpec.internationalization.locale,
      timezoneId: captureSpec.internationalization.timezone_id,
      colorScheme: captureSpec.media.color_scheme,
      reducedMotion: captureSpec.media.reduced_motion,
      forcedColors: captureSpec.media.forced_colors,
      serviceWorkers: captureSpec.network.service_workers,
      acceptDownloads: false,
      permissions: [],
      bypassCSP: false,
      javaScriptEnabled: true,
      hasTouch: false,
      isMobile: false,
    });
    const fixtureOrigin = "https://pilot-fixture.impactdiff.invalid";
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const path =
        url.origin === fixtureOrigin
          ? url.pathname === "/"
            ? manifest.entrypoint
            : url.pathname.slice(1)
          : "";
      const resource = manifest.resources.find(({ path: value }) => value === path);
      const bytes = lease.authoring_snapshot.resources.read(path);
      if (resource === undefined || bytes === undefined) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.fulfill({
        status: 200,
        body: bytes,
        headers: {
          "cache-control": "no-store",
          "content-security-policy": manifest.content_security_policy,
          "content-type": resource.media_type,
          "x-content-type-options": "nosniff",
        },
      });
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(captureSpec.budgets.navigation_timeout_ms);
    page.setDefaultTimeout(captureSpec.budgets.action_timeout_ms);
    await page.clock.install({ time: captureSpec.clock.epoch_ms });
    await page.clock.pauseAt(captureSpec.clock.epoch_ms);
    await page.goto(`${fixtureOrigin}/`, { waitUntil: "load" });
    await page.waitForFunction(
      (readinessGlobal) => {
        const state = Reflect.get(window, readinessGlobal) as
          { readonly ready?: unknown; readonly pendingRequests?: unknown } | undefined;
        return state?.ready === true && state.pendingRequests === 0;
      },
      manifest.readiness.global,
      { timeout: captureSpec.budgets.readiness_timeout_ms },
    );
    const observation = await capturePilotFixtureAuthoringObservation({
      page,
      capture_spec: captureSpec,
      action_plan: actionPlan,
      primary_action_target_id: primaryActionTargetId,
      primary_action_test_id: workflow.abi.primary.value,
    });
    reusable = true;
    return observation;
  } finally {
    try {
      await context?.close();
    } catch (error) {
      reusable = false;
      throw error;
    } finally {
      if (reusable) lease.release();
      else lease.invalidate();
    }
  }
}

test("Pilot capture checkpoints reject forged constructor capabilities", () => {
  assert.equal(Object.isFrozen(PilotFixtureAuthoringCheckpointBytes.prototype), true);
  assert.deepEqual(
    Object.getOwnPropertyNames(PilotFixtureAuthoringCheckpointBytes.prototype).sort(),
    ["accessibility_tree", "constructor", "layout_graph", "screenshot"],
  );
  assert.throws(
    () =>
      Reflect.construct(PilotFixtureAuthoringCheckpointBytes, [Symbol("forged"), {}]),
    (error: unknown) => {
      assert.ok(error instanceof PilotFixtureAuthoringRuntimeError);
      assert.equal(error.code, "pilot_runtime.checkpoint_capability");
      return true;
    },
  );
});

test(
  "Pilot capture emits deterministic canonical checkpoints for every authored workflow",
  { concurrency: false },
  async (t) => {
    const authoringPackage = await loadPilotFixtureAuthoringPackage(fixtureDirectory);
    const environment = await launchPilotFixtureAuthoringEnvironment(fixtureDirectory);
    const captureSpec = parseCaptureSpec(environment.capture_spec.bytes);
    let closed = false;
    try {
      assert.equal(ownedContextCount(environment), 0);
      const initialObservation = await captureInitialIdFreeObservation(
        environment,
        "add_bundle",
      );
      assert.equal(ownedContextCount(environment), 0);
      assert.equal(Object.isFrozen(initialObservation), true);
      assert.deepEqual(Reflect.ownKeys(initialObservation).sort(), [
        "accessibility_tree",
        "layout_graph",
        "screenshot",
      ]);
      assert.equal("checkpoint_id" in initialObservation, false);
      assert.equal("ordinal" in initialObservation, false);
      assertDefensiveBytes(
        () => initialObservation.screenshot,
        (bytes) => canonicalizePng(bytes, captureSpec.display.viewport),
      );
      assertDefensiveBytes(
        () => initialObservation.accessibility_tree,
        (bytes) => parseAccessibilitySnapshot(bytes),
      );
      assertDefensiveBytes(
        () => initialObservation.layout_graph,
        (bytes) => parseLayoutSnapshot(bytes),
      );
      for (const packagedWorkflow of authoringPackage.workflows) {
        await t.test(packagedWorkflow.workflow_key, async () => {
          const actionPlan = parseActionPlan(packagedWorkflow.action_plan.bytes);
          const primaryTargetId = actionPlan.actions.at(-1)?.target_id;
          assert.equal(typeof primaryTargetId, "string");

          const attempts: CaptureResult[] = [];
          for (let replicate = 0; replicate < 3; replicate += 1) {
            const result = await capturePilotFixtureAuthoringWorkflow(
              environment,
              packagedWorkflow.workflow_key,
            );
            assert.equal(ownedContextCount(environment), 0);
            assert.deepEqual(Reflect.ownKeys(result).sort(), [
              "audit",
              "checkpoints",
              "kind",
              "official",
            ]);
            assert.equal(
              result.kind,
              "pilot_fixture_workflow_capture_authoring_result",
            );
            assert.equal(result.official, false);
            assert.equal(Object.isFrozen(result), true);
            assert.equal(Object.isFrozen(result.audit), true);
            assert.equal(Object.isFrozen(result.checkpoints), true);
            assert.equal(result.audit.workflow_key, packagedWorkflow.workflow_key);
            assert.equal(result.audit.official, false);
            assert.equal(result.checkpoints.length, 3);

            for (const [ordinal, checkpoint] of result.checkpoints.entries()) {
              assert.ok(checkpoint instanceof PilotFixtureAuthoringCheckpointBytes);
              assert.equal(Object.isFrozen(checkpoint), true);
              assert.equal(checkpoint.ordinal, ordinal);
              assert.equal(
                checkpoint.checkpoint_id,
                computeCheckpointId(packagedWorkflow.action_plan.reference, ordinal),
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

          assert.equal(attempts.length, 3);
          for (const ordinal of [0, 1, 2] as const) {
            const first = attempts[0]?.checkpoints[ordinal];
            assert.ok(first !== undefined);
            for (const attempt of attempts.slice(1)) {
              assert.deepEqual(
                attempt.checkpoints[ordinal].screenshot,
                first.screenshot,
              );
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
          if (packagedWorkflow.workflow_key === "add_bundle") {
            assert.deepEqual(
              firstAttempt.checkpoints[0].screenshot,
              initialObservation.screenshot,
            );
            assert.deepEqual(
              firstAttempt.checkpoints[0].accessibility_tree,
              initialObservation.accessibility_tree,
            );
            assert.deepEqual(
              firstAttempt.checkpoints[0].layout_graph,
              initialObservation.layout_graph,
            );
          }
          const boundaryDigests = firstAttempt.checkpoints.map((checkpoint) =>
            sha256Hex(
              Buffer.concat([
                checkpoint.screenshot,
                checkpoint.accessibility_tree,
                checkpoint.layout_graph,
              ]),
            ),
          );
          assert.equal(
            new Set(boundaryDigests).size,
            3,
            "initial, pre-primary, and post-primary observations must remain distinct",
          );

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

          const replayAudit = await replayPilotFixtureAuthoringWorkflow(
            environment,
            packagedWorkflow.workflow_key,
          );
          assert.deepEqual(firstAttempt.audit, replayAudit);
          assert.equal(ownedContextCount(environment), 0);
        });
      }

      await environment.close();
      closed = true;
    } finally {
      if (!closed) {
        try {
          await environment.close();
        } catch {
          // Preserve the capture or assertion failure after best-effort cleanup.
        }
      }
    }
  },
);
