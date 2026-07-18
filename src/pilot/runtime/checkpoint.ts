import type { CDPSession, Page } from "@playwright/test";

import { canonicalizePng } from "../../artifacts/png.js";
import {
  adaptChromiumLayoutSnapshot,
  chromiumLayoutComputedStyles,
} from "../../capture/chromium-layout.js";
import { assertClosedChromiumFonts } from "../../capture/chromium-fonts.js";
import { normalizeAccessibilitySnapshot } from "../../capture/normalize-ax.js";
import type { ActionPlan, CaptureSpec, LayoutSnapshot } from "../../capture/schema.js";
import { assertCaptureGraphBindings } from "../../capture/validate.js";
import type { ArtifactRef } from "../../contracts/artifacts.js";
import {
  intrinsicUint8ArrayByteLength,
  snapshotUint8Array,
} from "../../contracts/byte-array.js";
import { canonicalJson, computeCheckpointId } from "../../contracts/canonical.js";
import { PilotFixtureAuthoringRuntimeError } from "./errors.js";

const checkpointConstructorToken = Symbol(
  "impactdiff.pilot-fixture-authoring-checkpoint",
);
const testIdPattern = /^[a-z0-9][a-z0-9-]{0,127}$/u;
const actionTargetIdPattern = /^idat1_[0-9a-f]{64}$/u;

function fail(code: string, message: string, options?: ErrorOptions): never {
  throw new PilotFixtureAuthoringRuntimeError(code, message, options);
}

function standaloneCheckpointBytes(bytes: Uint8Array): Buffer {
  const byteLength = intrinsicUint8ArrayByteLength(bytes);
  if (byteLength === null) {
    fail(
      "pilot_runtime.checkpoint_bytes",
      "checkpoint payload must be backed by fixed private bytes",
    );
  }
  try {
    return snapshotUint8Array(bytes, byteLength);
  } catch (error) {
    fail(
      "pilot_runtime.checkpoint_bytes",
      "checkpoint payload could not be copied into fixed private bytes",
      { cause: error },
    );
  }
}

function captureProtocolRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("pilot_runtime.checkpoint_protocol", `${name} must be a CDP data object`);
  }
  return value as Record<string, unknown>;
}

function captureProtocolInteger(value: unknown, name: string, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    fail(
      "pilot_runtime.checkpoint_protocol",
      `${name} must be a bounded positive integer`,
    );
  }
  return value;
}

async function captureTargetBackendNodeId(
  client: CDPSession,
  primaryActionTestId: string,
): Promise<number> {
  const documentResponse = captureProtocolRecord(
    await client.send("DOM.getDocument", { depth: 0, pierce: false }),
    "DOM.getDocument response",
  );
  const root = captureProtocolRecord(
    documentResponse.root,
    "DOM.getDocument response root",
  );
  const rootNodeId = captureProtocolInteger(
    root.nodeId,
    "document root nodeId",
    2_147_483_647,
  );
  const queryResponse = captureProtocolRecord(
    await client.send("DOM.querySelectorAll", {
      nodeId: rootNodeId,
      selector: `[data-testid="${primaryActionTestId}"]`,
    }),
    "DOM.querySelectorAll response",
  );
  const nodeIds = queryResponse.nodeIds;
  if (!Array.isArray(nodeIds) || nodeIds.length !== 1) {
    fail(
      "pilot_runtime.checkpoint_target",
      "the exact primary-action test ID must resolve one DOM node",
    );
  }
  const nodeId = captureProtocolInteger(
    nodeIds[0],
    "primary action nodeId",
    2_147_483_647,
  );
  const descriptionResponse = captureProtocolRecord(
    await client.send("DOM.describeNode", { nodeId, depth: 0, pierce: false }),
    "DOM.describeNode response",
  );
  const node = captureProtocolRecord(
    descriptionResponse.node,
    "DOM.describeNode response node",
  );
  const attributes = node.attributes;
  if (!Array.isArray(attributes) || attributes.length % 2 !== 0) {
    fail(
      "pilot_runtime.checkpoint_target",
      "the primary action must expose a valid CDP attribute vector",
    );
  }
  let testIdMatches = 0;
  for (let index = 0; index < attributes.length; index += 2) {
    if (
      attributes[index] === "data-testid" &&
      attributes[index + 1] === primaryActionTestId
    ) {
      testIdMatches += 1;
    }
  }
  if (testIdMatches !== 1) {
    fail(
      "pilot_runtime.checkpoint_target",
      "the resolved primary action must carry the exact fixture test ID",
    );
  }
  return captureProtocolInteger(
    node.backendNodeId,
    "primary action backendNodeId",
    4_294_967_295,
  );
}

function assertPilotObservationTarget(
  layout: LayoutSnapshot,
  primaryActionTargetId: string,
): void {
  const actualCount = layout.nodes.filter(
    (node) => node.action_target_id === primaryActionTargetId,
  ).length;
  if (actualCount !== 1) {
    fail(
      "pilot_runtime.checkpoint_target_binding",
      "Pilot observation must contain exactly one authenticated primary-action layout target",
    );
  }
}

export class PilotFixtureAuthoringCheckpointBytes {
  readonly checkpoint_id: string;
  readonly ordinal: 0 | 1 | 2;
  readonly #screenshot: Buffer;
  readonly #accessibilityTree: Buffer;
  readonly #layoutGraph: Buffer;

  constructor(
    token: symbol,
    value: {
      readonly checkpoint_id: string;
      readonly ordinal: 0 | 1 | 2;
      readonly screenshot: Uint8Array;
      readonly accessibility_tree: Uint8Array;
      readonly layout_graph: Uint8Array;
    },
  ) {
    if (token !== checkpointConstructorToken) {
      fail(
        "pilot_runtime.checkpoint_capability",
        "Pilot checkpoints can only be created by the bound authoring executor",
      );
    }
    this.checkpoint_id = value.checkpoint_id;
    this.ordinal = value.ordinal;
    this.#screenshot = standaloneCheckpointBytes(value.screenshot);
    this.#accessibilityTree = standaloneCheckpointBytes(value.accessibility_tree);
    this.#layoutGraph = standaloneCheckpointBytes(value.layout_graph);
    Object.freeze(this);
  }

  get screenshot(): Buffer {
    return standaloneCheckpointBytes(this.#screenshot);
  }

  get accessibility_tree(): Buffer {
    return standaloneCheckpointBytes(this.#accessibilityTree);
  }

  get layout_graph(): Buffer {
    return standaloneCheckpointBytes(this.#layoutGraph);
  }
}

Object.freeze(PilotFixtureAuthoringCheckpointBytes.prototype);

/** @internal Kept out of the package root; consumed only by Pilot runtime code. */
export interface PilotFixtureAuthoringObservationCapture {
  readonly page: Page;
  readonly capture_spec: CaptureSpec;
  readonly action_plan: ActionPlan;
  readonly primary_action_target_id: string;
  readonly primary_action_test_id: string;
}

/** @internal ID-free observation bytes with defensive reads. */
export interface PilotFixtureAuthoringObservationBytes {
  readonly screenshot: Buffer;
  readonly accessibility_tree: Buffer;
  readonly layout_graph: Buffer;
}

export interface PilotFixtureAuthoringCheckpointCapture extends PilotFixtureAuthoringObservationCapture {
  readonly action_plan_reference: ArtifactRef;
  readonly ordinal: 0 | 1 | 2;
}

interface CapturedObservationPayload {
  readonly screenshot: Buffer;
  readonly accessibilityTree: Buffer;
  readonly layoutGraph: Buffer;
}

async function captureObservationPayload(
  input: PilotFixtureAuthoringObservationCapture,
  client: CDPSession,
): Promise<CapturedObservationPayload> {
  const targetBackendNodeId = await captureTargetBackendNodeId(
    client,
    input.primary_action_test_id,
  );
  const screenshotInput = await input.page.screenshot({
    type: input.capture_spec.screenshot.format,
    fullPage: input.capture_spec.screenshot.full_page,
    animations: input.capture_spec.screenshot.animations,
    caret: input.capture_spec.screenshot.caret,
    scale: input.capture_spec.screenshot.scale,
    omitBackground: input.capture_spec.screenshot.omit_background,
  });
  const domSnapshot = await client.send("DOMSnapshot.captureSnapshot", {
    computedStyles: [...chromiumLayoutComputedStyles],
    includePaintOrder: true,
    includeDOMRects: true,
    includeBlendedBackgroundColors: false,
    includeTextColorOpacities: false,
  });
  const layout = adaptChromiumLayoutSnapshot(domSnapshot, {
    documentProfile: "pilot_fixture",
    viewport: input.capture_spec.display.viewport,
    target: {
      backendDomNodeId: targetBackendNodeId,
      actionTargetId: input.primary_action_target_id,
    },
  });
  const accessibilityInput = await client.send("Accessibility.getFullAXTree");
  const accessibility = normalizeAccessibilitySnapshot(
    accessibilityInput,
    layout.backendDomNodeToLayoutIndex,
  );
  assertPilotObservationTarget(layout.snapshot, input.primary_action_target_id);
  assertCaptureGraphBindings(input.action_plan, accessibility, layout.snapshot);
  const screenshot = canonicalizePng(
    screenshotInput,
    input.capture_spec.display.viewport,
  ).bytes;
  return Object.freeze({
    screenshot,
    accessibilityTree: Buffer.from(canonicalJson(accessibility), "utf8"),
    layoutGraph: Buffer.from(canonicalJson(layout.snapshot), "utf8"),
  });
}

function defensiveObservationBytes(
  payload: CapturedObservationPayload,
): PilotFixtureAuthoringObservationBytes {
  const screenshot = standaloneCheckpointBytes(payload.screenshot);
  const accessibilityTree = standaloneCheckpointBytes(payload.accessibilityTree);
  const layoutGraph = standaloneCheckpointBytes(payload.layoutGraph);
  const result = {} as PilotFixtureAuthoringObservationBytes;
  Object.defineProperties(result, {
    screenshot: {
      configurable: false,
      enumerable: true,
      get: () => standaloneCheckpointBytes(screenshot),
    },
    accessibility_tree: {
      configurable: false,
      enumerable: true,
      get: () => standaloneCheckpointBytes(accessibilityTree),
    },
    layout_graph: {
      configurable: false,
      enumerable: true,
      get: () => standaloneCheckpointBytes(layoutGraph),
    },
  });
  return Object.freeze(result);
}

function assertInternalObservationInput(
  input: PilotFixtureAuthoringObservationCapture,
): void {
  if (!testIdPattern.test(input.primary_action_test_id)) {
    fail(
      "pilot_runtime.checkpoint_input",
      "primary action test ID must use the closed Pilot test-ID domain",
    );
  }
  if (!actionTargetIdPattern.test(input.primary_action_target_id)) {
    fail(
      "pilot_runtime.checkpoint_input",
      "primary action target ID must use the idat1 SHA-256 form",
    );
  }
}

function assertInternalCheckpointInput(
  input: PilotFixtureAuthoringCheckpointCapture,
): void {
  assertInternalObservationInput(input);
  if (input.ordinal !== 0 && input.ordinal !== 1 && input.ordinal !== 2) {
    fail(
      "pilot_runtime.checkpoint_input",
      "Pilot checkpoint ordinal must be 0, 1, or 2",
    );
  }
}

/**
 * Captures one ID-free bound Pilot observation. Each invocation owns font
 * authentication, its capture CDP session, and all returned byte storage.
 *
 * @internal Imported only by the Pilot authoring session.
 */
export async function capturePilotFixtureAuthoringObservation(
  input: PilotFixtureAuthoringObservationCapture,
): Promise<PilotFixtureAuthoringObservationBytes> {
  assertInternalObservationInput(input);
  await assertClosedChromiumFonts(input.page, {
    expectedPlatformFamilyName: "Noto Sans",
    createError: (message, options) =>
      new PilotFixtureAuthoringRuntimeError(
        "pilot_runtime.fixture_font",
        message,
        options,
      ),
  });

  let client: CDPSession | undefined;
  let captured: CapturedObservationPayload | undefined;
  const errors: unknown[] = [];
  try {
    client = await input.page.context().newCDPSession(input.page);
    captured = await captureObservationPayload(input, client);
  } catch (error) {
    errors.push(error);
  }
  if (client !== undefined) {
    try {
      await client.detach();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      "Pilot observation capture and CDP cleanup failed",
    );
  }
  if (captured === undefined) {
    fail(
      "pilot_runtime.checkpoint_result",
      "Pilot checkpoint capture produced no complete payload",
    );
  }
  return defensiveObservationBytes(captured);
}

/**
 * Adds the ActionPlan-derived identity to one ID-free observation while
 * preserving the checkpoint capability and byte-ownership boundary.
 *
 * @internal Imported only by the Pilot authoring session.
 */
export async function capturePilotFixtureAuthoringCheckpoint(
  input: PilotFixtureAuthoringCheckpointCapture,
): Promise<PilotFixtureAuthoringCheckpointBytes> {
  assertInternalCheckpointInput(input);
  const observation = await capturePilotFixtureAuthoringObservation({
    page: input.page,
    capture_spec: input.capture_spec,
    action_plan: input.action_plan,
    primary_action_target_id: input.primary_action_target_id,
    primary_action_test_id: input.primary_action_test_id,
  });
  return new PilotFixtureAuthoringCheckpointBytes(checkpointConstructorToken, {
    checkpoint_id: computeCheckpointId(input.action_plan_reference, input.ordinal),
    ordinal: input.ordinal,
    screenshot: observation.screenshot,
    accessibility_tree: observation.accessibility_tree,
    layout_graph: observation.layout_graph,
  });
}
