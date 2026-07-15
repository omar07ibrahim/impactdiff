import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { computeFixtureActionTargetId } from "../../src/capture/identity.js";
import { parseActionPlan } from "../../src/capture/validate.js";
import {
  canonicalJson,
  computeTaskId,
  sha256Hex,
} from "../../src/contracts/canonical.js";
import {
  buildPilotFixtureActionPlanArtifacts,
  type PilotFixtureActionPlanArtifact,
} from "../../src/pilot/fixture/action-plan.js";
import {
  computePilotFixtureActionStepId,
  type PilotFixtureActionStepIdentity,
} from "../../src/pilot/fixture/identity.js";
import type {
  PilotFixtureActionRecipe,
  PilotFixtureManifest,
  PilotFixtureWorkflow,
} from "../../src/pilot/fixture/schema.js";
import { parsePilotFixtureManifest } from "../../src/pilot/fixture/validate.js";

const fixtureManifestPath = "fixtures/pilot-market-basket-v1/fixture.json";
const goldenManifestSha256 =
  "8747c81b2aa1f6771ac0b0cc7ef25f4d3a103a0e14e0fedb4904003442f9df94";

const goldenPlans = Object.freeze({
  add_bundle: Object.freeze({
    referenceSha256: "bb03cf5b90f3fa7a09526e0f5dbe7eac5ffe026d36f0202a93bdff27229d5bed",
    byteLength: 1_025,
    taskId: "idtk1_79c6534b21c46bfabcb881f01a2a51bf72ccaf3d3d4a1215deef3285f8e4453f",
    stepIds: Object.freeze([
      "idst1_efa78313f323fc2bde87e280fab1b95bfd08eda5bfaead1c6257970656f30114",
      "idst1_aa81eab75dbef06cd07f8ffbe78e46869bba1850270611042669d9aead30d6c0",
      "idst1_6e99bb138f02eee6e54424aca8cab335f482414fe75d10eeae00bc7385034301",
      "idst1_84e5ed90688e182bec9432d262606f106ada5221a09aad85f77b0017d6b185e6",
    ]),
  }),
  choose_pickup: Object.freeze({
    referenceSha256: "665dee6a357c2ea8f746924ca19ac0c191a4e8d72597bb271dc52a0aeecdd567",
    byteLength: 1_025,
    taskId: "idtk1_ab2de7b7bfe7df885fbb0b8f7f4d6fe82828b2da578e14daace7cf146d23e8f9",
    stepIds: Object.freeze([
      "idst1_170183ceaca86032820efa1c23e9d1f867dd7d703e24352b8b29b038a9775f50",
      "idst1_9e6722d2eae1677dc25a569f366e411f1f24369b5490ac5d34fef7f3a64c64d1",
      "idst1_8e65ef14de28238a98461bfa4894cc9d6d69e9c3f5f5ef03dadc15f1bb38dbdb",
      "idst1_f366dd2cb18604edb50a2f24ef5810c6534f9c2598868532403945ffeea8cc02",
    ]),
  }),
} as const);

type GoldenPlan = (typeof goldenPlans)[keyof typeof goldenPlans];

function goldenPlanForWorkflow(workflowKey: string): GoldenPlan {
  if (workflowKey === "add_bundle") return goldenPlans.add_bundle;
  if (workflowKey === "choose_pickup") return goldenPlans.choose_pickup;
  throw new Error(`no golden action plan for workflow ${workflowKey}`);
}

interface LoadedPlans {
  readonly manifest: PilotFixtureManifest;
  readonly manifestSha256: string;
  readonly artifacts: readonly PilotFixtureActionPlanArtifact[];
}

async function loadActualPlans(): Promise<LoadedPlans> {
  const rawManifest = await readFile(fixtureManifestPath);
  const manifestSha256 = sha256Hex(rawManifest);
  const canonicalManifest =
    rawManifest.at(-1) === 0x0a
      ? rawManifest.subarray(0, rawManifest.byteLength - 1)
      : rawManifest;
  const manifest = parsePilotFixtureManifest(canonicalManifest);
  return Object.freeze({
    manifest,
    manifestSha256,
    artifacts: buildPilotFixtureActionPlanArtifacts(manifest, manifestSha256),
  });
}

function recipeLocator(
  workflow: PilotFixtureWorkflow,
  recipe: PilotFixtureActionRecipe,
): { readonly strategy: "test_id"; readonly value: string } | null {
  if (recipe.target === null) return null;
  return workflow.abi[recipe.target];
}

function expectedStepId(
  manifest: PilotFixtureManifest,
  manifestSha256: string,
  workflow: PilotFixtureWorkflow,
  recipe: PilotFixtureActionRecipe,
  ordinal: number,
): string {
  return computePilotFixtureActionStepId({
    protocol_id: manifest.protocol_id,
    fixture_id: manifest.fixture_key,
    fixture_revision: manifest.revision,
    fixture_manifest_sha256: manifestSha256,
    workflow_key: workflow.workflow_key,
    ordinal,
    intent: recipe.intent,
    locator: recipeLocator(workflow, recipe),
    value: recipe.value,
    pointer_source_point: recipe.pointer_source_point,
  });
}

function expectedTargetId(
  manifest: PilotFixtureManifest,
  manifestSha256: string,
  workflow: PilotFixtureWorkflow,
  recipe: PilotFixtureActionRecipe,
): string | null {
  const locator = recipeLocator(workflow, recipe);
  return locator === null
    ? null
    : computeFixtureActionTargetId({
        fixture_id: manifest.fixture_key,
        fixture_revision: manifest.revision,
        fixture_manifest_sha256: manifestSha256,
        locator,
      });
}

function assertDeepFrozen(value: unknown, path = "$", seen = new Set<object>()): void {
  if (
    value === null ||
    typeof value !== "object" ||
    ArrayBuffer.isView(value) ||
    seen.has(value)
  ) {
    return;
  }
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, `${path} must be frozen`);
  for (const key of Reflect.ownKeys(value)) {
    assertDeepFrozen(Reflect.get(value, key), `${path}/${String(key)}`, seen);
  }
}

function assertStandaloneDefensiveBytes(read: () => Uint8Array): void {
  const first = read();
  const second = read();
  assert.equal(Buffer.isBuffer(first), false);
  assert.equal(first.byteOffset, 0);
  assert.equal(first.buffer.byteLength, first.byteLength);
  assert.equal(second.byteOffset, 0);
  assert.equal(second.buffer.byteLength, second.byteLength);
  assert.notEqual(first, second);
  assert.notEqual(first.buffer, second.buffer);
  assert.deepEqual(first, second);

  new Uint8Array(first.buffer).fill(0);
  const protectedBytes = read();
  assert.notEqual(protectedBytes.buffer, first.buffer);
  assert.notEqual(protectedBytes.buffer, second.buffer);
  assert.deepEqual(protectedBytes, second);
}

test("the actual market-basket manifest derives two exact canonical action plans", async () => {
  const { manifest, manifestSha256, artifacts } = await loadActualPlans();

  assert.equal(manifestSha256, goldenManifestSha256);
  assert.deepEqual(
    manifest.workflows.map(({ workflow_key }) => workflow_key),
    ["add_bundle", "choose_pickup"],
  );
  assert.deepEqual(
    artifacts.map(({ workflow_key }) => workflow_key),
    ["add_bundle", "choose_pickup"],
  );
  assert.equal(artifacts.length, 2);

  const allStepIds: string[] = [];
  for (const [workflowIndex, workflow] of manifest.workflows.entries()) {
    const artifact = artifacts[workflowIndex];
    assert.ok(artifact !== undefined);
    const golden = goldenPlanForWorkflow(workflow.workflow_key);
    const plan = parseActionPlan(artifact.bytes);
    const expectedStepIds: string[] = workflow.actions.map((recipe, ordinal) =>
      expectedStepId(manifest, manifestSha256, workflow, recipe, ordinal),
    );
    allStepIds.push(...expectedStepIds);

    assert.deepEqual(expectedStepIds, golden.stepIds);
    assert.deepEqual(
      plan.actions,
      workflow.actions.map((recipe, ordinal) => ({
        action_id: golden.stepIds[ordinal],
        ordinal,
        intent: recipe.intent,
        target_id: expectedTargetId(manifest, manifestSha256, workflow, recipe),
        value: recipe.value,
      })),
    );
    assert.deepEqual(
      plan.actions.map(({ intent }) => intent),
      ["focus", "press_key", "press_key", "pointer_click"],
    );
    assert.equal(plan.actions[1]?.target_id, null);
    assert.equal(plan.actions[2]?.target_id, null);
    assert.deepEqual(
      plan.checkpoints.map(({ after_action_ordinal }) => after_action_ordinal),
      [-1, 2, 3],
    );
    assert.equal(Buffer.from(artifact.bytes).toString("utf8"), canonicalJson(plan));

    assert.equal(artifact.reference.sha256, sha256Hex(artifact.bytes));
    assert.equal(artifact.reference.sha256, golden.referenceSha256);
    assert.equal(artifact.reference.byte_length, artifact.bytes.byteLength);
    assert.equal(artifact.reference.byte_length, golden.byteLength);
    assert.equal(
      artifact.reference.media_type,
      "application/vnd.impactdiff.action-plan+json",
    );
    assert.equal(artifact.reference.format_version, 1);
    assert.equal(artifact.task_id, computeTaskId(artifact.reference));
    assert.equal(artifact.task_id, golden.taskId);

    assertDeepFrozen(plan, `plan/${workflow.workflow_key}`);
    assertDeepFrozen(artifact, `artifact/${workflow.workflow_key}`);
  }

  assert.equal(new Set(allStepIds).size, 8);
  assert.notEqual(allStepIds[1], allStepIds[5]);
  assert.notEqual(allStepIds[2], allStepIds[6]);
  assertDeepFrozen(manifest, "manifest");
  assertDeepFrozen(artifacts, "artifacts");
});

test("action-plan artifacts expose immutable metadata and defensive byte copies", async () => {
  const { artifacts } = await loadActualPlans();

  for (const artifact of artifacts) {
    assertStandaloneDefensiveBytes(() => artifact.bytes);
    assert.ok(Object.isFrozen(artifact));
    assert.ok(Object.isFrozen(artifact.reference));
  }
});

test("step identity commits independently to every authoring input", async () => {
  const { manifest, manifestSha256 } = await loadActualPlans();
  const workflow = manifest.workflows[0];
  const recipe = workflow?.actions[3];
  assert.ok(workflow !== undefined && recipe !== undefined);
  const locator = recipeLocator(workflow, recipe);
  assert.ok(locator !== null);

  const base = {
    protocol_id: manifest.protocol_id,
    fixture_id: manifest.fixture_key,
    fixture_revision: manifest.revision,
    fixture_manifest_sha256: manifestSha256,
    workflow_key: workflow.workflow_key,
    ordinal: 3,
    intent: recipe.intent,
    locator,
    value: recipe.value,
    pointer_source_point: recipe.pointer_source_point,
  } as const satisfies PilotFixtureActionStepIdentity;
  const variants = [
    { ...base, protocol_id: `idpp1_${"f".repeat(64)}` },
    { ...base, fixture_revision: `${manifest.revision}.changed` },
    { ...base, fixture_manifest_sha256: "f".repeat(64) },
    { ...base, workflow_key: "changed_workflow" },
    { ...base, ordinal: 4 },
    { ...base, intent: "focus" as const },
    {
      ...base,
      locator: { strategy: "test_id" as const, value: "changed-target" },
    },
    { ...base, value: { kind: "none" as const } },
    { ...base, pointer_source_point: null },
  ] satisfies readonly PilotFixtureActionStepIdentity[];

  const baseId = computePilotFixtureActionStepId(base);
  const changedIds = variants.map(computePilotFixtureActionStepId);
  assert.equal(baseId, goldenPlans.add_bundle.stepIds[3]);
  assert.equal(new Set([baseId, ...changedIds]).size, variants.length + 1);
});

test("action-plan construction rejects a noncanonical manifest digest", async () => {
  const { manifest } = await loadActualPlans();
  for (const digest of [
    "",
    "a".repeat(63),
    "A".repeat(64),
    "g".repeat(64),
    undefined as unknown as string,
  ]) {
    assert.throws(
      () => buildPilotFixtureActionPlanArtifacts(manifest, digest),
      /fixture manifest SHA-256 must be 64 lowercase hex digits/u,
    );
  }
});
