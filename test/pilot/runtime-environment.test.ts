import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { parseCaptureSpec } from "../../src/capture/validate.js";
import { computeEnvironmentId, sha256Hex } from "../../src/contracts/canonical.js";
import {
  acquirePilotFixtureAuthoringEnvironment,
  launchPilotFixtureAuthoringEnvironment,
  PilotFixtureAuthoringEnvironment,
  type PilotFixtureAuthoringEnvironmentLease,
} from "../../src/pilot/runtime/environment.js";
import { PilotFixtureAuthoringRuntimeError } from "../../src/pilot/runtime/errors.js";

const fixtureDirectory = resolve("fixtures/pilot-market-basket-v1");

async function expectRuntimeError(
  action: Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof PilotFixtureAuthoringRuntimeError);
    assert.equal(error.code, code);
    return true;
  });
}

function expectSynchronousRuntimeError(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof PilotFixtureAuthoringRuntimeError);
    assert.equal(error.code, code);
    return true;
  });
}

test(
  "Pilot authoring environment rejects forged capabilities",
  { concurrency: false },
  () => {
    assert.ok(Object.isFrozen(PilotFixtureAuthoringEnvironment.prototype));
    expectSynchronousRuntimeError(
      () => Reflect.construct(PilotFixtureAuthoringEnvironment, [Symbol("forged"), {}]),
      "pilot_runtime.untrusted_environment",
    );
    expectSynchronousRuntimeError(
      () =>
        acquirePilotFixtureAuthoringEnvironment(
          Object.create(PilotFixtureAuthoringEnvironment.prototype) as unknown,
        ),
      "pilot_runtime.untrusted_environment",
    );
    expectSynchronousRuntimeError(
      () => acquirePilotFixtureAuthoringEnvironment(null),
      "pilot_runtime.untrusted_environment",
    );
  },
);

test(
  "Pilot authoring environment owns one reusable verified browser capability",
  { concurrency: false },
  async () => {
    const environment = await launchPilotFixtureAuthoringEnvironment(fixtureDirectory);
    let activeLease: PilotFixtureAuthoringEnvironmentLease | undefined;
    let closed = false;

    try {
      assert.ok(environment instanceof PilotFixtureAuthoringEnvironment);
      assert.ok(Object.isFrozen(environment));
      assert.equal(
        Object.getPrototypeOf(environment),
        PilotFixtureAuthoringEnvironment.prototype,
      );
      assert.deepEqual(Reflect.ownKeys(environment), []);

      const firstArtifact = environment.capture_spec;
      const secondArtifact = environment.capture_spec;
      assert.ok(Object.isFrozen(firstArtifact));
      assert.ok(Object.isFrozen(firstArtifact.reference));
      assert.notEqual(firstArtifact, secondArtifact);
      assert.notEqual(firstArtifact.reference, secondArtifact.reference);
      assert.notEqual(firstArtifact.bytes, secondArtifact.bytes);
      assert.deepEqual(firstArtifact.reference, secondArtifact.reference);
      assert.deepEqual(firstArtifact.bytes, secondArtifact.bytes);
      assert.equal(sha256Hex(firstArtifact.bytes), firstArtifact.reference.sha256);
      assert.equal(firstArtifact.bytes.byteLength, firstArtifact.reference.byte_length);
      parseCaptureSpec(firstArtifact.bytes);

      firstArtifact.bytes[0] = firstArtifact.bytes[0] === 0 ? 1 : 0;
      const protectedArtifact = environment.capture_spec;
      assert.deepEqual(protectedArtifact.bytes, secondArtifact.bytes);
      assert.equal(
        sha256Hex(protectedArtifact.bytes),
        protectedArtifact.reference.sha256,
      );
      parseCaptureSpec(protectedArtifact.bytes);

      const firstLease = acquirePilotFixtureAuthoringEnvironment(environment);
      activeLease = firstLease;
      assert.ok(Object.isFrozen(firstLease));
      assert.equal(
        firstLease.environment_id,
        computeEnvironmentId(protectedArtifact.reference),
      );
      assert.equal(
        firstLease.environment_id,
        "iden1_9635a43f6d78427c651b0a8b3085def1fcfd3f2cf1f0f9f9d7a8cc59584fa9d4",
      );
      assert.deepEqual(firstLease.capture_spec_reference, protectedArtifact.reference);
      assert.notEqual(firstLease.capture_spec_reference, protectedArtifact.reference);
      assert.ok(Object.isFrozen(firstLease.capture_spec_reference));

      await expectRuntimeError(environment.close(), "pilot_runtime.environment_in_use");
      expectSynchronousRuntimeError(
        () => acquirePilotFixtureAuthoringEnvironment(environment),
        "pilot_runtime.environment_in_use",
      );

      const ownedBrowser = firstLease.browser;
      firstLease.release();
      activeLease = undefined;
      expectSynchronousRuntimeError(
        firstLease.release,
        "pilot_runtime.environment_lease",
      );

      const reusedLease = acquirePilotFixtureAuthoringEnvironment(environment);
      activeLease = reusedLease;
      assert.equal(reusedLease.browser, ownedBrowser);
      assert.equal(reusedLease.environment_id, firstLease.environment_id);
      reusedLease.release();
      activeLease = undefined;

      const invalidatedLease = acquirePilotFixtureAuthoringEnvironment(environment);
      activeLease = invalidatedLease;
      assert.equal(invalidatedLease.browser, ownedBrowser);
      invalidatedLease.invalidate();
      activeLease = undefined;
      expectSynchronousRuntimeError(
        invalidatedLease.invalidate,
        "pilot_runtime.environment_lease",
      );
      expectSynchronousRuntimeError(
        () => acquirePilotFixtureAuthoringEnvironment(environment),
        "pilot_runtime.environment_poisoned",
      );

      await environment.close();
      closed = true;
      assert.equal(ownedBrowser.isConnected(), false);
      await expectRuntimeError(environment.close(), "pilot_runtime.environment_closed");
    } finally {
      if (activeLease !== undefined) {
        try {
          activeLease.invalidate();
        } catch {
          // A failed assertion can race with lease finalization; close still owns cleanup.
        }
      }
      if (!closed) {
        try {
          await environment.close();
        } catch {
          // Preserve the original test failure after a best-effort browser cleanup.
        }
      }
    }
  },
);
