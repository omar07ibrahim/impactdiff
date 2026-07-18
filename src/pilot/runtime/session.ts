import type {
  BrowserContext,
  BrowserContextOptions,
  CDPSession,
  ElementHandle,
  JSHandle,
  Page,
  Request,
  Route,
} from "@playwright/test";

import { assertClosedChromiumFonts } from "../../capture/chromium-fonts.js";
import { computeFixtureActionTargetId } from "../../capture/identity.js";
import type { ActionPlan, CaptureSpec } from "../../capture/schema.js";
import { parseActionPlan } from "../../capture/validate.js";
import type { ArtifactRef } from "../../contracts/artifacts.js";
import {
  canonicalJson,
  computeEnvironmentId,
  computeSourceStateId,
  computeTaskId,
  sha256Hex,
} from "../../contracts/canonical.js";
import { parseSourceState } from "../../source/validate.js";
import {
  buildPilotFixtureActionPlanArtifacts,
  type PilotFixtureActionPlanArtifact,
} from "../fixture/action-plan.js";
import type {
  PilotFixtureAuthoringPackage,
  PilotFixtureAuthoringSnapshot,
} from "../fixture/package.js";
import { pilotFixtureAbiSlots } from "../fixture/schema.js";
import type {
  PilotFixtureAbiSlot,
  PilotFixtureManifest,
  PilotFixtureWorkflow,
} from "../fixture/schema.js";
import type { PilotFixtureAuthoringEnvironmentLease } from "./environment.js";
import {
  capturePilotFixtureAuthoringCheckpoint,
  capturePilotFixtureAuthoringObservation,
  type PilotFixtureAuthoringCheckpointBytes,
  type PilotFixtureAuthoringObservationBytes,
} from "./checkpoint.js";
import { PilotFixtureAuthoringRuntimeError } from "./errors.js";
import {
  beginPilotPointerIntervention,
  finishPilotPointerIntervention,
  installPilotPointerIntervention,
  probePilotPointerIntervention,
  removePilotPointerIntervention,
  type PilotPointerLayerProbe,
  type PilotPointerLifecycleProbe,
  type PilotPointerMode,
  type PilotPointerMutationAuditApi,
  type PilotPointerRemovalProbe,
} from "./pointer-intervention.js";
import {
  assertPilotPointerInstalledPredicates,
  assertPilotPointerSourcePredicates,
  assertSelectedPilotPointerOperator,
  createPilotPointerCleanupProbeObservations,
  createPilotPointerInstalledProbeObservations,
  createPilotPointerRoundtripProbeObservations,
  createPilotPointerSourceProbeObservations,
  type SelectedPilotPointerOperator,
} from "./pointer-operator.js";
import {
  measurePilotMutationPredicates,
  type PilotMutationPredicateObservationTuple,
  type PilotPredicatePageGuardApi,
} from "./predicates.js";

const fixtureOrigin = "https://pilot-fixture.impactdiff.invalid";
const maximumAuditEvents = 256;
const maximumAuditTextLength = 2_048;
const terminalMutationSentinel = "ImpactDiff Pilot terminal boundary mutation";
const pageGuardApiName = "__impactdiffPilotPageGuardV1";

interface PilotNativeSelectState {
  readonly kind: "select";
  readonly disabled: boolean;
  readonly multiple: boolean;
  readonly value: string;
  readonly selectedIndex: number;
  readonly optionValues: readonly string[];
  readonly optionSelected: readonly boolean[];
}

interface PilotNativeInputState {
  readonly kind: "input";
  readonly type: string;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly value: string;
  readonly checked: boolean;
  readonly indeterminate: boolean;
  readonly groupPeerCount: number;
  readonly filesLength: number;
  readonly selectionStart: number | null;
  readonly selectionEnd: number | null;
  readonly selectionDirection: string | null;
}

interface PilotNativeTextareaState {
  readonly kind: "textarea";
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly selectionDirection: string;
}

interface PilotNativeOptionState {
  readonly kind: "option";
  readonly selected: boolean;
  readonly ownerSelect: HTMLSelectElement | null;
}

type PilotNativeControlState =
  | PilotNativeSelectState
  | PilotNativeInputState
  | PilotNativeTextareaState
  | PilotNativeOptionState
  | { readonly kind: "other" };

interface PilotPageGuardApi extends PilotPredicatePageGuardApi {
  readonly controlState: (element: Element) => PilotNativeControlState;
  readonly controlMatches: (
    element: Element,
    stateName: "value" | "checked" | null,
    expectedState: string | boolean | null,
  ) => boolean;
  readonly activeElement: () => Element | null;
  readonly isConnected: (node: Node) => boolean;
  readonly getAttribute: (element: Element, name: string) => string | null;
  readonly textContent: (node: Node) => string | null;
  readonly nativeButtonMatches: (element: Element, requireEnabled: boolean) => boolean;
  readonly sourcePointerGeometry: (primary: Element) => SourcePointerGeometry;
  readonly pointerCleanBoundaryProjection: (
    primary: Element,
    sourcePoint: Readonly<{ x: number; y: number }>,
    trackedElements: readonly Element[],
  ) => PilotPointerCleanBoundaryProjection;
  readonly createMutationAudit: (
    rootElement: Element,
    successElement: Element,
    rootAttribute: string,
  ) => PilotMutationAudit;
  readonly sealTerminalBoundary: (elements: readonly Element[]) => void;
}

interface PilotPointerCleanBoundaryProjection {
  readonly computedStyles: readonly {
    readonly depth: number;
    readonly localName: string;
    readonly testId: string | null;
    readonly properties: readonly string[];
  }[];
  readonly hitTest: {
    readonly geometry: SourcePointerGeometry;
    readonly samplesHitPrimary: readonly [true, true, true, true, true];
  };
  readonly focusAndScroll: {
    readonly activeSlotIndex: number;
    readonly windowScrollX: number;
    readonly windowScrollY: number;
    readonly visualViewport: {
      readonly offsetLeft: number;
      readonly offsetTop: number;
      readonly pageLeft: number;
      readonly pageTop: number;
      readonly scale: number;
    } | null;
    readonly elements: readonly {
      readonly index: number;
      readonly localName: string;
      readonly testId: string | null;
      readonly scrollLeft: number;
      readonly scrollTop: number;
    }[];
  };
}

interface PilotMutationSnapshot {
  readonly overflow: boolean;
  readonly unexpected: readonly string[];
  readonly rootMutationObserved: boolean;
  readonly successMutationObserved: boolean;
}

interface PilotMutationAudit extends PilotPointerMutationAuditApi {
  readonly drain: () => PilotMutationSnapshot;
  readonly drainAndDisconnect: () => PilotMutationSnapshot;
  readonly seal: () => PilotMutationSnapshot;
}

export interface PilotFixtureResourceRequestAudit {
  readonly path: string;
  readonly request_count: number;
}

export interface PilotFixtureWorkflowAuthoringAudit {
  readonly kind: "pilot_fixture_workflow_authoring_audit";
  readonly official: false;
  readonly fixture_key: string;
  readonly fixture_revision: string;
  readonly source_state_id: string;
  readonly workflow_key: string;
  readonly task_id: string;
  readonly environment_id: string;
  readonly actions_executed: number;
  readonly checkpoint_after_action_ordinals: readonly [number, number, number];
  readonly resource_requests: readonly PilotFixtureResourceRequestAudit[];
  readonly blocked_external_requests: readonly [];
  readonly unexpected_fixture_requests: readonly [];
}

export type PilotFixtureAuthoringCheckpointTuple = readonly [
  PilotFixtureAuthoringCheckpointBytes,
  PilotFixtureAuthoringCheckpointBytes,
  PilotFixtureAuthoringCheckpointBytes,
];

/** @internal */
export interface PilotFixtureWorkflowAuthoringCaptureSessionResult {
  readonly audit: PilotFixtureWorkflowAuthoringAudit;
  readonly checkpoints: PilotFixtureAuthoringCheckpointTuple;
}

/** @internal */
export interface PilotFixtureWorkflowAuthoringPredicateSessionResult {
  readonly audit: PilotFixtureWorkflowAuthoringAudit;
  readonly source_predicates: PilotMutationPredicateObservationTuple;
}

/** @internal */
export interface PilotFixturePointerBaselineAuthoringSessionResult {
  readonly audit: PilotFixtureWorkflowAuthoringAudit;
  readonly source_predicates: PilotMutationPredicateObservationTuple;
  readonly pointer_baseline: PilotPointerBaselineEvidence;
}

/** @internal */
export interface PilotFixturePointerCandidateAuthoringSessionResult {
  readonly audit: PilotFixtureWorkflowAuthoringAudit;
  readonly task_outcome: PilotPointerCandidateTaskOutcome;
}

interface BoundWorkflow {
  readonly manifest: PilotFixtureManifest;
  readonly workflow: PilotFixtureWorkflow;
  readonly actionPlan: ActionPlan;
  readonly actionPlanReference: ArtifactRef;
  readonly primaryActionTargetId: string;
  readonly primaryActionTestId: string;
  readonly authoringPackage: PilotFixtureAuthoringPackage;
  readonly resources: ReadonlyMap<
    string,
    {
      readonly bytes: Buffer;
      readonly mediaType: string;
    }
  >;
  readonly taskId: string;
}

interface BrowserAuditState {
  readonly blockedExternalRequests: string[];
  readonly unexpectedFixtureRequests: string[];
  readonly cspViolations: string[];
  readonly pageErrors: string[];
  readonly transientEvents: string[];
  readonly resourceRequestCounts: Map<string, number>;
  readonly activeRequests: Set<Request>;
  requestEvents: number;
  routeEvents: number;
  activeRouteHandlers: number;
  auditEventCount: number;
  overflow: boolean;
  navigationArmed: boolean;
  documentReplaced: boolean;
  closing: boolean;
}

interface BrowserAuditCompletionSnapshot {
  readonly auditEventCount: number;
  readonly requestEvents: number;
  readonly routeEvents: number;
  readonly resourceRequestCounts: readonly (readonly [string, number])[];
}

interface RetainedAbi {
  readonly documentElement: ElementHandle<HTMLElement>;
  readonly slots: ReadonlyMap<PilotFixtureAbiSlot, ElementHandle<Element>>;
  readonly pageGuard: JSHandle<PilotPageGuardApi>;
  readonly mutationAudit: JSHandle<PilotMutationAudit>;
  readonly pristineDocumentSha256: string;
}

function fail(code: string, message: string, options?: ErrorOptions): never {
  throw new PilotFixtureAuthoringRuntimeError(code, message, options);
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
}

function sameReference(
  left: {
    readonly sha256: string;
    readonly byte_length: number;
    readonly media_type: string;
    readonly format_version: number;
  },
  right: {
    readonly sha256: string;
    readonly byte_length: number;
    readonly media_type: string;
    readonly format_version: number;
  },
): boolean {
  return (
    left.sha256 === right.sha256 &&
    left.byte_length === right.byte_length &&
    left.media_type === right.media_type &&
    left.format_version === right.format_version
  );
}

function assertArtifactBytes(
  bytes: Uint8Array,
  reference: { readonly sha256: string; readonly byte_length: number },
  label: string,
): Buffer {
  const snapshot = Buffer.from(bytes);
  if (
    snapshot.byteLength !== reference.byte_length ||
    sha256Hex(snapshot) !== reference.sha256
  ) {
    fail(
      "pilot_runtime.artifact_binding",
      `${label} bytes differ from their authoring artifact reference`,
    );
  }
  return snapshot;
}

function recordEvent(
  audit: BrowserAuditState,
  target:
    | "blockedExternalRequests"
    | "unexpectedFixtureRequests"
    | "cspViolations"
    | "pageErrors"
    | "transientEvents",
  value: string,
): void {
  if (audit.auditEventCount >= maximumAuditEvents) {
    audit.overflow = true;
    return;
  }
  audit.auditEventCount += 1;
  audit[target].push(value.slice(0, maximumAuditTextLength));
}

function countAuditEvent(
  audit: BrowserAuditState,
  field: "requestEvents" | "routeEvents",
): void {
  if (audit[field] >= maximumAuditEvents) {
    audit.overflow = true;
  } else {
    audit[field] += 1;
  }
}

function verifyCaptureSpecBinding(
  captureSpec: CaptureSpec,
  manifest: PilotFixtureManifest,
): void {
  const environment = manifest.environment;
  if (
    captureSpec.display.viewport.width !== environment.viewport.width ||
    captureSpec.display.viewport.height !== environment.viewport.height ||
    captureSpec.display.screen.width !== environment.viewport.width ||
    captureSpec.display.screen.height !== environment.viewport.height ||
    captureSpec.display.device_scale_factor !== environment.device_scale_factor ||
    captureSpec.internationalization.locale !== environment.locale ||
    captureSpec.internationalization.timezone_id !== environment.timezone ||
    captureSpec.media.color_scheme !== environment.color_scheme ||
    captureSpec.media.reduced_motion !== "reduce" ||
    captureSpec.media.forced_colors !== "none" ||
    captureSpec.network.fixture_delivery !== "memory" ||
    captureSpec.network.external_requests !== "abort" ||
    captureSpec.network.service_workers !== "block" ||
    captureSpec.network.connect_policy !== "none" ||
    captureSpec.budgets.maximum_pending_requests !== manifest.readiness.pending_requests
  ) {
    fail(
      "pilot_runtime.environment_binding",
      "CaptureSpec differs from the fixture manifest or closed replay policy",
    );
  }
}

function verifySourceBinding(
  authoringPackage: PilotFixtureAuthoringPackage,
  manifest: PilotFixtureManifest,
): string {
  const bytes = assertArtifactBytes(
    authoringPackage.source_state.bytes,
    authoringPackage.source_state.reference,
    "source-state",
  );
  let sourceState;
  try {
    sourceState = parseSourceState(bytes);
  } catch (error) {
    fail(
      "pilot_runtime.source_binding",
      "authoring source-state is not a canonical validated contract",
      { cause: error },
    );
  }
  if (
    computeSourceStateId(authoringPackage.source_state.reference) !==
      authoringPackage.source_state_id ||
    sourceState.source.fixture_id !== manifest.fixture_key ||
    sourceState.source.revision !== manifest.revision ||
    sourceState.source.license !== manifest.license ||
    sourceState.source.entrypoint !== manifest.entrypoint ||
    sourceState.initial_state.route !== "/" ||
    sourceState.initial_state.storage !== "empty" ||
    canonicalJson(sourceState.source.resources) !== canonicalJson(manifest.resources)
  ) {
    fail(
      "pilot_runtime.source_binding",
      "authoring source-state does not bind the exact fixture manifest",
    );
  }
  return sourceState.source.raw_manifest.sha256;
}

function exactActionPlanArtifact(
  actual: PilotFixtureAuthoringPackage["workflows"][number],
  expected: PilotFixtureActionPlanArtifact,
): ActionPlan {
  const bytes = assertArtifactBytes(
    actual.action_plan.bytes,
    actual.action_plan.reference,
    "action-plan",
  );
  if (
    !sameReference(actual.action_plan.reference, expected.reference) ||
    !bytes.equals(Buffer.from(expected.bytes)) ||
    actual.task_id !== expected.task_id ||
    actual.task_id !== computeTaskId(actual.action_plan.reference)
  ) {
    fail(
      "pilot_runtime.action_plan_binding",
      "authoring ActionPlan differs from its manifest-derived workflow",
    );
  }
  try {
    return parseActionPlan(bytes);
  } catch (error) {
    fail(
      "pilot_runtime.action_plan_binding",
      "authoring ActionPlan is not a canonical validated contract",
      { cause: error },
    );
  }
}

function bindPrimaryActionTarget(
  actionPlan: ActionPlan,
  workflow: PilotFixtureWorkflow,
  manifest: PilotFixtureManifest,
  manifestSha256: string,
): {
  readonly targetId: string;
  readonly testId: string;
} {
  const finalAction = actionPlan.actions.at(-1);
  const finalRecipe = workflow.actions.at(-1);
  const primaryLocator = workflow.abi.primary;
  if (
    finalAction?.intent !== "pointer_click" ||
    typeof finalAction.target_id !== "string" ||
    finalAction.ordinal !== actionPlan.actions.length - 1 ||
    actionPlan.actions.length !== workflow.actions.length ||
    finalRecipe?.intent !== "pointer_click" ||
    finalRecipe.target !== "primary" ||
    primaryLocator.strategy !== "test_id"
  ) {
    fail(
      "pilot_runtime.action_plan_binding",
      "final parsed action does not bind the manifest primary locator",
    );
  }
  const manifestTargetId = computeFixtureActionTargetId({
    fixture_id: manifest.fixture_key,
    fixture_revision: manifest.revision,
    fixture_manifest_sha256: manifestSha256,
    locator: {
      strategy: primaryLocator.strategy,
      value: primaryLocator.value,
    },
  });
  if (finalAction.target_id !== manifestTargetId) {
    fail(
      "pilot_runtime.action_plan_binding",
      "final parsed action target ID differs from the manifest primary locator",
    );
  }
  return Object.freeze({
    targetId: finalAction.target_id,
    testId: primaryLocator.value,
  });
}

function resourceSnapshot(
  snapshot: PilotFixtureAuthoringSnapshot,
  manifest: PilotFixtureManifest,
): ReadonlyMap<string, { readonly bytes: Buffer; readonly mediaType: string }> {
  const declaredPaths = manifest.resources.map(({ path }) => path);
  if (!sameStrings(snapshot.resources.paths, declaredPaths)) {
    fail(
      "pilot_runtime.resource_binding",
      "in-memory resource snapshot membership differs from the fixture manifest",
    );
  }
  const resources = new Map<
    string,
    { readonly bytes: Buffer; readonly mediaType: string }
  >();
  for (const resource of manifest.resources) {
    const bytes = snapshot.resources.read(resource.path);
    if (
      bytes === undefined ||
      bytes.byteLength !== resource.byte_length ||
      sha256Hex(bytes) !== resource.sha256
    ) {
      fail(
        "pilot_runtime.resource_binding",
        `in-memory resource ${resource.path} differs from its manifest binding`,
      );
    }
    resources.set(
      resource.path,
      Object.freeze({ bytes: Buffer.from(bytes), mediaType: resource.media_type }),
    );
  }
  return resources;
}

function bindWorkflow(
  lease: PilotFixtureAuthoringEnvironmentLease,
  workflowKey: string,
): BoundWorkflow {
  if (
    typeof workflowKey !== "string" ||
    workflowKey.length < 1 ||
    workflowKey.length > 64 ||
    !/^[a-z][a-z0-9_]*$/u.test(workflowKey)
  ) {
    fail(
      "pilot_runtime.workflow",
      "workflow key must use the bounded manifest workflow-key domain",
    );
  }
  const snapshot = lease.authoring_snapshot;
  const authoringPackage = snapshot.authoring_package;
  const manifest = authoringPackage.manifest;
  verifyCaptureSpecBinding(lease.capture_spec, manifest);
  if (computeEnvironmentId(lease.capture_spec_reference) !== lease.environment_id) {
    fail(
      "pilot_runtime.environment_binding",
      "environment ID is not derived from the exact CaptureSpec reference",
    );
  }
  const manifestSha256 = verifySourceBinding(authoringPackage, manifest);
  const workflowIndex = manifest.workflows.findIndex(
    ({ workflow_key }) => workflow_key === workflowKey,
  );
  if (workflowIndex < 0) {
    fail(
      "pilot_runtime.workflow",
      `workflow ${workflowKey.slice(0, 128)} is not declared by this fixture`,
    );
  }
  const workflow = manifest.workflows[workflowIndex];
  const packagedWorkflow = authoringPackage.workflows[workflowIndex];
  if (
    workflow === undefined ||
    packagedWorkflow === undefined ||
    packagedWorkflow.workflow_key !== workflow.workflow_key ||
    authoringPackage.workflows.length !== manifest.workflows.length
  ) {
    fail(
      "pilot_runtime.action_plan_binding",
      "authoring workflow order differs from the fixture manifest",
    );
  }
  const expectedPlans = buildPilotFixtureActionPlanArtifacts(manifest, manifestSha256);
  const expectedPlan = expectedPlans[workflowIndex];
  if (expectedPlan === undefined) {
    fail(
      "pilot_runtime.action_plan_binding",
      "manifest-derived workflow has no ActionPlan",
    );
  }
  const actionPlan = exactActionPlanArtifact(packagedWorkflow, expectedPlan);
  const primaryAction = bindPrimaryActionTarget(
    actionPlan,
    workflow,
    manifest,
    manifestSha256,
  );
  const actionPlanReference: ArtifactRef = Object.freeze({
    ...packagedWorkflow.action_plan.reference,
  });
  return Object.freeze({
    manifest,
    workflow,
    actionPlan,
    actionPlanReference,
    primaryActionTargetId: primaryAction.targetId,
    primaryActionTestId: primaryAction.testId,
    authoringPackage,
    resources: resourceSnapshot(snapshot, manifest),
    taskId: packagedWorkflow.task_id,
  });
}

function contextOptions(captureSpec: CaptureSpec): BrowserContextOptions {
  return {
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
  };
}

function newBrowserAudit(): BrowserAuditState {
  return {
    blockedExternalRequests: [],
    unexpectedFixtureRequests: [],
    cspViolations: [],
    pageErrors: [],
    transientEvents: [],
    resourceRequestCounts: new Map<string, number>(),
    activeRequests: new Set<Request>(),
    requestEvents: 0,
    routeEvents: 0,
    activeRouteHandlers: 0,
    auditEventCount: 0,
    overflow: false,
    navigationArmed: false,
    documentReplaced: false,
    closing: false,
  };
}

async function abortRoute(route: Route): Promise<void> {
  try {
    await route.abort("blockedbyclient");
  } catch {
    // The surrounding route/request counters and eventual context audit remain
    // authoritative even if Chromium races an already-cancelled request.
  }
}

async function serveRoute(
  route: Route,
  bound: BoundWorkflow,
  audit: BrowserAuditState,
): Promise<void> {
  countAuditEvent(audit, "routeEvents");
  audit.activeRouteHandlers += 1;
  try {
    const request = route.request();
    const rawUrl = request.url();
    let headers: Record<string, string>;
    try {
      headers = await request.allHeaders();
    } catch (error) {
      recordEvent(
        audit,
        "unexpectedFixtureRequests",
        `request headers unavailable: ${
          error instanceof Error ? error.message : "unknown failure"
        }`,
      );
      await abortRoute(route);
      return;
    }
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      recordEvent(audit, "unexpectedFixtureRequests", rawUrl);
      await abortRoute(route);
      return;
    }
    if (url.origin !== fixtureOrigin) {
      recordEvent(audit, "blockedExternalRequests", rawUrl);
      await abortRoute(route);
      return;
    }
    const path =
      url.pathname === "/"
        ? bound.manifest.entrypoint
        : url.pathname.startsWith("/")
          ? url.pathname.slice(1)
          : "";
    const resource = bound.resources.get(path);
    const exactRequestUrl =
      url.pathname === "/" ? `${fixtureOrigin}/` : `${fixtureOrigin}/${path}`;
    const carriesCredentials = Object.keys(headers).some((name) =>
      ["authorization", "cookie", "proxy-authorization"].includes(name.toLowerCase()),
    );
    if (
      request.method() !== "GET" ||
      carriesCredentials ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      path.length < 1 ||
      rawUrl !== exactRequestUrl ||
      resource === undefined ||
      (request.resourceType() === "font" && path !== bound.manifest.font.path) ||
      (path === bound.manifest.font.path && request.resourceType() !== "font") ||
      (request.isNavigationRequest() && url.pathname !== "/")
    ) {
      recordEvent(audit, "unexpectedFixtureRequests", rawUrl);
      await abortRoute(route);
      return;
    }
    await route.fulfill({
      status: 200,
      body: resource.bytes,
      headers: {
        "cache-control": "no-store",
        "content-security-policy": bound.manifest.content_security_policy,
        "content-type": resource.mediaType,
        "x-content-type-options": "nosniff",
      },
    });
    audit.resourceRequestCounts.set(
      path,
      (audit.resourceRequestCounts.get(path) ?? 0) + 1,
    );
  } finally {
    audit.activeRouteHandlers -= 1;
  }
}

async function installBrowserAudit(
  context: BrowserContext,
  page: Page,
  bound: BoundWorkflow,
  audit: BrowserAuditState,
): Promise<void> {
  context.on("request", (request) => {
    const bounded = audit.requestEvents < maximumAuditEvents;
    countAuditEvent(audit, "requestEvents");
    if (bounded) audit.activeRequests.add(request);
    if (audit.closing) {
      recordEvent(audit, "transientEvents", "request began during teardown");
    }
  });
  const finishRequest = (request: Request): void => {
    if (!audit.activeRequests.delete(request) && !audit.overflow) {
      recordEvent(audit, "transientEvents", "untracked request completed");
    }
  };
  context.on("requestfinished", finishRequest);
  context.on("requestfailed", (request) => {
    finishRequest(request);
    recordEvent(audit, "transientEvents", `request failed: ${request.url()}`);
  });
  context.on("page", () =>
    recordEvent(audit, "transientEvents", "additional page opened"),
  );
  context.on("serviceworker", () =>
    recordEvent(audit, "transientEvents", "service worker opened"),
  );
  context.on("weberror", (webError) =>
    recordEvent(audit, "pageErrors", webError.error().message),
  );
  page.on("console", (message) => {
    const text = message.text();
    if (text === terminalMutationSentinel) {
      recordEvent(audit, "transientEvents", text);
    } else if (
      /content security policy|violates the following directive/iu.test(text)
    ) {
      recordEvent(audit, "cspViolations", text);
    }
  });
  page.on("pageerror", (error) => recordEvent(audit, "pageErrors", error.message));
  page.on("worker", () =>
    recordEvent(audit, "transientEvents", "dedicated worker opened"),
  );
  page.on("crash", () => recordEvent(audit, "transientEvents", "fixture page crashed"));
  page.on("filechooser", () =>
    recordEvent(audit, "transientEvents", "native file chooser opened"),
  );
  page.on("websocket", () => recordEvent(audit, "transientEvents", "websocket opened"));
  page.on("download", () => recordEvent(audit, "transientEvents", "download began"));
  page.on("dialog", (dialog) => {
    recordEvent(audit, "transientEvents", `dialog opened: ${dialog.type()}`);
    void dialog
      .dismiss()
      .catch((error: unknown) =>
        recordEvent(
          audit,
          "pageErrors",
          error instanceof Error ? error.message : "dialog dismissal failed",
        ),
      );
  });
  page.on("frameattached", () =>
    recordEvent(audit, "transientEvents", "child frame attached"),
  );
  page.on("framenavigated", (frame) => {
    if (audit.navigationArmed && frame === page.mainFrame()) {
      audit.documentReplaced = true;
    }
  });
  page.on("close", () => {
    if (!audit.closing) audit.documentReplaced = true;
  });
  await context.route("**/*", (route) => serveRoute(route, bound, audit));
}

// This callback is serialized into Chromium; Node cannot observe its execution.
/* node:coverage disable */
function pilotPageGuardInit({
  apiName,
  styleCspNonce,
  terminalSentinel,
}: {
  readonly apiName: string;
  readonly styleCspNonce: string;
  readonly terminalSentinel: string;
}): void {
  const NativeArray = Array;
  const NativeBoolean = Boolean;
  const NativeError = Error;
  const NativeMutationObserver = MutationObserver;
  const NativeString = String;
  const NativeWeakSet = WeakSet;
  const guardedDocument = document;
  const guardedWindow = globalThis;
  const nativeConsole = console;
  const nativeConsoleError = console.error;
  const defineProperty = Object.defineProperty;
  const freeze = Object.freeze;
  const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const getOwnPropertyNames = Object.getOwnPropertyNames;
  const getPrototypeOf = Object.getPrototypeOf;
  const objectIs = Object.is;
  const mathMin = Math.min;
  const mathAbs = Math.abs;
  const numberIsFinite = Number.isFinite;
  const reflectApply = Reflect.apply;
  const reflectGet = Reflect.get;

  const inputPrototype = HTMLInputElement.prototype;
  const textareaPrototype = HTMLTextAreaElement.prototype;
  const selectPrototype = HTMLSelectElement.prototype;
  const optionPrototype = HTMLOptionElement.prototype;
  const buttonPrototype = HTMLButtonElement.prototype;
  const bodyPrototype = HTMLBodyElement.prototype;
  const divPrototype = HTMLDivElement.prototype;
  const stylePrototype = HTMLStyleElement.prototype;

  const descriptorFor = (prototype: object, property: string): PropertyDescriptor => {
    let owner: object | null = prototype;
    while (owner !== null) {
      const descriptor = getOwnPropertyDescriptor(owner, property);
      if (descriptor !== undefined) return descriptor;
      owner = getPrototypeOf(owner) as object | null;
    }
    throw new NativeError(`native ${property} descriptor is unavailable`);
  };
  const getterFor = (
    prototype: object,
    property: string,
  ): ((this: unknown) => unknown) => {
    const descriptor = descriptorFor(prototype, property);
    if (descriptor.get === undefined) {
      throw new NativeError(`native ${property} getter is unavailable`);
    }
    return descriptor.get;
  };
  const setterFor = (
    prototype: object,
    property: string,
  ): ((this: unknown, value: unknown) => void) => {
    const descriptor = descriptorFor(prototype, property);
    if (descriptor.set === undefined) {
      throw new NativeError(`native ${property} setter is unavailable`);
    }
    return descriptor.set;
  };
  const methodFor = (
    prototype: object,
    property: string,
  ): ((this: unknown, ...args: unknown[]) => unknown) => {
    const descriptor = descriptorFor(prototype, property);
    if (typeof descriptor.value !== "function") {
      throw new NativeError(`native ${property} method is unavailable`);
    }
    return descriptor.value as (this: unknown, ...args: unknown[]) => unknown;
  };
  const read = <Value>(getter: (this: unknown) => unknown, receiver: unknown): Value =>
    reflectApply(getter, receiver, []) as Value;
  const call = <Value>(
    method: (this: unknown, ...args: unknown[]) => unknown,
    receiver: unknown,
    args: readonly unknown[],
  ): Value => reflectApply(method, receiver, args) as Value;

  const inputGetters = freeze({
    checked: getterFor(inputPrototype, "checked"),
    disabled: getterFor(inputPrototype, "disabled"),
    files: getterFor(inputPrototype, "files"),
    form: getterFor(inputPrototype, "form"),
    indeterminate: getterFor(inputPrototype, "indeterminate"),
    name: getterFor(inputPrototype, "name"),
    readOnly: getterFor(inputPrototype, "readOnly"),
    selectionDirection: getterFor(inputPrototype, "selectionDirection"),
    selectionEnd: getterFor(inputPrototype, "selectionEnd"),
    selectionStart: getterFor(inputPrototype, "selectionStart"),
    type: getterFor(inputPrototype, "type"),
    value: getterFor(inputPrototype, "value"),
  });
  const textareaGetters = freeze({
    disabled: getterFor(textareaPrototype, "disabled"),
    readOnly: getterFor(textareaPrototype, "readOnly"),
    selectionDirection: getterFor(textareaPrototype, "selectionDirection"),
    selectionEnd: getterFor(textareaPrototype, "selectionEnd"),
    selectionStart: getterFor(textareaPrototype, "selectionStart"),
    value: getterFor(textareaPrototype, "value"),
  });
  const selectGetters = freeze({
    disabled: getterFor(selectPrototype, "disabled"),
    multiple: getterFor(selectPrototype, "multiple"),
    options: getterFor(selectPrototype, "options"),
    selectedIndex: getterFor(selectPrototype, "selectedIndex"),
    value: getterFor(selectPrototype, "value"),
  });
  const optionGetters = freeze({
    selected: getterFor(optionPrototype, "selected"),
    value: getterFor(optionPrototype, "value"),
  });
  const collectionLengthGet = getterFor(HTMLCollection.prototype, "length");
  const collectionItem = methodFor(HTMLCollection.prototype, "item");
  const fileListLengthGet = getterFor(FileList.prototype, "length");
  const nodeListLengthGet = getterFor(NodeList.prototype, "length");
  const nodeListItem = methodFor(NodeList.prototype, "item");
  const arrayJoin = methodFor(Array.prototype, "join");
  const arrayPush = methodFor(Array.prototype, "push");
  const documentBodyGet = getterFor(Document.prototype, "body");
  const documentCreateElement = methodFor(Document.prototype, "createElement");
  const eventTargetAddEventListener = methodFor(
    EventTarget.prototype,
    "addEventListener",
  );
  const eventTargetRemoveEventListener = methodFor(
    EventTarget.prototype,
    "removeEventListener",
  );
  const eventTargetGet = getterFor(Event.prototype, "target");
  const eventPreventDefault = methodFor(Event.prototype, "preventDefault");
  const nodeAppendChild = methodFor(Node.prototype, "appendChild");
  const nodeRemoveChild = methodFor(Node.prototype, "removeChild");
  const nodeChildNodesGet = getterFor(Node.prototype, "childNodes");
  const nodeFirstChildGet = getterFor(Node.prototype, "firstChild");
  const nodeLastChildGet = getterFor(Node.prototype, "lastChild");
  const nodePreviousSiblingGet = getterFor(Node.prototype, "previousSibling");
  const nodeNextSiblingGet = getterFor(Node.prototype, "nextSibling");
  const nodeOwnerDocumentGet = getterFor(Node.prototype, "ownerDocument");
  const nodeParentGet = getterFor(Node.prototype, "parentNode");
  const elementNodeType = Node.ELEMENT_NODE;
  const nodeTypeGet = getterFor(Node.prototype, "nodeType");
  const nodeIsConnectedGet = getterFor(Node.prototype, "isConnected");
  const nodeTextContentGet = getterFor(Node.prototype, "textContent");
  const nodeTextContentSet = setterFor(Node.prototype, "textContent");
  const elementAttributesGet = getterFor(Element.prototype, "attributes");
  const elementLocalNameGet = getterFor(Element.prototype, "localName");
  const documentActiveElementGet = getterFor(Document.prototype, "activeElement");
  const windowInnerWidthGet = getterFor(guardedWindow, "innerWidth");
  const windowInnerHeightGet = getterFor(guardedWindow, "innerHeight");
  const windowScrollXGet = getterFor(guardedWindow, "scrollX");
  const windowScrollYGet = getterFor(guardedWindow, "scrollY");
  const documentQuerySelectorAll = methodFor(Document.prototype, "querySelectorAll");
  const documentElementFromPoint = methodFor(Document.prototype, "elementFromPoint");
  const elementGetAttribute = methodFor(Element.prototype, "getAttribute");
  const elementSetAttribute = methodFor(Element.prototype, "setAttribute");
  const elementGetBoundingClientRect = methodFor(
    Element.prototype,
    "getBoundingClientRect",
  );
  const elementMatches = methodFor(Element.prototype, "matches");
  const elementClientLeftGet = getterFor(Element.prototype, "clientLeft");
  const elementClientTopGet = getterFor(Element.prototype, "clientTop");
  const elementClientWidthGet = getterFor(Element.prototype, "clientWidth");
  const elementClientHeightGet = getterFor(Element.prototype, "clientHeight");
  const elementScrollLeftGet = getterFor(Element.prototype, "scrollLeft");
  const elementScrollTopGet = getterFor(Element.prototype, "scrollTop");
  const elementScrollWidthGet = getterFor(Element.prototype, "scrollWidth");
  const elementScrollHeightGet = getterFor(Element.prototype, "scrollHeight");
  const buttonDisabledGet = getterFor(buttonPrototype, "disabled");
  const domRectXGet = getterFor(DOMRectReadOnly.prototype, "x");
  const domRectYGet = getterFor(DOMRectReadOnly.prototype, "y");
  const domRectWidthGet = getterFor(DOMRectReadOnly.prototype, "width");
  const domRectHeightGet = getterFor(DOMRectReadOnly.prototype, "height");
  const windowGetComputedStyle = methodFor(guardedWindow, "getComputedStyle");
  const cssStyleGetPropertyValue = methodFor(
    CSSStyleDeclaration.prototype,
    "getPropertyValue",
  );
  const htmlElementTabIndexGet = getterFor(HTMLElement.prototype, "tabIndex");
  const htmlElementNonceGet = getterFor(HTMLElement.prototype, "nonce");
  const htmlElementIsContentEditableGet = getterFor(
    HTMLElement.prototype,
    "isContentEditable",
  );
  const namedNodeMapLengthGet = getterFor(NamedNodeMap.prototype, "length");
  const windowVisualViewportGet = getterFor(guardedWindow, "visualViewport");
  const visualViewportOffsetLeftGet = getterFor(VisualViewport.prototype, "offsetLeft");
  const visualViewportOffsetTopGet = getterFor(VisualViewport.prototype, "offsetTop");
  const visualViewportPageLeftGet = getterFor(VisualViewport.prototype, "pageLeft");
  const visualViewportPageTopGet = getterFor(VisualViewport.prototype, "pageTop");
  const visualViewportScaleGet = getterFor(VisualViewport.prototype, "scale");
  const mutationObserverObserve = methodFor(MutationObserver.prototype, "observe");
  const mutationObserverTakeRecords = methodFor(
    MutationObserver.prototype,
    "takeRecords",
  );
  const mutationObserverDisconnect = methodFor(
    MutationObserver.prototype,
    "disconnect",
  );
  const mutationRecordGetters = freeze({
    addedNodes: getterFor(MutationRecord.prototype, "addedNodes"),
    attributeName: getterFor(MutationRecord.prototype, "attributeName"),
    nextSibling: getterFor(MutationRecord.prototype, "nextSibling"),
    oldValue: getterFor(MutationRecord.prototype, "oldValue"),
    previousSibling: getterFor(MutationRecord.prototype, "previousSibling"),
    removedNodes: getterFor(MutationRecord.prototype, "removedNodes"),
    target: getterFor(MutationRecord.prototype, "target"),
    type: getterFor(MutationRecord.prototype, "type"),
  });

  const inputStateProperties = freeze([
    "checked",
    "disabled",
    "files",
    "form",
    "indeterminate",
    "name",
    "readOnly",
    "selectionDirection",
    "selectionEnd",
    "selectionStart",
    "type",
    "value",
  ]);
  const textareaStateProperties = freeze([
    "disabled",
    "readOnly",
    "selectionDirection",
    "selectionEnd",
    "selectionStart",
    "value",
  ]);
  const selectStateProperties = freeze([
    "disabled",
    "form",
    "length",
    "multiple",
    "options",
    "selectedIndex",
    "value",
  ]);
  const optionStateProperties = freeze([
    "defaultSelected",
    "disabled",
    "form",
    "index",
    "label",
    "selected",
    "text",
    "value",
  ]);

  let terminalSealed = false;
  let activeOwnedPointerOverlay: Element | null = null;
  let activeOwnedPointerIntercept = false;
  let mutationAuditCreated = false;
  const signalTerminalMutation = (): never => {
    reflectApply(nativeConsoleError, nativeConsole, [terminalSentinel]);
    throw new NativeError(terminalSentinel);
  };
  const preserveOwnedPointerFocus = freeze(function preserveOwnedPointerFocus(
    event: Event,
  ): void {
    if (
      activeOwnedPointerIntercept &&
      activeOwnedPointerOverlay !== null &&
      read<EventTarget | null>(eventTargetGet, event) === activeOwnedPointerOverlay
    ) {
      call<void>(eventPreventDefault, event, []);
    }
  });
  call<void>(eventTargetAddEventListener, guardedWindow, [
    "mousedown",
    preserveOwnedPointerFocus,
    true,
  ]);
  interface GuardedListenerRecord {
    readonly target: EventTarget;
    readonly type: string;
    readonly callback: object;
    readonly nativeCallback: object;
    readonly capture: boolean;
    readonly once: boolean;
    readonly passive: boolean;
  }
  let listenerRecords = new NativeArray() as GuardedListenerRecord[];
  const maximumListenerOperations = 256;
  let listenerEpoch = 0;
  let listenerRegistryOverflow = false;
  const advanceListenerEpoch = (): void => {
    listenerEpoch += 1;
    if (listenerEpoch > maximumListenerOperations) listenerRegistryOverflow = true;
  };
  const addListenerOptions = (
    options: unknown,
  ): {
    readonly capture: boolean;
    readonly once: boolean;
    readonly passive: boolean;
  } => {
    if (typeof options === "boolean") {
      return freeze({ capture: options, once: false, passive: false });
    }
    if (
      options === null ||
      options === undefined ||
      (typeof options !== "object" && typeof options !== "function")
    ) {
      return freeze({ capture: false, once: false, passive: false });
    }
    const capture = NativeBoolean(reflectGet(options, "capture"));
    const once = NativeBoolean(reflectGet(options, "once"));
    const passive = NativeBoolean(reflectGet(options, "passive"));
    const signal = reflectGet(options, "signal");
    if (signal !== undefined) {
      throw new NativeError("abort-driven event listener registration is not admitted");
    }
    return freeze({ capture, once, passive });
  };
  const removeListenerCapture = (options: unknown): boolean => {
    if (typeof options === "boolean") return options;
    if (
      options === null ||
      options === undefined ||
      (typeof options !== "object" && typeof options !== "function")
    ) {
      return false;
    }
    return NativeBoolean(reflectGet(options, "capture"));
  };
  const findListenerRecord = (
    target: EventTarget,
    type: string,
    callback: object,
    capture: boolean,
  ): number => {
    for (let index = 0; index < listenerRecords.length; index += 1) {
      const record = listenerRecords[index];
      if (
        record !== undefined &&
        record.target === target &&
        record.type === type &&
        record.callback === callback &&
        record.capture === capture
      ) {
        return index;
      }
    }
    return -1;
  };
  const removeListenerRecordAt = (index: number): void => {
    if (index < 0 || index >= listenerRecords.length) {
      throw new NativeError("listener registry removal index is invalid");
    }
    const retainedRecords = new NativeArray() as GuardedListenerRecord[];
    for (let cursor = 0; cursor < listenerRecords.length; cursor += 1) {
      if (cursor === index) continue;
      const retainedRecord = listenerRecords[cursor];
      if (retainedRecord === undefined) {
        throw new NativeError("listener registry entry disappeared");
      }
      defineProperty(retainedRecords, retainedRecords.length, {
        configurable: false,
        enumerable: true,
        value: retainedRecord,
        writable: false,
      });
    }
    listenerRecords = retainedRecords;
    advanceListenerEpoch();
  };
  const appendListenerRecord = (record: GuardedListenerRecord): void => {
    defineProperty(listenerRecords, listenerRecords.length, {
      configurable: false,
      enumerable: true,
      value: record,
      writable: false,
    });
  };
  defineProperty(EventTarget.prototype, "addEventListener", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: function guardedAddEventListener(
      this: EventTarget,
      typeValue: unknown,
      callbackValue: unknown,
      optionsValue?: unknown,
    ): void {
      if (terminalSealed) signalTerminalMutation();
      if (typeof typeValue !== "string") {
        throw new NativeError("event listener type must be a primitive string");
      }
      const type = typeValue;
      const normalized = addListenerOptions(optionsValue);
      if (
        callbackValue === null ||
        callbackValue === undefined ||
        (typeof callbackValue !== "function" && typeof callbackValue !== "object")
      ) {
        call<void>(eventTargetAddEventListener, this, [
          type,
          callbackValue,
          normalized,
        ]);
        return;
      }
      const callback = callbackValue as object;
      const existingIndex = findListenerRecord(
        this,
        type,
        callback,
        normalized.capture,
      );
      if (existingIndex >= 0) {
        const existing = listenerRecords[existingIndex];
        if (existing === undefined) {
          throw new NativeError("listener registry entry disappeared");
        }
        call<void>(eventTargetAddEventListener, this, [
          type,
          existing.nativeCallback,
          normalized,
        ]);
        return;
      }

      let record: GuardedListenerRecord | undefined;
      const nativeCallback = normalized.once
        ? freeze(function guardedOnceListener(this: EventTarget, event: Event): void {
            if (terminalSealed) signalTerminalMutation();
            if (record === undefined) {
              throw new NativeError("once listener registry entry is unavailable");
            }
            const index = findListenerRecord(
              record.target,
              record.type,
              record.callback,
              record.capture,
            );
            if (index < 0 || listenerRecords[index] !== record) {
              throw new NativeError("once listener registry identity changed");
            }
            removeListenerRecordAt(index);
            if (typeof callbackValue === "function") {
              reflectApply(callbackValue, this, [event]);
              return;
            }
            const handleEvent = reflectGet(callbackValue, "handleEvent");
            if (typeof handleEvent === "function") {
              reflectApply(handleEvent, callbackValue, [event]);
            }
          })
        : callback;
      record = freeze({
        target: this,
        type,
        callback,
        nativeCallback,
        capture: normalized.capture,
        once: normalized.once,
        passive: normalized.passive,
      });
      call<void>(eventTargetAddEventListener, this, [type, nativeCallback, normalized]);
      appendListenerRecord(record);
      advanceListenerEpoch();
    },
  });
  defineProperty(EventTarget.prototype, "removeEventListener", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: function guardedRemoveEventListener(
      this: EventTarget,
      typeValue: unknown,
      callbackValue: unknown,
      optionsValue?: unknown,
    ): void {
      if (terminalSealed) signalTerminalMutation();
      if (typeof typeValue !== "string") {
        throw new NativeError("event listener type must be a primitive string");
      }
      const type = typeValue;
      const capture = removeListenerCapture(optionsValue);
      if (
        callbackValue === null ||
        callbackValue === undefined ||
        (typeof callbackValue !== "function" && typeof callbackValue !== "object")
      ) {
        call<void>(eventTargetRemoveEventListener, this, [
          type,
          callbackValue,
          capture,
        ]);
        return;
      }
      const callback = callbackValue as object;
      const index = findListenerRecord(this, type, callback, capture);
      if (index < 0) {
        call<void>(eventTargetRemoveEventListener, this, [type, callback, capture]);
        return;
      }
      const record = listenerRecords[index];
      if (record === undefined) {
        throw new NativeError("listener registry entry disappeared");
      }
      call<void>(eventTargetRemoveEventListener, this, [
        type,
        record.nativeCallback,
        capture,
      ]);
      removeListenerRecordAt(index);
    },
  });
  const handlerPrototypes = new NativeArray() as object[];
  const seenHandlerPrototypes = new NativeWeakSet<object>();
  const appendHandlerPrototype = (prototype: object): void => {
    if (seenHandlerPrototypes.has(prototype)) return;
    seenHandlerPrototypes.add(prototype);
    defineProperty(handlerPrototypes, handlerPrototypes.length, {
      configurable: false,
      enumerable: true,
      value: prototype,
      writable: false,
    });
  };
  for (const prototype of [
    EventTarget.prototype,
    Window.prototype,
    Document.prototype,
    Element.prototype,
    HTMLElement.prototype,
    SVGElement.prototype,
    HTMLBodyElement.prototype,
  ]) {
    appendHandlerPrototype(prototype);
  }
  const globalPropertyNames = getOwnPropertyNames(guardedWindow);
  for (let index = 0; index < globalPropertyNames.length; index += 1) {
    const name = globalPropertyNames[index];
    if (name === undefined) continue;
    const descriptor = getOwnPropertyDescriptor(guardedWindow, name);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "function"
    ) {
      continue;
    }
    const prototypeDescriptor = getOwnPropertyDescriptor(descriptor.value, "prototype");
    if (
      prototypeDescriptor === undefined ||
      !("value" in prototypeDescriptor) ||
      prototypeDescriptor.value === null ||
      typeof prototypeDescriptor.value !== "object"
    ) {
      continue;
    }
    const prototype = prototypeDescriptor.value;
    let ancestor: object | null = prototype;
    let depth = 0;
    while (ancestor !== null && ancestor !== EventTarget.prototype && depth < 32) {
      ancestor = getPrototypeOf(ancestor);
      depth += 1;
    }
    if (ancestor === EventTarget.prototype) appendHandlerPrototype(prototype);
  }
  for (
    let prototypeIndex = 0;
    prototypeIndex < handlerPrototypes.length;
    prototypeIndex += 1
  ) {
    const prototype = handlerPrototypes[prototypeIndex];
    if (prototype === undefined) {
      throw new NativeError("event-handler prototype registry is sparse");
    }
    const propertyNames = getOwnPropertyNames(prototype);
    for (let index = 0; index < propertyNames.length; index += 1) {
      const property = propertyNames[index];
      if (
        property === undefined ||
        property.length < 3 ||
        property[0] !== "o" ||
        property[1] !== "n"
      ) {
        continue;
      }
      const descriptor = getOwnPropertyDescriptor(prototype, property);
      if (
        descriptor === undefined ||
        descriptor.get === undefined ||
        descriptor.set === undefined ||
        !descriptor.configurable
      ) {
        throw new NativeError(`event handler ${property} cannot be guarded`);
      }
      const nativeGet = descriptor.get;
      const nativeSet = descriptor.set;
      defineProperty(prototype, property, {
        configurable: false,
        enumerable: descriptor.enumerable ?? true,
        get() {
          return reflectApply(nativeGet, this, []);
        },
        set(value: unknown): void {
          if (terminalSealed) signalTerminalMutation();
          const before = reflectApply(nativeGet, this, []);
          reflectApply(nativeSet, this, [value]);
          const after = reflectApply(nativeGet, this, []);
          if (before !== after) advanceListenerEpoch();
        },
      });
    }
  }
  const guardAccessor = (prototype: object, property: string): void => {
    const descriptor = descriptorFor(prototype, property);
    if (descriptor.get === undefined || !descriptor.configurable) {
      throw new NativeError(`terminal ${property} accessor cannot be guarded`);
    }
    const nativeGet = descriptor.get;
    const nativeSet = descriptor.set;
    const guardedDescriptor: PropertyDescriptor = {
      configurable: false,
      enumerable: descriptor.enumerable ?? true,
      get() {
        return reflectApply(nativeGet, this, []);
      },
    };
    if (nativeSet !== undefined) {
      guardedDescriptor.set = function guardedTerminalStateWrite(
        this: unknown,
        value: unknown,
      ): void {
        if (terminalSealed) signalTerminalMutation();
        reflectApply(nativeSet, this, [value]);
      };
    }
    defineProperty(prototype, property, guardedDescriptor);
  };
  const guardMethod = (prototype: object, property: string): void => {
    const descriptor = descriptorFor(prototype, property);
    if (typeof descriptor.value !== "function" || !descriptor.configurable) {
      throw new NativeError(`terminal ${property} method cannot be guarded`);
    }
    const nativeMethod = descriptor.value as (
      this: unknown,
      ...args: unknown[]
    ) => unknown;
    defineProperty(prototype, property, {
      configurable: false,
      enumerable: descriptor.enumerable ?? false,
      writable: false,
      value: function guardedTerminalOperation(...args: unknown[]): unknown {
        if (terminalSealed) signalTerminalMutation();
        return reflectApply(nativeMethod, this, args);
      },
    });
  };
  for (const property of [
    "checked",
    "defaultChecked",
    "defaultValue",
    "disabled",
    "files",
    "form",
    "indeterminate",
    "name",
    "readOnly",
    "selectionDirection",
    "selectionEnd",
    "selectionStart",
    "type",
    "value",
    "valueAsDate",
    "valueAsNumber",
  ]) {
    guardAccessor(inputPrototype, property);
  }
  for (const property of [
    "defaultValue",
    "disabled",
    "form",
    "readOnly",
    "selectionDirection",
    "selectionEnd",
    "selectionStart",
    "value",
  ]) {
    guardAccessor(textareaPrototype, property);
  }
  for (const property of [
    "disabled",
    "form",
    "length",
    "multiple",
    "options",
    "selectedIndex",
    "value",
  ]) {
    guardAccessor(selectPrototype, property);
  }
  for (const property of optionStateProperties) {
    guardAccessor(optionPrototype, property);
  }
  guardAccessor(Document.prototype, "activeElement");
  guardAccessor(Document.prototype, "adoptedStyleSheets");
  guardAccessor(Node.prototype, "isConnected");
  guardAccessor(Node.prototype, "textContent");
  guardAccessor(Element.prototype, "scrollLeft");
  guardAccessor(Element.prototype, "scrollTop");
  for (const property of [
    "select",
    "setRangeText",
    "setSelectionRange",
    "stepDown",
    "stepUp",
  ]) {
    guardMethod(inputPrototype, property);
  }
  for (const property of ["select", "setRangeText", "setSelectionRange"]) {
    guardMethod(textareaPrototype, property);
  }
  for (const prototype of [
    inputPrototype,
    selectPrototype,
    textareaPrototype,
    buttonPrototype,
  ]) {
    for (const property of ["checkValidity", "reportValidity", "setCustomValidity"]) {
      guardMethod(prototype, property);
    }
  }
  guardMethod(HTMLFormElement.prototype, "reset");
  for (const property of ["reportValidity", "requestSubmit", "submit"]) {
    guardMethod(HTMLFormElement.prototype, property);
  }
  for (const property of ["blur", "click", "focus"]) {
    guardMethod(HTMLElement.prototype, property);
  }
  guardMethod(EventTarget.prototype, "dispatchEvent");
  guardMethod(Element.prototype, "animate");
  for (const property of ["scroll", "scrollBy", "scrollIntoView", "scrollTo"]) {
    guardMethod(Element.prototype, property);
  }
  for (const property of ["scroll", "scrollBy", "scrollTo"]) {
    guardMethod(globalThis, property);
  }
  for (const property of [
    "addRule",
    "deleteRule",
    "insertRule",
    "removeRule",
    "replace",
    "replaceSync",
  ]) {
    guardMethod(CSSStyleSheet.prototype, property);
  }

  const assertExactPrototypeAndNoOwnState = (
    element: Element,
    prototype: object,
    properties: readonly string[],
  ): void => {
    if (getPrototypeOf(element) !== prototype) {
      throw new NativeError("control prototype differs from its native ABI");
    }
    for (let index = 0; index < properties.length; index += 1) {
      const property = properties[index];
      if (
        property !== undefined &&
        getOwnPropertyDescriptor(element, property) !== undefined
      ) {
        throw new NativeError(`control has an own ${property} state descriptor`);
      }
    }
  };
  const optionElements = (element: HTMLSelectElement): readonly Element[] => {
    const collection = read<HTMLCollection>(selectGetters.options, element);
    const length = read<number>(collectionLengthGet, collection);
    const result = new NativeArray(length) as Element[];
    for (let index = 0; index < length; index += 1) {
      const option = call<Element | null>(collectionItem, collection, [index]);
      if (option === null || getPrototypeOf(option) !== optionPrototype) {
        throw new NativeError("select options differ from the native option ABI");
      }
      defineProperty(result, index, {
        configurable: false,
        enumerable: true,
        value: option,
        writable: false,
      });
    }
    return freeze(result);
  };
  const ownerSelect = (element: HTMLOptionElement): HTMLSelectElement | null => {
    let parent = read<Node | null>(nodeParentGet, element);
    while (parent !== null) {
      if (getPrototypeOf(parent) === selectPrototype) {
        return parent as HTMLSelectElement;
      }
      parent = read<Node | null>(nodeParentGet, parent);
    }
    return null;
  };
  const radioGroupPeerCount = (element: HTMLInputElement): number => {
    const name = read<string>(inputGetters.name, element);
    if (name === "") return 0;
    const form = read<HTMLFormElement | null>(inputGetters.form, element);
    const candidates = call<NodeList>(documentQuerySelectorAll, document, [
      'input[type="radio"]',
    ]);
    const length = read<number>(nodeListLengthGet, candidates);
    let count = 0;
    for (let index = 0; index < length; index += 1) {
      const candidate = call<Node | null>(nodeListItem, candidates, [index]);
      if (
        candidate !== null &&
        candidate !== element &&
        read<string>(inputGetters.type, candidate) === "radio" &&
        read<string>(inputGetters.name, candidate) === name &&
        read<HTMLFormElement | null>(inputGetters.form, candidate) === form
      ) {
        count += 1;
      }
    }
    return count;
  };
  const controlState = (element: Element): PilotNativeControlState => {
    const prototype = getPrototypeOf(element);
    if (prototype === selectPrototype) {
      assertExactPrototypeAndNoOwnState(
        element,
        selectPrototype,
        selectStateProperties,
      );
      const options = optionElements(element as HTMLSelectElement);
      const optionValues = new NativeArray(options.length) as string[];
      const optionSelected = new NativeArray(options.length) as boolean[];
      for (let index = 0; index < options.length; index += 1) {
        const option = options[index];
        if (option === undefined) {
          throw new NativeError("select option collection is sparse");
        }
        assertExactPrototypeAndNoOwnState(
          option,
          optionPrototype,
          optionStateProperties,
        );
        defineProperty(optionValues, index, {
          configurable: false,
          enumerable: true,
          value: read<string>(optionGetters.value, option),
          writable: false,
        });
        defineProperty(optionSelected, index, {
          configurable: false,
          enumerable: true,
          value: read<boolean>(optionGetters.selected, option),
          writable: false,
        });
      }
      return freeze({
        kind: "select" as const,
        disabled: read<boolean>(selectGetters.disabled, element),
        multiple: read<boolean>(selectGetters.multiple, element),
        value: read<string>(selectGetters.value, element),
        selectedIndex: read<number>(selectGetters.selectedIndex, element),
        optionValues: freeze(optionValues),
        optionSelected: freeze(optionSelected),
      });
    }
    if (prototype === inputPrototype) {
      assertExactPrototypeAndNoOwnState(element, inputPrototype, inputStateProperties);
      const files = read<FileList | null>(inputGetters.files, element);
      const type = read<string>(inputGetters.type, element);
      return freeze({
        kind: "input" as const,
        type,
        disabled: read<boolean>(inputGetters.disabled, element),
        readOnly: read<boolean>(inputGetters.readOnly, element),
        value: read<string>(inputGetters.value, element),
        checked: read<boolean>(inputGetters.checked, element),
        indeterminate: read<boolean>(inputGetters.indeterminate, element),
        groupPeerCount:
          type === "radio" ? radioGroupPeerCount(element as HTMLInputElement) : 0,
        filesLength: files === null ? 0 : read<number>(fileListLengthGet, files),
        selectionStart: read<number | null>(inputGetters.selectionStart, element),
        selectionEnd: read<number | null>(inputGetters.selectionEnd, element),
        selectionDirection: read<string | null>(
          inputGetters.selectionDirection,
          element,
        ),
      });
    }
    if (prototype === textareaPrototype) {
      assertExactPrototypeAndNoOwnState(
        element,
        textareaPrototype,
        textareaStateProperties,
      );
      return freeze({
        kind: "textarea" as const,
        disabled: read<boolean>(textareaGetters.disabled, element),
        readOnly: read<boolean>(textareaGetters.readOnly, element),
        value: read<string>(textareaGetters.value, element),
        selectionStart: read<number>(textareaGetters.selectionStart, element),
        selectionEnd: read<number>(textareaGetters.selectionEnd, element),
        selectionDirection: read<string>(textareaGetters.selectionDirection, element),
      });
    }
    if (prototype === optionPrototype) {
      assertExactPrototypeAndNoOwnState(
        element,
        optionPrototype,
        optionStateProperties,
      );
      return freeze({
        kind: "option" as const,
        selected: read<boolean>(optionGetters.selected, element),
        ownerSelect: ownerSelect(element as HTMLOptionElement),
      });
    }
    return freeze({ kind: "other" as const });
  };
  const controlMatches = (
    element: Element,
    stateName: "value" | "checked" | null,
    expectedState: string | boolean | null,
  ): boolean => {
    const state = controlState(element);
    if (stateName === "value" && typeof expectedState === "string") {
      if (state.kind === "select") {
        let selectedCount = 0;
        let selectedIndex = -1;
        let uniqueValues = true;
        for (let index = 0; index < state.optionValues.length; index += 1) {
          if (state.optionSelected[index] === true) {
            selectedCount += 1;
            selectedIndex = index;
          }
          for (let peer = 0; peer < index; peer += 1) {
            if (state.optionValues[peer] === state.optionValues[index]) {
              uniqueValues = false;
            }
          }
        }
        return (
          !state.disabled &&
          !state.multiple &&
          state.optionValues.length >= 2 &&
          uniqueValues &&
          selectedCount === 1 &&
          selectedIndex === state.selectedIndex &&
          state.optionValues[state.selectedIndex] === expectedState &&
          state.value === expectedState
        );
      }
      if (state.kind === "input") {
        return (
          (state.type === "email" ||
            state.type === "search" ||
            state.type === "tel" ||
            state.type === "text" ||
            state.type === "url") &&
          !state.disabled &&
          !state.readOnly &&
          state.value === expectedState
        );
      }
      return (
        state.kind === "textarea" &&
        !state.disabled &&
        !state.readOnly &&
        state.value === expectedState
      );
    }
    return (
      stateName === "checked" &&
      typeof expectedState === "boolean" &&
      state.kind === "input" &&
      state.type === "radio" &&
      !state.disabled &&
      !state.indeterminate &&
      state.checked === expectedState &&
      state.groupPeerCount === 0
    );
  };
  const nativeButtonMatches = (element: Element, requireEnabled: boolean): boolean =>
    getPrototypeOf(element) === buttonPrototype &&
    getOwnPropertyDescriptor(element, "disabled") === undefined &&
    (!requireEnabled ||
      (!read<boolean>(buttonDisabledGet, element) &&
        !call<boolean>(elementMatches, element, [":disabled"])));
  const sourcePointerGeometry = (primary: Element): SourcePointerGeometry => {
    const rect = call<DOMRect>(elementGetBoundingClientRect, primary, []);
    const x = read<number>(domRectXGet, rect);
    const y = read<number>(domRectYGet, rect);
    const width = read<number>(domRectWidthGet, rect);
    const height = read<number>(domRectHeightGet, rect);
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const viewportWidth = read<number>(windowInnerWidthGet, guardedWindow);
    const viewportHeight = read<number>(windowInnerHeightGet, guardedWindow);
    const scrollX = read<number>(windowScrollXGet, guardedWindow);
    const scrollY = read<number>(windowScrollYGet, guardedWindow);
    const style = call<CSSStyleDeclaration>(windowGetComputedStyle, guardedWindow, [
      primary,
    ]);
    const property = (name: string): string =>
      call<string>(cssStyleGetPropertyValue, style, [name]);
    const hit = call<Element | null>(documentElementFromPoint, guardedDocument, [
      centerX,
      centerY,
    ]);
    const numericEvidence = [
      x,
      y,
      width,
      height,
      centerX,
      centerY,
      viewportWidth,
      viewportHeight,
      scrollX,
      scrollY,
    ];
    for (let index = 0; index < numericEvidence.length; index += 1) {
      if (!numberIsFinite(numericEvidence[index])) {
        throw new NativeError("primary source geometry is not finite");
      }
    }
    if (
      !read<boolean>(nodeIsConnectedGet, primary) ||
      !nativeButtonMatches(primary, true) ||
      width <= 0 ||
      height <= 0 ||
      x < 0 ||
      y < 0 ||
      x + width > viewportWidth ||
      y + height > viewportHeight ||
      scrollX !== 0 ||
      scrollY !== 0 ||
      property("display") === "none" ||
      property("visibility") !== "visible" ||
      property("pointer-events") === "none" ||
      property("opacity") !== "1" ||
      property("clip-path") !== "none" ||
      property("filter") !== "none" ||
      property("mask-image") !== "none" ||
      property("content-visibility") === "hidden" ||
      hit !== primary
    ) {
      throw new NativeError(
        "primary source border box is not a fully visible exact native hit target",
      );
    }
    return freeze({ x, y, width, height, centerX, centerY, scrollX, scrollY });
  };
  const predicateSnapshot = (
    primary: Element,
    clipHost: Element,
    contentPressure: Element,
    sourcePoint: { readonly x: number; readonly y: number },
  ) => {
    const rectFor = (element: Element) => {
      const rect = call<DOMRect>(elementGetBoundingClientRect, element, []);
      return freeze({
        x: read<number>(domRectXGet, rect),
        y: read<number>(domRectYGet, rect),
        width: read<number>(domRectWidthGet, rect),
        height: read<number>(domRectHeightGet, rect),
      });
    };
    const property = (style: CSSStyleDeclaration, name: string): string =>
      call<string>(cssStyleGetPropertyValue, style, [name]);
    const primaryRect = rectFor(primary);
    const clipRect = rectFor(clipHost);
    const viewportWidth = read<number>(windowInnerWidthGet, guardedWindow);
    const viewportHeight = read<number>(windowInnerHeightGet, guardedWindow);
    const scrollX = read<number>(windowScrollXGet, guardedWindow);
    const scrollY = read<number>(windowScrollYGet, guardedWindow);
    const clipClientLeft = read<number>(elementClientLeftGet, clipHost);
    const clipClientTop = read<number>(elementClientTopGet, clipHost);
    const clipClientWidth = read<number>(elementClientWidthGet, clipHost);
    const clipClientHeight = read<number>(elementClientHeightGet, clipHost);
    const contentClientWidth = read<number>(elementClientWidthGet, contentPressure);
    const contentClientHeight = read<number>(elementClientHeightGet, contentPressure);
    const contentScrollWidth = read<number>(elementScrollWidthGet, contentPressure);
    const contentScrollHeight = read<number>(elementScrollHeightGet, contentPressure);
    const numericEvidence = [
      primaryRect.x,
      primaryRect.y,
      primaryRect.width,
      primaryRect.height,
      clipRect.x,
      clipRect.y,
      clipRect.width,
      clipRect.height,
      sourcePoint.x,
      sourcePoint.y,
      viewportWidth,
      viewportHeight,
      scrollX,
      scrollY,
      clipClientLeft,
      clipClientTop,
      clipClientWidth,
      clipClientHeight,
      contentClientWidth,
      contentClientHeight,
      contentScrollWidth,
      contentScrollHeight,
    ];
    for (let index = 0; index < numericEvidence.length; index += 1) {
      if (!numberIsFinite(numericEvidence[index])) {
        throw new NativeError("Pilot predicate geometry is not finite");
      }
    }
    if (
      !read<boolean>(nodeIsConnectedGet, primary) ||
      !read<boolean>(nodeIsConnectedGet, clipHost) ||
      !read<boolean>(nodeIsConnectedGet, contentPressure) ||
      primaryRect.width <= 0 ||
      primaryRect.height <= 0 ||
      clipClientWidth <= 0 ||
      clipClientHeight <= 0 ||
      contentClientWidth <= 0 ||
      contentClientHeight <= 0 ||
      viewportWidth <= 0 ||
      viewportHeight <= 0 ||
      scrollX !== 0 ||
      scrollY !== 0
    ) {
      throw new NativeError(
        "Pilot predicate nodes, geometry, viewport, or scroll state is invalid",
      );
    }
    const hit = call<Element | null>(documentElementFromPoint, guardedDocument, [
      sourcePoint.x,
      sourcePoint.y,
    ]);
    const hitPrimary = hit === primary;
    const sourcePointWithinPrimary =
      sourcePoint.x >= primaryRect.x &&
      sourcePoint.y >= primaryRect.y &&
      sourcePoint.x < primaryRect.x + primaryRect.width &&
      sourcePoint.y < primaryRect.y + primaryRect.height;
    const primaryStyle = call<CSSStyleDeclaration>(
      windowGetComputedStyle,
      guardedWindow,
      [primary],
    );
    const insetX = mathMin(1, primaryRect.width / 4);
    const insetY = mathMin(1, primaryRect.height / 4);
    const cornerPoints = freeze([
      freeze({ x: primaryRect.x + insetX, y: primaryRect.y + insetY }),
      freeze({
        x: primaryRect.x + primaryRect.width - insetX,
        y: primaryRect.y + insetY,
      }),
      freeze({
        x: primaryRect.x + insetX,
        y: primaryRect.y + primaryRect.height - insetY,
      }),
      freeze({
        x: primaryRect.x + primaryRect.width - insetX,
        y: primaryRect.y + primaryRect.height - insetY,
      }),
    ]);
    let cornersHitPrimary = true;
    for (let index = 0; index < cornerPoints.length; index += 1) {
      const point = cornerPoints[index];
      if (
        point === undefined ||
        call<Element | null>(documentElementFromPoint, guardedDocument, [
          point.x,
          point.y,
        ]) !== primary
      ) {
        cornersHitPrimary = false;
      }
    }
    let ancestorsAdmitPrimary = true;
    let clipHostSeen = false;
    let ancestor = read<Node | null>(nodeParentGet, primary);
    let ancestorDepth = 0;
    while (ancestor !== null && ancestor !== guardedDocument) {
      ancestorDepth += 1;
      if (
        ancestorDepth > 64 ||
        read<number>(nodeTypeGet, ancestor) !== elementNodeType
      ) {
        throw new NativeError("primary ancestor chain is invalid or over budget");
      }
      const element = ancestor as Element;
      if (element === clipHost) clipHostSeen = true;
      const ancestorRect = rectFor(element);
      const ancestorStyle = call<CSSStyleDeclaration>(
        windowGetComputedStyle,
        guardedWindow,
        [element],
      );
      const clientLeft = read<number>(elementClientLeftGet, element);
      const clientTop = read<number>(elementClientTopGet, element);
      const clientWidth = read<number>(elementClientWidthGet, element);
      const clientHeight = read<number>(elementClientHeightGet, element);
      const ancestorNumericEvidence = [
        ancestorRect.x,
        ancestorRect.y,
        ancestorRect.width,
        ancestorRect.height,
        clientLeft,
        clientTop,
        clientWidth,
        clientHeight,
      ];
      for (let index = 0; index < ancestorNumericEvidence.length; index += 1) {
        if (!numberIsFinite(ancestorNumericEvidence[index])) {
          throw new NativeError("primary ancestor geometry is not finite");
        }
      }
      const overflowX = property(ancestorStyle, "overflow-x");
      const overflowY = property(ancestorStyle, "overflow-y");
      const clientX = ancestorRect.x + clientLeft;
      const clientY = ancestorRect.y + clientTop;
      if (
        property(ancestorStyle, "display") === "none" ||
        property(ancestorStyle, "visibility") !== "visible" ||
        property(ancestorStyle, "opacity") !== "1" ||
        property(ancestorStyle, "clip-path") !== "none" ||
        property(ancestorStyle, "filter") !== "none" ||
        property(ancestorStyle, "mask-image") !== "none" ||
        property(ancestorStyle, "content-visibility") === "hidden" ||
        (overflowX !== "visible" &&
          (clientWidth <= 0 ||
            primaryRect.x < clientX ||
            primaryRect.x + primaryRect.width > clientX + clientWidth)) ||
        (overflowY !== "visible" &&
          (clientHeight <= 0 ||
            primaryRect.y < clientY ||
            primaryRect.y + primaryRect.height > clientY + clientHeight))
      ) {
        ancestorsAdmitPrimary = false;
      }
      ancestor = read<Node | null>(nodeParentGet, element);
    }
    if (ancestor !== guardedDocument || !clipHostSeen) {
      throw new NativeError(
        "primary must reach the guarded document through its retained clip host",
      );
    }
    const primaryFullyVisible =
      primaryRect.x >= 0 &&
      primaryRect.y >= 0 &&
      primaryRect.x + primaryRect.width <= viewportWidth &&
      primaryRect.y + primaryRect.height <= viewportHeight &&
      property(primaryStyle, "display") !== "none" &&
      property(primaryStyle, "visibility") === "visible" &&
      property(primaryStyle, "pointer-events") !== "none" &&
      property(primaryStyle, "opacity") === "1" &&
      property(primaryStyle, "clip-path") === "none" &&
      property(primaryStyle, "filter") === "none" &&
      property(primaryStyle, "mask-image") === "none" &&
      property(primaryStyle, "content-visibility") !== "hidden" &&
      cornersHitPrimary &&
      ancestorsAdmitPrimary;
    const primaryEnabled = nativeButtonMatches(primary, true);
    return freeze({
      hitPrimary,
      primaryFullyVisible,
      sourcePointWithinPrimary,
      primaryEnabled,
      focusReachesPrimary:
        read<Element | null>(documentActiveElementGet, guardedDocument) === primary,
      contentContained:
        contentScrollWidth <= contentClientWidth &&
        contentScrollHeight <= contentClientHeight,
      foregroundColor: property(primaryStyle, "color"),
      backgroundColor: property(primaryStyle, "background-color"),
      backgroundImage: property(primaryStyle, "background-image"),
      opacity: property(primaryStyle, "opacity"),
    });
  };
  const pointerComputedStyleProperties = freeze([
    "display",
    "position",
    "visibility",
    "opacity",
    "pointer-events",
    "cursor",
    "overflow-x",
    "overflow-y",
    "clip-path",
    "filter",
    "mask-image",
    "content-visibility",
    "transform",
    "z-index",
    "box-sizing",
    "left",
    "top",
    "width",
    "height",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "color",
    "background-color",
    "background-image",
    "box-shadow",
    "outline-width",
  ]);
  const pointerCleanBoundaryProjection = (
    primary: Element,
    sourcePoint: Readonly<{ x: number; y: number }>,
    trackedElements: readonly Element[],
  ): PilotPointerCleanBoundaryProjection => {
    const defineArrayValue = <Value>(
      array: Value[],
      index: number,
      value: Value,
    ): void => {
      defineProperty(array, index, {
        configurable: false,
        enumerable: true,
        value,
        writable: false,
      });
    };
    const geometry = sourcePointerGeometry(primary);
    if (
      sourcePoint === null ||
      typeof sourcePoint !== "object" ||
      !numberIsFinite(sourcePoint.x) ||
      !numberIsFinite(sourcePoint.y) ||
      mathAbs(sourcePoint.x - geometry.centerX) > 0.001 ||
      mathAbs(sourcePoint.y - geometry.centerY) > 0.001
    ) {
      throw new NativeError("pointer boundary source point is not the frozen center");
    }
    if (trackedElements.length === 0 || trackedElements.length > 16) {
      throw new NativeError("pointer boundary tracked ABI slots are out of bounds");
    }
    let activeSlotIndex = -1;
    const activeElement = read<Element | null>(
      documentActiveElementGet,
      guardedDocument,
    );
    for (let index = 0; index < trackedElements.length; index += 1) {
      const element = trackedElements[index];
      if (
        element === undefined ||
        !read<boolean>(nodeIsConnectedGet, element) ||
        read<Document | null>(nodeOwnerDocumentGet, element) !== guardedDocument
      ) {
        throw new NativeError("pointer boundary tracked ABI identity is invalid");
      }
      if (activeSlotIndex < 0 && activeElement === element) activeSlotIndex = index;
    }
    if (activeSlotIndex < 0) {
      throw new NativeError("pointer boundary focus is outside the retained ABI");
    }

    const insetX = mathMin(1, geometry.width / 4);
    const insetY = mathMin(1, geometry.height / 4);
    const hitPoints = freeze([
      freeze({ x: geometry.centerX, y: geometry.centerY }),
      freeze({ x: geometry.x + insetX, y: geometry.y + insetY }),
      freeze({
        x: geometry.x + geometry.width - insetX,
        y: geometry.y + insetY,
      }),
      freeze({
        x: geometry.x + insetX,
        y: geometry.y + geometry.height - insetY,
      }),
      freeze({
        x: geometry.x + geometry.width - insetX,
        y: geometry.y + geometry.height - insetY,
      }),
    ]);
    const sampleHits = new NativeArray(hitPoints.length) as true[];
    for (let index = 0; index < hitPoints.length; index += 1) {
      const point = hitPoints[index];
      if (
        point === undefined ||
        call<Element | null>(documentElementFromPoint, guardedDocument, [
          point.x,
          point.y,
        ]) !== primary
      ) {
        throw new NativeError("pointer boundary hit-test projection changed");
      }
      defineArrayValue(sampleHits, index, true);
    }

    const computedStyles = new NativeArray() as {
      readonly depth: number;
      readonly localName: string;
      readonly testId: string | null;
      readonly properties: readonly string[];
    }[];
    let ancestor: Node | null = primary;
    let depth = 0;
    while (ancestor !== guardedDocument) {
      if (
        ancestor === null ||
        depth > 64 ||
        read<number>(nodeTypeGet, ancestor) !== elementNodeType
      ) {
        throw new NativeError("pointer boundary ancestor chain is invalid");
      }
      const element = ancestor as Element;
      const style = call<CSSStyleDeclaration>(windowGetComputedStyle, guardedWindow, [
        element,
      ]);
      const properties = new NativeArray(
        pointerComputedStyleProperties.length,
      ) as string[];
      for (let index = 0; index < pointerComputedStyleProperties.length; index += 1) {
        const propertyName = pointerComputedStyleProperties[index];
        if (propertyName === undefined) {
          throw new NativeError("pointer computed-style property is absent");
        }
        defineArrayValue(
          properties,
          index,
          call<string>(cssStyleGetPropertyValue, style, [propertyName]),
        );
      }
      defineArrayValue(
        computedStyles,
        computedStyles.length,
        freeze({
          depth,
          localName: read<string>(elementLocalNameGet, element),
          testId: call<string | null>(elementGetAttribute, element, ["data-testid"]),
          properties: freeze(properties),
        }),
      );
      depth += 1;
      ancestor = read<Node | null>(nodeParentGet, element);
    }

    const allElements = call<NodeListOf<Element>>(
      documentQuerySelectorAll,
      guardedDocument,
      ["*"],
    );
    const elementCount = read<number>(nodeListLengthGet, allElements);
    if (elementCount < 1 || elementCount > 2_048) {
      throw new NativeError("pointer boundary document element count is out of bounds");
    }
    const elementScrolls = new NativeArray(elementCount) as {
      readonly index: number;
      readonly localName: string;
      readonly testId: string | null;
      readonly scrollLeft: number;
      readonly scrollTop: number;
    }[];
    for (let index = 0; index < elementCount; index += 1) {
      const element = call<Element | null>(nodeListItem, allElements, [index]);
      if (element === null) {
        throw new NativeError("pointer boundary document element is absent");
      }
      const scrollLeft = read<number>(elementScrollLeftGet, element);
      const scrollTop = read<number>(elementScrollTopGet, element);
      if (!numberIsFinite(scrollLeft) || !numberIsFinite(scrollTop)) {
        throw new NativeError("pointer boundary element scroll is not finite");
      }
      defineArrayValue(
        elementScrolls,
        index,
        freeze({
          index,
          localName: read<string>(elementLocalNameGet, element),
          testId: call<string | null>(elementGetAttribute, element, ["data-testid"]),
          scrollLeft,
          scrollTop,
        }),
      );
    }

    const windowScrollX = read<number>(windowScrollXGet, guardedWindow);
    const windowScrollY = read<number>(windowScrollYGet, guardedWindow);
    if (!numberIsFinite(windowScrollX) || !numberIsFinite(windowScrollY)) {
      throw new NativeError("pointer boundary window scroll is not finite");
    }
    const visualViewport = read<VisualViewport | null>(
      windowVisualViewportGet,
      guardedWindow,
    );
    const visualViewportProjection =
      visualViewport === null
        ? null
        : freeze({
            offsetLeft: read<number>(visualViewportOffsetLeftGet, visualViewport),
            offsetTop: read<number>(visualViewportOffsetTopGet, visualViewport),
            pageLeft: read<number>(visualViewportPageLeftGet, visualViewport),
            pageTop: read<number>(visualViewportPageTopGet, visualViewport),
            scale: read<number>(visualViewportScaleGet, visualViewport),
          });
    if (
      visualViewportProjection !== null &&
      (!numberIsFinite(visualViewportProjection.offsetLeft) ||
        !numberIsFinite(visualViewportProjection.offsetTop) ||
        !numberIsFinite(visualViewportProjection.pageLeft) ||
        !numberIsFinite(visualViewportProjection.pageTop) ||
        !numberIsFinite(visualViewportProjection.scale))
    ) {
      throw new NativeError("pointer boundary visual viewport is not finite");
    }

    return freeze({
      computedStyles: freeze(computedStyles),
      hitTest: freeze({
        geometry,
        samplesHitPrimary: freeze(sampleHits) as unknown as readonly [
          true,
          true,
          true,
          true,
          true,
        ],
      }),
      focusAndScroll: freeze({
        activeSlotIndex,
        windowScrollX,
        windowScrollY,
        visualViewport: visualViewportProjection,
        elements: freeze(elementScrolls),
      }),
    });
  };
  const createMutationAudit = (
    rootElement: Element,
    successElement: Element,
    rootAttribute: string,
  ): PilotMutationAudit => {
    if (mutationAuditCreated) {
      throw new NativeError("Pilot mutation audit can be created only once");
    }
    mutationAuditCreated = true;
    let overflow = false;
    let rootMutationObserved = false;
    let successMutationObserved = false;
    const unexpected = new NativeArray() as string[];
    const maximumRecords = 64;
    let recordCount = 0;
    let sealed = false;
    let pointerState: PilotPointerLifecycleProbe["state"] = "unstarted";
    let pointerPrimary: Element | null = null;
    let pointerMode: PilotPointerMode | null = null;
    let pointerGeometry: SourcePointerGeometry | null = null;
    let pointerBody: HTMLElement | null = null;
    let pointerWrapper: HTMLDivElement | null = null;
    let pointerStyle: HTMLStyleElement | null = null;
    let pointerOverlay: HTMLDivElement | null = null;
    let pointerCssText: string | null = null;
    let pointerInstallCount = 0;
    let pointerRemovalCount = 0;
    let ownedMutationRecordExact = false;
    let pointerMutationAdmissionClean = true;
    let listenerBaselineEpoch = -1;
    let listenerBaseline: readonly GuardedListenerRecord[] | null = null;
    let bodyBaseline: readonly Node[] | null = null;
    let ownedAdmission: {
      readonly change: "added" | "removed";
      readonly wrapper: Node;
      readonly previousSibling: Node | null;
      readonly nextSibling: Node | null;
      readonly nonceStyle: HTMLStyleElement | null;
      readonly nextExpected: "nonce_hiding" | "child_list";
    } | null = null;
    const nodeListIs = (nodes: NodeList, expected: readonly Node[]): boolean => {
      if (read<number>(nodeListLengthGet, nodes) !== expected.length) return false;
      for (let index = 0; index < expected.length; index += 1) {
        if (call<Node | null>(nodeListItem, nodes, [index]) !== expected[index]) {
          return false;
        }
      }
      return true;
    };
    const nodeListEveryText = (nodes: NodeList): boolean => {
      const length = read<number>(nodeListLengthGet, nodes);
      for (let index = 0; index < length; index += 1) {
        const node = call<Node | null>(nodeListItem, nodes, [index]);
        if (node === null || read<number>(nodeTypeGet, node) !== 3) return false;
      }
      return true;
    };
    const process = (records: readonly MutationRecord[]): void => {
      if (sealed && records.length > 0) signalTerminalMutation();
      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (record === undefined) {
          throw new NativeError("mutation audit record is absent");
        }
        recordCount += 1;
        if (recordCount > maximumRecords) {
          overflow = true;
          continue;
        }
        const type = read<string>(mutationRecordGetters.type, record);
        const target = read<Node>(mutationRecordGetters.target, record);
        const attributeName = read<string | null>(
          mutationRecordGetters.attributeName,
          record,
        );
        if (ownedAdmission !== null) {
          const addedNodes = read<NodeList>(mutationRecordGetters.addedNodes, record);
          const removedNodes = read<NodeList>(
            mutationRecordGetters.removedNodes,
            record,
          );
          const previousSibling = read<Node | null>(
            mutationRecordGetters.previousSibling,
            record,
          );
          const nextSibling = read<Node | null>(
            mutationRecordGetters.nextSibling,
            record,
          );
          const oldValue = read<string | null>(mutationRecordGetters.oldValue, record);
          const admission = ownedAdmission;
          const exactNonceHidingRecord =
            admission.nextExpected === "nonce_hiding" &&
            admission.change === "added" &&
            admission.nonceStyle !== null &&
            type === "attributes" &&
            target === admission.nonceStyle &&
            attributeName === "nonce" &&
            oldValue === styleCspNonce &&
            previousSibling === null &&
            nextSibling === null &&
            nodeListIs(addedNodes, []) &&
            nodeListIs(removedNodes, []) &&
            call<string | null>(elementGetAttribute, admission.nonceStyle, [
              "nonce",
            ]) === "" &&
            read<string>(htmlElementNonceGet, admission.nonceStyle) === styleCspNonce;
          if (exactNonceHidingRecord) {
            ownedAdmission = freeze({
              change: admission.change,
              wrapper: admission.wrapper,
              previousSibling: admission.previousSibling,
              nextSibling: admission.nextSibling,
              nonceStyle: admission.nonceStyle,
              nextExpected: "child_list" as const,
            });
            continue;
          }
          const exactOwnedChildListRecord =
            admission.nextExpected === "child_list" &&
            type === "childList" &&
            target === pointerBody &&
            attributeName === null &&
            oldValue === null &&
            previousSibling === admission.previousSibling &&
            nextSibling === admission.nextSibling &&
            nodeListIs(
              addedNodes,
              admission.change === "added" ? [admission.wrapper] : [],
            ) &&
            nodeListIs(
              removedNodes,
              admission.change === "removed" ? [admission.wrapper] : [],
            );
          if (exactOwnedChildListRecord) {
            ownedMutationRecordExact = true;
            ownedAdmission = null;
            continue;
          }
          pointerMutationAdmissionClean = false;
          pointerState = "poisoned";
        }
        if (
          type === "attributes" &&
          target === rootElement &&
          attributeName === rootAttribute
        ) {
          rootMutationObserved = true;
          continue;
        }
        if (type === "childList" && target === successElement) {
          const addedNodes = read<NodeList>(mutationRecordGetters.addedNodes, record);
          const removedNodes = read<NodeList>(
            mutationRecordGetters.removedNodes,
            record,
          );
          const changedNodeCount =
            read<number>(nodeListLengthGet, addedNodes) +
            read<number>(nodeListLengthGet, removedNodes);
          if (
            changedNodeCount > 0 &&
            nodeListEveryText(addedNodes) &&
            nodeListEveryText(removedNodes)
          ) {
            successMutationObserved = true;
            continue;
          }
        }
        if (
          type === "characterData" &&
          read<number>(nodeTypeGet, target) === 3 &&
          read<Node | null>(nodeParentGet, target) === successElement
        ) {
          successMutationObserved = true;
          continue;
        }
        const targetType = read<number>(nodeTypeGet, target);
        const targetName =
          targetType === 1
            ? (call<string | null>(elementGetAttribute, target, ["data-testid"]) ??
              read<string>(elementLocalNameGet, target))
            : `node-${targetType}`;
        if (pointerState !== "unstarted" && pointerState !== "closed") {
          pointerMutationAdmissionClean = false;
          pointerState = "poisoned";
        }
        call<number>(arrayPush, unexpected, [
          `${type}:${targetName}:${attributeName ?? "$NULL"}`,
        ]);
      }
    };
    const observer = new NativeMutationObserver(process);
    call<void>(mutationObserverObserve, observer, [
      guardedDocument,
      {
        subtree: true,
        attributes: true,
        attributeOldValue: true,
        childList: true,
        characterData: true,
        characterDataOldValue: true,
      },
    ]);
    const snapshotAndReset = (): PilotMutationSnapshot => {
      const copiedUnexpected = new NativeArray(unexpected.length) as string[];
      for (let index = 0; index < unexpected.length; index += 1) {
        defineProperty(copiedUnexpected, index, {
          configurable: false,
          enumerable: true,
          value: unexpected[index],
          writable: false,
        });
      }
      const snapshot = freeze({
        overflow,
        unexpected: freeze(copiedUnexpected),
        rootMutationObserved,
        successMutationObserved,
      });
      overflow = false;
      rootMutationObserved = false;
      successMutationObserved = false;
      unexpected.length = 0;
      recordCount = 0;
      return snapshot;
    };
    const pointerFailure = (message: string): never => {
      pointerState = "poisoned";
      pointerMutationAdmissionClean = false;
      throw new NativeError(message);
    };
    const copyChildren = (parent: Node): readonly Node[] => {
      const children = read<NodeList>(nodeChildNodesGet, parent);
      const length = read<number>(nodeListLengthGet, children);
      const copied = new NativeArray(length) as Node[];
      for (let index = 0; index < length; index += 1) {
        const child = call<Node | null>(nodeListItem, children, [index]);
        if (child === null) throw new NativeError("body child identity is absent");
        defineProperty(copied, index, {
          configurable: false,
          enumerable: true,
          value: child,
          writable: false,
        });
      }
      return freeze(copied);
    };
    const sameBodyChildren = (): boolean => {
      if (pointerBody === null || bodyBaseline === null) return false;
      const children = read<NodeList>(nodeChildNodesGet, pointerBody);
      if (read<number>(nodeListLengthGet, children) !== bodyBaseline.length) {
        return false;
      }
      for (let index = 0; index < bodyBaseline.length; index += 1) {
        if (
          call<Node | null>(nodeListItem, children, [index]) !== bodyBaseline[index]
        ) {
          return false;
        }
      }
      return true;
    };
    const sameListenerRegistry = (): boolean => {
      if (
        listenerBaseline === null ||
        listenerRegistryOverflow ||
        listenerEpoch !== listenerBaselineEpoch ||
        listenerRecords.length !== listenerBaseline.length
      ) {
        return false;
      }
      for (let index = 0; index < listenerBaseline.length; index += 1) {
        if (listenerRecords[index] !== listenerBaseline[index]) return false;
      }
      return true;
    };
    const lifecycleProbe = (): PilotPointerLifecycleProbe =>
      freeze({
        state: pointerState,
        installCount: pointerInstallCount as 0 | 1 | 2,
        removalCount: pointerRemovalCount as 0 | 1 | 2,
        activeOwnedHandleCount:
          pointerWrapper === null &&
          pointerOverlay === null &&
          pointerStyle === null &&
          activeOwnedPointerOverlay === null &&
          !activeOwnedPointerIntercept
            ? 0
            : 1,
        listenerRegistryEqual: sameListenerRegistry(),
        listenerRegistryOverflow,
        mutationAdmissionClean:
          pointerMutationAdmissionClean &&
          ownedAdmission === null &&
          unexpected.length === 0 &&
          !overflow,
      });
    const samePointerGeometry = (
      left: SourcePointerGeometry,
      right: SourcePointerGeometry,
    ): boolean =>
      left.x === right.x &&
      left.y === right.y &&
      left.width === right.width &&
      left.height === right.height &&
      left.centerX === right.centerX &&
      left.centerY === right.centerY &&
      left.scrollX === right.scrollX &&
      left.scrollY === right.scrollY;
    const boundPrimaryGeometryEqual = (): boolean => {
      if (pointerPrimary === null || pointerGeometry === null) return false;
      const rect = call<DOMRect>(elementGetBoundingClientRect, pointerPrimary, []);
      const x = read<number>(domRectXGet, rect);
      const y = read<number>(domRectYGet, rect);
      const width = read<number>(domRectWidthGet, rect);
      const height = read<number>(domRectHeightGet, rect);
      return (
        numberIsFinite(x) &&
        numberIsFinite(y) &&
        numberIsFinite(width) &&
        numberIsFinite(height) &&
        x === pointerGeometry.x &&
        y === pointerGeometry.y &&
        width === pointerGeometry.width &&
        height === pointerGeometry.height &&
        x + width / 2 === pointerGeometry.centerX &&
        y + height / 2 === pointerGeometry.centerY &&
        read<number>(windowScrollXGet, guardedWindow) === pointerGeometry.scrollX &&
        read<number>(windowScrollYGet, guardedWindow) === pointerGeometry.scrollY &&
        read<boolean>(nodeIsConnectedGet, pointerPrimary)
      );
    };
    const exactAttributes = (
      element: Element,
      expected: readonly (readonly [string, string])[],
    ): boolean => {
      const attributes = read<NamedNodeMap>(elementAttributesGet, element);
      if (read<number>(namedNodeMapLengthGet, attributes) !== expected.length) {
        return false;
      }
      for (let index = 0; index < expected.length; index += 1) {
        const pair = expected[index];
        if (
          pair === undefined ||
          call<string | null>(elementGetAttribute, element, [pair[0]]) !== pair[1]
        ) {
          return false;
        }
      }
      return true;
    };
    const cssNumber = (value: number): string =>
      objectIs(value, -0) ? "0" : NativeString(value);
    const buildPointerCss = (
      geometry: SourcePointerGeometry,
      mode: PilotPointerMode,
    ): string => {
      const rows = [
        '[data-impactdiff-pilot-owned="pointer-h0"] {',
        "  display: contents !important;",
        "  pointer-events: none !important;",
        "}",
        '[data-impactdiff-pilot-owned="pointer-h0"]::before,',
        '[data-impactdiff-pilot-owned="pointer-h0"]::after,',
        '[data-impactdiff-pilot-owned="pointer-h0"] > [data-impactdiff-pilot-layer="pointer-h0"]::before,',
        '[data-impactdiff-pilot-owned="pointer-h0"] > [data-impactdiff-pilot-layer="pointer-h0"]::after {',
        "  content: none !important;",
        "  display: none !important;",
        "  background: transparent !important;",
        "  background-image: none !important;",
        "  border: 0 !important;",
        "  outline: 0 !important;",
        "  box-shadow: none !important;",
        "  filter: none !important;",
        "  backdrop-filter: none !important;",
        "  opacity: 1 !important;",
        "  animation: none !important;",
        "  transition: none !important;",
        "}",
        '[data-impactdiff-pilot-owned="pointer-h0"] > [data-impactdiff-pilot-layer="pointer-h0"] {',
        "  position: fixed !important;",
        `  left: ${cssNumber(geometry.x)}px !important;`,
        `  top: ${cssNumber(geometry.y)}px !important;`,
        `  width: ${cssNumber(geometry.width)}px !important;`,
        `  height: ${cssNumber(geometry.height)}px !important;`,
        "  z-index: 2147483647 !important;",
        "  display: block !important;",
        "  box-sizing: border-box !important;",
        "  margin: 0 !important;",
        "  padding: 0 !important;",
        "  border: 0 !important;",
        "  outline: 0 !important;",
        "  outline-style: none !important;",
        "  background: transparent !important;",
        "  background-image: none !important;",
        "  opacity: 1 !important;",
        "  visibility: visible !important;",
        "  box-shadow: none !important;",
        "  filter: none !important;",
        "  backdrop-filter: none !important;",
        "  transform: none !important;",
        "  clip-path: none !important;",
        "  mask-image: none !important;",
        "  overflow: visible !important;",
        "  content-visibility: visible !important;",
        "  mix-blend-mode: normal !important;",
        "  text-shadow: none !important;",
        "  animation: none !important;",
        "  transition: none !important;",
        "  cursor: pointer !important;",
        `  pointer-events: ${mode === "intercept" ? "auto" : "none"} !important;`,
        "}",
      ];
      return call<string>(arrayJoin, rows, ["\n"]);
    };
    const pointerLayerProbe = (): PilotPointerLayerProbe => {
      if (
        pointerState !== "installed" ||
        pointerPrimary === null ||
        pointerMode === null ||
        pointerGeometry === null ||
        pointerBody === null ||
        pointerWrapper === null ||
        pointerStyle === null ||
        pointerOverlay === null ||
        activeOwnedPointerOverlay !== pointerOverlay ||
        activeOwnedPointerIntercept !== (pointerMode === "intercept") ||
        pointerCssText === null ||
        pointerInstallCount < 1 ||
        pointerInstallCount > 2
      ) {
        return pointerFailure(
          "owned pointer layer is not in one exact installed state",
        );
      }
      const wrapperChildren = read<NodeList>(nodeChildNodesGet, pointerWrapper);
      const wrapperStyle = call<CSSStyleDeclaration>(
        windowGetComputedStyle,
        guardedWindow,
        [pointerWrapper],
      );
      const overlayStyle = call<CSSStyleDeclaration>(
        windowGetComputedStyle,
        guardedWindow,
        [pointerOverlay],
      );
      const property = (style: CSSStyleDeclaration, name: string): string =>
        call<string>(cssStyleGetPropertyValue, style, [name]);
      const pseudoPaintAbsent = (
        element: Element,
        pseudo: "::before" | "::after",
      ): boolean => {
        const style = call<CSSStyleDeclaration>(windowGetComputedStyle, guardedWindow, [
          element,
          pseudo,
        ]);
        return (
          property(style, "content") === "none" &&
          property(style, "display") === "none" &&
          property(style, "background-color") === "rgba(0, 0, 0, 0)" &&
          property(style, "background-image") === "none" &&
          property(style, "border-top-width") === "0px" &&
          property(style, "border-right-width") === "0px" &&
          property(style, "border-bottom-width") === "0px" &&
          property(style, "border-left-width") === "0px" &&
          property(style, "outline-width") === "0px" &&
          property(style, "box-shadow") === "none" &&
          property(style, "filter") === "none" &&
          property(style, "backdrop-filter") === "none" &&
          property(style, "opacity") === "1" &&
          property(style, "animation-name") === "none" &&
          property(style, "transition-duration") === "0s"
        );
      };
      const rect = call<DOMRect>(elementGetBoundingClientRect, pointerOverlay, []);
      const overlayX = read<number>(domRectXGet, rect);
      const overlayY = read<number>(domRectYGet, rect);
      const overlayWidth = read<number>(domRectWidthGet, rect);
      const overlayHeight = read<number>(domRectHeightGet, rect);
      const sourceHit = call<Element | null>(
        documentElementFromPoint,
        guardedDocument,
        [pointerGeometry.centerX, pointerGeometry.centerY],
      );
      const structureExact =
        getPrototypeOf(pointerWrapper) === divPrototype &&
        getPrototypeOf(pointerStyle) === stylePrototype &&
        getPrototypeOf(pointerOverlay) === divPrototype &&
        read<Document | null>(nodeOwnerDocumentGet, pointerWrapper) ===
          guardedDocument &&
        read<Document | null>(nodeOwnerDocumentGet, pointerStyle) === guardedDocument &&
        read<Document | null>(nodeOwnerDocumentGet, pointerOverlay) ===
          guardedDocument &&
        read<number>(nodeListLengthGet, wrapperChildren) === 2 &&
        call<Node | null>(nodeListItem, wrapperChildren, [0]) === pointerStyle &&
        call<Node | null>(nodeListItem, wrapperChildren, [1]) === pointerOverlay &&
        read<Node | null>(nodeFirstChildGet, pointerWrapper) === pointerStyle &&
        read<Node | null>(nodeLastChildGet, pointerWrapper) === pointerOverlay &&
        activeOwnedPointerOverlay === pointerOverlay &&
        activeOwnedPointerIntercept === (pointerMode === "intercept");
      const attributesExact =
        exactAttributes(pointerWrapper, [
          ["aria-hidden", "true"],
          ["data-impactdiff-pilot-owned", "pointer-h0"],
        ]) &&
        read<number>(
          namedNodeMapLengthGet,
          read<NamedNodeMap>(elementAttributesGet, pointerStyle),
        ) === 1 &&
        read<string>(htmlElementNonceGet, pointerStyle) === styleCspNonce &&
        exactAttributes(pointerOverlay, [
          ["aria-hidden", "true"],
          ["data-impactdiff-pilot-layer", "pointer-h0"],
        ]);
      const geometryExact =
        numberIsFinite(overlayX) &&
        numberIsFinite(overlayY) &&
        numberIsFinite(overlayWidth) &&
        numberIsFinite(overlayHeight) &&
        mathAbs(overlayX - pointerGeometry.x) <= 0.001 &&
        mathAbs(overlayY - pointerGeometry.y) <= 0.001 &&
        mathAbs(overlayWidth - pointerGeometry.width) <= 0.001 &&
        mathAbs(overlayHeight - pointerGeometry.height) <= 0.001 &&
        boundPrimaryGeometryEqual();
      const transparentPaint =
        property(overlayStyle, "background-color") === "rgba(0, 0, 0, 0)" &&
        property(overlayStyle, "background-image") === "none" &&
        property(overlayStyle, "opacity") === "1" &&
        property(overlayStyle, "visibility") === "visible" &&
        property(overlayStyle, "border-top-width") === "0px" &&
        property(overlayStyle, "border-right-width") === "0px" &&
        property(overlayStyle, "border-bottom-width") === "0px" &&
        property(overlayStyle, "border-left-width") === "0px" &&
        property(overlayStyle, "outline-width") === "0px" &&
        property(overlayStyle, "outline-style") === "none" &&
        property(overlayStyle, "box-shadow") === "none" &&
        property(overlayStyle, "text-shadow") === "none" &&
        property(overlayStyle, "filter") === "none" &&
        property(overlayStyle, "backdrop-filter") === "none" &&
        property(overlayStyle, "transform") === "none" &&
        property(overlayStyle, "clip-path") === "none" &&
        property(overlayStyle, "mask-image") === "none" &&
        property(overlayStyle, "mix-blend-mode") === "normal" &&
        property(overlayStyle, "animation-name") === "none" &&
        property(overlayStyle, "transition-duration") === "0s" &&
        pseudoPaintAbsent(pointerWrapper, "::before") &&
        pseudoPaintAbsent(pointerWrapper, "::after") &&
        pseudoPaintAbsent(pointerOverlay, "::before") &&
        pseudoPaintAbsent(pointerOverlay, "::after");
      const stylesheetExact =
        read<Node | null>(nodeParentGet, pointerStyle) === pointerWrapper &&
        read<string | null>(nodeTextContentGet, pointerStyle) === pointerCssText &&
        read<string>(htmlElementNonceGet, pointerStyle) === styleCspNonce &&
        property(wrapperStyle, "display") === "contents" &&
        property(wrapperStyle, "pointer-events") === "none" &&
        property(overlayStyle, "position") === "fixed" &&
        property(overlayStyle, "display") === "block" &&
        property(overlayStyle, "z-index") === "2147483647" &&
        property(overlayStyle, "cursor") === "pointer" &&
        property(overlayStyle, "pointer-events") ===
          (pointerMode === "intercept" ? "auto" : "none");
      return freeze({
        applicationOrdinal: (pointerInstallCount - 1) as 0 | 1,
        pointerMode,
        connected:
          read<boolean>(nodeIsConnectedGet, pointerWrapper) &&
          read<boolean>(nodeIsConnectedGet, pointerOverlay),
        parentIsBody: read<Node | null>(nodeParentGet, pointerWrapper) === pointerBody,
        structureExact,
        attributesExact,
        stylesheetExact,
        geometryExact,
        transparentPaint,
        accessibilityHidden:
          call<string | null>(elementGetAttribute, pointerWrapper, ["aria-hidden"]) ===
            "true" &&
          call<string | null>(elementGetAttribute, pointerOverlay, ["aria-hidden"]) ===
            "true" &&
          call<string | null>(elementGetAttribute, pointerOverlay, ["role"]) === null,
        nonFocusable:
          read<number>(htmlElementTabIndexGet, pointerOverlay) === -1 &&
          !read<boolean>(htmlElementIsContentEditableGet, pointerOverlay) &&
          call<string | null>(elementGetAttribute, pointerOverlay, ["tabindex"]) ===
            null &&
          call<string | null>(elementGetAttribute, pointerOverlay, [
            "contenteditable",
          ]) === null &&
          read<string | null>(nodeTextContentGet, pointerOverlay) === "",
        sourceHit:
          sourceHit === pointerOverlay
            ? "owned_layer"
            : sourceHit === pointerPrimary
              ? "primary"
              : "other",
        mutationRecordExact: ownedMutationRecordExact,
      });
    };
    const processOwnedRecords = (): void => {
      process(call<MutationRecord[]>(mutationObserverTakeRecords, observer, []));
      if (ownedAdmission !== null || !ownedMutationRecordExact) {
        pointerFailure("owned pointer mutation record was absent or malformed");
      }
    };
    return freeze({
      drain(): PilotMutationSnapshot {
        process(call<MutationRecord[]>(mutationObserverTakeRecords, observer, []));
        return snapshotAndReset();
      },
      drainAndDisconnect(): PilotMutationSnapshot {
        const incompletePointerLifecycle =
          pointerState !== "unstarted" && pointerState !== "closed";
        process(call<MutationRecord[]>(mutationObserverTakeRecords, observer, []));
        call<void>(mutationObserverDisconnect, observer, []);
        const snapshot = snapshotAndReset();
        if (incompletePointerLifecycle) {
          return pointerFailure(
            "owned pointer lifecycle was not closed before audit disconnect",
          );
        }
        return snapshot;
      },
      seal(): PilotMutationSnapshot {
        if (sealed) {
          throw new NativeError("mutation audit was sealed more than once");
        }
        if (pointerState !== "unstarted" && pointerState !== "closed") {
          pointerFailure("owned pointer lifecycle was not closed before audit seal");
        }
        process(call<MutationRecord[]>(mutationObserverTakeRecords, observer, []));
        const snapshot = snapshotAndReset();
        sealed = true;
        return snapshot;
      },
      beginOwnedPointerLifecycle(
        primary: Element,
        sourcePoint: Readonly<{ x: number; y: number }>,
        mode: PilotPointerMode,
      ): PilotPointerLifecycleProbe {
        if (sealed || pointerState !== "unstarted") {
          return pointerFailure("owned pointer lifecycle began from an invalid state");
        }
        process(call<MutationRecord[]>(mutationObserverTakeRecords, observer, []));
        if (
          overflow ||
          unexpected.length !== 0 ||
          rootMutationObserved ||
          successMutationObserved ||
          ownedAdmission !== null
        ) {
          return pointerFailure("owned pointer lifecycle began with a dirty runtime");
        }
        snapshotAndReset();
        if (
          (mode !== "intercept" && mode !== "pass_through") ||
          sourcePoint === null ||
          typeof sourcePoint !== "object" ||
          !numberIsFinite(sourcePoint.x) ||
          !numberIsFinite(sourcePoint.y) ||
          typeof styleCspNonce !== "string" ||
          styleCspNonce.length < 1 ||
          styleCspNonce.length > 192
        ) {
          return pointerFailure("owned pointer lifecycle input is malformed");
        }
        const reservedNodes = call<NodeListOf<Element>>(
          documentQuerySelectorAll,
          guardedDocument,
          ["[data-impactdiff-pilot-owned], [data-impactdiff-pilot-layer]"],
        );
        if (read<number>(nodeListLengthGet, reservedNodes) !== 0) {
          return pointerFailure(
            "fixture DOM collides with the reserved pointer intervention namespace",
          );
        }
        const geometry = sourcePointerGeometry(primary);
        const primaryStyle = call<CSSStyleDeclaration>(
          windowGetComputedStyle,
          guardedWindow,
          [primary],
        );
        const primaryCursor = call<string>(cssStyleGetPropertyValue, primaryStyle, [
          "cursor",
        ]);
        if (
          mathAbs(sourcePoint.x - geometry.centerX) > 0.001 ||
          mathAbs(sourcePoint.y - geometry.centerY) > 0.001
        ) {
          return pointerFailure(
            "owned pointer source point differs from the native center",
          );
        }
        if (primaryCursor !== "pointer") {
          return pointerFailure(
            "owned pointer lifecycle requires the exact source pointer cursor",
          );
        }
        const body = read<HTMLElement | null>(documentBodyGet, guardedDocument);
        if (
          body === null ||
          getPrototypeOf(body) !== bodyPrototype ||
          read<Document | null>(nodeOwnerDocumentGet, body) !== guardedDocument
        ) {
          return pointerFailure(
            "owned pointer lifecycle requires the exact native body",
          );
        }
        const listeners = new NativeArray(
          listenerRecords.length,
        ) as GuardedListenerRecord[];
        for (let index = 0; index < listenerRecords.length; index += 1) {
          const record = listenerRecords[index];
          if (record === undefined) {
            return pointerFailure("listener baseline entry is absent");
          }
          defineProperty(listeners, index, {
            configurable: false,
            enumerable: true,
            value: record,
            writable: false,
          });
        }
        pointerPrimary = primary;
        pointerMode = mode;
        pointerGeometry = geometry;
        pointerBody = body;
        listenerBaseline = freeze(listeners);
        listenerBaselineEpoch = listenerEpoch;
        bodyBaseline = copyChildren(body);
        pointerState = "clean";
        return lifecycleProbe();
      },
      installOwnedPointerLayer(): PilotPointerLayerProbe {
        if (
          sealed ||
          pointerState !== "clean" ||
          pointerPrimary === null ||
          pointerMode === null ||
          pointerGeometry === null ||
          pointerBody === null ||
          pointerInstallCount >= 2 ||
          pointerRemovalCount !== pointerInstallCount ||
          !sameBodyChildren() ||
          !sameListenerRegistry()
        ) {
          return pointerFailure(
            "owned pointer layer installation preconditions failed",
          );
        }
        const currentGeometry = sourcePointerGeometry(pointerPrimary);
        if (!samePointerGeometry(currentGeometry, pointerGeometry)) {
          return pointerFailure(
            "owned pointer source geometry drifted before installation",
          );
        }
        const wrapper = call<HTMLDivElement>(documentCreateElement, guardedDocument, [
          "div",
        ]);
        const style = call<HTMLStyleElement>(documentCreateElement, guardedDocument, [
          "style",
        ]);
        const overlay = call<HTMLDivElement>(documentCreateElement, guardedDocument, [
          "div",
        ]);
        if (
          getPrototypeOf(wrapper) !== divPrototype ||
          getPrototypeOf(style) !== stylePrototype ||
          getPrototypeOf(overlay) !== divPrototype
        ) {
          return pointerFailure(
            "owned pointer layer elements are not exact native nodes",
          );
        }
        const cssText = buildPointerCss(pointerGeometry, pointerMode);
        call<void>(elementSetAttribute, wrapper, ["aria-hidden", "true"]);
        call<void>(elementSetAttribute, wrapper, [
          "data-impactdiff-pilot-owned",
          "pointer-h0",
        ]);
        call<void>(elementSetAttribute, style, ["nonce", styleCspNonce]);
        reflectApply(nodeTextContentSet, style, [cssText]);
        call<void>(elementSetAttribute, overlay, ["aria-hidden", "true"]);
        call<void>(elementSetAttribute, overlay, [
          "data-impactdiff-pilot-layer",
          "pointer-h0",
        ]);
        call<Node>(nodeAppendChild, wrapper, [style]);
        call<Node>(nodeAppendChild, wrapper, [overlay]);
        const previousSibling = read<Node | null>(nodeLastChildGet, pointerBody);
        ownedMutationRecordExact = false;
        ownedAdmission = freeze({
          change: "added" as const,
          wrapper,
          previousSibling,
          nextSibling: null,
          nonceStyle: style,
          nextExpected: "nonce_hiding" as const,
        });
        pointerWrapper = wrapper;
        pointerStyle = style;
        pointerOverlay = overlay;
        activeOwnedPointerOverlay = overlay;
        activeOwnedPointerIntercept = pointerMode === "intercept";
        pointerCssText = cssText;
        call<Node>(nodeAppendChild, pointerBody, [wrapper]);
        processOwnedRecords();
        pointerInstallCount += 1;
        pointerState = "installed";
        return pointerLayerProbe();
      },
      probeOwnedPointerLayer(): PilotPointerLayerProbe {
        return pointerLayerProbe();
      },
      removeOwnedPointerLayer(): PilotPointerRemovalProbe {
        if (
          sealed ||
          pointerState !== "installed" ||
          pointerBody === null ||
          pointerWrapper === null ||
          pointerStyle === null ||
          pointerOverlay === null ||
          activeOwnedPointerOverlay !== pointerOverlay ||
          activeOwnedPointerIntercept !== (pointerMode === "intercept") ||
          pointerInstallCount !== pointerRemovalCount + 1
        ) {
          return pointerFailure("owned pointer layer removal preconditions failed");
        }
        const installed = pointerLayerProbe();
        const installedExact =
          installed.connected &&
          installed.parentIsBody &&
          installed.structureExact &&
          installed.attributesExact &&
          installed.stylesheetExact &&
          installed.geometryExact &&
          installed.transparentPaint &&
          installed.accessibilityHidden &&
          installed.nonFocusable &&
          installed.mutationRecordExact &&
          installed.sourceHit ===
            (pointerMode === "intercept" ? "owned_layer" : "primary");
        const wrapper = pointerWrapper;
        const overlay = pointerOverlay;
        const applicationOrdinal = (pointerInstallCount - 1) as 0 | 1;
        const previousSibling = read<Node | null>(nodePreviousSiblingGet, wrapper);
        const nextSibling = read<Node | null>(nodeNextSiblingGet, wrapper);
        ownedMutationRecordExact = false;
        ownedAdmission = freeze({
          change: "removed" as const,
          wrapper,
          previousSibling,
          nextSibling,
          nonceStyle: null,
          nextExpected: "child_list" as const,
        });
        activeOwnedPointerOverlay = null;
        activeOwnedPointerIntercept = false;
        call<Node>(nodeRemoveChild, pointerBody, [wrapper]);
        processOwnedRecords();
        const disconnected =
          !read<boolean>(nodeIsConnectedGet, wrapper) &&
          !read<boolean>(nodeIsConnectedGet, overlay) &&
          read<Node | null>(nodeParentGet, wrapper) === null;
        pointerWrapper = null;
        pointerStyle = null;
        pointerOverlay = null;
        pointerCssText = null;
        pointerRemovalCount += 1;
        const listenerEqual = sameListenerRegistry();
        const bodyEqual = sameBodyChildren();
        const runtimeClean =
          installedExact &&
          ownedMutationRecordExact &&
          disconnected &&
          activeOwnedPointerOverlay === null &&
          !activeOwnedPointerIntercept &&
          listenerEqual &&
          bodyEqual &&
          pointerMutationAdmissionClean &&
          ownedAdmission === null &&
          unexpected.length === 0 &&
          !overflow;
        pointerState = runtimeClean ? "clean" : "poisoned";
        return freeze({
          applicationOrdinal,
          mutationRecordExact: ownedMutationRecordExact,
          ownedHandlesAbsent: disconnected,
          mutationPreimagesEqual: bodyEqual,
          listenerRegistryEqual: listenerEqual,
          runtimeClean,
        });
      },
      finishOwnedPointerLifecycle(): PilotPointerLifecycleProbe {
        if (
          sealed ||
          pointerState !== "clean" ||
          pointerInstallCount !== 2 ||
          pointerRemovalCount !== 2
        ) {
          return pointerFailure("owned pointer lifecycle did not complete twice");
        }
        process(call<MutationRecord[]>(mutationObserverTakeRecords, observer, []));
        if (
          !sameBodyChildren() ||
          !sameListenerRegistry() ||
          ownedAdmission !== null ||
          pointerWrapper !== null ||
          pointerStyle !== null ||
          pointerOverlay !== null ||
          activeOwnedPointerOverlay !== null ||
          activeOwnedPointerIntercept ||
          overflow ||
          unexpected.length !== 0 ||
          rootMutationObserved ||
          successMutationObserved ||
          !pointerMutationAdmissionClean
        ) {
          return pointerFailure("owned pointer lifecycle finished with dirty state");
        }
        pointerState = "closed";
        return lifecycleProbe();
      },
    });
  };
  const api: PilotPageGuardApi = freeze({
    controlState,
    controlMatches,
    nativeButtonMatches,
    predicateSnapshot,
    sourcePointerGeometry,
    pointerCleanBoundaryProjection,
    activeElement: () => read<Element | null>(documentActiveElementGet, document),
    isConnected: (node: Node) => read<boolean>(nodeIsConnectedGet, node),
    getAttribute: (element: Element, name: string) =>
      call<string | null>(elementGetAttribute, element, [name]),
    textContent: (node: Node) => read<string | null>(nodeTextContentGet, node),
    createMutationAudit,
    sealTerminalBoundary(elements: readonly Element[]): void {
      if (terminalSealed) {
        throw new NativeError("terminal boundary was sealed more than once");
      }
      for (let index = 0; index < elements.length; index += 1) {
        const element = elements[index];
        if (element === undefined) {
          throw new NativeError("terminal boundary element is absent");
        }
        const state = controlState(element);
        if (state.kind === "select") {
          const options = optionElements(element as HTMLSelectElement);
          for (let optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
            const option = options[optionIndex];
            if (option === undefined) {
              throw new NativeError("terminal select option is absent");
            }
          }
        }
      }
      terminalSealed = true;
    },
  });
  defineProperty(globalThis, apiName, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: api,
  });

  const denyAuthorShadowRoot = freeze(function denyAuthorShadowRoot(): never {
    throw new DOMException(
      "author shadow roots are disabled in Pilot authoring",
      "NotSupportedError",
    );
  });
  defineProperty(Element.prototype, "attachShadow", {
    value: denyAuthorShadowRoot,
    writable: false,
    enumerable: false,
    configurable: false,
  });
  for (const property of ["RTCPeerConnection", "webkitRTCPeerConnection"] as const) {
    defineProperty(globalThis, property, {
      value: undefined,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }
}
/* node:coverage enable */

async function installPageGuards(page: Page, styleNonce: string): Promise<void> {
  const styleCspNonce = Buffer.from(styleNonce, "utf8").toString("base64");
  try {
    await page.addInitScript(pilotPageGuardInit, {
      apiName: pageGuardApiName,
      styleCspNonce,
      terminalSentinel: terminalMutationSentinel,
    });
  } catch (error) {
    fail(
      "pilot_runtime.page_guard",
      "Pilot pre-navigation page guards could not be installed",
      { cause: error },
    );
  }
}
async function assertNoAuthorShadowRoots(
  page: Page,
  maximumNodes: number,
): Promise<void> {
  let client: CDPSession | undefined;
  const failures: unknown[] = [];
  try {
    client = await page.context().newCDPSession(page);
    const { root } = await client.send("DOM.getDocument", {
      depth: -1,
      pierce: false,
    });
    const stack = [root];
    let nodeCount = 0;
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === undefined) continue;
      nodeCount += 1;
      if (nodeCount > maximumNodes + 2) {
        throw new Error("CDP DOM audit exceeded the CaptureSpec node budget");
      }
      for (const shadowRoot of node.shadowRoots ?? []) {
        if (shadowRoot.children !== undefined) {
          throw new Error("CDP DOM audit materialized a shadow subtree");
        }
        if (shadowRoot.shadowRootType !== "user-agent") {
          throw new Error("fixture contains an author shadow root");
        }
      }
      stack.push(...(node.children ?? []));
    }
  } catch (error) {
    failures.push(error);
  }
  if (client !== undefined) {
    try {
      await client.detach();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    fail(
      "pilot_runtime.document_integrity",
      "fixture author-shadow-root evidence could not be proven closed",
      {
        cause:
          failures.length === 1
            ? failures[0]
            : new AggregateError(failures, "CDP DOM audit and cleanup failed"),
      },
    );
  }
}

interface DocumentIntegrityBounds {
  readonly maximumNodes: number;
  readonly maximumDepth: number;
  readonly maximumAttributes: number;
  readonly maximumAttributeCodeUnits: number;
  readonly maximumTextCodeUnits: number;
  readonly maximumStyleSheets: number;
  readonly maximumAdoptedStyleSheets: number;
  readonly maximumCssRules: number;
  readonly maximumCssNestingDepth: number;
  readonly maximumCssTextCodeUnits: number;
}

function documentIntegrityBounds(
  captureSpec: CaptureSpec,
  manifest: PilotFixtureManifest,
): DocumentIntegrityBounds {
  const maximumNodes = captureSpec.budgets.maximum_nodes;
  const maximumSourceAwareCodeUnits = maximumNodes * 1_024;
  const minimumSourceAwareCodeUnits = maximumNodes * 256;
  const boundedDeclaredBytes = (mediaType: (value: string) => boolean): number => {
    let total = 0;
    for (const resource of manifest.resources) {
      if (mediaType(resource.media_type)) {
        total = Math.min(
          maximumSourceAwareCodeUnits,
          total + Math.min(resource.byte_length, maximumSourceAwareCodeUnits),
        );
      }
    }
    return total;
  };
  const sourceAwareCodeUnits = (declaredBytes: number): number =>
    Math.max(
      minimumSourceAwareCodeUnits,
      Math.min(maximumSourceAwareCodeUnits, declaredBytes * 4),
    );
  const textualSourceBytes = boundedDeclaredBytes(
    (mediaType) =>
      mediaType.startsWith("text/") ||
      /^application\/(?:javascript|json|xhtml\+xml|xml)(?:;|$)/u.test(mediaType) ||
      /^image\/svg\+xml(?:;|$)/u.test(mediaType),
  );
  const cssSourceBytes = boundedDeclaredBytes((mediaType) =>
    /^text\/css(?:;|$)/u.test(mediaType),
  );
  return Object.freeze({
    maximumNodes,
    maximumDepth: Math.min(maximumNodes, 128),
    maximumAttributes: maximumNodes * 16,
    maximumAttributeCodeUnits: sourceAwareCodeUnits(textualSourceBytes),
    maximumTextCodeUnits: sourceAwareCodeUnits(textualSourceBytes),
    maximumStyleSheets: Math.min(maximumNodes, 256),
    maximumAdoptedStyleSheets: Math.min(maximumNodes, 64),
    maximumCssRules: maximumNodes * 4,
    maximumCssNestingDepth: Math.min(maximumNodes, 64),
    maximumCssTextCodeUnits: sourceAwareCodeUnits(cssSourceBytes),
  });
}

async function assertFixtureReadiness(
  page: Page,
  manifest: PilotFixtureManifest,
  captureSpec: CaptureSpec,
): Promise<void> {
  let evidence: {
    readonly ready: boolean;
    readonly revision: string | null;
    readonly pendingRequests: number | null;
    readonly sealedGlobal: boolean;
    readonly sealedState: boolean;
    readonly csp: string | null;
    readonly cspCount: number;
    readonly fontLoaded: boolean;
    readonly imagesDecoded: boolean;
    readonly innerWidth: number;
    readonly innerHeight: number;
    readonly screenWidth: number;
    readonly screenHeight: number;
    readonly devicePixelRatio: number;
    readonly language: string;
    readonly timeZone: string;
    readonly lightScheme: boolean;
    readonly reducedMotion: boolean;
    readonly forcedColors: boolean;
    readonly serviceWorkerControlled: boolean;
    readonly serviceWorkerRegistrations: number;
    readonly attachShadowBlocked: boolean;
    readonly peerConnectionsBlocked: boolean;
  };
  try {
    evidence = await page.evaluate(
      async ({ readinessGlobal, expectedStateKeys, maximumNodes }) => {
        const documentElement = document.documentElement;
        if (documentElement === null) {
          throw new Error("fixture document element is absent");
        }
        const walker = document.createTreeWalker(documentElement, NodeFilter.SHOW_ALL);
        let nodeCount = 1;
        while (walker.nextNode() !== null) {
          nodeCount += 1;
          if (nodeCount > maximumNodes) {
            throw new Error("fixture DOM exceeds the CaptureSpec node budget");
          }
        }
        const descriptor = Object.getOwnPropertyDescriptor(window, readinessGlobal);
        const stateValue =
          descriptor !== undefined && "value" in descriptor
            ? descriptor.value
            : undefined;
        const state =
          stateValue !== null && typeof stateValue === "object"
            ? (stateValue as {
                readonly ready?: unknown;
                readonly revision?: unknown;
                readonly pendingRequests?: unknown;
              })
            : undefined;
        const exactStatePrototype =
          state !== undefined && Object.getPrototypeOf(state) === Object.prototype;
        const rawStateKeys = exactStatePrototype ? Reflect.ownKeys(state) : [];
        const stateKeys = rawStateKeys
          .filter((key): key is string => typeof key === "string")
          .sort();
        const stateDescriptorsSealed = expectedStateKeys.every((key) => {
          const field =
            state === undefined
              ? undefined
              : Object.getOwnPropertyDescriptor(state, key);
          return (
            field !== undefined &&
            "value" in field &&
            field.enumerable === true &&
            field.configurable === false &&
            field.writable === false
          );
        });
        const cspElements = document.querySelectorAll(
          'meta[http-equiv="Content-Security-Policy"]',
        );
        const attachShadowDescriptor = Object.getOwnPropertyDescriptor(
          Element.prototype,
          "attachShadow",
        );
        let attachShadowThrows = false;
        try {
          document.createElement("div").attachShadow({ mode: "open" });
        } catch (error) {
          attachShadowThrows =
            error instanceof DOMException && error.name === "NotSupportedError";
        }
        const peerConnectionsBlocked = [
          "RTCPeerConnection",
          "webkitRTCPeerConnection",
        ].every((property) => {
          const field = Object.getOwnPropertyDescriptor(globalThis, property);
          return (
            field !== undefined &&
            "value" in field &&
            field.value === undefined &&
            field.configurable === false &&
            field.enumerable === false &&
            field.writable === false
          );
        });
        return {
          ready: state?.ready === true,
          revision: typeof state?.revision === "string" ? state.revision : null,
          pendingRequests:
            typeof state?.pendingRequests === "number" ? state.pendingRequests : null,
          sealedGlobal:
            descriptor !== undefined &&
            "value" in descriptor &&
            descriptor.configurable === false &&
            descriptor.enumerable === false &&
            descriptor.writable === false,
          sealedState:
            state !== undefined &&
            exactStatePrototype &&
            Object.isFrozen(state) &&
            rawStateKeys.length === stateKeys.length &&
            stateKeys.length === expectedStateKeys.length &&
            stateKeys.every((key, index) => key === expectedStateKeys[index]) &&
            stateDescriptorsSealed,
          csp: cspElements[0]?.getAttribute("content") ?? null,
          cspCount: cspElements.length,
          fontLoaded:
            document.fonts.status === "loaded" &&
            document.fonts.check('16px "ImpactDiff Noto Sans"'),
          imagesDecoded: Array.from(document.images).every(
            (image) =>
              image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
          ),
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          screenWidth: window.screen.width,
          screenHeight: window.screen.height,
          devicePixelRatio: window.devicePixelRatio,
          language: navigator.language,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          lightScheme: matchMedia("(prefers-color-scheme: light)").matches,
          reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
          forcedColors: matchMedia("(forced-colors: active)").matches,
          serviceWorkerControlled: navigator.serviceWorker.controller !== null,
          serviceWorkerRegistrations: (await navigator.serviceWorker.getRegistrations())
            .length,
          attachShadowBlocked:
            attachShadowDescriptor !== undefined &&
            "value" in attachShadowDescriptor &&
            typeof attachShadowDescriptor.value === "function" &&
            attachShadowDescriptor.configurable === false &&
            attachShadowDescriptor.enumerable === false &&
            attachShadowDescriptor.writable === false &&
            attachShadowThrows,
          peerConnectionsBlocked,
        };
      },
      {
        readinessGlobal: manifest.readiness.global,
        expectedStateKeys: ["pendingRequests", "ready", "revision"],
        maximumNodes: captureSpec.budgets.maximum_nodes,
      },
    );
  } catch (error) {
    fail(
      "pilot_runtime.fixture_readiness",
      "fixture readiness evidence could not be collected",
      { cause: error },
    );
  }
  const viewport = manifest.environment.viewport;
  if (
    !evidence.ready ||
    evidence.revision !== manifest.revision ||
    evidence.pendingRequests !== manifest.readiness.pending_requests ||
    !evidence.sealedGlobal ||
    !evidence.sealedState ||
    evidence.cspCount !== 1 ||
    evidence.csp !== manifest.content_security_policy ||
    !evidence.fontLoaded ||
    !evidence.imagesDecoded ||
    evidence.innerWidth !== viewport.width ||
    evidence.innerHeight !== viewport.height ||
    evidence.screenWidth !== viewport.width ||
    evidence.screenHeight !== viewport.height ||
    evidence.devicePixelRatio !== manifest.environment.device_scale_factor ||
    evidence.language !== manifest.environment.locale ||
    evidence.timeZone !== manifest.environment.timezone ||
    evidence.lightScheme !== (manifest.environment.color_scheme === "light") ||
    evidence.reducedMotion !== (captureSpec.media.reduced_motion === "reduce") ||
    evidence.forcedColors !== (captureSpec.media.forced_colors !== "none") ||
    evidence.serviceWorkerControlled ||
    evidence.serviceWorkerRegistrations !== 0 ||
    !evidence.attachShadowBlocked ||
    !evidence.peerConnectionsBlocked ||
    page.viewportSize()?.width !== viewport.width ||
    page.viewportSize()?.height !== viewport.height
  ) {
    fail(
      "pilot_runtime.fixture_readiness",
      "fixture readiness, CSP, font, service-worker, or display evidence differs from its manifest",
    );
  }
}

function abiHandle(
  retained: RetainedAbi,
  slot: PilotFixtureAbiSlot,
): ElementHandle<Element> {
  const handle = retained.slots.get(slot);
  if (handle === undefined) {
    fail("pilot_runtime.abi", `retained ABI slot ${slot} is unavailable`);
  }
  return handle;
}

interface PilotDocumentFingerprintOptions {
  readonly controlPhase: "initial" | "selected";
  readonly normalization: "workflow_transition" | "exact";
}

async function documentFingerprint(
  page: Page,
  retained: Pick<RetainedAbi, "documentElement" | "slots" | "pageGuard">,
  workflow: PilotFixtureWorkflow,
  options: PilotDocumentFingerprintOptions,
  bounds: DocumentIntegrityBounds,
): Promise<string> {
  const root = retained.slots.get("root");
  const success = retained.slots.get("success");
  const setup = retained.slots.get("setup");
  const focusEntry = retained.slots.get("focus_entry");
  if (
    root === undefined ||
    success === undefined ||
    setup === undefined ||
    focusEntry === undefined
  ) {
    fail(
      "pilot_runtime.abi",
      "document fingerprint requires root, setup, focus-entry, and success ABI slots",
    );
  }
  let snapshot: unknown;
  let exactControlStates = false;
  try {
    const projection = await page.evaluate(
      ({
        documentElement,
        rootElement,
        setupElement,
        focusEntryElement,
        successElement,
        rootAttribute,
        setupStateName,
        focusEntryStateName,
        expectedSetupState,
        expectedFocusEntryState,
        normalization,
        pageGuard,
        limits,
      }) => {
        if (
          documentElement !== document.documentElement ||
          !rootElement.isConnected ||
          !setupElement.isConnected ||
          !focusEntryElement.isConnected ||
          !successElement.isConnected ||
          !documentElement.contains(rootElement) ||
          !documentElement.contains(setupElement) ||
          !documentElement.contains(focusEntryElement) ||
          !documentElement.contains(successElement)
        ) {
          throw new Error("retained integrity nodes are not in the exact document");
        }
        if (
          document.querySelector("canvas, audio, video, template") !== null ||
          document.querySelector("dialog[open]") !== null ||
          document.querySelector(":popover-open") !== null ||
          document.fullscreenElement !== null ||
          document.pointerLockElement !== null ||
          (Reflect.get(document, "pictureInPictureElement") ?? null) !== null ||
          document.getAnimations().length !== 0
        ) {
          throw new Error(
            "fixture integrity does not admit author drawing/media surfaces, active top-layer state, or animations",
          );
        }
        if (
          document.doctype === null ||
          document.childNodes.length !== 2 ||
          document.childNodes.item(0) !== document.doctype ||
          document.childNodes.item(1) !== documentElement
        ) {
          throw new Error(
            "fixture document must contain only its doctype and exact html",
          );
        }

        const preflightWalker = document.createTreeWalker(
          documentElement,
          NodeFilter.SHOW_ALL,
        );
        let preflightNodeCount = 1;
        const rejectShadowRoot = (node: Node): void => {
          if (node instanceof Element && node.shadowRoot !== null) {
            throw new Error("fixture integrity does not admit shadow roots");
          }
        };
        rejectShadowRoot(documentElement);
        for (
          let node = preflightWalker.nextNode();
          node !== null;
          node = preflightWalker.nextNode()
        ) {
          preflightNodeCount += 1;
          if (preflightNodeCount > limits.maximumNodes) {
            throw new Error("fixture integrity DOM node budget exceeded");
          }
          rejectShadowRoot(node);
        }

        let nodeCount = 0;
        let attributeCount = 0;
        let attributeCodeUnits = 0;
        let textCodeUnits = 0;
        let styleSheetCount = 0;
        let cssRuleCount = 0;
        let cssTextCodeUnits = 0;

        const addText = (value: string): string => {
          textCodeUnits += value.length;
          if (textCodeUnits > limits.maximumTextCodeUnits) {
            throw new Error("fixture integrity text budget exceeded");
          }
          return value;
        };
        const finiteNumber = (value: number, label: string): number => {
          if (!Number.isFinite(value)) {
            throw new Error(`fixture integrity ${label} is not finite`);
          }
          return value;
        };
        const controlStateMatches = (
          element: Element,
          stateName: "value" | "checked" | null,
          expectedState: string | boolean | null,
        ): boolean => pageGuard.controlMatches(element, stateName, expectedState);
        const projectLiveElementState = (node: Element): unknown => {
          const scroll = {
            left: finiteNumber(node.scrollLeft, "element scrollLeft"),
            top: finiteNumber(node.scrollTop, "element scrollTop"),
          };
          const normalizedStateName =
            normalization === "workflow_transition"
              ? node === setupElement
                ? setupStateName
                : node === focusEntryElement
                  ? focusEntryStateName
                  : null
              : null;
          const nativeControlState = pageGuard.controlState(node);
          if (nativeControlState.kind === "select") {
            const normalizedValue = normalizedStateName === "value";
            return {
              scroll,
              form: {
                kind: "select",
                value: normalizedValue
                  ? "$EXPECTED_CONTROL_VALUE"
                  : addText(nativeControlState.value),
                selectedIndex: normalizedValue
                  ? "$EXPECTED_SETUP_INDEX"
                  : nativeControlState.selectedIndex,
                optionSelected: normalizedValue
                  ? "$EXPECTED_SETUP_SELECTED"
                  : nativeControlState.optionSelected,
              },
            };
          }
          if (nativeControlState.kind === "option") {
            return {
              scroll,
              form: {
                kind: "option",
                selected:
                  normalization === "workflow_transition" &&
                  (nativeControlState.ownerSelect === setupElement ||
                    nativeControlState.ownerSelect === focusEntryElement)
                    ? "$EXPECTED_SETUP_SELECTED"
                    : nativeControlState.selected,
              },
            };
          }
          if (nativeControlState.kind === "input") {
            if (nativeControlState.filesLength !== 0) {
              throw new Error("fixture integrity does not admit selected files");
            }
            return {
              scroll,
              form: {
                kind: "input",
                value:
                  normalizedStateName === "value"
                    ? "$EXPECTED_CONTROL_VALUE"
                    : addText(nativeControlState.value),
                checked:
                  normalizedStateName === "checked"
                    ? "$EXPECTED_CONTROL_CHECKED"
                    : nativeControlState.checked,
                indeterminate: nativeControlState.indeterminate,
                selectionStart:
                  normalizedStateName === "value"
                    ? "$EXPECTED_CONTROL_SELECTION_START"
                    : nativeControlState.selectionStart,
                selectionEnd:
                  normalizedStateName === "value"
                    ? "$EXPECTED_CONTROL_SELECTION_END"
                    : nativeControlState.selectionEnd,
                selectionDirection:
                  normalizedStateName === "value"
                    ? "$EXPECTED_CONTROL_SELECTION_DIRECTION"
                    : nativeControlState.selectionDirection,
              },
            };
          }
          if (nativeControlState.kind === "textarea") {
            return {
              scroll,
              form: {
                kind: "textarea",
                value:
                  normalizedStateName === "value"
                    ? "$EXPECTED_CONTROL_VALUE"
                    : addText(nativeControlState.value),
                selectionStart:
                  normalizedStateName === "value"
                    ? "$EXPECTED_CONTROL_SELECTION_START"
                    : nativeControlState.selectionStart,
                selectionEnd:
                  normalizedStateName === "value"
                    ? "$EXPECTED_CONTROL_SELECTION_END"
                    : nativeControlState.selectionEnd,
                selectionDirection:
                  normalizedStateName === "value"
                    ? "$EXPECTED_CONTROL_SELECTION_DIRECTION"
                    : nativeControlState.selectionDirection,
              },
            };
          }
          if (node instanceof HTMLProgressElement) {
            return { scroll, form: { kind: "progress", value: node.value } };
          }
          if (node instanceof HTMLMeterElement) {
            return { scroll, form: { kind: "meter", value: node.value } };
          }
          return { scroll, form: null };
        };
        const addAttribute = (
          name: string,
          value: string,
          namespace: string | null,
        ) => {
          attributeCodeUnits +=
            name.length + value.length + (namespace === null ? 0 : namespace.length);
          if (attributeCodeUnits > limits.maximumAttributeCodeUnits) {
            throw new Error("fixture integrity attribute text budget exceeded");
          }
        };
        const walk = (node: Node, depth: number, project: boolean): unknown => {
          nodeCount += 1;
          if (nodeCount > limits.maximumNodes || depth > limits.maximumDepth) {
            throw new Error("fixture integrity DOM budget exceeded");
          }
          if (node.nodeType === Node.TEXT_NODE) {
            const value = addText(node.nodeValue ?? "");
            return project ? { type: "text", value } : null;
          }
          if (node.nodeType === Node.COMMENT_NODE) {
            const value = addText(node.nodeValue ?? "");
            return project ? { type: "comment", value } : null;
          }
          if (!(node instanceof Element)) {
            const value = addText(node.nodeValue ?? "");
            return project
              ? { type: `node-${node.nodeType}`, name: node.nodeName, value }
              : null;
          }
          if (node.shadowRoot !== null) {
            throw new Error("fixture integrity does not admit shadow roots");
          }
          const rawAttributeCount = node.attributes.length;
          attributeCount += rawAttributeCount;
          if (attributeCount > limits.maximumAttributes) {
            throw new Error("fixture integrity attribute count budget exceeded");
          }
          const attributes: (readonly [string | null, string, string])[] = [];
          let normalizedRootAttributePresent = false;
          for (let index = 0; index < rawAttributeCount; index += 1) {
            const attribute = node.attributes.item(index);
            if (attribute === null) {
              throw new Error("fixture integrity attribute collection changed");
            }
            addAttribute(attribute.name, attribute.value, attribute.namespaceURI);
            const normalizeRootAttribute =
              normalization === "workflow_transition" &&
              node === rootElement &&
              attribute.namespaceURI === null &&
              attribute.name === rootAttribute;
            if (normalizeRootAttribute) normalizedRootAttributePresent = true;
            if (project) {
              attributes.push([
                attribute.namespaceURI,
                attribute.name,
                normalizeRootAttribute ? "$EXPECTED_ROOT_VALUE" : attribute.value,
              ]);
            }
          }
          if (
            project &&
            normalization === "workflow_transition" &&
            node === rootElement &&
            !normalizedRootAttributePresent
          ) {
            attributes.push([null, rootAttribute, "$EXPECTED_ROOT_VALUE"]);
          }
          if (project) {
            attributes.sort((left, right) => {
              const leftKey = `${left[0] ?? ""}\0${left[1]}`;
              const rightKey = `${right[0] ?? ""}\0${right[1]}`;
              return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
            });
          }
          const normalizeSuccessChildren =
            normalization === "workflow_transition" && node === successElement;
          const children: unknown[] = [];
          const rawChildCount = node.childNodes.length;
          if (
            normalizeSuccessChildren &&
            (rawChildCount !== 1 || !(node.firstChild instanceof Text))
          ) {
            throw new Error(
              "fixture success ABI must contain exactly one direct text node",
            );
          }
          for (let index = 0; index < rawChildCount; index += 1) {
            const child = node.childNodes.item(index);
            if (child === null) {
              throw new Error("fixture integrity child collection changed");
            }
            const childProjection = walk(
              child,
              depth + 1,
              project && !normalizeSuccessChildren,
            );
            if (project && !normalizeSuccessChildren) children.push(childProjection);
          }
          if (!project) return null;
          return {
            type: "element",
            namespace: node.namespaceURI,
            name: node.localName,
            attributes,
            live: projectLiveElementState(node),
            children: normalizeSuccessChildren
              ? [{ type: "text", value: "$EXPECTED_SUCCESS_TEXT" }]
              : children,
          };
        };

        const seenStyleSheets = new WeakSet<CSSStyleSheet>();
        function projectRules(rules: CSSRuleList, depth: number): unknown[] {
          if (depth > limits.maximumCssNestingDepth) {
            throw new Error("fixture integrity CSS nesting budget exceeded");
          }
          if (cssRuleCount + rules.length > limits.maximumCssRules) {
            throw new Error("fixture integrity CSS rule budget exceeded");
          }
          const projection: unknown[] = [];
          for (let index = 0; index < rules.length; index += 1) {
            const rule = rules.item(index);
            if (rule === null) {
              throw new Error("fixture integrity CSS rule collection changed");
            }
            cssRuleCount += 1;
            if (cssRuleCount > limits.maximumCssRules) {
              throw new Error("fixture integrity CSS rule budget exceeded");
            }
            const cssText = rule.cssText;
            cssTextCodeUnits += cssText.length;
            if (cssTextCodeUnits > limits.maximumCssTextCodeUnits) {
              throw new Error("fixture integrity CSS text budget exceeded");
            }
            const nestedRules =
              "cssRules" in rule
                ? (rule as CSSRule & { readonly cssRules: CSSRuleList }).cssRules
                : undefined;
            const importedStyleSheet =
              rule.type === CSSRule.IMPORT_RULE
                ? (rule as CSSImportRule).styleSheet
                : null;
            projection.push({
              cssText,
              rules:
                nestedRules === undefined ? null : projectRules(nestedRules, depth + 1),
              importedStyleSheet:
                importedStyleSheet === null
                  ? null
                  : projectStyleSheet(importedStyleSheet),
            });
          }
          return projection;
        }
        function projectStyleSheet(sheet: CSSStyleSheet): unknown {
          if (seenStyleSheets.has(sheet)) {
            throw new Error("fixture integrity stylesheet graph is cyclic or aliased");
          }
          seenStyleSheets.add(sheet);
          styleSheetCount += 1;
          if (styleSheetCount > limits.maximumStyleSheets) {
            throw new Error("fixture integrity stylesheet budget exceeded");
          }
          return {
            href: sheet.href,
            disabled: sheet.disabled,
            media: sheet.media.mediaText,
            rules: projectRules(sheet.cssRules, 0),
          };
        }

        const tree = walk(documentElement, 0, true);
        if (
          document.styleSheets.length > limits.maximumStyleSheets ||
          document.adoptedStyleSheets.length > limits.maximumAdoptedStyleSheets ||
          document.styleSheets.length + document.adoptedStyleSheets.length >
            limits.maximumStyleSheets
        ) {
          throw new Error("fixture integrity stylesheet collection budget exceeded");
        }
        const styleSheets: unknown[] = [];
        for (let index = 0; index < document.styleSheets.length; index += 1) {
          const sheet = document.styleSheets.item(index);
          if (sheet === null) {
            throw new Error("fixture integrity stylesheet collection changed");
          }
          styleSheets.push(projectStyleSheet(sheet));
        }
        const adoptedStyleSheets: unknown[] = [];
        for (let index = 0; index < document.adoptedStyleSheets.length; index += 1) {
          const sheet = document.adoptedStyleSheets[index];
          if (sheet === undefined) {
            throw new Error("fixture integrity adopted stylesheet collection changed");
          }
          adoptedStyleSheets.push(projectStyleSheet(sheet));
        }

        const visualViewport = window.visualViewport;
        return {
          exactControlStates:
            controlStateMatches(setupElement, setupStateName, expectedSetupState) &&
            (focusEntryElement === setupElement ||
              (focusEntryStateName !== null &&
                controlStateMatches(
                  focusEntryElement,
                  focusEntryStateName,
                  expectedFocusEntryState,
                ))),
          snapshot: {
            url: document.URL,
            contentType: document.contentType,
            characterSet: document.characterSet,
            compatMode: document.compatMode,
            doctype:
              document.doctype === null
                ? null
                : {
                    name: addText(document.doctype.name),
                    publicId: addText(document.doctype.publicId),
                    systemId: addText(document.doctype.systemId),
                  },
            tree,
            styleSheets,
            adoptedStyleSheets,
            liveDocument: {
              scrollX: finiteNumber(window.scrollX, "window scrollX"),
              scrollY: finiteNumber(window.scrollY, "window scrollY"),
              visualViewport:
                visualViewport === null
                  ? null
                  : {
                      offsetLeft: finiteNumber(
                        visualViewport.offsetLeft,
                        "visual viewport offsetLeft",
                      ),
                      offsetTop: finiteNumber(
                        visualViewport.offsetTop,
                        "visual viewport offsetTop",
                      ),
                      pageLeft: finiteNumber(
                        visualViewport.pageLeft,
                        "visual viewport pageLeft",
                      ),
                      pageTop: finiteNumber(
                        visualViewport.pageTop,
                        "visual viewport pageTop",
                      ),
                      scale: finiteNumber(
                        visualViewport.scale,
                        "visual viewport scale",
                      ),
                    },
            },
          },
        };
      },
      {
        documentElement: retained.documentElement,
        rootElement: root,
        setupElement: setup,
        focusEntryElement: focusEntry,
        successElement: success,
        rootAttribute: workflow.expectations.final.root_attribute.name,
        setupStateName: workflow.expectations.setup_attribute.name,
        focusEntryStateName: workflow.expectations.focus_entry_attribute?.name ?? null,
        expectedSetupState: workflow.expectations.setup_attribute[options.controlPhase],
        expectedFocusEntryState:
          workflow.expectations.focus_entry_attribute?.[options.controlPhase] ?? null,
        normalization: options.normalization,
        pageGuard: retained.pageGuard,
        limits: bounds,
      },
    );
    snapshot = projection.snapshot;
    exactControlStates = projection.exactControlStates;
  } catch (error) {
    fail(
      "pilot_runtime.document_integrity",
      "fixture document fingerprint could not be collected",
      { cause: error },
    );
  }
  if (!exactControlStates) {
    fail(
      options.controlPhase === "initial"
        ? "pilot_runtime.workflow_state"
        : "pilot_runtime.final_expectation",
      `fixture ${options.controlPhase} control states differ from their exact manifest expectations`,
    );
  }
  return sha256Hex(Buffer.from(canonicalJson(snapshot), "utf8"));
}

async function retainAbi(
  page: Page,
  workflow: PilotFixtureWorkflow,
  integrityBounds: DocumentIntegrityBounds,
): Promise<RetainedAbi> {
  const documentElement = (await page
    .locator("html")
    .elementHandle()) as ElementHandle<HTMLElement> | null;
  if (documentElement === null) {
    fail("pilot_runtime.abi", "fixture document element could not be retained");
  }
  const slots = new Map<PilotFixtureAbiSlot, ElementHandle<Element>>();
  for (const slot of pilotFixtureAbiSlots) {
    const testId = workflow.abi[slot].value;
    const locator = page.getByTestId(testId);
    if ((await locator.count()) !== 1) {
      fail(
        "pilot_runtime.abi",
        `ABI slot ${slot} must resolve to exactly one retained element`,
      );
    }
    const handle = await locator.elementHandle();
    if (handle === null) {
      fail("pilot_runtime.abi", `ABI slot ${slot} detached during retention`);
    }
    slots.set(slot, handle);
  }
  const root = slots.get("root");
  const success = slots.get("success");
  if (root === undefined || success === undefined) {
    fail("pilot_runtime.abi", "root and success ABI slots were not retained");
  }
  let pageGuard: JSHandle<PilotPageGuardApi>;
  try {
    pageGuard = (await page.evaluateHandle((apiName) => {
      const api = (globalThis as Record<string, unknown>)[apiName] as
        PilotPageGuardApi | undefined;
      if (
        api === undefined ||
        typeof api.controlState !== "function" ||
        typeof api.controlMatches !== "function" ||
        typeof api.activeElement !== "function" ||
        typeof api.isConnected !== "function" ||
        typeof api.getAttribute !== "function" ||
        typeof api.textContent !== "function" ||
        typeof api.nativeButtonMatches !== "function" ||
        typeof api.predicateSnapshot !== "function" ||
        typeof api.sourcePointerGeometry !== "function" ||
        typeof api.pointerCleanBoundaryProjection !== "function" ||
        typeof api.createMutationAudit !== "function" ||
        typeof api.sealTerminalBoundary !== "function"
      ) {
        throw new Error("Pilot native page guard is unavailable");
      }
      return api;
    }, pageGuardApiName)) as JSHandle<PilotPageGuardApi>;
  } catch (error) {
    fail(
      "pilot_runtime.page_guard",
      "Pilot native page guards did not initialize before fixture execution",
      { cause: error },
    );
  }
  const mutationAudit = (await page.evaluateHandle(
    ({ apiName, rootElement, successElement, rootAttribute }) => {
      const guard = (globalThis as Record<string, unknown>)[apiName] as {
        readonly createMutationAudit: (
          root: Element,
          success: Element,
          attribute: string,
        ) => unknown;
      };
      return guard.createMutationAudit(rootElement, successElement, rootAttribute);
    },
    {
      apiName: pageGuardApiName,
      rootElement: root,
      successElement: success,
      rootAttribute: workflow.expectations.final.root_attribute.name,
    },
  )) as JSHandle<PilotMutationAudit>;
  const partial = { documentElement, slots, pageGuard, mutationAudit };
  return Object.freeze({
    ...partial,
    pristineDocumentSha256: await documentFingerprint(
      page,
      partial,
      workflow,
      { controlPhase: "initial", normalization: "workflow_transition" },
      integrityBounds,
    ),
  });
}

async function assertRetainedDocument(
  context: BrowserContext,
  page: Page,
  retained: RetainedAbi,
  bound: BoundWorkflow,
  audit: BrowserAuditState,
  captureSpec: CaptureSpec,
): Promise<void> {
  if (
    page.isClosed() ||
    page.url() !== `${fixtureOrigin}/` ||
    audit.documentReplaced ||
    context.pages().length !== 1 ||
    context.pages()[0] !== page ||
    context.serviceWorkers().length !== 0 ||
    page.frames().length !== 1 ||
    page.workers().length !== 0
  ) {
    fail(
      "pilot_runtime.document_integrity",
      "fixture page, frame, worker, or document identity changed",
    );
  }
  await assertNoAuthorShadowRoots(page, captureSpec.budgets.maximum_nodes);
  let sameDocument = false;
  try {
    sameDocument = await retained.documentElement.evaluate(
      (element, pageGuard: PilotPageGuardApi) =>
        element === document.documentElement && pageGuard.isConnected(element),
      retained.pageGuard,
    );
  } catch (error) {
    fail(
      "pilot_runtime.document_integrity",
      "retained fixture document identity could not be proven",
      { cause: error },
    );
  }
  if (!sameDocument) {
    fail("pilot_runtime.document_integrity", "retained fixture document was replaced");
  }
  const root = abiHandle(retained, "root");
  for (const slot of pilotFixtureAbiSlots) {
    const handle = abiHandle(retained, slot);
    const testId = bound.workflow.abi[slot].value;
    let exact = false;
    try {
      exact = await handle.evaluate((element, expectedTestId) => {
        const matches = document.querySelectorAll(`[data-testid="${expectedTestId}"]`);
        return element.isConnected && matches.length === 1 && matches[0] === element;
      }, testId);
    } catch (error) {
      fail(
        "pilot_runtime.abi",
        `retained ABI slot ${slot} identity could not be proven`,
        { cause: error },
      );
    }
    if (!exact) {
      fail("pilot_runtime.abi", `retained ABI slot ${slot} was replaced`);
    }
    if (
      slot !== "root" &&
      !(await root.evaluate((parent, node) => parent.contains(node), handle))
    ) {
      fail("pilot_runtime.abi", `ABI slot ${slot} left the retained root`);
    }
  }
  await assertFixtureReadiness(page, bound.manifest, captureSpec);
  const now = await page.evaluate(() => Date.now());
  if (now !== captureSpec.clock.epoch_ms) {
    fail(
      "pilot_runtime.clock_drift",
      "fixture virtual clock is no longer paused at the CaptureSpec epoch",
    );
  }
}

async function assertInitialWorkflowState(
  page: Page,
  retained: RetainedAbi,
  workflow: PilotFixtureWorkflow,
): Promise<void> {
  const setup = abiHandle(retained, "setup");
  const focusEntry = abiHandle(retained, "focus_entry");
  const root = abiHandle(retained, "root");
  const primary = abiHandle(retained, "primary");
  const peer = abiHandle(retained, "native_control_peer");
  const success = abiHandle(retained, "success");
  const evidence = await page.evaluate(
    ({
      setupElement,
      focusElement,
      rootElement,
      primaryElement,
      peerElement,
      successElement,
      rootAttribute,
      pageGuard,
    }) => ({
      setupConnected: pageGuard.isConnected(setupElement),
      focusConnected: pageGuard.isConnected(focusElement),
      rootInitial: pageGuard.getAttribute(rootElement, rootAttribute),
      primaryIsButton: pageGuard.nativeButtonMatches(primaryElement, true),
      peerIsButton: pageGuard.nativeButtonMatches(peerElement, false),
      successFocusable:
        successElement instanceof HTMLElement && successElement.tabIndex === -1,
    }),
    {
      setupElement: setup,
      focusElement: focusEntry,
      rootElement: root,
      primaryElement: primary,
      peerElement: peer,
      successElement: success,
      rootAttribute: workflow.expectations.final.root_attribute.name,
      pageGuard: retained.pageGuard,
    },
  );
  if (
    !evidence.setupConnected ||
    !evidence.focusConnected ||
    evidence.rootInitial === null ||
    evidence.rootInitial === workflow.expectations.final.root_attribute.value ||
    !evidence.primaryIsButton ||
    !evidence.peerIsButton ||
    !evidence.successFocusable
  ) {
    fail(
      "pilot_runtime.workflow_state",
      "fixture initial workflow state differs from its manifest expectations",
    );
  }
  await assertExactControlState(
    setup,
    retained.pageGuard,
    workflow.expectations.setup_attribute,
    "initial",
    "pilot_runtime.workflow_state",
    "fixture initial setup state differs from its exact expectation",
  );
  const focusEntryExpectation = workflow.expectations.focus_entry_attribute;
  if (focusEntryExpectation !== undefined) {
    await assertExactControlState(
      focusEntry,
      retained.pageGuard,
      focusEntryExpectation,
      "initial",
      "pilot_runtime.workflow_state",
      "fixture initial focus-entry state differs from its exact expectation",
    );
  }
}

type PilotControlStateExpectation =
  PilotFixtureWorkflow["expectations"]["setup_attribute"];

async function assertExactControlState(
  control: ElementHandle<Element>,
  pageGuard: JSHandle<PilotPageGuardApi>,
  expectation: PilotControlStateExpectation,
  phase: "initial" | "selected",
  code: string,
  message: string,
): Promise<void> {
  let exact = false;
  try {
    exact = await control.evaluate(
      (
        element,
        {
          guard,
          stateName,
          expectedState,
        }: {
          readonly guard: PilotPageGuardApi;
          readonly stateName: "value" | "checked";
          readonly expectedState: string | boolean;
        },
      ) => guard.controlMatches(element, stateName, expectedState),
      {
        guard: pageGuard,
        stateName: expectation.name,
        expectedState: expectation[phase],
      },
    );
  } catch (error) {
    fail(code, message, { cause: error });
  }
  if (!exact) fail(code, message);
}

async function assertExactFinalWorkflowState(
  page: Page,
  retained: RetainedAbi,
  workflow: PilotFixtureWorkflow,
  boundary: string,
  sealTerminalBoundary = false,
): Promise<
  | {
      readonly overflow: boolean;
      readonly unexpected: readonly string[];
      readonly rootMutationObserved: boolean;
      readonly successMutationObserved: boolean;
    }
  | undefined
> {
  let exact = false;
  let lateMutations: {
    readonly overflow: boolean;
    readonly unexpected: readonly string[];
    readonly rootMutationObserved: boolean;
    readonly successMutationObserved: boolean;
  } | null = null;
  try {
    const projection = await page.evaluate(
      ({
        rootElement,
        setupElement,
        focusEntryElement,
        successElement,
        expectedFocusElement,
        rootAttribute,
        expectedRootValue,
        expectedSuccessText,
        setupExpectation,
        focusEntryExpectation,
        pageGuard,
        mutationAudit,
      }) => {
        const controlMatches = (
          element: Element,
          expectation:
            | { readonly name: "value"; readonly selected: string }
            | { readonly name: "checked"; readonly selected: true },
        ): boolean =>
          pageGuard.controlMatches(element, expectation.name, expectation.selected);
        const exactState =
          pageGuard.isConnected(rootElement) &&
          pageGuard.isConnected(setupElement) &&
          pageGuard.isConnected(focusEntryElement) &&
          pageGuard.isConnected(successElement) &&
          pageGuard.getAttribute(rootElement, rootAttribute) === expectedRootValue &&
          pageGuard.textContent(successElement) === expectedSuccessText &&
          pageGuard.activeElement() === expectedFocusElement &&
          controlMatches(setupElement, setupExpectation) &&
          (focusEntryExpectation === null
            ? focusEntryElement === setupElement
            : controlMatches(focusEntryElement, focusEntryExpectation));
        const terminalMutations = mutationAudit?.seal() ?? null;
        if (mutationAudit !== null && exactState) {
          pageGuard.sealTerminalBoundary([
            rootElement,
            setupElement,
            focusEntryElement,
            successElement,
            expectedFocusElement,
          ]);
        }
        return { exactState, terminalMutations };
      },
      {
        rootElement: abiHandle(retained, "root"),
        setupElement: abiHandle(retained, "setup"),
        focusEntryElement: abiHandle(retained, "focus_entry"),
        successElement: abiHandle(retained, "success"),
        expectedFocusElement: abiHandle(retained, workflow.expectations.final.focus),
        rootAttribute: workflow.expectations.final.root_attribute.name,
        expectedRootValue: workflow.expectations.final.root_attribute.value,
        expectedSuccessText: workflow.expectations.final.success_text,
        setupExpectation: workflow.expectations.setup_attribute,
        focusEntryExpectation: workflow.expectations.focus_entry_attribute ?? null,
        pageGuard: retained.pageGuard,
        mutationAudit: sealTerminalBoundary ? retained.mutationAudit : null,
      },
    );
    exact = projection.exactState;
    lateMutations = projection.terminalMutations;
  } catch (error) {
    fail(
      "pilot_runtime.final_expectation",
      `${boundary} final state could not be verified`,
      { cause: error },
    );
  }
  if (!exact) {
    fail(
      "pilot_runtime.final_expectation",
      `${boundary} final state differs from its exact manifest expectations`,
    );
  }
  return lateMutations ?? undefined;
}

interface SourcePointerGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly scrollX: number;
  readonly scrollY: number;
}

async function sourcePointerGeometry(
  primary: ElementHandle<Element>,
  pageGuard: JSHandle<PilotPageGuardApi>,
): Promise<SourcePointerGeometry> {
  let value: SourcePointerGeometry;
  try {
    value = await primary.evaluate(
      (target, guard: PilotPageGuardApi) => guard.sourcePointerGeometry(target),
      pageGuard,
    );
  } catch (error) {
    fail(
      "pilot_runtime.pointer_geometry",
      "primary source geometry could not be collected through native guards",
      { cause: error },
    );
  }
  if (
    !Object.values(value).every(Number.isFinite) ||
    value.width <= 0 ||
    value.height <= 0 ||
    value.scrollX !== 0 ||
    value.scrollY !== 0
  ) {
    fail(
      "pilot_runtime.pointer_geometry",
      "primary source geometry is not finite, positive, and unscrolled",
    );
  }
  return Object.freeze(value);
}

function sameGeometry(
  left: SourcePointerGeometry,
  right: SourcePointerGeometry,
): boolean {
  return (Object.keys(left) as (keyof SourcePointerGeometry)[]).every((key) =>
    Object.is(left[key], right[key]),
  );
}

async function assertActiveElement(
  handle: ElementHandle<Element>,
  pageGuard: JSHandle<PilotPageGuardApi>,
  code: string,
  message: string,
): Promise<void> {
  let active = false;
  try {
    active = await handle.evaluate(
      (element, guard: PilotPageGuardApi) => guard.activeElement() === element,
      pageGuard,
    );
  } catch (error) {
    fail(code, message, { cause: error });
  }
  if (!active) fail(code, message);
}

async function captureWorkflowCheckpoint(
  page: Page,
  bound: BoundWorkflow,
  captureSpec: CaptureSpec,
  ordinal: 0 | 1 | 2,
  checkpointBuffer: PilotFixtureAuthoringCheckpointBytes[] | undefined,
): Promise<PilotFixtureAuthoringCheckpointBytes | undefined> {
  if (checkpointBuffer === undefined) return undefined;
  const checkpoint = await capturePilotFixtureAuthoringCheckpoint({
    page,
    capture_spec: captureSpec,
    action_plan: bound.actionPlan,
    action_plan_reference: bound.actionPlanReference,
    primary_action_target_id: bound.primaryActionTargetId,
    primary_action_test_id: bound.primaryActionTestId,
    ordinal,
  });
  if (checkpoint.ordinal !== ordinal || checkpointBuffer.length !== ordinal) {
    fail(
      "pilot_runtime.checkpoint_capture",
      "Pilot authoring checkpoints were not captured in exact schedule order",
    );
  }
  checkpointBuffer.push(checkpoint);
  return checkpoint;
}

interface ExecutedWorkflow {
  readonly retained: RetainedAbi;
  readonly sourcePredicates: PilotMutationPredicateObservationTuple | undefined;
  readonly pointerBaseline: PilotPointerBaselineEvidence | undefined;
  readonly pointerCandidateOutcome: PilotPointerCandidateTaskOutcome | undefined;
  readonly pointerTerminalSealed: boolean;
}

/** @internal */
export type PilotPointerCandidateTaskOutcome = "exact_success" | "exact_unchanged";

interface PilotPointerCleanBoundary {
  readonly exactDocumentSha256: string;
  readonly computedStylesSha256: string;
  readonly observation: PilotFixtureAuthoringObservationBytes;
  readonly hitTestSha256: string;
  readonly focusAndScrollSha256: string;
}

/** @internal */
export interface PilotPointerBaselineEvidence {
  readonly prePrimary: PilotPointerCleanBoundary;
  readonly postPrimary: PilotPointerCleanBoundary;
}

/** @internal */
export interface PilotPointerCandidateExecutionInput {
  readonly selected: SelectedPilotPointerOperator;
  readonly sourcePredicates: PilotMutationPredicateObservationTuple;
  readonly baseline: PilotPointerBaselineEvidence;
}

async function capturePilotPointerCleanBoundary(
  page: Page,
  retained: RetainedAbi,
  bound: BoundWorkflow,
  captureSpec: CaptureSpec,
  integrityBounds: DocumentIntegrityBounds,
  sourcePoint: Readonly<{ x: number; y: number }>,
  controlPhase: "initial" | "selected",
): Promise<PilotPointerCleanBoundary> {
  let projection: PilotPointerCleanBoundaryProjection;
  try {
    const trackedElements = pilotFixtureAbiSlots.map((slot) =>
      abiHandle(retained, slot),
    );
    const collect = (
      primary: Element,
      {
        guard,
        point,
        tracked,
      }: {
        readonly guard: PilotPageGuardApi;
        readonly point: Readonly<{ x: number; y: number }>;
        readonly tracked: readonly Element[];
      },
    ): PilotPointerCleanBoundaryProjection =>
      guard.pointerCleanBoundaryProjection(primary, point, tracked);
    const evaluate = abiHandle(retained, "primary").evaluate.bind(
      abiHandle(retained, "primary"),
    ) as unknown as (
      pageFunction: typeof collect,
      argument: unknown,
    ) => Promise<PilotPointerCleanBoundaryProjection>;
    projection = await evaluate(collect, {
      guard: retained.pageGuard,
      point: sourcePoint,
      tracked: trackedElements,
    });
  } catch (error) {
    fail(
      "pilot_runtime.pointer_roundtrip",
      "pointer clean-boundary browser projection could not be collected",
      { cause: error },
    );
  }
  const observation = await capturePilotFixtureAuthoringObservation({
    page,
    capture_spec: captureSpec,
    action_plan: bound.actionPlan,
    primary_action_target_id: bound.primaryActionTargetId,
    primary_action_test_id: bound.primaryActionTestId,
  });
  return Object.freeze({
    exactDocumentSha256: await documentFingerprint(
      page,
      retained,
      bound.workflow,
      { controlPhase, normalization: "exact" },
      integrityBounds,
    ),
    computedStylesSha256: sha256Hex(
      Buffer.from(canonicalJson(projection.computedStyles), "utf8"),
    ),
    observation,
    hitTestSha256: sha256Hex(Buffer.from(canonicalJson(projection.hitTest), "utf8")),
    focusAndScrollSha256: sha256Hex(
      Buffer.from(canonicalJson(projection.focusAndScroll), "utf8"),
    ),
  });
}

/** @internal */
export function comparePilotPointerCleanBoundaries(
  actual: PilotPointerCleanBoundary,
  expected: PilotPointerCleanBoundary,
): Readonly<{
  dom: boolean;
  computedStyle: boolean;
  pixel: boolean;
  accessibility: boolean;
  layout: boolean;
  hitTest: boolean;
  focusAndScroll: boolean;
}> {
  return Object.freeze({
    dom: actual.exactDocumentSha256 === expected.exactDocumentSha256,
    computedStyle: actual.computedStylesSha256 === expected.computedStylesSha256,
    pixel: actual.observation.screenshot.equals(expected.observation.screenshot),
    accessibility: actual.observation.accessibility_tree.equals(
      expected.observation.accessibility_tree,
    ),
    layout: actual.observation.layout_graph.equals(expected.observation.layout_graph),
    hitTest: actual.hitTestSha256 === expected.hitTestSha256,
    focusAndScroll: actual.focusAndScrollSha256 === expected.focusAndScrollSha256,
  });
}

function pointerBoundaryComparisonPasses(
  comparison: ReturnType<typeof comparePilotPointerCleanBoundaries>,
): boolean {
  return (
    comparison.dom &&
    comparison.computedStyle &&
    comparison.pixel &&
    comparison.accessibility &&
    comparison.layout &&
    comparison.hitTest &&
    comparison.focusAndScroll
  );
}

function passingPointerProbeRows(probes: readonly string[]): readonly unknown[] {
  return probes.map((probe) => ({ probe, state: "pass" as const }));
}

function verifyPilotPointerRoundtrip(
  selected: SelectedPilotPointerOperator,
  removal: PilotPointerRemovalProbe,
  comparison: ReturnType<typeof comparePilotPointerCleanBoundaries>,
  phase: "inverse" | "cleanup",
): void {
  const states = [
    removal.ownedHandlesAbsent,
    removal.mutationPreimagesEqual,
    removal.listenerRegistryEqual,
    comparison.dom,
    comparison.computedStyle,
    comparison.pixel,
    comparison.accessibility,
    comparison.layout,
    comparison.hitTest,
    comparison.focusAndScroll,
    removal.runtimeClean,
  ];
  const probeCodes =
    phase === "inverse"
      ? selected.definition.required_probes.inverse_roundtrip
      : selected.definition.cleanup_audit.required;
  const rows = probeCodes.map((probe, index) => ({
    probe,
    state: states[index] === true ? ("pass" as const) : ("fail" as const),
  }));
  if (phase === "inverse") {
    createPilotPointerRoundtripProbeObservations(selected, rows);
  } else {
    createPilotPointerCleanupProbeObservations(selected, rows);
  }
}

async function sealPilotPointerTerminalBoundary(
  page: Page,
  retained: RetainedAbi,
): Promise<void> {
  const elements = pilotFixtureAbiSlots.map((slot) => abiHandle(retained, slot));
  const seal = ({
    audit,
    guard,
    retainedElements,
  }: {
    readonly audit: PilotMutationAudit;
    readonly guard: PilotPageGuardApi;
    readonly retainedElements: readonly Element[];
  }): PilotMutationSnapshot => {
    const snapshot = audit.seal();
    guard.sealTerminalBoundary(retainedElements);
    return snapshot;
  };
  const evaluate = page.evaluate.bind(page) as unknown as (
    pageFunction: typeof seal,
    argument: unknown,
  ) => Promise<PilotMutationSnapshot>;
  let snapshot: PilotMutationSnapshot;
  try {
    snapshot = await evaluate(seal, {
      audit: retained.mutationAudit,
      guard: retained.pageGuard,
      retainedElements: elements,
    });
  } catch (error) {
    fail(
      "pilot_runtime.pointer_cleanup",
      "pointer candidate terminal boundary could not be sealed",
      { cause: error },
    );
  }
  if (
    snapshot.overflow ||
    snapshot.unexpected.length !== 0 ||
    snapshot.rootMutationObserved ||
    snapshot.successMutationObserved
  ) {
    fail(
      "pilot_runtime.pointer_cleanup",
      "pointer candidate changed after its cleanup boundary",
    );
  }
}

async function executeWorkflow(
  context: BrowserContext,
  page: Page,
  bound: BoundWorkflow,
  audit: BrowserAuditState,
  captureSpec: CaptureSpec,
  checkpointBuffer: PilotFixtureAuthoringCheckpointBytes[] | undefined,
  measurePredicates: boolean,
  collectPointerBaseline = false,
  pointerCandidate?: PilotPointerCandidateExecutionInput,
): Promise<ExecutedWorkflow> {
  const selectedPointer =
    pointerCandidate === undefined
      ? undefined
      : assertSelectedPilotPointerOperator(pointerCandidate.selected);
  const integrityBounds = documentIntegrityBounds(captureSpec, bound.manifest);
  const retained = await retainAbi(page, bound.workflow, integrityBounds);
  await assertRetainedDocument(context, page, retained, bound, audit, captureSpec);
  await assertInitialWorkflowState(page, retained, bound.workflow);
  const frozenSourceGeometry = await sourcePointerGeometry(
    abiHandle(retained, "primary"),
    retained.pageGuard,
  );
  await assertClosedChromiumFonts(page, {
    expectedPlatformFamilyName: "Noto Sans",
    createError: (message, options) =>
      new PilotFixtureAuthoringRuntimeError(
        "pilot_runtime.fixture_font",
        message,
        options,
      ),
  });
  const pointerSourcePoint = Object.freeze({
    x: frozenSourceGeometry.centerX,
    y: frozenSourceGeometry.centerY,
  });
  if (selectedPointer !== undefined && pointerCandidate !== undefined) {
    assertPilotPointerSourcePredicates(
      selectedPointer,
      pointerCandidate.sourcePredicates,
    );
    createPilotPointerSourceProbeObservations(
      selectedPointer,
      passingPointerProbeRows(selectedPointer.definition.required_probes.source),
    );
    await beginPilotPointerIntervention(
      retained.mutationAudit,
      abiHandle(retained, "primary"),
      pointerSourcePoint,
      selectedPointer,
    );
    await installPilotPointerIntervention(retained.mutationAudit, selectedPointer, 0);
  }
  await captureWorkflowCheckpoint(page, bound, captureSpec, 0, checkpointBuffer);

  const focusEntry = abiHandle(retained, "focus_entry");
  const setup = abiHandle(retained, "setup");
  const primary = abiHandle(retained, "primary");
  const primaryOrdinal = bound.workflow.actions.length - 1;
  let activeSetupSlot: "focus_entry" | "setup" = "focus_entry";
  for (const [ordinal, action] of bound.workflow.actions.entries()) {
    if (ordinal === primaryOrdinal) break;
    switch (action.intent) {
      case "focus": {
        const target = abiHandle(retained, action.target);
        try {
          await target.focus();
        } catch (error) {
          fail("pilot_runtime.action_focus", "focus action failed", { cause: error });
        }
        await assertActiveElement(
          target,
          retained.pageGuard,
          "pilot_runtime.action_focus",
          "focus action did not retain its manifest-bound target",
        );
        await assertExactControlState(
          target,
          retained.pageGuard,
          bound.workflow.expectations.focus_entry_attribute ??
            bound.workflow.expectations.setup_attribute,
          "initial",
          "pilot_runtime.action_focus",
          "focus action changed the focus-entry control before its setup segment",
        );
        activeSetupSlot = "focus_entry";
        break;
      }
      case "fill_text": {
        const target = abiHandle(retained, action.target);
        try {
          await target.fill(action.value.text);
        } catch (error) {
          fail("pilot_runtime.action_fill", "fill-text action failed", {
            cause: error,
          });
        }
        const expectation =
          bound.workflow.expectations.focus_entry_attribute ??
          bound.workflow.expectations.setup_attribute;
        await assertExactControlState(
          target,
          retained.pageGuard,
          expectation,
          "selected",
          "pilot_runtime.action_fill",
          "fill-text action did not produce its exact declared value",
        );
        await assertActiveElement(
          target,
          retained.pageGuard,
          "pilot_runtime.action_fill",
          "fill-text action did not retain its manifest-bound target",
        );
        activeSetupSlot = "focus_entry";
        break;
      }
      case "press_key": {
        if (action.value.key === "Tab") {
          const segmentExpectation =
            activeSetupSlot === "focus_entry"
              ? (bound.workflow.expectations.focus_entry_attribute ??
                bound.workflow.expectations.setup_attribute)
              : bound.workflow.expectations.setup_attribute;
          await assertExactControlState(
            abiHandle(retained, activeSetupSlot),
            retained.pageGuard,
            segmentExpectation,
            "selected",
            "pilot_runtime.action_key",
            "setup segment did not reach its exact declared state before Tab",
          );
        }
        try {
          await page.keyboard.press(action.value.key);
        } catch (error) {
          fail("pilot_runtime.action_key", "key action failed", { cause: error });
        }
        if (action.value.key === "Tab") {
          const expectedSlot =
            ordinal === primaryOrdinal - 1
              ? bound.workflow.expectations.pre_primary_focus
              : "setup";
          await assertActiveElement(
            abiHandle(retained, expectedSlot),
            retained.pageGuard,
            "pilot_runtime.action_key",
            "Tab did not reach its manifest-bound workflow target",
          );
          if (ordinal !== primaryOrdinal - 1) {
            await assertExactControlState(
              abiHandle(retained, "setup"),
              retained.pageGuard,
              bound.workflow.expectations.setup_attribute,
              "initial",
              "pilot_runtime.action_key",
              "Tab changed the setup control before its key segment",
            );
          }
          activeSetupSlot = "setup";
        } else {
          await assertActiveElement(
            abiHandle(retained, activeSetupSlot),
            retained.pageGuard,
            "pilot_runtime.action_key",
            "setup key did not retain the active manifest control",
          );
        }
        break;
      }
      case "pointer_click":
        fail(
          "pilot_runtime.action_plan_binding",
          "pointer action appeared before the final recipe step",
        );
    }
  }

  await assertExactControlState(
    setup,
    retained.pageGuard,
    bound.workflow.expectations.setup_attribute,
    "selected",
    "pilot_runtime.action_key",
    "setup actions did not produce the exact declared setup state",
  );
  const focusEntryExpectation = bound.workflow.expectations.focus_entry_attribute;
  if (focusEntryExpectation !== undefined) {
    await assertExactControlState(
      focusEntry,
      retained.pageGuard,
      focusEntryExpectation,
      "selected",
      "pilot_runtime.action_key",
      "setup actions did not produce the exact declared focus-entry state",
    );
  }

  const prePrimaryMutations = await retained.mutationAudit.evaluate((guard) =>
    guard.drain(),
  );
  if (
    prePrimaryMutations.overflow ||
    prePrimaryMutations.unexpected.length !== 0 ||
    prePrimaryMutations.rootMutationObserved ||
    prePrimaryMutations.successMutationObserved
  ) {
    fail(
      "pilot_runtime.document_integrity",
      "workflow changed the manifest final fields before the primary action",
    );
  }
  await assertRetainedDocument(context, page, retained, bound, audit, captureSpec);
  assertBrowserAuditClean(context, page, bound, audit);
  let installedLayerProbe: PilotPointerLayerProbe | undefined;
  if (selectedPointer === undefined) {
    const prePrimaryGeometry = await sourcePointerGeometry(primary, retained.pageGuard);
    if (!sameGeometry(frozenSourceGeometry, prePrimaryGeometry)) {
      fail(
        "pilot_runtime.pointer_geometry",
        "primary geometry drifted after the source center was frozen",
      );
    }
  } else {
    installedLayerProbe = await probePilotPointerIntervention(
      retained.mutationAudit,
      selectedPointer,
      0,
    );
  }
  const primaryAction = bound.workflow.actions[primaryOrdinal];
  if (primaryAction?.intent !== "pointer_click") {
    fail(
      "pilot_runtime.action_plan_binding",
      "workflow does not end with its source-bound primary pointer action",
    );
  }
  const prePrimaryCheckpoint = await captureWorkflowCheckpoint(
    page,
    bound,
    captureSpec,
    1,
    checkpointBuffer,
  );
  if (
    (measurePredicates || selectedPointer !== undefined) &&
    prePrimaryCheckpoint === undefined
  ) {
    fail(
      "pilot_runtime.predicate_checkpoint",
      "Pilot predicate measurement requires a private pre-primary checkpoint",
    );
  }
  const measuredPredicates =
    (!measurePredicates && selectedPointer === undefined) ||
    prePrimaryCheckpoint === undefined
      ? undefined
      : await measurePilotMutationPredicates({
          primary,
          clipHost: abiHandle(retained, "clip_host"),
          contentPressure: abiHandle(retained, "content_pressure"),
          pageGuard: retained.pageGuard,
          sourcePoint: Object.freeze({
            x: frozenSourceGeometry.centerX,
            y: frozenSourceGeometry.centerY,
          }),
          prePrimaryCheckpoint,
          primaryActionTargetId: bound.primaryActionTargetId,
        });
  const sourcePredicates =
    selectedPointer === undefined ? measuredPredicates : undefined;
  const prePrimaryPointerBoundary = collectPointerBaseline
    ? await capturePilotPointerCleanBoundary(
        page,
        retained,
        bound,
        captureSpec,
        integrityBounds,
        Object.freeze({
          x: frozenSourceGeometry.centerX,
          y: frozenSourceGeometry.centerY,
        }),
        "selected",
      )
    : undefined;
  if (selectedPointer !== undefined && pointerCandidate !== undefined) {
    if (measuredPredicates === undefined || prePrimaryCheckpoint === undefined) {
      fail(
        "pilot_runtime.pointer_predicate_policy",
        "pointer candidate produced no installed predicate vector",
      );
    }
    const installedPredicates = assertPilotPointerInstalledPredicates(
      selectedPointer,
      measuredPredicates,
    );
    if (installedLayerProbe === undefined) {
      fail(
        "pilot_runtime.pointer_intervention_probe",
        "pointer candidate produced no mechanical installed-layer evidence",
      );
    }
    const changedSurfaceBounded =
      prePrimaryCheckpoint.screenshot.equals(
        pointerCandidate.baseline.prePrimary.observation.screenshot,
      ) &&
      prePrimaryCheckpoint.accessibility_tree.equals(
        pointerCandidate.baseline.prePrimary.observation.accessibility_tree,
      );
    const installedProbeStates = [
      installedLayerProbe.connected &&
        installedLayerProbe.parentIsBody &&
        installedLayerProbe.structureExact &&
        installedLayerProbe.attributesExact &&
        installedLayerProbe.stylesheetExact &&
        installedLayerProbe.geometryExact &&
        installedLayerProbe.transparentPaint &&
        installedLayerProbe.accessibilityHidden &&
        installedLayerProbe.nonFocusable &&
        installedLayerProbe.mutationRecordExact,
      installedLayerProbe.sourceHit ===
        (selectedPointer.pointer_mode === "intercept" ? "owned_layer" : "primary"),
      changedSurfaceBounded,
      installedPredicates[0].state ===
        selectedPointer.definition.expected_local_task_predicate.state,
      installedPredicates.every(
        ({ predicate, state }, index) =>
          predicate ===
            selectedPointer.definition.installed_predicate_policy.vector[index]
              ?.predicate &&
          state ===
            selectedPointer.definition.installed_predicate_policy.vector[index]
              ?.expected_state,
      ),
    ];
    createPilotPointerInstalledProbeObservations(
      selectedPointer,
      selectedPointer.definition.required_probes.installed.map((probe, index) => ({
        probe,
        state:
          installedProbeStates[index] === true ? ("pass" as const) : ("fail" as const),
      })),
    );
    const inverseRemoval = await removePilotPointerIntervention(
      retained.mutationAudit,
      0,
    );
    assertBrowserAuditClean(context, page, bound, audit);
    const inverseBoundary = await capturePilotPointerCleanBoundary(
      page,
      retained,
      bound,
      captureSpec,
      integrityBounds,
      pointerSourcePoint,
      "selected",
    );
    const inverseComparison = comparePilotPointerCleanBoundaries(
      inverseBoundary,
      pointerCandidate.baseline.prePrimary,
    );
    verifyPilotPointerRoundtrip(
      selectedPointer,
      inverseRemoval,
      inverseComparison,
      "inverse",
    );
    await installPilotPointerIntervention(retained.mutationAudit, selectedPointer, 1);
    await probePilotPointerIntervention(retained.mutationAudit, selectedPointer, 1);
  }
  try {
    await page.mouse.click(frozenSourceGeometry.centerX, frozenSourceGeometry.centerY, {
      button: "left",
    });
  } catch (error) {
    fail("pilot_runtime.action_pointer", "primary pointer action failed", {
      cause: error,
    });
  }
  await captureWorkflowCheckpoint(page, bound, captureSpec, 2, checkpointBuffer);

  const mutations = await retained.mutationAudit.evaluate((guard) => guard.drain());
  if (selectedPointer !== undefined && pointerCandidate !== undefined) {
    if (mutations.overflow || mutations.unexpected.length !== 0) {
      fail(
        "pilot_runtime.pointer_outcome",
        "pointer candidate changed DOM outside the declared task fields",
      );
    }
    const cleanupRemoval = await removePilotPointerIntervention(
      retained.mutationAudit,
      1,
    );
    await assertRetainedDocument(context, page, retained, bound, audit, captureSpec);
    assertBrowserAuditClean(context, page, bound, audit);
    const cleanupBoundary = await capturePilotPointerCleanBoundary(
      page,
      retained,
      bound,
      captureSpec,
      integrityBounds,
      pointerSourcePoint,
      "selected",
    );
    const unchangedComparison = comparePilotPointerCleanBoundaries(
      cleanupBoundary,
      pointerCandidate.baseline.prePrimary,
    );
    const successComparison = comparePilotPointerCleanBoundaries(
      cleanupBoundary,
      pointerCandidate.baseline.postPrimary,
    );
    const exactUnchanged = pointerBoundaryComparisonPasses(unchangedComparison);
    const exactSuccess = pointerBoundaryComparisonPasses(successComparison);
    if (exactUnchanged === exactSuccess) {
      fail(
        "pilot_runtime.pointer_outcome",
        "pointer candidate outcome is neither one exact state nor is ambiguous",
      );
    }
    const pointerCandidateOutcome: PilotPointerCandidateTaskOutcome = exactSuccess
      ? "exact_success"
      : "exact_unchanged";
    if (
      (pointerCandidateOutcome === "exact_success" &&
        (!mutations.rootMutationObserved || !mutations.successMutationObserved)) ||
      (pointerCandidateOutcome === "exact_unchanged" &&
        (mutations.rootMutationObserved || mutations.successMutationObserved))
    ) {
      fail(
        "pilot_runtime.pointer_outcome",
        "pointer candidate mutation trace disagrees with its independently measured task state",
      );
    }
    verifyPilotPointerRoundtrip(
      selectedPointer,
      cleanupRemoval,
      exactSuccess ? successComparison : unchangedComparison,
      "cleanup",
    );
    await finishPilotPointerIntervention(retained.mutationAudit);
    assertBrowserAuditClean(context, page, bound, audit);
    await assertClosedChromiumFonts(page, {
      expectedPlatformFamilyName: "Noto Sans",
      createError: (message, options) =>
        new PilotFixtureAuthoringRuntimeError(
          "pilot_runtime.fixture_font",
          message,
          options,
        ),
    });
    await sealPilotPointerTerminalBoundary(page, retained);
    return Object.freeze({
      retained,
      sourcePredicates: undefined,
      pointerBaseline: undefined,
      pointerCandidateOutcome,
      pointerTerminalSealed: true,
    });
  }

  await assertExactFinalWorkflowState(page, retained, bound.workflow, "workflow");
  if (
    mutations.overflow ||
    mutations.unexpected.length !== 0 ||
    !mutations.rootMutationObserved ||
    !mutations.successMutationObserved
  ) {
    fail(
      "pilot_runtime.document_integrity",
      "workflow DOM changes exceeded the two manifest-declared final fields",
    );
  }

  await assertRetainedDocument(context, page, retained, bound, audit, captureSpec);
  const finalDocumentSha256 = await documentFingerprint(
    page,
    retained,
    bound.workflow,
    { controlPhase: "selected", normalization: "workflow_transition" },
    integrityBounds,
  );
  if (finalDocumentSha256 !== retained.pristineDocumentSha256) {
    fail(
      "pilot_runtime.document_integrity",
      "fixture DOM or CSS changed outside the normalized workflow final fields",
    );
  }
  await assertClosedChromiumFonts(page, {
    expectedPlatformFamilyName: "Noto Sans",
    createError: (message, options) =>
      new PilotFixtureAuthoringRuntimeError(
        "pilot_runtime.fixture_font",
        message,
        options,
      ),
  });
  await assertExactFinalWorkflowState(
    page,
    retained,
    bound.workflow,
    "post-fingerprint workflow",
  );
  const postPrimaryPointerBoundary = collectPointerBaseline
    ? await capturePilotPointerCleanBoundary(
        page,
        retained,
        bound,
        captureSpec,
        integrityBounds,
        Object.freeze({
          x: frozenSourceGeometry.centerX,
          y: frozenSourceGeometry.centerY,
        }),
        "selected",
      )
    : undefined;
  const pointerBaseline =
    prePrimaryPointerBoundary === undefined || postPrimaryPointerBoundary === undefined
      ? undefined
      : Object.freeze({
          prePrimary: prePrimaryPointerBoundary,
          postPrimary: postPrimaryPointerBoundary,
        });
  return Object.freeze({
    retained,
    sourcePredicates,
    pointerBaseline,
    pointerCandidateOutcome: undefined,
    pointerTerminalSealed: false,
  });
}

function assertBrowserAuditClean(
  context: BrowserContext,
  page: Page,
  bound: BoundWorkflow,
  audit: BrowserAuditState,
): void {
  if (audit.blockedExternalRequests.length > 0) {
    fail(
      "pilot_runtime.blocked_external_request",
      "fixture attempted a request outside its exact in-memory origin",
    );
  }
  if (audit.unexpectedFixtureRequests.length > 0) {
    fail(
      "pilot_runtime.unexpected_fixture_request",
      "fixture attempted a request outside its exact declared GET paths",
    );
  }
  if (
    audit.cspViolations.length > 0 ||
    audit.pageErrors.length > 0 ||
    audit.transientEvents.length > 0 ||
    audit.overflow ||
    audit.documentReplaced ||
    audit.activeRouteHandlers !== 0 ||
    audit.activeRequests.size !== 0 ||
    audit.requestEvents !== audit.routeEvents ||
    context.pages().length !== 1 ||
    context.pages()[0] !== page ||
    context.serviceWorkers().length !== 0 ||
    page.frames().length !== 1 ||
    page.workers().length !== 0 ||
    (audit.resourceRequestCounts.get(bound.manifest.entrypoint) ?? 0) !== 1 ||
    (audit.resourceRequestCounts.get(bound.manifest.font.path) ?? 0) !== 1
  ) {
    fail(
      "pilot_runtime.session_tainted",
      "fixture browser, CSP, document, resource, or network audit is not clean",
    );
  }
}

function snapshotBrowserAudit(
  audit: BrowserAuditState,
): BrowserAuditCompletionSnapshot {
  return Object.freeze({
    auditEventCount: audit.auditEventCount,
    requestEvents: audit.requestEvents,
    routeEvents: audit.routeEvents,
    resourceRequestCounts: Object.freeze(
      [...audit.resourceRequestCounts.entries()]
        .sort(([left], [right]) => codeUnitCompare(left, right))
        .map(([path, count]) => Object.freeze([path, count] as const)),
    ),
  });
}

function sameResourceRequestCounts(
  audit: BrowserAuditState,
  snapshot: BrowserAuditCompletionSnapshot,
): boolean {
  const current = [...audit.resourceRequestCounts.entries()].sort(([left], [right]) =>
    codeUnitCompare(left, right),
  );
  return (
    current.length === snapshot.resourceRequestCounts.length &&
    current.every(
      ([path, count], index) =>
        path === snapshot.resourceRequestCounts[index]?.[0] &&
        count === snapshot.resourceRequestCounts[index]?.[1],
    )
  );
}

function assertTeardownAuditClean(
  bound: BoundWorkflow,
  audit: BrowserAuditState,
  snapshot: BrowserAuditCompletionSnapshot,
): void {
  if (
    audit.blockedExternalRequests.length > 0 ||
    audit.unexpectedFixtureRequests.length > 0 ||
    audit.cspViolations.length > 0 ||
    audit.pageErrors.length > 0 ||
    audit.transientEvents.length > 0 ||
    audit.overflow ||
    audit.documentReplaced ||
    audit.activeRouteHandlers !== 0 ||
    audit.activeRequests.size !== 0 ||
    audit.requestEvents !== audit.routeEvents ||
    audit.auditEventCount !== snapshot.auditEventCount ||
    audit.requestEvents !== snapshot.requestEvents ||
    audit.routeEvents !== snapshot.routeEvents ||
    !sameResourceRequestCounts(audit, snapshot) ||
    (audit.resourceRequestCounts.get(bound.manifest.entrypoint) ?? 0) !== 1 ||
    (audit.resourceRequestCounts.get(bound.manifest.font.path) ?? 0) !== 1
  ) {
    fail(
      "pilot_runtime.session_tainted",
      "fixture emitted browser, document, or network activity after completion",
    );
  }
}

function successAudit(
  lease: PilotFixtureAuthoringEnvironmentLease,
  bound: BoundWorkflow,
  audit: BrowserAuditState,
): PilotFixtureWorkflowAuthoringAudit {
  const resourceRequests = Object.freeze(
    [...audit.resourceRequestCounts.entries()]
      .sort(([left], [right]) => codeUnitCompare(left, right))
      .map(([path, requestCount]) =>
        Object.freeze({ path, request_count: requestCount }),
      ),
  );
  const [initial, prePrimary, postPrimary, ...extraCheckpoints] =
    bound.actionPlan.checkpoints;
  if (
    initial === undefined ||
    prePrimary === undefined ||
    postPrimary === undefined ||
    extraCheckpoints.length !== 0
  ) {
    fail(
      "pilot_runtime.action_plan_binding",
      "Pilot workflow must bind exactly three semantic checkpoints",
    );
  }
  const checkpointOrdinals = Object.freeze([
    initial.after_action_ordinal,
    prePrimary.after_action_ordinal,
    postPrimary.after_action_ordinal,
  ] as const);
  const emptyExternal = Object.freeze([]) as readonly [];
  const emptyUnexpected = Object.freeze([]) as readonly [];
  return Object.freeze({
    kind: "pilot_fixture_workflow_authoring_audit",
    official: false,
    fixture_key: bound.manifest.fixture_key,
    fixture_revision: bound.manifest.revision,
    source_state_id: bound.authoringPackage.source_state_id,
    workflow_key: bound.workflow.workflow_key,
    task_id: bound.taskId,
    environment_id: lease.environment_id,
    actions_executed: bound.actionPlan.actions.length,
    checkpoint_after_action_ordinals: checkpointOrdinals,
    resource_requests: resourceRequests,
    blocked_external_requests: emptyExternal,
    unexpected_fixture_requests: emptyUnexpected,
  });
}

async function disposeRetained(
  retained: RetainedAbi,
  requireQuiescent: boolean,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    const lateMutations = await retained.mutationAudit.evaluate((guard) =>
      guard.drainAndDisconnect(),
    );
    if (
      requireQuiescent &&
      (lateMutations.overflow ||
        lateMutations.unexpected.length !== 0 ||
        lateMutations.rootMutationObserved ||
        lateMutations.successMutationObserved)
    ) {
      errors.push(
        new PilotFixtureAuthoringRuntimeError(
          "pilot_runtime.document_integrity",
          "fixture changed after the final workflow boundary",
        ),
      );
    }
  } catch (error) {
    errors.push(error);
  }
  try {
    await retained.mutationAudit.dispose();
  } catch (error) {
    errors.push(error);
  }
  try {
    await retained.pageGuard.dispose();
  } catch (error) {
    errors.push(error);
  }
  for (const handle of retained.slots.values()) {
    try {
      await handle.dispose();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await retained.documentElement.dispose();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "retained Pilot ABI cleanup failed");
  }
}

function normalizeSessionFailure(
  error: unknown,
  audit: BrowserAuditState | undefined,
): PilotFixtureAuthoringRuntimeError {
  if (error instanceof PilotFixtureAuthoringRuntimeError) return error;
  if (audit !== undefined && audit.blockedExternalRequests.length > 0) {
    return new PilotFixtureAuthoringRuntimeError(
      "pilot_runtime.blocked_external_request",
      "fixture attempted a request outside its exact in-memory origin",
      { cause: error },
    );
  }
  if (audit !== undefined && audit.unexpectedFixtureRequests.length > 0) {
    return new PilotFixtureAuthoringRuntimeError(
      "pilot_runtime.unexpected_fixture_request",
      "fixture attempted a request outside its exact declared GET paths",
      { cause: error },
    );
  }
  return new PilotFixtureAuthoringRuntimeError(
    "pilot_runtime.execution",
    "Pilot fixture workflow authoring replay failed",
    { cause: error },
  );
}

type PilotFixtureWorkflowAuthoringSessionMode =
  "audit" | "capture" | "predicate" | "pointer_baseline" | "pointer_candidate";

function exactCheckpointTuple(
  checkpointBuffer: readonly PilotFixtureAuthoringCheckpointBytes[],
): PilotFixtureAuthoringCheckpointTuple {
  const [initial, prePrimary, postPrimary, ...extra] = checkpointBuffer;
  if (
    initial === undefined ||
    prePrimary === undefined ||
    postPrimary === undefined ||
    extra.length !== 0 ||
    initial.ordinal !== 0 ||
    prePrimary.ordinal !== 1 ||
    postPrimary.ordinal !== 2
  ) {
    fail(
      "pilot_runtime.checkpoint_capture",
      "Pilot authoring capture did not produce its exact three-checkpoint tuple",
    );
  }
  return Object.freeze([initial, prePrimary, postPrimary] as const);
}

/** @internal Acquires no disk authority and always finalizes the supplied lease. */
export function runPilotFixtureWorkflowAuthoringSession(
  lease: PilotFixtureAuthoringEnvironmentLease,
  workflowKey: string,
): Promise<PilotFixtureWorkflowAuthoringAudit>;
/** @internal Acquires no disk authority and always finalizes the supplied lease. */
export function runPilotFixtureWorkflowAuthoringSession(
  lease: PilotFixtureAuthoringEnvironmentLease,
  workflowKey: string,
  mode: "audit",
): Promise<PilotFixtureWorkflowAuthoringAudit>;
/** @internal Acquires no disk authority and always finalizes the supplied lease. */
export function runPilotFixtureWorkflowAuthoringSession(
  lease: PilotFixtureAuthoringEnvironmentLease,
  workflowKey: string,
  mode: "capture",
): Promise<PilotFixtureWorkflowAuthoringCaptureSessionResult>;
/** @internal Acquires no disk authority and always finalizes the supplied lease. */
export function runPilotFixtureWorkflowAuthoringSession(
  lease: PilotFixtureAuthoringEnvironmentLease,
  workflowKey: string,
  mode: "predicate",
): Promise<PilotFixtureWorkflowAuthoringPredicateSessionResult>;
/** @internal Acquires no disk authority and always finalizes the supplied lease. */
export function runPilotFixtureWorkflowAuthoringSession(
  lease: PilotFixtureAuthoringEnvironmentLease,
  workflowKey: string,
  mode: "pointer_baseline",
): Promise<PilotFixturePointerBaselineAuthoringSessionResult>;
/** @internal Acquires no disk authority and always finalizes the supplied lease. */
export function runPilotFixtureWorkflowAuthoringSession(
  lease: PilotFixtureAuthoringEnvironmentLease,
  workflowKey: string,
  mode: "pointer_candidate",
  pointerCandidate: PilotPointerCandidateExecutionInput,
): Promise<PilotFixturePointerCandidateAuthoringSessionResult>;
/** @internal Acquires no disk authority and always finalizes the supplied lease. */
export async function runPilotFixtureWorkflowAuthoringSession(
  lease: PilotFixtureAuthoringEnvironmentLease,
  workflowKey: string,
  mode: PilotFixtureWorkflowAuthoringSessionMode = "audit",
  pointerCandidate?: PilotPointerCandidateExecutionInput,
): Promise<
  | PilotFixtureWorkflowAuthoringAudit
  | PilotFixtureWorkflowAuthoringCaptureSessionResult
  | PilotFixtureWorkflowAuthoringPredicateSessionResult
  | PilotFixturePointerBaselineAuthoringSessionResult
  | PilotFixturePointerCandidateAuthoringSessionResult
> {
  let bound: BoundWorkflow | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let retained: RetainedAbi | undefined;
  let sourcePredicates: PilotMutationPredicateObservationTuple | undefined;
  let pointerBaseline: PilotPointerBaselineEvidence | undefined;
  let pointerCandidateOutcome: PilotPointerCandidateTaskOutcome | undefined;
  let audit: BrowserAuditState | undefined;
  let completionSnapshot: BrowserAuditCompletionSnapshot | undefined;
  let executionComplete = false;
  let primaryFailure: PilotFixtureAuthoringRuntimeError | undefined;
  const cleanupFailures: unknown[] = [];
  let contextCreationAttempted = false;
  let reusable = true;
  let terminalBoundarySealed = false;
  const checkpointBuffer: PilotFixtureAuthoringCheckpointBytes[] | undefined =
    mode === "audit" ? undefined : [];

  try {
    bound = bindWorkflow(lease, workflowKey);
    if (
      (mode === "pointer_candidate" && pointerCandidate === undefined) ||
      (mode !== "pointer_candidate" && pointerCandidate !== undefined)
    ) {
      fail(
        "pilot_runtime.pointer_intervention_input",
        "pointer candidate evidence must accompany only pointer-candidate mode",
      );
    }
    contextCreationAttempted = true;
    if (lease.browser.contexts().length !== 0) {
      fail(
        "pilot_runtime.context_ownership",
        "verified Pilot browser was not context-free before replay",
      );
    }
    context = await lease.browser.newContext(contextOptions(lease.capture_spec));
    page = await context.newPage();
    audit = newBrowserAudit();
    await installBrowserAudit(context, page, bound, audit);
    await installPageGuards(page, bound.manifest.mutation_policy.style_nonce);
    page.setDefaultNavigationTimeout(lease.capture_spec.budgets.navigation_timeout_ms);
    page.setDefaultTimeout(lease.capture_spec.budgets.action_timeout_ms);
    await page.clock.install({ time: lease.capture_spec.clock.epoch_ms });
    await page.clock.pauseAt(lease.capture_spec.clock.epoch_ms);
    await page.goto(`${fixtureOrigin}/`, { waitUntil: "load" });
    await page.waitForFunction(
      (readinessGlobal) => {
        const state = Reflect.get(window, readinessGlobal) as
          { readonly ready?: unknown; readonly pendingRequests?: unknown } | undefined;
        return state?.ready === true && state.pendingRequests === 0;
      },
      bound.manifest.readiness.global,
      { timeout: lease.capture_spec.budgets.readiness_timeout_ms },
    );
    audit.navigationArmed = true;
    assertBrowserAuditClean(context, page, bound, audit);
    await assertFixtureReadiness(page, bound.manifest, lease.capture_spec);
    const initialNow = await page.evaluate(() => Date.now());
    if (initialNow !== lease.capture_spec.clock.epoch_ms) {
      fail(
        "pilot_runtime.clock_drift",
        "fixture virtual clock did not pause at the CaptureSpec epoch",
      );
    }
    const executed = await executeWorkflow(
      context,
      page,
      bound,
      audit,
      lease.capture_spec,
      checkpointBuffer,
      mode === "predicate" || mode === "pointer_baseline",
      mode === "pointer_baseline",
      pointerCandidate,
    );
    retained = executed.retained;
    sourcePredicates = executed.sourcePredicates;
    pointerBaseline = executed.pointerBaseline;
    pointerCandidateOutcome = executed.pointerCandidateOutcome;
    terminalBoundarySealed = executed.pointerTerminalSealed;
    assertBrowserAuditClean(context, page, bound, audit);
    completionSnapshot = snapshotBrowserAudit(audit);
    executionComplete = true;
  } catch (error) {
    primaryFailure = normalizeSessionFailure(error, audit);
    if (contextCreationAttempted) reusable = false;
  }

  if (audit !== undefined) {
    if (audit.activeRouteHandlers !== 0) {
      reusable = false;
      cleanupFailures.push(
        new Error("fixture route handlers remained active when cleanup began"),
      );
    }
  }
  if (retained !== undefined) {
    if (executionComplete && !terminalBoundarySealed) {
      try {
        if (bound === undefined || page === undefined) {
          throw new Error("retained Pilot ABI has no bound workflow and owned page");
        }
        const lateMutations = await assertExactFinalWorkflowState(
          page,
          retained,
          bound.workflow,
          "terminal workflow",
          true,
        );
        if (
          lateMutations === undefined ||
          lateMutations.overflow ||
          lateMutations.unexpected.length !== 0 ||
          lateMutations.rootMutationObserved ||
          lateMutations.successMutationObserved
        ) {
          throw new PilotFixtureAuthoringRuntimeError(
            "pilot_runtime.document_integrity",
            "fixture changed after the final workflow boundary",
          );
        }
        terminalBoundarySealed = true;
      } catch (error) {
        reusable = false;
        cleanupFailures.push(error);
      }
    }
    if (!terminalBoundarySealed) {
      try {
        await disposeRetained(retained, false);
      } catch (error) {
        reusable = false;
        cleanupFailures.push(error);
      }
    }
  }
  if (context !== undefined) {
    if (audit !== undefined) audit.closing = true;
    try {
      await context.close();
    } catch (error) {
      reusable = false;
      cleanupFailures.push(error);
    }
    try {
      const remainingContexts = lease.browser.contexts();
      if (remainingContexts.length !== 0 || remainingContexts.includes(context)) {
        reusable = false;
        cleanupFailures.push(
          new Error("verified Pilot browser retained its authoring context"),
        );
      }
    } catch (error) {
      reusable = false;
      cleanupFailures.push(error);
    }
    if (audit?.activeRouteHandlers !== 0) {
      reusable = false;
      cleanupFailures.push(
        new Error("fixture route handlers remained active after context close"),
      );
    }
    if (audit !== undefined && audit.activeRequests.size !== 0) {
      reusable = false;
      cleanupFailures.push(
        new Error("fixture requests remained active after context close"),
      );
    }
    if (
      executionComplete &&
      bound !== undefined &&
      audit !== undefined &&
      completionSnapshot !== undefined
    ) {
      try {
        assertTeardownAuditClean(bound, audit, completionSnapshot);
      } catch (error) {
        reusable = false;
        cleanupFailures.push(error);
      }
    }
    if (!lease.browser.isConnected()) {
      reusable = false;
      cleanupFailures.push(
        new Error("verified browser disconnected during fixture context cleanup"),
      );
    }
  } else if (contextCreationAttempted) {
    reusable = false;
  }
  try {
    if (reusable) lease.release();
    else lease.invalidate();
  } catch (error) {
    cleanupFailures.push(error);
  }

  if (cleanupFailures.length > 0) {
    const causes =
      primaryFailure === undefined
        ? cleanupFailures
        : [primaryFailure, ...cleanupFailures];
    throw new PilotFixtureAuthoringRuntimeError(
      "pilot_runtime.cleanup",
      "Pilot fixture authoring replay could not be cleaned up safely",
      {
        cause: new AggregateError(causes, "Pilot replay and cleanup lifecycle failed"),
      },
    );
  }
  if (primaryFailure !== undefined) throw primaryFailure;
  if (
    !executionComplete ||
    bound === undefined ||
    audit === undefined ||
    completionSnapshot === undefined
  ) {
    fail(
      "pilot_runtime.execution",
      "Pilot fixture workflow replay produced no complete audit",
    );
  }
  const completedAudit = successAudit(lease, bound, audit);
  if (mode === "audit") return completedAudit;
  if (checkpointBuffer === undefined) {
    fail(
      "pilot_runtime.checkpoint_capture",
      "Pilot authoring capture produced no private checkpoint buffer",
    );
  }
  if (mode === "capture") {
    return Object.freeze({
      audit: completedAudit,
      checkpoints: exactCheckpointTuple(checkpointBuffer),
    });
  }
  exactCheckpointTuple(checkpointBuffer);
  if (mode === "pointer_candidate") {
    if (pointerCandidateOutcome === undefined) {
      fail(
        "pilot_runtime.pointer_outcome",
        "Pilot pointer candidate produced no exact task outcome",
      );
    }
    return Object.freeze({
      audit: completedAudit,
      task_outcome: pointerCandidateOutcome,
    });
  }
  if (sourcePredicates === undefined) {
    fail(
      "pilot_runtime.predicate_probe",
      "Pilot authoring capture produced no complete source predicate vector",
    );
  }
  if (mode === "pointer_baseline") {
    if (pointerBaseline === undefined) {
      fail(
        "pilot_runtime.pointer_roundtrip",
        "Pilot pointer baseline produced no exact clean-boundary evidence",
      );
    }
    return Object.freeze({
      audit: completedAudit,
      source_predicates: sourcePredicates,
      pointer_baseline: pointerBaseline,
    });
  }
  return Object.freeze({
    audit: completedAudit,
    source_predicates: sourcePredicates,
  });
}
