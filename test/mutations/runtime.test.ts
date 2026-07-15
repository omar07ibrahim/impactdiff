import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";

import { chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

import { canonicalizePng } from "../../src/artifacts/png.js";
import {
  assertCaptureGraphBindings,
  computeFixtureActionTargetId,
  normalizeAccessibilitySnapshot,
  parseActionPlan,
  parseAccessibilitySnapshot,
  parseLayoutSnapshot,
} from "../../src/capture/index.js";
import {
  canonicalJson,
  computeCheckpointId,
  computeSourceStateId,
  computeTaskId,
  sha256Hex,
} from "../../src/contracts/canonical.js";
import {
  applyCompiledMutation,
  compileMutation,
  computeMutationTargetNodeId,
  executeMutationFixtureTask,
  loadVerifiedMutationFixtureSourceState,
  MutationRuntimeError,
  openMutationFixtureSession,
  prepareMutationFixtureTask,
  probeMutation,
  validateMutationRequest,
  validateMutationRuntimeBinding,
} from "../../src/mutations/index.js";
import type {
  MutationCleanup,
  MutationCompileResult,
  MutationFixtureSession,
  MutationRequest,
} from "../../src/mutations/index.js";

const fixtureDirectory = resolve("fixtures/checkout-card-v1");
const fixtureOrigin = "https://fixture.impactdiff.invalid";
const fixedEpochMs = 1_735_689_600_000;
const viewport = Object.freeze({ width: 800, height: 600 });

const hex = (character: string): string => character.repeat(64);
const id = (prefix: string, character: string): string => `${prefix}${hex(character)}`;
const primaryActionTargetId = computeFixtureActionTargetId({
  fixture_id: "checkout-card-v1",
  fixture_revision: "checkout-card-v1.0.0",
  fixture_manifest_sha256:
    "3b8a3f79a15969e575e0d4ace4a98b7a89704840cb1b2a818c06e03e5cc4e9ea",
  locator: { strategy: "test_id", value: "place-order" },
});
const actionPlan = Object.freeze({
  contract: "impactdiff.action-plan",
  version: 1,
  actions: [
    {
      action_id: id("idst1_", "1"),
      ordinal: 0,
      intent: "pointer_click",
      target_id: primaryActionTargetId,
      value: { kind: "pointer", button: "primary" },
    },
  ],
  checkpoints: [
    { ordinal: 0, after_action_ordinal: -1 },
    { ordinal: 1, after_action_ordinal: 0 },
  ],
});
const actionPlanBytes = Buffer.from(canonicalJson(actionPlan), "utf8");
const parsedActionPlan = parseActionPlan(actionPlanBytes);
const actionPlanReference = Object.freeze({
  sha256: sha256Hex(actionPlanBytes),
  byte_length: actionPlanBytes.byteLength,
  media_type: "application/vnd.impactdiff.action-plan+json",
  format_version: 1 as const,
});
const sourceState = Object.freeze({
  contract: "impactdiff.source-state",
  version: 1,
  source: Object.freeze({
    kind: "closed_fixture",
    fixture_id: "checkout-card-v1",
    revision: "checkout-card-v1.0.0",
    license: "Apache-2.0",
    entrypoint: "index.html",
    raw_manifest: Object.freeze({
      sha256: "3b8a3f79a15969e575e0d4ace4a98b7a89704840cb1b2a818c06e03e5cc4e9ea",
      byte_length: 1_819,
    }),
    resources: [
      {
        path: "app.js",
        media_type: "text/javascript; charset=utf-8",
        sha256: "9e63523f982ff8f71276ed7137f098198750f2cdde2a811fcd1678087aa4bf60",
        byte_length: 1_185,
        license: "Apache-2.0",
      },
      {
        path: "fonts/OFL-1.1.txt",
        media_type: "text/plain; charset=utf-8",
        sha256: "54ec7b5a35310ad66f9f3091426f7028484cbf9ae1ab5da30122ee412a3009e1",
        byte_length: 4_518,
        license: "OFL-1.1",
      },
      {
        path: "fonts/noto-sans-latin-standard-normal.woff2",
        media_type: "font/woff2",
        sha256: "df8c8215937ab2a4270c0cd997101b3fb8cdd444c9903d342200d6179ebcc097",
        byte_length: 59_928,
        license: "OFL-1.1",
      },
      {
        path: "index.html",
        media_type: "text/html; charset=utf-8",
        sha256: "325a67d957557b9e766c23f53f6d8c71e64f03cea06f1f752ae1a6195efdfd40",
        byte_length: 4_899,
        license: "Apache-2.0",
      },
      {
        path: "styles.css",
        media_type: "text/css; charset=utf-8",
        sha256: "ea32617a0be3b2d3c73dae0a31a7d198e2e0f758f0d0c18a9bc60e7f793fcb9d",
        byte_length: 6_349,
        license: "Apache-2.0",
      },
    ],
  }),
  initial_state: Object.freeze({
    kind: "fixture_default",
    route: "/",
    storage: "empty",
  }),
});
const sourceStateBytes = Buffer.from(canonicalJson(sourceState), "utf8");
const sourceStateReference = Object.freeze({
  sha256: sha256Hex(sourceStateBytes),
  byte_length: sourceStateBytes.byteLength,
  media_type: "application/vnd.impactdiff.source-state+json",
  format_version: 1 as const,
});
const sourceStateId = computeSourceStateId(sourceStateReference);
const upstreamEvidence = Object.freeze({
  environment_id: id("iden1_", "3"),
  source_state: Object.freeze({
    reference: sourceStateReference,
    bytes: sourceStateBytes,
  }),
  action_plan: Object.freeze({
    reference: actionPlanReference,
    bytes: actionPlanBytes,
  }),
});
const taskId = computeTaskId(actionPlanReference);

function upstreamEvidenceForActionPlan(value: unknown) {
  const bytes = Buffer.from(canonicalJson(value), "utf8");
  return {
    environment_id: upstreamEvidence.environment_id,
    source_state: upstreamEvidence.source_state,
    action_plan: {
      reference: {
        sha256: sha256Hex(bytes),
        byte_length: bytes.byteLength,
        media_type: "application/vnd.impactdiff.action-plan+json",
        format_version: 1 as const,
      },
      bytes,
    },
  };
}

interface RawAxValue {
  readonly value?: unknown;
}

interface RawAxProperty {
  readonly name: string;
  readonly value?: RawAxValue;
}

interface RawAxNode {
  readonly ignored?: boolean;
  readonly backendDOMNodeId?: number;
  readonly role?: RawAxValue;
  readonly name?: RawAxValue;
  readonly description?: RawAxValue;
  readonly value?: RawAxValue;
  readonly properties?: readonly RawAxProperty[];
}

let browser: Browser | undefined;

before(async () => {
  browser = await chromium.launch({ headless: true });
  assert.equal(browser.version(), "149.0.7827.55");
});

after(async () => {
  await browser?.close();
});

async function fixtureSession(): Promise<MutationFixtureSession> {
  assert.ok(browser, "Chromium must be launched before a fixture session");
  return openMutationFixtureSession(browser, fixtureDirectory, upstreamEvidence);
}

function mutationRequest(
  operatorKey: MutationRequest["operator_key"],
): MutationRequest {
  const locator = {
    strategy: "test_id" as const,
    value: operatorKey === "palette_swap" ? "app-root" : "place-order",
  };
  return validateMutationRequest({
    contract: "impactdiff.mutation-request",
    version: 1,
    source_state_id: sourceStateId,
    task_id: taskId,
    environment_id: id("iden1_", "3"),
    operator_key: operatorKey,
    operator_version: 1,
    replicate_index: 0,
    target: {
      node_id: computeMutationTargetNodeId(sourceStateId, locator),
      locator,
    },
  });
}

async function applicableCompilation(
  session: MutationFixtureSession,
  operatorKey: MutationRequest["operator_key"],
): Promise<Extract<MutationCompileResult, { readonly status: "applicable" }>> {
  if (operatorKey === "pointer_interceptor") {
    await session.page.getByTestId("place-order").scrollIntoViewIfNeeded();
  }
  const request = mutationRequest(operatorKey);
  const probe = await probeMutation(session, request);
  const result = compileMutation(request, probe);
  assert.equal(result.status, "applicable");
  if (result.status !== "applicable") {
    throw new Error(`${operatorKey} unexpectedly failed its fixture preconditions`);
  }
  return result;
}

async function canonicalScreenshot(page: Page): Promise<Buffer> {
  const screenshot = await page.screenshot({
    type: "png",
    fullPage: false,
    animations: "disabled",
    caret: "hide",
    scale: "css",
    omitBackground: false,
  });
  return canonicalizePng(screenshot, viewport).bytes;
}

function axPrimitive(value: RawAxValue | undefined): unknown {
  const primitive = value?.value;
  if (
    primitive === null ||
    typeof primitive === "string" ||
    typeof primitive === "number" ||
    typeof primitive === "boolean"
  ) {
    return primitive;
  }
  return null;
}

async function semanticAxSnapshot(page: Page): Promise<unknown> {
  const session = await page.context().newCDPSession(page);
  try {
    const response = (await session.send("Accessibility.getFullAXTree")) as {
      readonly nodes: readonly RawAxNode[];
    };
    return response.nodes
      .filter((node) => node.ignored !== true)
      .map((node) => ({
        role: axPrimitive(node.role),
        name: axPrimitive(node.name),
        description: axPrimitive(node.description),
        value: axPrimitive(node.value),
        properties: (node.properties ?? [])
          .map((property) => ({
            name: property.name,
            value: axPrimitive(property.value),
          }))
          .sort((left, right) =>
            left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
          ),
      }));
  } finally {
    await session.detach();
  }
}

async function clickPrimaryActionAtCenter(page: Page): Promise<boolean> {
  const target = page.getByTestId("place-order");
  await target.scrollIntoViewIfNeeded();
  const bounds = await target.boundingBox();
  assert.ok(bounds, "the task action must have a browser bounding box");
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  return page.getByTestId("order-confirmation").isVisible();
}

async function expectRuntimeError(
  action: Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof MutationRuntimeError);
    assert.equal(error.code, code);
    return true;
  });
}

async function closeSession(
  session: MutationFixtureSession,
  expectedBlockedExternalRequests: readonly string[] = [],
): Promise<void> {
  const audit = await session.close();
  assert.equal(
    audit.fixture_manifest_sha256,
    "3b8a3f79a15969e575e0d4ace4a98b7a89704840cb1b2a818c06e03e5cc4e9ea",
  );
  assert.deepEqual(audit.served_resources, [
    "index.html",
    "styles.css",
    "app.js",
    "fonts/noto-sans-latin-standard-normal.woff2",
  ]);
  assert.deepEqual(audit.blocked_external_requests, expectedBlockedExternalRequests);
}

test("baseline task uses a true coordinate click and the fixture route aborts external traffic", async () => {
  const session = await fixtureSession();
  try {
    assert.ok(Object.isFrozen(session.binding));
    assert.ok(Object.isFrozen(session.binding.action_plan));
    assert.equal(session.binding.task_id, taskId);
    assert.deepEqual(session.binding.action_plan, actionPlanReference);
    assert.equal(session.binding.source_state_id, sourceStateId);
    assert.deepEqual(session.binding.source_state, sourceStateReference);
    assert.equal(session.binding.primary_action_target_id, primaryActionTargetId);
    const firstTime = await session.page.evaluate(() => Date.now());
    await new Promise<void>((resolveDelay) => {
      setTimeout(resolveDelay, 25);
    });
    const secondTime = await session.page.evaluate(() => Date.now());
    assert.equal(firstTime, fixedEpochMs);
    assert.equal(secondTime, fixedEpochMs);
    assert.equal(await clickPrimaryActionAtCenter(session.page), true);
    assert.equal(
      await session.page.getByTestId("app-root").getAttribute("data-state"),
      "confirmed",
    );

    const externalPage = await session.page.context().newPage();
    try {
      await assert.rejects(externalPage.goto("https://outside.impactdiff.invalid/"));
    } finally {
      await externalPage.close();
    }
  } finally {
    await closeSession(session, ["https://outside.impactdiff.invalid/"]);
  }
});

test("pinned Chromium AX output normalizes through the closed accessibility contract", async () => {
  const session = await fixtureSession();
  const client = await session.page.context().newCDPSession(session.page);
  try {
    const response = (await client.send("Accessibility.getFullAXTree")) as {
      readonly nodes: readonly RawAxNode[];
    };
    const backendDomNodeIds = [
      ...new Set(
        response.nodes.flatMap((node) =>
          node.backendDOMNodeId === undefined ? [] : [node.backendDOMNodeId],
        ),
      ),
    ].sort((left, right) => left - right);
    const temporaryLayoutMap = new Map(
      backendDomNodeIds.map((backendDomNodeId, index) => [backendDomNodeId, index]),
    );
    const normalized = normalizeAccessibilitySnapshot(response, temporaryLayoutMap);
    const roles = new Set(normalized.nodes.map((node) => node.role));

    assert.ok(normalized.nodes.length >= 20);
    assert.equal(normalized.nodes[0]?.role, "document");
    for (const expectedRole of ["button", "heading", "list", "main"] as const) {
      assert.ok(roles.has(expectedRole), `missing normalized role ${expectedRole}`);
    }
    assert.ok(
      normalized.nodes.some(
        (node) => node.role === "button" && node.name === "Place order",
      ),
    );
  } finally {
    await client.detach();
    await closeSession(session);
  }
});

test("authenticated task capture emits deterministic canonical checkpoints", async () => {
  const runs = [];
  for (let replicate = 0; replicate < 2; replicate += 1) {
    const session = await fixtureSession();
    try {
      await prepareMutationFixtureTask(session);
      const run = await executeMutationFixtureTask(session);
      assert.equal(run.task_success, true);
      assert.equal(run.first_unsatisfied_step_id, null);
      assert.equal(run.virtual_elapsed_ms, 0);
      assert.equal(run.checkpoints.length, 2);
      assert.equal(Object.isFrozen(run), true);

      for (const [ordinal, checkpoint] of run.checkpoints.entries()) {
        assert.equal(Object.isFrozen(checkpoint), true);
        assert.equal(checkpoint.ordinal, ordinal);
        assert.equal(
          checkpoint.checkpoint_id,
          computeCheckpointId(actionPlanReference, ordinal),
        );
        assert.deepEqual(
          canonicalizePng(checkpoint.screenshot, viewport).bytes,
          checkpoint.screenshot,
        );
        const accessibility = parseAccessibilitySnapshot(checkpoint.accessibility_tree);
        const layout = parseLayoutSnapshot(checkpoint.layout_graph);
        assertCaptureGraphBindings(parsedActionPlan, accessibility, layout);
        const targets = layout.nodes.filter(
          (node) => node.action_target_id === primaryActionTargetId,
        );
        assert.equal(targets.length, ordinal === 0 ? 1 : 0);
      }
      const mutableScreenshot = run.checkpoints[0].screenshot;
      const mutableAccessibility = run.checkpoints[0].accessibility_tree;
      const mutableLayout = run.checkpoints[0].layout_graph;
      mutableScreenshot[0] = 0;
      mutableAccessibility[0] = 0;
      mutableLayout[0] = 0;
      assert.notDeepEqual(mutableScreenshot, run.checkpoints[0].screenshot);
      assert.notDeepEqual(mutableAccessibility, run.checkpoints[0].accessibility_tree);
      assert.notDeepEqual(mutableLayout, run.checkpoints[0].layout_graph);
      canonicalizePng(run.checkpoints[0].screenshot, viewport);
      parseAccessibilitySnapshot(run.checkpoints[0].accessibility_tree);
      parseLayoutSnapshot(run.checkpoints[0].layout_graph);
      runs.push(run);
    } finally {
      await closeSession(session);
    }
  }

  assert.equal(runs.length, 2);
  for (const ordinal of [0, 1] as const) {
    assert.deepEqual(
      runs[0]?.checkpoints[ordinal].screenshot,
      runs[1]?.checkpoints[ordinal].screenshot,
    );
    assert.deepEqual(
      runs[0]?.checkpoints[ordinal].accessibility_tree,
      runs[1]?.checkpoints[ordinal].accessibility_tree,
    );
    assert.deepEqual(
      runs[0]?.checkpoints[ordinal].layout_graph,
      runs[1]?.checkpoints[ordinal].layout_graph,
    );
  }
});

test("captured task outcomes distinguish preserving and breaking mutations", async () => {
  for (const [operatorKey, expectedSuccess] of [
    ["palette_swap", true],
    ["pointer_interceptor", false],
  ] as const) {
    const session = await fixtureSession();
    let cleanup: MutationCleanup | undefined;
    try {
      await prepareMutationFixtureTask(session);
      const compilation = await applicableCompilation(session, operatorKey);
      cleanup = await applyCompiledMutation(
        session,
        compilation.plan,
        compilation.preconditions,
      );
      const run = await executeMutationFixtureTask(session);
      assert.equal(run.task_success, expectedSuccess);
      assert.equal(
        run.first_unsatisfied_step_id,
        expectedSuccess ? null : parsedActionPlan.actions[0]?.action_id,
      );

      const initialLayout = parseLayoutSnapshot(run.checkpoints[0].layout_graph);
      const finalLayout = parseLayoutSnapshot(run.checkpoints[1].layout_graph);
      assert.equal(
        initialLayout.nodes.filter(
          (node) => node.action_target_id === primaryActionTargetId,
        ).length,
        1,
      );
      assert.equal(
        finalLayout.nodes.filter(
          (node) => node.action_target_id === primaryActionTargetId,
        ).length,
        expectedSuccess ? 0 : 1,
      );
    } finally {
      await cleanup?.();
      await closeSession(session);
    }
  }
});

test("task capture enforces its phase, geometry, plan, and operation lock", async () => {
  const session = await fixtureSession();
  try {
    await expectRuntimeError(
      executeMutationFixtureTask(session),
      "mutation.capture_phase",
    );
    await prepareMutationFixtureTask(session);
    await expectRuntimeError(
      prepareMutationFixtureTask(session),
      "mutation.capture_phase",
    );

    const runPromise = executeMutationFixtureTask(session);
    await expectRuntimeError(
      probeMutation(session, mutationRequest("palette_swap")),
      "mutation.concurrent_operation",
    );
    assert.equal((await runPromise).task_success, true);
  } finally {
    await closeSession(session);
  }

  const drifted = await fixtureSession();
  try {
    await prepareMutationFixtureTask(drifted);
    await drifted.page.evaluate(() => window.scrollBy(0, -1));
    await expectRuntimeError(
      executeMutationFixtureTask(drifted),
      "mutation.capture_geometry_drift",
    );
    await expectRuntimeError(
      executeMutationFixtureTask(drifted),
      "mutation.capture_phase",
    );
  } finally {
    await closeSession(drifted);
  }

  const extraActionPlan = {
    ...actionPlan,
    actions: [
      ...actionPlan.actions,
      {
        action_id: id("idst1_", "2"),
        ordinal: 1,
        intent: "press_key",
        target_id: null,
        value: { kind: "key", key: "Enter" },
      },
    ],
    checkpoints: [
      { ordinal: 0, after_action_ordinal: -1 },
      { ordinal: 1, after_action_ordinal: 1 },
    ],
  };
  assert.ok(browser);
  const unsupported = await openMutationFixtureSession(
    browser,
    fixtureDirectory,
    upstreamEvidenceForActionPlan(extraActionPlan),
  );
  try {
    await expectRuntimeError(
      prepareMutationFixtureTask(unsupported),
      "mutation.capture_action_plan",
    );
  } finally {
    await closeSession(unsupported);
  }
});

test("factory rejects changed manifest bytes, resources, and directory members", async () => {
  assert.ok(browser);
  for (const [name, mutate, code] of [
    [
      "manifest",
      async (directory: string) => {
        const path = join(directory, "fixture.json");
        const bytes = await readFile(path);
        bytes[0] = bytes[0] === 0x7b ? 0x5b : 0x7b;
        await writeFile(path, bytes);
      },
      "mutation.fixture_resource",
    ],
    [
      "resource",
      async (directory: string) => {
        const path = join(directory, "app.js");
        const bytes = await readFile(path);
        bytes[0] = bytes[0] === 0x22 ? 0x27 : 0x22;
        await writeFile(path, bytes);
      },
      "mutation.fixture_resource",
    ],
    [
      "extra-file",
      async (directory: string) => {
        await writeFile(join(directory, "canary.txt"), "canary", "utf8");
      },
      "mutation.fixture_directory",
    ],
  ] as const) {
    const temporaryRoot = await mkdtemp(join(tmpdir(), `impactdiff-${name}-`));
    const copied = join(temporaryRoot, "fixture");
    try {
      await cp(fixtureDirectory, copied, { recursive: true });
      await mutate(copied);
      await expectRuntimeError(
        openMutationFixtureSession(browser, copied, upstreamEvidence),
        code,
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
});

test("factory binds task identity to exact canonical action-plan bytes and target mapping", async () => {
  assert.ok(browser);
  const wrongTargetPlan = structuredClone(actionPlan);
  wrongTargetPlan.actions[0]!.target_id = id("idat1_", "f");
  await expectRuntimeError(
    openMutationFixtureSession(
      browser,
      fixtureDirectory,
      upstreamEvidenceForActionPlan(wrongTargetPlan),
    ),
    "mutation.action_plan_target",
  );

  const wrongBytes = Buffer.from(actionPlanBytes);
  wrongBytes[wrongBytes.byteLength - 1] = 0x20;
  await expectRuntimeError(
    openMutationFixtureSession(browser, fixtureDirectory, {
      ...upstreamEvidence,
      action_plan: { reference: actionPlanReference, bytes: wrongBytes },
    }),
    "mutation.action_plan_reference",
  );
  await expectRuntimeError(
    openMutationFixtureSession(browser, fixtureDirectory, {
      ...upstreamEvidence,
      action_plan: {
        reference: { ...actionPlanReference, sha256: hex("f") },
        bytes: actionPlanBytes,
      },
    }),
    "mutation.action_plan_reference",
  );
  assert.throws(
    () =>
      validateMutationRuntimeBinding({
        ...upstreamEvidence,
        task_id: id("idtk1_", "f"),
      }),
    (error: unknown) =>
      error instanceof MutationRuntimeError && error.code === "mutation.binding_shape",
  );
});

test("factory derives source identity from exact sealed provenance bytes", async () => {
  assert.ok(browser);
  const wrongBytes = Buffer.from(sourceStateBytes);
  wrongBytes[wrongBytes.byteLength - 1] = 0x20;
  await expectRuntimeError(
    openMutationFixtureSession(browser, fixtureDirectory, {
      ...upstreamEvidence,
      source_state: { reference: sourceStateReference, bytes: wrongBytes },
    }),
    "mutation.source_state_reference",
  );

  const changedState = {
    ...sourceState,
    initial_state: { ...sourceState.initial_state, route: "/changed" },
  };
  const changedBytes = Buffer.from(canonicalJson(changedState), "utf8");
  const changedReference = {
    ...sourceStateReference,
    sha256: sha256Hex(changedBytes),
    byte_length: changedBytes.byteLength,
  };
  await expectRuntimeError(
    openMutationFixtureSession(browser, fixtureDirectory, {
      ...upstreamEvidence,
      source_state: { reference: changedReference, bytes: changedBytes },
    }),
    "mutation.source_state_fixture",
  );

  assert.throws(
    () =>
      validateMutationRuntimeBinding({
        ...upstreamEvidence,
        source_state_id: id("idss1_", "f"),
      }),
    (error: unknown) =>
      error instanceof MutationRuntimeError && error.code === "mutation.binding_shape",
  );
});

test("verified fixture loader emits the exact reusable source-state artifact", async () => {
  const artifact = await loadVerifiedMutationFixtureSourceState(fixtureDirectory);
  assert.deepEqual(artifact.reference, sourceStateReference);
  assert.deepEqual(artifact.bytes, sourceStateBytes);
  assert.equal(artifact.reference.byte_length, 1_322);
  assert.equal(
    artifact.reference.sha256,
    "dfb68f22b93c901389d52a57275e5bfa3cd52113b637e0cf94f54289b909d891",
  );
  assert.equal(
    computeSourceStateId(artifact.reference),
    "idss1_141b99be1e1955be93cffe9b90a5574d3519c060ee020e988abcc8abc662e66b",
  );
  assert.notEqual(artifact.bytes, sourceStateBytes);
  assert.ok(Object.isFrozen(artifact));

  const copiedBytes = artifact.bytes as Uint8Array;
  copiedBytes[copiedBytes.byteLength - 1] = 0x20;
  const second = await loadVerifiedMutationFixtureSourceState(fixtureDirectory);
  assert.deepEqual(second.bytes, sourceStateBytes);
});

test("runtime provenance rejects unbranded sessions, caller targets, and mismatched IDs", async () => {
  const session = await fixtureSession();
  assert.ok(browser);
  const unbrandedPage = await browser.newPage();
  try {
    const pointerRequest = mutationRequest("pointer_interceptor");
    await expectRuntimeError(
      probeMutation(unbrandedPage as unknown as MutationFixtureSession, pointerRequest),
      "mutation.untrusted_session",
    );
    const forgedSession = Object.assign(
      Object.create(Object.getPrototypeOf(session)) as object,
      { page: session.page, binding: session.binding },
    );
    await expectRuntimeError(
      probeMutation(forgedSession as MutationFixtureSession, pointerRequest),
      "mutation.untrusted_session",
    );

    assert.throws(
      () =>
        validateMutationRuntimeBinding({
          ...upstreamEvidence,
          task_relevant_target_node_ids: [pointerRequest.target.node_id],
        }),
      (error: unknown) =>
        error instanceof MutationRuntimeError &&
        error.code === "mutation.binding_shape",
    );
    const sourceStateId = id("idss1_", "4");
    const changedSourceRequest = validateMutationRequest({
      ...pointerRequest,
      source_state_id: sourceStateId,
      target: {
        ...pointerRequest.target,
        node_id: computeMutationTargetNodeId(
          sourceStateId,
          pointerRequest.target.locator,
        ),
      },
    });
    for (const changedRequest of [
      changedSourceRequest,
      validateMutationRequest({
        ...pointerRequest,
        task_id: id("idtk1_", "4"),
      }),
      validateMutationRequest({
        ...pointerRequest,
        environment_id: id("iden1_", "4"),
      }),
    ]) {
      await expectRuntimeError(
        probeMutation(session, changedRequest),
        "mutation.binding_request",
      );
    }

    const wrongLocator = {
      strategy: "test_id" as const,
      value: "app-root",
    };
    const unsupported = validateMutationRequest({
      ...pointerRequest,
      target: {
        locator: wrongLocator,
        node_id: computeMutationTargetNodeId(
          pointerRequest.source_state_id,
          wrongLocator,
        ),
      },
    });
    await expectRuntimeError(
      probeMutation(session, unsupported),
      "mutation.unsupported_target",
    );
  } finally {
    await unbrandedPage.close();
    await closeSession(session);
  }
});

test("session serializes operations so close cannot race an in-flight audit", async () => {
  const session = await fixtureSession();
  const request = mutationRequest("pointer_interceptor");
  const inFlightProbe = probeMutation(session, request);
  await expectRuntimeError(
    probeMutation(session, request),
    "mutation.concurrent_operation",
  );
  await expectRuntimeError(session.close(), "mutation.concurrent_operation");
  const probe = await inFlightProbe;
  assert.equal(probe.target.used_by_task, true);
  await closeSession(session);
});

test("session audit records external aborts and rejects internal network taint", async (t) => {
  await t.test("external origin is aborted and reported", async () => {
    const session = await fixtureSession();
    const externalPage = await session.page.context().newPage();
    try {
      await assert.rejects(
        externalPage.goto("https://outside.impactdiff.invalid/audit"),
      );
    } finally {
      await externalPage.close();
    }
    await closeSession(session, ["https://outside.impactdiff.invalid/audit"]);
  });

  await t.test("unknown same-origin resource taints close", async () => {
    const session = await fixtureSession();
    const unexpectedPage = await session.page.context().newPage();
    try {
      await assert.rejects(unexpectedPage.goto(`${fixtureOrigin}/unknown.js`));
    } finally {
      await unexpectedPage.close();
    }
    await expectRuntimeError(session.close(), "mutation.session_tainted");
  });

  await t.test("removing the route cannot bypass the request audit", async () => {
    const session = await fixtureSession();
    await session.page.context().unrouteAll({ behavior: "wait" });
    const externalPage = await session.page.context().newPage();
    try {
      await assert.rejects(
        externalPage.goto("https://outside.impactdiff.invalid/unrouted"),
      );
    } finally {
      await externalPage.close();
    }
    await expectRuntimeError(session.close(), "mutation.session_tainted");
  });
});

test("CSP enforcement blocks unsafe inline style and taints the audited session", async () => {
  const session = await fixtureSession();
  const blocked = await session.page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = ":root { --impactdiff-unsafe-canary: applied; }";
    document.head.append(style);
    const applied = getComputedStyle(document.documentElement)
      .getPropertyValue("--impactdiff-unsafe-canary")
      .trim();
    const hasSheet = style.sheet !== null;
    style.remove();
    return !hasSheet && applied === "";
  });
  assert.equal(blocked, true);
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, 25);
  });
  await expectRuntimeError(session.close(), "mutation.session_tainted");
});

test("replacing the branded document invalidates the session provenance", async () => {
  const session = await fixtureSession();
  await session.page.evaluate(() => {
    const replacement = document.createElement("html");
    replacement.innerHTML =
      '<head></head><body><button data-testid="place-order">forged</button></body>';
    document.documentElement.replaceWith(replacement);
  });
  await expectRuntimeError(
    probeMutation(session, mutationRequest("pointer_interceptor")),
    "mutation.untrusted_document",
  );
  await expectRuntimeError(session.close(), "mutation.session_tainted");
});

test("replacing a retained fixture target inside the same document is rejected", async () => {
  const session = await fixtureSession();
  await session.page.getByTestId("place-order").evaluate((target) => {
    target.replaceWith(target.cloneNode(true));
  });
  await expectRuntimeError(
    probeMutation(session, mutationRequest("pointer_interceptor")),
    "mutation.untrusted_document",
  );
  await expectRuntimeError(session.close(), "mutation.session_tainted");
});

test("in-place critical content and CSSOM tampering are rejected", async (t) => {
  await t.test("text tamper restored before probing is still audited", async () => {
    const session = await fixtureSession();
    await session.page.getByTestId("place-order").evaluate((target) => {
      const original = target.textContent;
      target.textContent = "Forged action";
      target.textContent = original;
    });
    await expectRuntimeError(
      probeMutation(session, mutationRequest("pointer_interceptor")),
      "mutation.document_integrity",
    );
    await expectRuntimeError(session.close(), "mutation.session_tainted");
  });

  await t.test(
    "persistent stylesheet rule mutation changes the integrity digest",
    async () => {
      const session = await fixtureSession();
      await session.page.evaluate(() => {
        const sheet = document.styleSheets[0];
        if (sheet === undefined) throw new Error("fixture stylesheet is absent");
        sheet.insertRule('[data-testid="place-order"] { opacity: 0.4; }');
      });
      await expectRuntimeError(
        probeMutation(session, mutationRequest("pointer_interceptor")),
        "mutation.document_integrity",
      );
      await expectRuntimeError(session.close(), "mutation.session_tainted");
    },
  );
});

test("palette mutation changes canonical pixels, restores exactly, and preserves the task", async () => {
  const session = await fixtureSession();
  try {
    const compilation = await applicableCompilation(session, "palette_swap");
    const baseline = await canonicalScreenshot(session.page);
    const cleanup = await applyCompiledMutation(
      session,
      compilation.plan,
      compilation.preconditions,
    );
    const changed = await canonicalScreenshot(session.page);
    assert.notDeepEqual(changed, baseline);
    await cleanup();
    assert.deepEqual(await canonicalScreenshot(session.page), baseline);
    assert.equal(await session.page.locator("head > style").count(), 0);

    const taskCleanup = await applyCompiledMutation(
      session,
      compilation.plan,
      compilation.preconditions,
    );
    try {
      assert.equal(await clickPrimaryActionAtCenter(session.page), true);
    } finally {
      await taskCleanup();
    }
    assert.equal(
      await session.page
        .getByTestId("app-root")
        .evaluate((root) => getComputedStyle(root).getPropertyValue("--canvas").trim()),
      "#f4f0e8",
    );
  } finally {
    await closeSession(session);
  }
});

test("active owned CSSOM tampering is detected before it can be reused", async () => {
  const session = await fixtureSession();
  const compilation = await applicableCompilation(session, "palette_swap");
  const cleanup = await applyCompiledMutation(
    session,
    compilation.plan,
    compilation.preconditions,
  );
  await session.page.locator("head > style").evaluate((style) => {
    if (!(style instanceof HTMLStyleElement) || style.sheet === null) {
      throw new Error("owned palette stylesheet is unavailable");
    }
    style.sheet.insertRule("body { outline: 1px solid transparent; }");
  });
  await expectRuntimeError(
    probeMutation(session, mutationRequest("palette_swap")),
    "mutation.palette_verification",
  );
  await expectRuntimeError(cleanup(), "mutation.palette_verification");
  assert.equal(await session.page.locator("head > style").count(), 0);
  await closeSession(session);
});

test("pointer interceptor preserves pixels and AX while blocking only the coordinate task", async () => {
  const session = await fixtureSession();
  let cleanup: MutationCleanup | undefined;
  try {
    const compilation = await applicableCompilation(session, "pointer_interceptor");
    const baselineScreenshot = await canonicalScreenshot(session.page);
    const baselineAx = await semanticAxSnapshot(session.page);
    cleanup = await applyCompiledMutation(
      session,
      compilation.plan,
      compilation.preconditions,
    );

    assert.deepEqual(await canonicalScreenshot(session.page), baselineScreenshot);
    assert.deepEqual(await semanticAxSnapshot(session.page), baselineAx);
    assert.equal(
      await session.page.getByTestId("place-order").evaluate((target) => {
        const rect = target.getBoundingClientRect();
        return (
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ) === target
        );
      }),
      false,
    );
    assert.equal(await clickPrimaryActionAtCenter(session.page), false);
    assert.equal(
      await session.page.getByTestId("app-root").getAttribute("data-state"),
      "review",
    );

    await cleanup();
    cleanup = undefined;
    assert.deepEqual(await canonicalScreenshot(session.page), baselineScreenshot);
    assert.deepEqual(await semanticAxSnapshot(session.page), baselineAx);
    assert.equal(await clickPrimaryActionAtCenter(session.page), true);
  } finally {
    await cleanup?.();
    await closeSession(session);
  }
});

test("live re-probing rejects stale and overlapping applications without leaking ownership", async () => {
  const session = await fixtureSession();
  let cleanup: MutationCleanup | undefined;
  try {
    const compilation = await applicableCompilation(session, "pointer_interceptor");
    const initialScrollY = await session.page.evaluate(() => window.scrollY);
    const changedScrollY = await session.page.evaluate((initial) => {
      window.scrollTo(0, initial === 0 ? document.documentElement.scrollHeight : 0);
      return window.scrollY;
    }, initialScrollY);
    assert.notEqual(changedScrollY, initialScrollY);
    await expectRuntimeError(
      applyCompiledMutation(session, compilation.plan, compilation.preconditions),
      "mutation.stale_probe",
    );
    await session.page.evaluate(
      (scrollY) => window.scrollTo(0, scrollY),
      initialScrollY,
    );

    cleanup = await applyCompiledMutation(
      session,
      compilation.plan,
      compilation.preconditions,
    );
    await expectRuntimeError(
      applyCompiledMutation(session, compilation.plan, compilation.preconditions),
      "mutation.overlapping_application",
    );
    const firstCleanup = cleanup;
    await firstCleanup();
    await expectRuntimeError(firstCleanup(), "mutation.cleanup_reused");
    cleanup = undefined;

    const secondCleanup = await applyCompiledMutation(
      session,
      compilation.plan,
      compilation.preconditions,
    );
    await secondCleanup();
  } finally {
    await cleanup?.();
    await closeSession(session);
  }
});

test("failed verification rolls back the exact owned node and releases the page", async () => {
  const session = await fixtureSession();
  try {
    const compilation = await applicableCompilation(session, "pointer_interceptor");
    const originalScrollY = await session.page.evaluate(() => window.scrollY);
    const observer = await session.page.evaluateHandle(() => {
      const original = window.scrollY;
      const maximum = document.documentElement.scrollHeight - window.innerHeight;
      const destination = original === 0 ? maximum : 0;
      const mutationObserver = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (
              node instanceof HTMLDivElement &&
              node.parentElement === document.body
            ) {
              window.scrollTo(0, destination);
            }
          }
        }
      });
      mutationObserver.observe(document.body, { childList: true });
      return mutationObserver;
    });
    try {
      const attempt = await applyCompiledMutation(
        session,
        compilation.plan,
        compilation.preconditions,
      ).then(
        (cleanup) => ({ status: "applied" as const, cleanup }),
        (error: unknown) => ({ status: "failed" as const, error }),
      );
      if (attempt.status === "applied") {
        await attempt.cleanup();
        assert.fail("scroll race unexpectedly passed pointer verification");
      }
      assert.ok(attempt.error instanceof MutationRuntimeError);
      assert.equal(attempt.error.code, "mutation.pointer_verification");
    } finally {
      await observer.evaluate((mutationObserver) => mutationObserver.disconnect());
      await observer.dispose();
      await session.page.evaluate(
        (scrollY) => window.scrollTo(0, scrollY),
        originalScrollY,
      );
    }
    assert.equal(await session.page.locator("body > div").count(), 0);

    const cleanup = await applyCompiledMutation(
      session,
      compilation.plan,
      compilation.preconditions,
    );
    await cleanup();
  } finally {
    await closeSession(session);
  }
});
