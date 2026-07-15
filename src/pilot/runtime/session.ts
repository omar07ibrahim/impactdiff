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
import type { ActionPlan, CaptureSpec } from "../../capture/schema.js";
import { parseActionPlan } from "../../capture/validate.js";
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
import { PilotFixtureAuthoringRuntimeError } from "./errors.js";

const fixtureOrigin = "https://pilot-fixture.impactdiff.invalid";
const maximumAuditEvents = 256;
const maximumAuditTextLength = 2_048;

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
  readonly actions_executed: 4;
  readonly checkpoint_after_action_ordinals: readonly [-1, 2, 3];
  readonly resource_requests: readonly PilotFixtureResourceRequestAudit[];
  readonly blocked_external_requests: readonly [];
  readonly unexpected_fixture_requests: readonly [];
}

interface BoundWorkflow {
  readonly manifest: PilotFixtureManifest;
  readonly workflow: PilotFixtureWorkflow;
  readonly actionPlan: ActionPlan;
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
  readonly mutationAudit: JSHandle<{
    readonly drain: () => {
      readonly overflow: boolean;
      readonly unexpected: readonly string[];
      readonly rootMutationObserved: boolean;
      readonly successMutationObserved: boolean;
    };
    readonly drainAndDisconnect: () => {
      readonly overflow: boolean;
      readonly unexpected: readonly string[];
      readonly rootMutationObserved: boolean;
      readonly successMutationObserved: boolean;
    };
  }>;
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
  return Object.freeze({
    manifest,
    workflow,
    actionPlan,
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
    if (/content security policy|violates the following directive/iu.test(text)) {
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

async function installPageGuards(page: Page): Promise<void> {
  try {
    await page.addInitScript(() => {
      const denyAuthorShadowRoot = Object.freeze(
        function denyAuthorShadowRoot(): never {
          throw new DOMException(
            "author shadow roots are disabled in Pilot authoring",
            "NotSupportedError",
          );
        },
      );
      Object.defineProperty(Element.prototype, "attachShadow", {
        value: denyAuthorShadowRoot,
        writable: false,
        enumerable: false,
        configurable: false,
      });
      for (const property of [
        "RTCPeerConnection",
        "webkitRTCPeerConnection",
      ] as const) {
        Object.defineProperty(globalThis, property, {
          value: undefined,
          writable: false,
          enumerable: false,
          configurable: false,
        });
      }
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

async function documentFingerprint(
  page: Page,
  retained: Pick<RetainedAbi, "documentElement" | "slots">,
  workflow: PilotFixtureWorkflow,
  bounds: DocumentIntegrityBounds,
): Promise<string> {
  const root = retained.slots.get("root");
  const success = retained.slots.get("success");
  const setup = retained.slots.get("setup");
  if (root === undefined || success === undefined || setup === undefined) {
    fail(
      "pilot_runtime.abi",
      "document fingerprint requires root, setup, and success ABI slots",
    );
  }
  let snapshot: unknown;
  try {
    snapshot = await page.evaluate(
      ({
        documentElement,
        rootElement,
        setupElement,
        successElement,
        rootAttribute,
        limits,
      }) => {
        if (
          documentElement !== document.documentElement ||
          !rootElement.isConnected ||
          !setupElement.isConnected ||
          !successElement.isConnected ||
          !documentElement.contains(rootElement) ||
          !documentElement.contains(setupElement) ||
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
        const projectLiveElementState = (node: Element): unknown => {
          const scroll = {
            left: finiteNumber(node.scrollLeft, "element scrollLeft"),
            top: finiteNumber(node.scrollTop, "element scrollTop"),
          };
          if (node instanceof HTMLSelectElement) {
            const normalizedSetup = node === setupElement;
            return {
              scroll,
              form: {
                kind: "select",
                value: normalizedSetup ? "$EXPECTED_SETUP_VALUE" : addText(node.value),
                selectedIndex: normalizedSetup
                  ? "$EXPECTED_SETUP_INDEX"
                  : node.selectedIndex,
                optionSelected: Array.from(node.options, (option) =>
                  normalizedSetup ? "$EXPECTED_SETUP_SELECTED" : option.selected,
                ),
              },
            };
          }
          if (node instanceof HTMLOptionElement) {
            return {
              scroll,
              form: {
                kind: "option",
                selected:
                  node.closest("select") === setupElement
                    ? "$EXPECTED_SETUP_SELECTED"
                    : node.selected,
              },
            };
          }
          if (node instanceof HTMLInputElement) {
            if (node.files !== null && node.files.length !== 0) {
              throw new Error("fixture integrity does not admit selected files");
            }
            return {
              scroll,
              form: {
                kind: "input",
                value: addText(node.value),
                checked: node.checked,
                indeterminate: node.indeterminate,
                selectionStart: node.selectionStart,
                selectionEnd: node.selectionEnd,
                selectionDirection: node.selectionDirection,
              },
            };
          }
          if (node instanceof HTMLTextAreaElement) {
            return {
              scroll,
              form: {
                kind: "textarea",
                value: addText(node.value),
                selectionStart: node.selectionStart,
                selectionEnd: node.selectionEnd,
                selectionDirection: node.selectionDirection,
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
          if (project && node === rootElement && !normalizedRootAttributePresent) {
            attributes.push([null, rootAttribute, "$EXPECTED_ROOT_VALUE"]);
          }
          if (project) {
            attributes.sort((left, right) => {
              const leftKey = `${left[0] ?? ""}\0${left[1]}`;
              const rightKey = `${right[0] ?? ""}\0${right[1]}`;
              return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
            });
          }
          const normalizeSuccessChildren = node === successElement;
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
                    scale: finiteNumber(visualViewport.scale, "visual viewport scale"),
                  },
          },
        };
      },
      {
        documentElement: retained.documentElement,
        rootElement: root,
        setupElement: setup,
        successElement: success,
        rootAttribute: workflow.expectations.final.root_attribute.name,
        limits: bounds,
      },
    );
  } catch (error) {
    fail(
      "pilot_runtime.document_integrity",
      "fixture document fingerprint could not be collected",
      { cause: error },
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
  const mutationAudit = (await page.evaluateHandle(
    ({ rootElement, successElement, rootAttribute }) => {
      let overflow = false;
      let rootMutationObserved = false;
      let successMutationObserved = false;
      const unexpected: string[] = [];
      const maximumRecords = 64;
      let recordCount = 0;
      const process = (records: MutationRecord[]): void => {
        for (const record of records) {
          recordCount += 1;
          if (recordCount > maximumRecords) {
            overflow = true;
            continue;
          }
          if (
            record.type === "attributes" &&
            record.target === rootElement &&
            record.attributeName === rootAttribute
          ) {
            rootMutationObserved = true;
            continue;
          }
          if (
            record.type === "childList" &&
            record.target === successElement &&
            record.addedNodes.length + record.removedNodes.length > 0 &&
            [...record.addedNodes, ...record.removedNodes].every(
              (node) => node instanceof Text,
            )
          ) {
            successMutationObserved = true;
            continue;
          }
          if (
            record.type === "characterData" &&
            record.target instanceof Text &&
            record.target.parentNode === successElement
          ) {
            successMutationObserved = true;
            continue;
          }
          const target =
            record.target instanceof Element
              ? (record.target.getAttribute("data-testid") ?? record.target.localName)
              : `node-${record.target.nodeType}`;
          unexpected.push(
            `${record.type}:${target}:${record.attributeName ?? "$NULL"}`,
          );
        }
      };
      const observer = new MutationObserver(process);
      observer.observe(document, {
        subtree: true,
        attributes: true,
        attributeOldValue: true,
        childList: true,
        characterData: true,
        characterDataOldValue: true,
      });
      const snapshotAndReset = () => {
        const snapshot = Object.freeze({
          overflow,
          unexpected: Object.freeze([...unexpected]),
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
      return Object.freeze({
        drain() {
          process(observer.takeRecords());
          return snapshotAndReset();
        },
        drainAndDisconnect() {
          process(observer.takeRecords());
          observer.disconnect();
          return snapshotAndReset();
        },
      });
    },
    {
      rootElement: root,
      successElement: success,
      rootAttribute: workflow.expectations.final.root_attribute.name,
    },
  )) as RetainedAbi["mutationAudit"];
  const partial = { documentElement, slots, mutationAudit };
  return Object.freeze({
    ...partial,
    pristineDocumentSha256: await documentFingerprint(
      page,
      partial,
      workflow,
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
      (element) => element === document.documentElement && element.isConnected,
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
    }) => ({
      setupIsSelect: setupElement instanceof HTMLSelectElement,
      setupValue: setupElement instanceof HTMLSelectElement ? setupElement.value : null,
      setupFocusAlias: setupElement === focusElement,
      rootInitial: rootElement.getAttribute(rootAttribute),
      primaryIsButton:
        primaryElement instanceof HTMLButtonElement && !primaryElement.disabled,
      peerIsButton: peerElement instanceof HTMLButtonElement,
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
    },
  );
  if (
    !evidence.setupIsSelect ||
    evidence.setupValue !== workflow.expectations.setup_attribute.initial ||
    !evidence.setupFocusAlias ||
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
  await assertExactSetupSelection(
    setup,
    workflow.expectations.setup_attribute.initial,
    "pilot_runtime.workflow_state",
    "fixture initial setup selection is not unique and one-hot",
  );
}

async function assertExactSetupSelection(
  setup: ElementHandle<Element>,
  expectedValue: string,
  code: string,
  message: string,
): Promise<void> {
  let evidence:
    | {
        readonly multiple: boolean;
        readonly value: string;
        readonly selectedIndex: number;
        readonly optionValues: readonly string[];
        readonly selectedIndexes: readonly number[];
      }
    | undefined;
  try {
    evidence = await setup.evaluate((element) => {
      if (!(element instanceof HTMLSelectElement)) return undefined;
      const options = Array.from(element.options);
      return {
        multiple: element.multiple,
        value: element.value,
        selectedIndex: element.selectedIndex,
        optionValues: options.map((option) => option.value),
        selectedIndexes: options.flatMap((option, index) =>
          option.selected ? [index] : [],
        ),
      };
    });
  } catch (error) {
    fail(code, message, { cause: error });
  }
  if (
    evidence === undefined ||
    evidence.multiple ||
    evidence.optionValues.length < 2 ||
    new Set(evidence.optionValues).size !== evidence.optionValues.length ||
    evidence.selectedIndexes.length !== 1 ||
    evidence.selectedIndexes[0] !== evidence.selectedIndex ||
    evidence.optionValues[evidence.selectedIndex] !== expectedValue ||
    evidence.value !== expectedValue
  ) {
    fail(code, message);
  }
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
  page: Page,
  primary: ElementHandle<Element>,
): Promise<SourcePointerGeometry> {
  const value = await page.evaluate((target) => {
    const rect = target.getBoundingClientRect();
    const style = getComputedStyle(target);
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const hit = document.elementFromPoint(centerX, centerY);
    if (
      !target.isConnected ||
      !(target instanceof HTMLButtonElement) ||
      target.disabled ||
      rect.width <= 0 ||
      rect.height <= 0 ||
      centerX < 0 ||
      centerY < 0 ||
      centerX >= innerWidth ||
      centerY >= innerHeight ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      hit === null ||
      (hit !== target && !target.contains(hit))
    ) {
      throw new Error("primary source center is not a visible exact hit target");
    }
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      centerX,
      centerY,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
  }, primary);
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

async function activeElementIs(handle: ElementHandle<Element>): Promise<boolean> {
  return handle.evaluate((element) => document.activeElement === element);
}

async function executeWorkflow(
  context: BrowserContext,
  page: Page,
  bound: BoundWorkflow,
  audit: BrowserAuditState,
  captureSpec: CaptureSpec,
): Promise<RetainedAbi> {
  const integrityBounds = documentIntegrityBounds(captureSpec, bound.manifest);
  const retained = await retainAbi(page, bound.workflow, integrityBounds);
  await assertRetainedDocument(context, page, retained, bound, audit, captureSpec);
  await assertInitialWorkflowState(page, retained, bound.workflow);
  const frozenSourceGeometry = await sourcePointerGeometry(
    page,
    abiHandle(retained, "primary"),
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

  const focusEntry = abiHandle(retained, "focus_entry");
  const setup = abiHandle(retained, "setup");
  const primary = abiHandle(retained, "primary");
  const root = abiHandle(retained, "root");
  const success = abiHandle(retained, "success");

  await focusEntry.focus();
  if (!(await activeElementIs(focusEntry))) {
    fail(
      "pilot_runtime.action_focus",
      "focus action did not retain the manifest focus-entry element",
    );
  }

  await page.keyboard.press("ArrowDown");
  await assertExactSetupSelection(
    setup,
    bound.workflow.expectations.setup_attribute.selected,
    "pilot_runtime.action_key",
    "ArrowDown did not produce the exact unique one-hot native setup selection",
  );
  if (!(await activeElementIs(setup))) {
    fail(
      "pilot_runtime.action_key",
      "ArrowDown did not retain focus on the native setup control",
    );
  }

  await page.keyboard.press("Tab");
  if (!(await activeElementIs(primary))) {
    fail(
      "pilot_runtime.action_key",
      "Tab did not reach the manifest-bound primary ABI element",
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
  const prePrimaryGeometry = await sourcePointerGeometry(page, primary);
  if (!sameGeometry(frozenSourceGeometry, prePrimaryGeometry)) {
    fail(
      "pilot_runtime.pointer_geometry",
      "primary geometry drifted after the source center was frozen",
    );
  }
  await page.mouse.click(frozenSourceGeometry.centerX, frozenSourceGeometry.centerY, {
    button: "left",
  });

  const final = await page.evaluate(
    ({ rootElement, successElement, setupElement, rootAttribute }) => ({
      rootValue: rootElement.getAttribute(rootAttribute),
      successText: successElement.textContent,
      setupValue: setupElement instanceof HTMLSelectElement ? setupElement.value : null,
      successFocused: document.activeElement === successElement,
    }),
    {
      rootElement: root,
      successElement: success,
      setupElement: setup,
      rootAttribute: bound.workflow.expectations.final.root_attribute.name,
    },
  );
  if (
    final.rootValue !== bound.workflow.expectations.final.root_attribute.value ||
    final.successText !== bound.workflow.expectations.final.success_text ||
    final.setupValue !== bound.workflow.expectations.setup_attribute.selected ||
    !final.successFocused
  ) {
    fail(
      "pilot_runtime.final_expectation",
      "workflow final state differs from its exact manifest expectations",
    );
  }
  await assertExactSetupSelection(
    setup,
    bound.workflow.expectations.setup_attribute.selected,
    "pilot_runtime.final_expectation",
    "workflow final setup selection is not unique and one-hot",
  );

  const mutations = await retained.mutationAudit.evaluate((guard) => guard.drain());
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
  return retained;
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
  const checkpointOrdinals = Object.freeze([-1, 2, 3] as const);
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
    actions_executed: 4,
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

/** @internal Acquires no disk authority and always finalizes the supplied lease. */
export async function runPilotFixtureWorkflowAuthoringSession(
  lease: PilotFixtureAuthoringEnvironmentLease,
  workflowKey: string,
): Promise<PilotFixtureWorkflowAuthoringAudit> {
  let bound: BoundWorkflow | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let retained: RetainedAbi | undefined;
  let audit: BrowserAuditState | undefined;
  let completionSnapshot: BrowserAuditCompletionSnapshot | undefined;
  let executionComplete = false;
  let primaryFailure: PilotFixtureAuthoringRuntimeError | undefined;
  const cleanupFailures: unknown[] = [];
  let contextCreationAttempted = false;
  let reusable = true;

  try {
    bound = bindWorkflow(lease, workflowKey);
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
    await installPageGuards(page);
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
    retained = await executeWorkflow(context, page, bound, audit, lease.capture_spec);
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
    try {
      await disposeRetained(retained, executionComplete);
    } catch (error) {
      reusable = false;
      cleanupFailures.push(error);
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
  return successAudit(lease, bound, audit);
}
