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
  "0d21e7336b74512b26a0d129d71834ae6a84c3953022c15d13ad33b1a0153391";

const goldenPlans = Object.freeze({
  add_bundle: Object.freeze({
    referenceSha256: "619153122740419f8fae9ea4ac1648bd8412ff8c7ecd379da76d1a9d29a6655e",
    byteLength: 1_025,
    taskId: "idtk1_97e8143bb0ec2b7f326cfe02793182f25110f7834b05dcae29eba2f066bf61a2",
    stepIds: Object.freeze([
      "idst1_f06b93f58ef1ea596ac4fe9fb1de21aea0ede66b9d077d50a1e2b18545513966",
      "idst1_2821e2ba7e5e0901d64d483b66aa0c8c7730e06bea28e6f7c4b016db383b92b7",
      "idst1_ef26c6ad4cde06bab82c7f3350ba70ec60b7fa1fc8656fb5f64e6d7fa9dc1be1",
      "idst1_7265bc2081b3f23636e335a73dd9a05cb61a46ab5486f6751418640d54e1dc1a",
    ]),
  }),
  choose_pickup: Object.freeze({
    referenceSha256: "9707420d01a113ead998a5b41508f91d5fb348b63d0a27aed44892623015b3ee",
    byteLength: 1_025,
    taskId: "idtk1_36fa89ee2d7f696299242821dcb214c3b7b1577944b63ae12098dd2c41d72b8a",
    stepIds: Object.freeze([
      "idst1_fc4e6be96406d370f3ba39a30cc5b959fac8117555af85e476f90d4a6df6ea1c",
      "idst1_b5446102b8b5ba4289152b4976b59d34e30df846e36c51d31985af827ba82991",
      "idst1_b960d69cff84aac9e0df22253fb6c44c4ea8323bb9860b144716d2434e92ca1e",
      "idst1_9f84065633cf4f6caaef7360487feea8431ae4a2a23e97a0d4ff65c16d3b364d",
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
    const first = artifact.bytes;
    const second = artifact.bytes;
    assert.notEqual(first, second);
    assert.deepEqual(first, second);
    const original = first[0];
    assert.notEqual(original, undefined);
    first[0] = (original ?? 0) ^ 0xff;
    assert.deepEqual(artifact.bytes, second);
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
