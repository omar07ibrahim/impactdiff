import assert from "node:assert/strict";
import test from "node:test";

import { parseActionPlan } from "../../src/capture/index.js";
import { computeTaskId, sha256Hex } from "../../src/contracts/canonical.js";
import {
  loadVerifiedMutationFixtureActionPlan,
  type MutationFixtureActionPlanArtifact,
} from "../../src/mutations/index.js";

function acceptsActionPlanArtifact(
  _artifact: MutationFixtureActionPlanArtifact,
): void {}

void acceptsActionPlanArtifact;

test("verified fixture loader emits the exact reusable action-plan artifact", () => {
  const first = loadVerifiedMutationFixtureActionPlan();
  const second = loadVerifiedMutationFixtureActionPlan();
  const plan = parseActionPlan(first.bytes);

  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.reference));
  assert.notEqual(first.bytes, second.bytes);
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.reference.sha256, sha256Hex(first.bytes));
  assert.equal(first.reference.byte_length, first.bytes.byteLength);
  assert.equal(
    first.reference.media_type,
    "application/vnd.impactdiff.action-plan+json",
  );
  assert.equal(first.reference.format_version, 1);
  assert.equal(plan.actions.length, 1);
  assert.deepEqual(plan.actions[0], {
    action_id: "idst1_b76406caa92d8ceff3ca1dddcb9fce27c1bae84e6bf858efdf6cc811902d4e60",
    ordinal: 0,
    intent: "pointer_click",
    target_id: "idat1_b43885716a1a2b6a08a52610bdbf2b89de8feba4d1e6e4807e679f0c805a6010",
    value: { kind: "pointer", button: "primary" },
  });
  assert.deepEqual(plan.checkpoints, [
    { ordinal: 0, after_action_ordinal: -1 },
    { ordinal: 1, after_action_ordinal: 0 },
  ]);

  const changed = first.bytes as Uint8Array;
  changed[changed.byteLength - 1] = 0x20;
  assert.deepEqual(loadVerifiedMutationFixtureActionPlan().bytes, second.bytes);

  assert.equal(
    first.reference.sha256,
    "2334657b16ffa4ea97c2e84d73ae817592747fbc268158d5982116b71eb52656",
  );
  assert.equal(first.reference.byte_length, 411);
  assert.equal(
    computeTaskId(first.reference),
    "idtk1_4e16f8ff4995f234b0fd71b9c75610286e1b0d8be5c3f8f76729172665d09d26",
  );
});
