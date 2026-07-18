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

function assertPilotCheckpointTarget(
  layout: LayoutSnapshot,
  primaryActionTargetId: string,
  ordinal: 0 | 1 | 2,
): void {
  const actualCount = layout.nodes.filter(
    (node) => node.action_target_id === primaryActionTargetId,
  ).length;
  if (actualCount !== 1) {
    fail(
      "pilot_runtime.checkpoint_target_binding",
      `checkpoint ${ordinal} must contain exactly one authenticated primary-action layout target`,
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

export interface PilotFixtureAuthoringCheckpointCapture {
  readonly page: Page;
  readonly capture_spec: CaptureSpec;
  readonly action_plan: ActionPlan;
  readonly action_plan_reference: ArtifactRef;
  readonly primary_action_target_id: string;
  readonly primary_action_test_id: string;
  readonly ordinal: 0 | 1 | 2;
}

interface CapturedCheckpointPayload {
  readonly checkpointId: string;
  readonly ordinal: 0 | 1 | 2;
  readonly screenshot: Buffer;
  readonly accessibilityTree: Buffer;
  readonly layoutGraph: Buffer;
}

async function captureCheckpointPayload(
  input: PilotFixtureAuthoringCheckpointCapture,
  client: CDPSession,
): Promise<CapturedCheckpointPayload> {
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
  assertPilotCheckpointTarget(
    layout.snapshot,
    input.primary_action_target_id,
    input.ordinal,
  );
  assertCaptureGraphBindings(input.action_plan, accessibility, layout.snapshot);
  const screenshot = canonicalizePng(
    screenshotInput,
    input.capture_spec.display.viewport,
  ).bytes;
  return Object.freeze({
    checkpointId: computeCheckpointId(input.action_plan_reference, input.ordinal),
    ordinal: input.ordinal,
    screenshot,
    accessibilityTree: Buffer.from(canonicalJson(accessibility), "utf8"),
    layoutGraph: Buffer.from(canonicalJson(layout.snapshot), "utf8"),
  });
}

function assertInternalCaptureInput(
  input: PilotFixtureAuthoringCheckpointCapture,
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
  if (input.ordinal !== 0 && input.ordinal !== 1 && input.ordinal !== 2) {
    fail(
      "pilot_runtime.checkpoint_input",
      "Pilot checkpoint ordinal must be 0, 1, or 2",
    );
  }
}

/**
 * Captures one bound Pilot observation without exposing its Page or CDP
 * capability. Each invocation owns and detaches its capture CDP session, and a
 * public checkpoint value is created only after capture cleanup succeeds.
 *
 * @internal Imported only by the Pilot authoring session.
 */
export async function capturePilotFixtureAuthoringCheckpoint(
  input: PilotFixtureAuthoringCheckpointCapture,
): Promise<PilotFixtureAuthoringCheckpointBytes> {
  assertInternalCaptureInput(input);
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
  let captured: CapturedCheckpointPayload | undefined;
  const errors: unknown[] = [];
  try {
    client = await input.page.context().newCDPSession(input.page);
    captured = await captureCheckpointPayload(input, client);
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
    throw new AggregateError(errors, "Pilot checkpoint capture and CDP cleanup failed");
  }
  if (captured === undefined) {
    fail(
      "pilot_runtime.checkpoint_result",
      "Pilot checkpoint capture produced no complete payload",
    );
  }
  return new PilotFixtureAuthoringCheckpointBytes(checkpointConstructorToken, {
    checkpoint_id: captured.checkpointId,
    ordinal: captured.ordinal,
    screenshot: captured.screenshot,
    accessibility_tree: captured.accessibilityTree,
    layout_graph: captured.layoutGraph,
  });
}
