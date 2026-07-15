import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  BrowserContext,
  BrowserContextOptions,
  CDPSession,
  ElementHandle,
  JSHandle,
  Page,
} from "@playwright/test";

import { validateArtifactReference } from "../artifacts/cas.js";
import { canonicalizePng } from "../artifacts/png.js";
import {
  adaptChromiumLayoutSnapshot,
  chromiumLayoutComputedStyles,
} from "../capture/chromium-layout.js";
import { assertClosedChromiumFonts } from "../capture/chromium-fonts.js";
import { computeFixtureActionTargetId } from "../capture/identity.js";
import { normalizeAccessibilitySnapshot } from "../capture/normalize-ax.js";
import type { ActionPlan, CaptureSpec, LayoutSnapshot } from "../capture/schema.js";
import {
  assertCaptureGraphBindings,
  parseActionPlan,
  parseCaptureSpec,
} from "../capture/validate.js";
import {
  canonicalJson,
  computeCheckpointId,
  computeEnvironmentId,
  computeSourceStateId,
  computeTaskId,
  sha256Hex,
} from "../contracts/canonical.js";
import type { ArtifactRef } from "../contracts/artifacts.js";
import {
  intrinsicUint8ArrayByteLength,
  snapshotUint8Array,
} from "../contracts/byte-array.js";
import {
  validateMutationCompilation,
  validateMutationRequest,
  validateSourceProbe,
} from "./compiler.js";
import {
  computeMutationInstanceId,
  computeMutationTargetNodeId,
  computeSourceProbeFingerprint,
} from "./identity.js";
import {
  contrastRatioMilli,
  oceanPaletteDefinition,
  oceanPaletteSha256,
} from "./palette.js";
import type { Rgb } from "./palette.js";
import type {
  FixedRect,
  MutationPlan,
  MutationRequest,
  SourceProbe,
} from "./schema.js";
import { parseSourceState } from "../source/validate.js";
import type { SourceState } from "../source/schema.js";
import {
  acquireMutationFixtureEnvironment,
  type MutationFixtureEnvironment,
} from "./environment.js";
import { MutationRuntimeError } from "./errors.js";

export { MutationRuntimeError } from "./errors.js";

const occupiedPages = new WeakSet<Page>();
const pageSessions = new WeakMap<Page, MutationFixtureSessionState>();
const fixtureSessions = new WeakMap<
  MutationFixtureSession,
  MutationFixtureSessionState
>();
const sessionConstructorToken = Symbol("impactdiff.mutation-fixture-session");
const checkpointConstructorToken = Symbol("impactdiff.mutation-fixture-checkpoint");
const maximumAuditEvents = 256;
const maximumAuditTextLength = 2_048;
const maximumActionPlanBytes = 131_072;
const maximumCaptureSpecBytes = 65_536;
const maximumSourceStateBytes = 1_048_576;
const closedFixture = Object.freeze({
  fixtureId: "checkout-card-v1",
  revision: "checkout-card-v1.0.0",
  manifestSha256: "3b8a3f79a15969e575e0d4ace4a98b7a89704840cb1b2a818c06e03e5cc4e9ea",
  manifestByteLength: 1_819,
  styleNonceValue: "impactdiff-checkout-v1",
  origin: "https://fixture.impactdiff.invalid",
});
const fixtureUrl = `${closedFixture.origin}/`;
const fixtureStyleNonce = Buffer.from(closedFixture.styleNonceValue, "utf8").toString(
  "base64",
);
const exactFixtureCsp = `default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'self'; form-action 'none'; frame-src 'none'; img-src 'none'; manifest-src 'none'; media-src 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'nonce-${fixtureStyleNonce}'; worker-src 'none'`;

const fixtureResources = Object.freeze([
  Object.freeze({
    path: "index.html",
    mediaType: "text/html; charset=utf-8",
    sha256: "325a67d957557b9e766c23f53f6d8c71e64f03cea06f1f752ae1a6195efdfd40",
    byteLength: 4_899,
    served: true,
    license: "Apache-2.0",
  }),
  Object.freeze({
    path: "styles.css",
    mediaType: "text/css; charset=utf-8",
    sha256: "ea32617a0be3b2d3c73dae0a31a7d198e2e0f758f0d0c18a9bc60e7f793fcb9d",
    byteLength: 6_349,
    served: true,
    license: "Apache-2.0",
  }),
  Object.freeze({
    path: "app.js",
    mediaType: "text/javascript; charset=utf-8",
    sha256: "9e63523f982ff8f71276ed7137f098198750f2cdde2a811fcd1678087aa4bf60",
    byteLength: 1_185,
    served: true,
    license: "Apache-2.0",
  }),
  Object.freeze({
    path: "fonts/noto-sans-latin-standard-normal.woff2",
    mediaType: "font/woff2",
    sha256: "df8c8215937ab2a4270c0cd997101b3fb8cdd444c9903d342200d6179ebcc097",
    byteLength: 59_928,
    served: true,
    license: "OFL-1.1",
  }),
  Object.freeze({
    path: "fonts/OFL-1.1.txt",
    mediaType: "text/plain; charset=utf-8",
    sha256: "54ec7b5a35310ad66f9f3091426f7028484cbf9ae1ab5da30122ee412a3009e1",
    byteLength: 4_518,
    served: false,
    license: "OFL-1.1",
  }),
]);

const exactSourceState = Object.freeze({
  contract: "impactdiff.source-state",
  version: 1,
  source: Object.freeze({
    kind: "closed_fixture",
    fixture_id: closedFixture.fixtureId,
    revision: closedFixture.revision,
    license: "Apache-2.0",
    entrypoint: "index.html",
    raw_manifest: Object.freeze({
      sha256: closedFixture.manifestSha256,
      byte_length: closedFixture.manifestByteLength,
    }),
    resources: Object.freeze(
      fixtureResources
        .map((resource) =>
          Object.freeze({
            path: resource.path,
            media_type: resource.mediaType,
            sha256: resource.sha256,
            byte_length: resource.byteLength,
            license: resource.license,
          }),
        )
        .sort((left, right) =>
          left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
        ),
    ),
  }),
  initial_state: Object.freeze({
    kind: "fixture_default",
    route: "/",
    storage: "empty",
  }),
});
const exactSourceStateBytes = Buffer.from(canonicalJson(exactSourceState), "utf8");
const exactSourceStateReference = Object.freeze({
  sha256: sha256Hex(exactSourceStateBytes),
  byte_length: exactSourceStateBytes.byteLength,
  media_type: "application/vnd.impactdiff.source-state+json",
  format_version: 1 as const,
});

const exactFixtureManifest = Object.freeze({
  contract: "impactdiff.fixture-manifest",
  version: 1,
  fixture_id: "checkout-card-v1",
  revision: "checkout-card-v1.0.0",
  title: "Northstar checkout review",
  license: "Apache-2.0",
  entrypoint: "index.html",
  resources: fixtureResources.map(({ path, mediaType, sha256 }) => ({
    path,
    media_type: mediaType,
    sha256,
  })),
  readiness: {
    global: "__impactdiffFixtureV1",
    ready: true,
    pendingRequests: 0,
  },
  targets: {
    root: "app-root",
    primary_action: "place-order",
    success_state: "order-confirmation",
  },
  network_policy: {
    connect: "deny",
    external_resources: "deny",
    service_worker: "absent",
  },
  mutation_policy: {
    style_nonce: "impactdiff-checkout-v1",
    inline_styles: "nonce-only",
  },
  font: {
    family: "ImpactDiff Noto Sans",
    source_package: "@fontsource-variable/noto-sans@5.2.10",
    license: "OFL-1.1",
    sha256: "df8c8215937ab2a4270c0cd997101b3fb8cdd444c9903d342200d6179ebcc097",
  },
});

const primaryActionLocator = Object.freeze({
  strategy: "test_id" as const,
  value: "place-order",
});
const primaryActionTargetId = computeFixtureActionTargetId({
  fixture_id: closedFixture.fixtureId,
  fixture_revision: closedFixture.revision,
  fixture_manifest_sha256: closedFixture.manifestSha256,
  locator: primaryActionLocator,
});
const primaryActionValue = Object.freeze({
  kind: "pointer" as const,
  button: "primary" as const,
});
const primaryActionId = (() => {
  const hash = createHash("sha256");
  hash.update("impactdiff:fixture-action-step:v1", "utf8");
  hash.update("\0", "utf8");
  hash.update(
    canonicalJson({
      fixture_id: closedFixture.fixtureId,
      fixture_revision: closedFixture.revision,
      fixture_manifest_sha256: closedFixture.manifestSha256,
      locator: primaryActionLocator,
      intent: "pointer_click",
      value: primaryActionValue,
    }),
    "utf8",
  );
  return `idst1_${hash.digest("hex")}`;
})();
const exactActionPlanBytes = (() => {
  const bytes = Buffer.from(
    canonicalJson({
      contract: "impactdiff.action-plan",
      version: 1,
      actions: [
        {
          action_id: primaryActionId,
          ordinal: 0,
          intent: "pointer_click",
          target_id: primaryActionTargetId,
          value: primaryActionValue,
        },
      ],
      checkpoints: [
        { ordinal: 0, after_action_ordinal: -1 },
        { ordinal: 1, after_action_ordinal: 0 },
      ],
    }),
    "utf8",
  );
  parseActionPlan(bytes);
  return bytes;
})();
const exactActionPlanReference = Object.freeze({
  sha256: sha256Hex(exactActionPlanBytes),
  byte_length: exactActionPlanBytes.byteLength,
  media_type: "application/vnd.impactdiff.action-plan+json",
  format_version: 1 as const,
});

const supportedTargets = Object.freeze({
  palette_swap: Object.freeze({
    mutationTestId: "app-root",
    taskRelation: "contains" as const,
  }),
  pointer_interceptor: Object.freeze({
    mutationTestId: "place-order",
    taskRelation: "identity" as const,
  }),
});

const defaultPaletteTokens = Object.freeze({
  canvas: "#f4f0e8",
  panel: "#ffffff",
  text: "#272019",
  border: "#ded4c5",
  primary: "#a9432a",
  primary_text: "#ffffff",
});

const paletteVariableNames = Object.freeze([
  "canvas",
  "panel",
  "text",
  "border",
  "primary",
  "primary_text",
] as const);

type PaletteVariableName = (typeof paletteVariableNames)[number];

interface BrowserTargetProbe {
  readonly connected: boolean;
  readonly visible: boolean;
  readonly inViewport: boolean;
  readonly rect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly centerHit:
    | { readonly kind: "target" }
    | { readonly kind: "other"; readonly elementPath: readonly number[] }
    | null;
  readonly paletteVariables: Readonly<Record<PaletteVariableName, string>>;
}

interface CollectedProbe {
  readonly probe: SourceProbe;
  readonly targetHandle: ElementHandle<Element> | null;
}

interface PaletteVerification {
  readonly connected: boolean;
  readonly exactOwnedNode: boolean;
  readonly variables: Readonly<Record<PaletteVariableName, string>>;
  readonly bodyForeground: string;
  readonly bodyBackground: string;
  readonly actionForeground: string;
  readonly actionBackground: string;
}

interface LoadedFixtureResource {
  readonly body: Buffer;
  readonly contentType: string;
}

interface LoadedMutationFixture {
  readonly resources: ReadonlyMap<string, LoadedFixtureResource>;
}

type FixtureTaskState = "review" | "confirmed";
type OwnedMutationKind = "palette" | "pointer";
type CaptureTaskPhase = "unprepared" | "prepared" | "executing" | "complete" | "failed";

function sameFixtureTaskState(
  left: FixtureTaskState,
  right: FixtureTaskState,
): boolean {
  return left === right;
}

interface PreparedCaptureGeometry {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly targetBounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

interface IntegrityRecordSummary {
  readonly type: "attributes" | "childList" | "characterData" | "other";
  readonly target: string;
  readonly attributeName: string | null;
  readonly oldValue: string | null;
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

interface IntegrityDrainResult {
  readonly overflow: boolean;
  readonly records: readonly IntegrityRecordSummary[];
}

interface ActiveOwnedMutation {
  readonly kind: OwnedMutationKind;
  readonly handle: ElementHandle<Element>;
  readonly rect: FixedRect | null;
}

interface MutationFixtureAuditState {
  readonly blockedExternalRequests: string[];
  readonly unexpectedFixtureRequests: string[];
  readonly cspViolations: string[];
  readonly pageErrors: string[];
  readonly integrityViolations: string[];
  readonly servedResourceCounts: Map<string, number>;
  navigationArmed: boolean;
  documentReplaced: boolean;
  auditOverflow: boolean;
  auditEventCount: number;
  activeRouteHandlers: number;
  requestEventCount: number;
  routeEventCount: number;
  closing: boolean;
}

interface MutationFixtureSessionState {
  readonly session: MutationFixtureSession;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly binding: MutationRuntimeBinding;
  readonly actionPlan: ActionPlan;
  readonly captureSpec: CaptureSpec;
  readonly releaseEnvironment: () => void;
  readonly invalidateEnvironment: () => void;
  readonly primaryActionTargetId: string;
  readonly documentElement: ElementHandle<HTMLElement>;
  readonly criticalElements: readonly {
    readonly testId: string;
    readonly handle: ElementHandle<Element>;
  }[];
  readonly integrityGuard: JSHandle<{
    readonly drain: (refs: {
      readonly documentElement: Element;
      readonly appRoot: Element;
      readonly review: Element;
      readonly action: Element;
      readonly confirmation: Element;
      readonly owned: Element | null;
    }) => IntegrityDrainResult;
    readonly disconnect: () => void;
  }>;
  readonly pristineDocumentSha256: string;
  readonly audit: MutationFixtureAuditState;
  lastTaskState: FixtureTaskState;
  activeOwnedMutation: ActiveOwnedMutation | null;
  captureTaskPhase: CaptureTaskPhase;
  preparedCaptureGeometry: PreparedCaptureGeometry | null;
  operationInProgress: boolean;
  closed: boolean;
}

export interface MutationFixtureUpstreamEvidence {
  readonly source_state: {
    readonly reference: ArtifactRef;
    readonly bytes: Uint8Array;
  };
  readonly action_plan: {
    readonly reference: ArtifactRef;
    readonly bytes: Uint8Array;
  };
  readonly capture_spec: {
    readonly reference: ArtifactRef;
    readonly bytes: Uint8Array;
  };
}

export interface MutationFixtureSourceStateArtifact {
  readonly reference: ArtifactRef;
  readonly bytes: Uint8Array;
}

export interface MutationFixtureActionPlanArtifact {
  readonly reference: ArtifactRef;
  readonly bytes: Uint8Array;
}

export class MutationFixtureCheckpointBytes {
  readonly checkpoint_id: string;
  readonly ordinal: 0 | 1;
  readonly #screenshot: Buffer;
  readonly #accessibilityTree: Buffer;
  readonly #layoutGraph: Buffer;

  constructor(
    token: symbol,
    value: {
      readonly checkpoint_id: string;
      readonly ordinal: 0 | 1;
      readonly screenshot: Uint8Array;
      readonly accessibility_tree: Uint8Array;
      readonly layout_graph: Uint8Array;
    },
  ) {
    if (token !== checkpointConstructorToken) {
      fail(
        "mutation.capture_checkpoint_capability",
        "fixture checkpoints can only be created by the authenticated executor",
      );
    }
    this.checkpoint_id = value.checkpoint_id;
    this.ordinal = value.ordinal;
    this.#screenshot = Buffer.from(value.screenshot);
    this.#accessibilityTree = Buffer.from(value.accessibility_tree);
    this.#layoutGraph = Buffer.from(value.layout_graph);
    Object.freeze(this);
  }

  get screenshot(): Buffer {
    return Buffer.from(this.#screenshot);
  }

  get accessibility_tree(): Buffer {
    return Buffer.from(this.#accessibilityTree);
  }

  get layout_graph(): Buffer {
    return Buffer.from(this.#layoutGraph);
  }
}

Object.freeze(MutationFixtureCheckpointBytes.prototype);

export interface MutationFixtureTaskRun {
  readonly checkpoints: readonly [
    MutationFixtureCheckpointBytes,
    MutationFixtureCheckpointBytes,
  ];
  readonly task_success: boolean;
  readonly first_unsatisfied_step_id: string | null;
  readonly virtual_elapsed_ms: 0;
}

export interface MutationRuntimeBinding {
  readonly source_state_id: string;
  readonly task_id: string;
  readonly environment_id: string;
  readonly fixture_id: "checkout-card-v1";
  readonly fixture_revision: "checkout-card-v1.0.0";
  readonly fixture_manifest_sha256: string;
  readonly source_state: ArtifactRef;
  readonly action_plan: ArtifactRef;
  readonly capture_spec: ArtifactRef;
  readonly primary_action_target_id: string;
}

export interface MutationFixtureAudit {
  readonly fixture_manifest_sha256: string;
  readonly served_resources: readonly string[];
  readonly blocked_external_requests: readonly string[];
}

/**
 * A same-process capability, authenticated by module-private WeakMap state.
 * Possessing the real object grants access to its Playwright Page; forged
 * lookalikes and transplanted Pages are rejected. Persistent DOM/CSS changes,
 * transient DOM mutations, navigation, CSP, and network activity are audited.
 * This is not a hostile-JavaScript sandbox: the holder and Node/page-realm
 * intrinsics are trusted. Code with this Page can monkey-patch DOM APIs or
 * event-listener state and potentially evade page-realm checks; that capability
 * is explicitly outside the v1 attestation boundary.
 */
export class MutationFixtureSession {
  readonly page: Page;
  readonly binding: MutationRuntimeBinding;

  constructor(token: symbol, page: Page, binding: MutationRuntimeBinding) {
    if (token !== sessionConstructorToken) {
      fail(
        "mutation.untrusted_session",
        "mutation fixture sessions can only be created by the verified factory",
      );
    }
    this.page = page;
    this.binding = binding;
  }

  async close(): Promise<MutationFixtureAudit> {
    return closeMutationFixtureSession(this);
  }
}

Object.freeze(MutationFixtureSession.prototype);

export type MutationCleanup = () => Promise<void>;

function fail(code: string, message: string, options?: ErrorOptions): never {
  throw new MutationRuntimeError(code, message, options);
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function bindingRecord(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    fail(
      "mutation.binding_shape",
      "runtime provenance binding must be a plain data object",
    );
  }
  return value as Record<string, unknown>;
}

function bindingValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
    fail(
      "mutation.binding_shape",
      `runtime provenance field ${key} must be an enumerable data property`,
    );
  }
  return descriptor.value;
}

function assertClosedBindingKeys(
  record: Record<string, unknown>,
  requiredKeys: readonly string[],
  label: string,
): void {
  const rawKeys = Reflect.ownKeys(record);
  if (rawKeys.some((key) => typeof key !== "string")) {
    fail("mutation.binding_shape", `${label} cannot contain symbol properties`);
  }
  const actualKeys = (rawKeys as string[]).sort(codeUnitCompare);
  const expectedKeys = [...requiredKeys].sort(codeUnitCompare);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    fail(
      "mutation.binding_shape",
      `${label} must contain only its closed required fields`,
    );
  }
  for (const key of expectedKeys) {
    bindingValue(record, key);
  }
}

interface ResolvedRuntimeUpstream {
  readonly binding: MutationRuntimeBinding;
  readonly actionPlan: ActionPlan;
  readonly captureSpec: CaptureSpec;
}

interface ResolvedRuntimeArtifact<T> {
  readonly reference: ArtifactRef;
  readonly value: T;
}

function resolveRuntimeArtifact<T>(
  parent: Record<string, unknown>,
  key: string,
  options: {
    readonly label: string;
    readonly mediaType: string;
    readonly maximumBytes: number;
    readonly errorPrefix: string;
    readonly parse: (bytes: Buffer) => T;
  },
): ResolvedRuntimeArtifact<T> {
  const artifactRecord = bindingRecord(bindingValue(parent, key));
  assertClosedBindingKeys(
    artifactRecord,
    ["bytes", "reference"],
    `runtime ${options.label} artifact`,
  );
  let reference: ArtifactRef;
  try {
    reference = validateArtifactReference(
      bindingValue(artifactRecord, "reference"),
      options.maximumBytes,
    );
  } catch (error) {
    fail(
      `mutation.${options.errorPrefix}_reference`,
      `${options.label} reference is not a valid closed artifact reference`,
      { cause: error },
    );
  }
  if (reference.media_type !== options.mediaType) {
    fail(
      `mutation.${options.errorPrefix}_reference`,
      `${options.label} reference has the wrong media type`,
    );
  }
  const byteValue = bindingValue(artifactRecord, "bytes");
  const byteLength = intrinsicUint8ArrayByteLength(byteValue);
  if (byteLength === null || byteLength < 1 || byteLength > options.maximumBytes) {
    fail(
      `mutation.${options.errorPrefix}_bytes`,
      `${options.label} bytes must be a bounded fixed-memory Uint8Array`,
    );
  }
  let bytes: Buffer;
  try {
    bytes = snapshotUint8Array(byteValue as Uint8Array, byteLength);
  } catch (error) {
    fail(
      `mutation.${options.errorPrefix}_bytes`,
      `${options.label} bytes could not be snapshotted exactly`,
      { cause: error },
    );
  }
  if (
    reference.byte_length !== bytes.byteLength ||
    reference.sha256 !== sha256Hex(bytes)
  ) {
    fail(
      `mutation.${options.errorPrefix}_reference`,
      `${options.label} bytes do not match their exact digest and byte-length reference`,
    );
  }
  let parsed: T;
  try {
    parsed = options.parse(bytes);
  } catch (error) {
    fail(
      `mutation.${options.errorPrefix}_bytes`,
      `${options.label} bytes do not encode a canonical validated contract`,
      { cause: error },
    );
  }
  return Object.freeze({ reference, value: parsed });
}

function resolveMutationRuntimeBinding(value: unknown): ResolvedRuntimeUpstream {
  const record = bindingRecord(value);
  assertClosedBindingKeys(
    record,
    ["action_plan", "capture_spec", "source_state"],
    "runtime provenance binding",
  );

  const sourceArtifact = resolveRuntimeArtifact<SourceState>(record, "source_state", {
    label: "source-state",
    mediaType: "application/vnd.impactdiff.source-state+json",
    maximumBytes: maximumSourceStateBytes,
    errorPrefix: "source_state",
    parse: parseSourceState,
  });
  const sourceStateReference = sourceArtifact.reference;
  const sourceState = sourceArtifact.value;
  if (canonicalJson(sourceState) !== canonicalJson(exactSourceState)) {
    fail(
      "mutation.source_state_fixture",
      "source-state provenance differs from the exact closed fixture package",
    );
  }
  const sourceStateId = computeSourceStateId(sourceStateReference);

  const actionArtifact = resolveRuntimeArtifact<ActionPlan>(record, "action_plan", {
    label: "action-plan",
    mediaType: "application/vnd.impactdiff.action-plan+json",
    maximumBytes: maximumActionPlanBytes,
    errorPrefix: "action_plan",
    parse: parseActionPlan,
  });
  const actionPlanReference = actionArtifact.reference;
  const actionPlan = actionArtifact.value;
  const targetActions = actionPlan.actions.filter(
    (action) => action.target_id === primaryActionTargetId,
  );
  if (
    targetActions.length === 0 ||
    !targetActions.some(
      (action) => action.intent === "pointer_click" && action.value.kind === "pointer",
    )
  ) {
    fail(
      "mutation.action_plan_target",
      "the action plan must pointer-click the deterministic fixture primary-action target",
    );
  }

  const captureArtifact = resolveRuntimeArtifact<CaptureSpec>(record, "capture_spec", {
    label: "capture-spec",
    mediaType: "application/vnd.impactdiff.capture-spec+json",
    maximumBytes: maximumCaptureSpecBytes,
    errorPrefix: "capture_spec",
    parse: parseCaptureSpec,
  });
  const captureSpecReference = captureArtifact.reference;
  const captureSpec = captureArtifact.value;

  const binding = Object.freeze({
    source_state_id: sourceStateId,
    task_id: computeTaskId(actionPlanReference),
    environment_id: computeEnvironmentId(captureSpecReference),
    fixture_id: closedFixture.fixtureId,
    fixture_revision: closedFixture.revision,
    fixture_manifest_sha256: closedFixture.manifestSha256,
    source_state: sourceStateReference,
    action_plan: actionPlanReference,
    capture_spec: captureSpecReference,
    primary_action_target_id: primaryActionTargetId,
  });
  return Object.freeze({ binding, actionPlan, captureSpec });
}

export function validateMutationRuntimeBinding(value: unknown): MutationRuntimeBinding {
  return resolveMutationRuntimeBinding(value).binding;
}

async function readExactFixtureFile(
  path: string,
  byteLength: number,
  sha256: string,
): Promise<Buffer> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile() || before.size !== byteLength) {
      fail(
        "mutation.fixture_resource",
        "fixture resource type or byte length differs from the closed revision",
      );
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      bytes.byteLength !== byteLength ||
      createHash("sha256").update(bytes).digest("hex") !== sha256
    ) {
      fail(
        "mutation.fixture_resource",
        "fixture resource changed or failed its exact digest binding",
      );
    }
    return bytes;
  } catch (error) {
    if (error instanceof MutationRuntimeError) {
      throw error;
    }
    return fail("mutation.fixture_resource", "fixture resource verification failed", {
      cause: error,
    });
  } finally {
    await handle?.close();
  }
}

async function assertExactFixtureDirectory(root: string): Promise<void> {
  try {
    const rootStats = await stat(root);
    if (!rootStats.isDirectory()) {
      fail("mutation.fixture_directory", "fixture root must be a directory");
    }
    const rootEntries = await readdir(root, { withFileTypes: true });
    const actualRoot = rootEntries
      .map(
        (entry) =>
          `${entry.isDirectory() ? "d" : entry.isFile() ? "f" : "x"}:${entry.name}`,
      )
      .sort(codeUnitCompare);
    const expectedRoot = [
      "f:app.js",
      "f:fixture.json",
      "d:fonts",
      "f:index.html",
      "f:styles.css",
    ].sort(codeUnitCompare);
    if (
      actualRoot.length !== expectedRoot.length ||
      actualRoot.some((entry, index) => entry !== expectedRoot[index])
    ) {
      fail(
        "mutation.fixture_directory",
        "fixture root must contain exactly the closed revision files",
      );
    }

    const fontEntries = await readdir(resolve(root, "fonts"), {
      withFileTypes: true,
    });
    const actualFonts = fontEntries
      .map((entry) => `${entry.isFile() ? "f" : "x"}:${entry.name}`)
      .sort(codeUnitCompare);
    const expectedFonts = [
      "f:OFL-1.1.txt",
      "f:noto-sans-latin-standard-normal.woff2",
    ].sort(codeUnitCompare);
    if (
      actualFonts.length !== expectedFonts.length ||
      actualFonts.some((entry, index) => entry !== expectedFonts[index])
    ) {
      fail(
        "mutation.fixture_directory",
        "fixture font directory must contain exactly the closed revision files",
      );
    }
  } catch (error) {
    if (error instanceof MutationRuntimeError) {
      throw error;
    }
    fail("mutation.fixture_directory", "fixture directory audit failed", {
      cause: error,
    });
  }
}

async function loadMutationFixture(
  fixtureDirectory: string,
): Promise<LoadedMutationFixture> {
  if (
    typeof fixtureDirectory !== "string" ||
    fixtureDirectory.length < 1 ||
    fixtureDirectory.length > 4_096 ||
    fixtureDirectory.includes("\0")
  ) {
    fail("mutation.fixture_directory", "fixture directory path is invalid");
  }
  const root = resolve(fixtureDirectory);
  await assertExactFixtureDirectory(root);
  const manifestBytes = await readExactFixtureFile(
    resolve(root, "fixture.json"),
    closedFixture.manifestByteLength,
    closedFixture.manifestSha256,
  );
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
    if (canonicalJson(manifest) !== canonicalJson(exactFixtureManifest)) {
      fail(
        "mutation.fixture_manifest",
        "fixture manifest differs from the exact closed v1 definition",
      );
    }
  } catch (error) {
    if (error instanceof MutationRuntimeError) {
      throw error;
    }
    fail("mutation.fixture_manifest", "fixture manifest parsing failed", {
      cause: error,
    });
  }

  const resources = new Map<string, LoadedFixtureResource>();
  for (const resource of fixtureResources) {
    const body = await readExactFixtureFile(
      resolve(root, resource.path),
      resource.byteLength,
      resource.sha256,
    );
    if (resource.served) {
      resources.set(
        resource.path,
        Object.freeze({ body, contentType: resource.mediaType }),
      );
    }
  }
  const index = resources.get("index.html");
  if (
    index === undefined ||
    !index.body.toString("utf8").includes(`content="${exactFixtureCsp}"`)
  ) {
    fail(
      "mutation.fixture_manifest",
      "closed fixture HTML does not carry the exact CSP definition",
    );
  }
  return Object.freeze({ resources });
}

/**
 * Audits the exact closed fixture package before returning the canonical sealed
 * source-state artifact that a generator can pass to the session factory and CAS.
 */
export async function loadVerifiedMutationFixtureSourceState(
  fixtureDirectory: string,
): Promise<MutationFixtureSourceStateArtifact> {
  await loadMutationFixture(fixtureDirectory);
  return Object.freeze({
    reference: exactSourceStateReference,
    bytes: Buffer.from(exactSourceStateBytes),
  });
}

/**
 * Returns the canonical task artifact owned by the exact closed checkout fixture.
 * The action identity commits to the fixture, locator, intent, and pointer value.
 */
export function loadVerifiedMutationFixtureActionPlan(): MutationFixtureActionPlanArtifact {
  return Object.freeze({
    reference: exactActionPlanReference,
    bytes: Buffer.from(exactActionPlanBytes),
  });
}

function mutationSessionState(value: unknown): MutationFixtureSessionState {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== MutationFixtureSession.prototype
  ) {
    fail(
      "mutation.untrusted_session",
      "mutation operations require an exact verified fixture session",
    );
  }
  const state = fixtureSessions.get(value as MutationFixtureSession);
  if (state === undefined || state.session !== value) {
    fail(
      "mutation.untrusted_session",
      "fixture session or page provenance is not module-authenticated",
    );
  }
  if (state.closed) {
    fail("mutation.session_closed", "fixture session is already closed");
  }
  if (state.audit.closing) {
    fail("mutation.session_closing", "fixture session close is already in progress");
  }
  if (
    pageSessions.get(state.page) !== state ||
    state.session.page !== state.page ||
    state.session.binding !== state.binding
  ) {
    fail(
      "mutation.untrusted_session",
      "fixture session or page provenance is not module-authenticated",
    );
  }
  return state;
}

function beginSessionOperation(value: unknown): MutationFixtureSessionState {
  const state = mutationSessionState(value);
  if (state.operationInProgress) {
    fail(
      "mutation.concurrent_operation",
      "fixture session operations are serialized to close audit races",
    );
  }
  state.operationInProgress = true;
  return state;
}

function endSessionOperation(state: MutationFixtureSessionState): void {
  state.operationInProgress = false;
}

function recordAuditEvent(
  audit: MutationFixtureAuditState,
  target:
    | "blockedExternalRequests"
    | "unexpectedFixtureRequests"
    | "cspViolations"
    | "pageErrors"
    | "integrityViolations",
  value: string,
): void {
  const events = audit[target];
  if (audit.auditEventCount >= maximumAuditEvents) {
    audit.auditOverflow = true;
    return;
  }
  audit.auditEventCount += 1;
  events.push(value.slice(0, maximumAuditTextLength));
}

function recordNetworkAuditCount(
  audit: MutationFixtureAuditState,
  field: "requestEventCount" | "routeEventCount",
): void {
  if (audit[field] >= maximumAuditEvents) {
    audit.auditOverflow = true;
    return;
  }
  audit[field] += 1;
}

function currentAuditTaints(state: MutationFixtureSessionState): string[] {
  const taints: string[] = [];
  if (state.audit.documentReplaced) {
    taints.push("primary fixture document was replaced or navigated");
  }
  if (state.audit.unexpectedFixtureRequests.length > 0) {
    taints.push("unexpected fixture requests were attempted");
  }
  if (state.audit.cspViolations.length > 0) {
    taints.push("content security policy violations occurred");
  }
  if (state.audit.pageErrors.length > 0) {
    taints.push("uncaught fixture page errors occurred");
  }
  if (state.audit.integrityViolations.length > 0) {
    taints.push("fixture document integrity violations occurred");
  }
  if (state.audit.auditOverflow) {
    taints.push("fixture audit event budget was exceeded");
  }
  return taints;
}

function criticalHandle(
  state: MutationFixtureSessionState,
  testId: string,
): ElementHandle<Element> {
  const entry = state.criticalElements.find((candidate) => candidate.testId === testId);
  if (entry === undefined) {
    fail(
      "mutation.fixture_initialization",
      `fixture integrity handle ${testId} is unavailable`,
    );
  }
  return entry.handle;
}

async function installIntegrityGuard(
  page: Page,
): Promise<MutationFixtureSessionState["integrityGuard"]> {
  const handle = await page.evaluateHandle(() => {
    const maximumRecords = 256;
    const maximumNodesPerRecord = 32;
    let records: MutationRecord[] = [];
    let overflow = false;
    const ingest = (batch: readonly MutationRecord[]): void => {
      for (const record of batch) {
        if (records.length >= maximumRecords) {
          overflow = true;
          break;
        }
        records.push(record);
      }
    };
    const observer = new MutationObserver((batch) => ingest(batch));
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeOldValue: true,
      characterData: true,
      characterDataOldValue: true,
    });

    return Object.freeze({
      drain(refs: {
        readonly documentElement: Element;
        readonly appRoot: Element;
        readonly review: Element;
        readonly action: Element;
        readonly confirmation: Element;
        readonly owned: Element | null;
      }) {
        ingest(observer.takeRecords());
        const label = (node: Node): string => {
          if (node === refs.documentElement) return "documentElement";
          if (node === document.head) return "head";
          if (node === document.body) return "body";
          if (node === refs.appRoot) return "appRoot";
          if (node === refs.review) return "review";
          if (node === refs.action) return "action";
          if (node === refs.confirmation) return "confirmation";
          if (refs.owned !== null) {
            if (node === refs.owned) return "owned";
            if (refs.owned.contains(node)) return "owned-descendant";
          }
          return "other";
        };
        const nodeLabels = (nodes: NodeList): string[] => {
          if (nodes.length > maximumNodesPerRecord) {
            overflow = true;
          }
          return Array.from(nodes).slice(0, maximumNodesPerRecord).map(label);
        };
        const summaries = records.map((record) => ({
          type:
            record.type === "attributes" ||
            record.type === "childList" ||
            record.type === "characterData"
              ? record.type
              : ("other" as const),
          target: label(record.target),
          attributeName: record.attributeName,
          oldValue: record.oldValue,
          added: nodeLabels(record.addedNodes),
          removed: nodeLabels(record.removedNodes),
        }));
        const result = Object.freeze({
          overflow,
          records: Object.freeze(summaries),
        });
        records = [];
        overflow = false;
        return result;
      },
      disconnect() {
        observer.disconnect();
        records = [];
      },
    });
  });
  return handle as MutationFixtureSessionState["integrityGuard"];
}

interface IntegrityHandles {
  readonly documentElement: ElementHandle<HTMLElement>;
  readonly appRoot: ElementHandle<Element>;
  readonly review: ElementHandle<Element>;
  readonly action: ElementHandle<Element>;
  readonly confirmation: ElementHandle<Element>;
}

function integrityHandles(state: MutationFixtureSessionState): IntegrityHandles {
  return {
    documentElement: state.documentElement,
    appRoot: criticalHandle(state, "app-root"),
    review: criticalHandle(state, "checkout-review"),
    action: criticalHandle(state, "place-order"),
    confirmation: criticalHandle(state, "order-confirmation"),
  };
}

async function documentIntegritySha256(
  page: Page,
  handles: IntegrityHandles,
  owned: ElementHandle<Element> | null,
): Promise<string> {
  let snapshot: unknown;
  try {
    snapshot = await page.evaluate(
      ({ documentElement, appRoot, review, action, confirmation, ownedNode }) => {
        const maximumNodes = 2_048;
        const maximumDepth = 64;
        const maximumAttributes = 8_192;
        const maximumTextCodeUnits = 1_048_576;
        const maximumCssRules = 4_096;
        const maximumCssCodeUnits = 1_048_576;
        let nodeCount = 0;
        let attributeCount = 0;
        let textCodeUnits = 0;
        let cssRuleCount = 0;
        let cssCodeUnits = 0;
        let shadowRootCount = 0;

        const addText = (value: string): string => {
          textCodeUnits += value.length;
          if (textCodeUnits > maximumTextCodeUnits) {
            throw new Error("fixture integrity text budget exceeded");
          }
          return value;
        };
        const walk = (node: Node, depth: number): unknown => {
          if (node === ownedNode) return null;
          nodeCount += 1;
          if (nodeCount > maximumNodes || depth > maximumDepth) {
            throw new Error("fixture integrity DOM budget exceeded");
          }
          if (node.nodeType === Node.TEXT_NODE) {
            return { type: "text", value: addText(node.nodeValue ?? "") };
          }
          if (node.nodeType === Node.COMMENT_NODE) {
            return { type: "comment", value: addText(node.nodeValue ?? "") };
          }
          if (!(node instanceof Element)) {
            return {
              type: `node-${node.nodeType}`,
              value: addText(node.nodeValue ?? ""),
            };
          }
          if (node.shadowRoot !== null) shadowRootCount += 1;
          const attributes = Array.from(node.attributes)
            .flatMap((attribute) => {
              if (
                (node === review && attribute.name === "hidden") ||
                (node === action && attribute.name === "disabled") ||
                (node === confirmation && attribute.name === "hidden")
              ) {
                return [];
              }
              const value =
                node === appRoot && attribute.name === "data-state"
                  ? "$TASK_STATE"
                  : attribute.value;
              return [
                [attribute.namespaceURI, attribute.name, addText(value)] as const,
              ];
            })
            .sort((left, right) => {
              const leftKey = `${left[0] ?? ""}\0${left[1]}`;
              const rightKey = `${right[0] ?? ""}\0${right[1]}`;
              return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
            });
          attributeCount += attributes.length;
          if (attributeCount > maximumAttributes) {
            throw new Error("fixture integrity attribute budget exceeded");
          }
          return {
            type: "element",
            namespace: node.namespaceURI,
            name: node.localName,
            attributes,
            children: Array.from(node.childNodes)
              .map((child) => walk(child, depth + 1))
              .filter((child) => child !== null),
          };
        };
        const cssRules = (rules: CSSRuleList): string[] =>
          Array.from(rules).map((rule) => {
            cssRuleCount += 1;
            cssCodeUnits += rule.cssText.length;
            if (cssRuleCount > maximumCssRules || cssCodeUnits > maximumCssCodeUnits) {
              throw new Error("fixture integrity CSS budget exceeded");
            }
            return rule.cssText;
          });
        const styleSheets = Array.from(document.styleSheets).flatMap((sheet) => {
          const owner = sheet.ownerNode;
          if (
            ownedNode !== null &&
            owner !== null &&
            (owner === ownedNode || ownedNode.contains(owner))
          ) {
            return [];
          }
          return [
            {
              href: sheet.href,
              disabled: sheet.disabled,
              media: sheet.media.mediaText,
              rules: cssRules(sheet.cssRules),
            },
          ];
        });
        const adoptedStyleSheets = Array.from(document.adoptedStyleSheets).map(
          (sheet) => ({
            disabled: sheet.disabled,
            media: sheet.media.mediaText,
            rules: cssRules(sheet.cssRules),
          }),
        );
        return {
          url: document.URL,
          contentType: document.contentType,
          characterSet: document.characterSet,
          compatMode: document.compatMode,
          doctype:
            document.doctype === null
              ? null
              : {
                  name: document.doctype.name,
                  publicId: document.doctype.publicId,
                  systemId: document.doctype.systemId,
                },
          tree: walk(documentElement, 0),
          styleSheets,
          adoptedStyleSheets,
          shadowRootCount,
        };
      },
      { ...handles, ownedNode: owned },
    );
  } catch (error) {
    fail(
      "mutation.document_integrity",
      "fixture DOM/CSS integrity snapshot could not be produced",
      { cause: error },
    );
  }
  return sha256Hex(canonicalJson(snapshot));
}

async function readFixtureTaskState(
  page: Page,
  handles: IntegrityHandles,
): Promise<FixtureTaskState | null> {
  return page.evaluate(({ appRoot, review, action, confirmation }) => {
    const rootState = appRoot.getAttribute("data-state");
    const reviewHidden = review.hasAttribute("hidden");
    const actionDisabled = action.hasAttribute("disabled");
    const confirmationHidden = confirmation.hasAttribute("hidden");
    if (
      rootState === "review" &&
      !reviewHidden &&
      !actionDisabled &&
      confirmationHidden
    ) {
      return "review" as const;
    }
    if (
      rootState === "confirmed" &&
      reviewHidden &&
      actionDisabled &&
      !confirmationHidden
    ) {
      return "confirmed" as const;
    }
    return null;
  }, handles);
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
}

function taskTransitionRecordKey(record: IntegrityRecordSummary): string | null {
  if (
    record.type !== "attributes" ||
    record.attributeName === null ||
    record.added.length !== 0 ||
    record.removed.length !== 0
  ) {
    return null;
  }
  return `${record.target}:${record.attributeName}:${record.oldValue ?? "$NULL"}`;
}

type OwnedRecordChange = "added" | "removed" | null;

async function verifyIntegrityRecords(
  state: MutationFixtureSessionState,
  handles: IntegrityHandles,
  ownedChange: OwnedRecordChange,
): Promise<void> {
  const owned = state.activeOwnedMutation?.handle ?? null;
  const result = await state.integrityGuard.evaluate(
    (guard, refs) => guard.drain(refs),
    { ...handles, owned },
  );
  if (result.overflow) {
    state.audit.auditOverflow = true;
    recordAuditEvent(
      state.audit,
      "integrityViolations",
      "fixture DOM mutation record budget was exceeded",
    );
    fail(
      "mutation.document_integrity",
      "fixture DOM mutation record budget was exceeded",
    );
  }

  const currentTaskState = await readFixtureTaskState(state.page, handles);
  if (currentTaskState === null) {
    recordAuditEvent(
      state.audit,
      "integrityViolations",
      "fixture task state is not one of the two closed states",
    );
    fail(
      "mutation.document_integrity",
      "fixture task state is not one of the two closed states",
    );
  }

  const remaining = [...result.records];
  if (state.lastTaskState === "review" && currentTaskState === "confirmed") {
    const expected = [
      "action:disabled:$NULL",
      "appRoot:data-state:review",
      "confirmation:hidden:",
      "review:hidden:$NULL",
    ].sort(codeUnitCompare);
    const keys = remaining
      .map(taskTransitionRecordKey)
      .filter((key): key is string => key !== null)
      .filter((key) => expected.includes(key))
      .sort(codeUnitCompare);
    if (!sameStringArray(keys, expected)) {
      recordAuditEvent(
        state.audit,
        "integrityViolations",
        "fixture task transition did not produce its exact attribute mutation set",
      );
      fail(
        "mutation.document_integrity",
        "fixture task transition did not produce its exact attribute mutation set",
      );
    }
    for (const key of expected) {
      const index = remaining.findIndex(
        (record) => taskTransitionRecordKey(record) === key,
      );
      remaining.splice(index, 1);
    }
  } else if (state.lastTaskState !== currentTaskState) {
    recordAuditEvent(
      state.audit,
      "integrityViolations",
      "fixture task state changed outside the one-way closed transition",
    );
    fail(
      "mutation.document_integrity",
      "fixture task state changed outside the one-way closed transition",
    );
  }

  if (ownedChange !== null) {
    const kind = state.activeOwnedMutation?.kind;
    const expectedParent = kind === "palette" ? "head" : "body";
    const index = remaining.findIndex(
      (record) =>
        record.type === "childList" &&
        record.target === expectedParent &&
        record.attributeName === null &&
        record.oldValue === null &&
        sameStringArray(record.added, ownedChange === "added" ? ["owned"] : []) &&
        sameStringArray(record.removed, ownedChange === "removed" ? ["owned"] : []),
    );
    if (index >= 0) remaining.splice(index, 1);
    else {
      recordAuditEvent(
        state.audit,
        "integrityViolations",
        `owned mutation ${ownedChange} record was absent or malformed`,
      );
      fail(
        "mutation.document_integrity",
        `owned mutation ${ownedChange} record was absent or malformed`,
      );
    }
  }

  if (remaining.length > 0) {
    recordAuditEvent(
      state.audit,
      "integrityViolations",
      `fixture DOM changed outside the closed integrity model (${remaining[0]?.type ?? "unknown"}:${remaining[0]?.target ?? "unknown"})`,
    );
    fail(
      "mutation.document_integrity",
      "fixture DOM changed outside the closed integrity model",
    );
  }
  state.lastTaskState = currentTaskState;
}

async function assertAuthenticatedDocument(
  state: MutationFixtureSessionState,
  ownedChange: OwnedRecordChange = null,
): Promise<void> {
  if (state.page.isClosed() || state.page.url() !== fixtureUrl) {
    recordAuditEvent(
      state.audit,
      "integrityViolations",
      "fixture page closed or left its exact URL",
    );
    fail(
      "mutation.untrusted_document",
      "verified fixture page is closed or no longer at its exact origin",
    );
  }
  let sameDocument = false;
  try {
    sameDocument = await state.documentElement.evaluate(
      (element) => element === document.documentElement && element.isConnected,
    );
  } catch (error) {
    fail(
      "mutation.untrusted_document",
      "verified fixture document identity can no longer be proven",
      { cause: error },
    );
  }
  if (!sameDocument) {
    recordAuditEvent(
      state.audit,
      "integrityViolations",
      "fixture document element identity changed",
    );
    fail(
      "mutation.untrusted_document",
      "verified fixture document was replaced after session creation",
    );
  }
  for (const critical of state.criticalElements) {
    let exactElement = false;
    try {
      exactElement = await critical.handle.evaluate((element, testId) => {
        const matches = document.querySelectorAll(`[data-testid="${testId}"]`);
        return element.isConnected && matches.length === 1 && matches[0] === element;
      }, critical.testId);
    } catch (error) {
      fail(
        "mutation.untrusted_document",
        `fixture element ${critical.testId} identity can no longer be proven`,
        { cause: error },
      );
    }
    if (!exactElement) {
      recordAuditEvent(
        state.audit,
        "integrityViolations",
        `fixture critical element ${critical.testId} identity changed`,
      );
      fail(
        "mutation.untrusted_document",
        `fixture element ${critical.testId} was replaced after session creation`,
      );
    }
  }
  const handles = integrityHandles(state);
  const containsPrimaryAction = await handles.appRoot.evaluate(
    (root, action) => root.contains(action),
    handles.action,
  );
  if (!containsPrimaryAction) {
    recordAuditEvent(
      state.audit,
      "integrityViolations",
      "the primary task action left the palette mutation surface",
    );
    fail(
      "mutation.document_integrity",
      "the primary task action is no longer contained by the closed fixture root",
    );
  }
  await verifyIntegrityRecords(state, handles, ownedChange);
  let documentSha256: string;
  try {
    documentSha256 = await documentIntegritySha256(
      state.page,
      handles,
      state.activeOwnedMutation?.handle ?? null,
    );
  } catch (error) {
    recordAuditEvent(
      state.audit,
      "integrityViolations",
      "fixture DOM/CSS integrity snapshot failed",
    );
    throw error;
  }
  if (documentSha256 !== state.pristineDocumentSha256) {
    recordAuditEvent(
      state.audit,
      "integrityViolations",
      "fixture DOM/CSS fingerprint differs from the pristine closed revision",
    );
    fail(
      "mutation.document_integrity",
      "fixture DOM/CSS fingerprint differs from the pristine closed revision",
    );
  }
  if (state.activeOwnedMutation !== null && ownedChange !== "removed") {
    if (state.activeOwnedMutation.kind === "palette") {
      await verifyPaletteLayer(state.activeOwnedMutation.handle);
    } else {
      const rect = state.activeOwnedMutation.rect;
      if (rect === null) {
        fail(
          "mutation.pointer_verification",
          "active pointer mutation lost its compiled geometry",
        );
      }
      await verifyPointerInterceptor(
        state.activeOwnedMutation.handle,
        handles.action,
        rect,
      );
    }
  }
  const taints = currentAuditTaints(state);
  if (taints.length > 0) {
    fail("mutation.session_tainted", taints.join("; "));
  }
  await assertFixtureReadiness(state.page, state.binding, state.captureSpec);
  const now = await state.page.evaluate(() => Date.now());
  if (now !== state.captureSpec.clock.epoch_ms) {
    fail("mutation.clock_drift", "fixture virtual clock is no longer paused exactly");
  }
}

function servedResourceIssues(audit: MutationFixtureAuditState): string[] {
  const issues: string[] = [];
  for (const resource of fixtureResources) {
    const expectedCount = resource.served ? 1 : 0;
    const actualCount = audit.servedResourceCounts.get(resource.path) ?? 0;
    if (actualCount !== expectedCount) {
      issues.push(
        `resource ${resource.path} was served ${actualCount} times instead of ${expectedCount}`,
      );
    }
  }
  return issues;
}

function networkAuditIssues(audit: MutationFixtureAuditState): string[] {
  return audit.requestEventCount === audit.routeEventCount
    ? []
    : [
        `fixture observed ${audit.requestEventCount} requests but audited ${audit.routeEventCount} route decisions`,
      ];
}

async function closeMutationFixtureSession(
  value: unknown,
): Promise<MutationFixtureAudit> {
  const state = mutationSessionState(value);
  if (state.operationInProgress) {
    fail(
      "mutation.concurrent_operation",
      "fixture session cannot close while another operation is in progress",
    );
  }
  state.operationInProgress = true;
  state.audit.closing = true;
  const auditIssues = new Set<string>([
    ...currentAuditTaints(state),
    ...servedResourceIssues(state.audit),
    ...networkAuditIssues(state.audit),
  ]);
  if (occupiedPages.has(state.page)) {
    auditIssues.add("an owned mutation remained active at session close");
  }
  if (state.context.pages().length !== 1 || state.context.pages()[0] !== state.page) {
    auditIssues.add("fixture context contains additional live pages");
  }
  if (state.audit.activeRouteHandlers !== 0) {
    auditIssues.add("fixture route audit was active when close began");
  }
  try {
    await assertAuthenticatedDocument(state);
  } catch (error) {
    auditIssues.add(
      error instanceof Error ? error.message : "fixture document audit failed",
    );
  }

  try {
    await state.integrityGuard.evaluate((guard) => guard.disconnect());
  } catch {
    auditIssues.add("fixture integrity guard disconnect failed");
  }
  try {
    await state.integrityGuard.dispose();
  } catch {
    auditIssues.add("fixture integrity guard disposal failed");
  }
  try {
    await Promise.all(
      state.criticalElements.map(async ({ handle }) => handle.dispose()),
    );
  } catch {
    auditIssues.add("critical fixture element handle disposal failed");
  }
  try {
    await state.documentElement.dispose();
  } catch {
    auditIssues.add("fixture document handle disposal failed");
  }
  let contextReusable = true;
  try {
    await state.context.close();
  } catch {
    contextReusable = false;
    auditIssues.add("fixture browser context close failed");
  }
  if (state.audit.activeRouteHandlers !== 0) {
    contextReusable = false;
  }
  try {
    if (contextReusable) {
      state.releaseEnvironment();
    } else {
      state.invalidateEnvironment();
    }
  } catch {
    auditIssues.add("capture environment lease release failed");
  }
  if (state.audit.activeRouteHandlers !== 0) {
    auditIssues.add("fixture route audit remained active after context close");
  }
  for (const issue of [
    ...currentAuditTaints(state),
    ...servedResourceIssues(state.audit),
    ...networkAuditIssues(state.audit),
  ]) {
    auditIssues.add(issue);
  }
  occupiedPages.delete(state.page);
  pageSessions.delete(state.page);
  state.activeOwnedMutation = null;
  state.closed = true;
  state.operationInProgress = false;

  if (auditIssues.size > 0) {
    fail(
      "mutation.session_tainted",
      `fixture session audit failed: ${[...auditIssues]
        .slice(0, 32)
        .map((issue) => issue.slice(0, maximumAuditTextLength))
        .join("; ")}`,
    );
  }
  return Object.freeze({
    fixture_manifest_sha256: closedFixture.manifestSha256,
    served_resources: Object.freeze(
      fixtureResources
        .filter((resource) => resource.served)
        .map((resource) => resource.path),
    ),
    blocked_external_requests: Object.freeze([...state.audit.blockedExternalRequests]),
  });
}

/**
 * Opens the one closed checkout fixture inside a runtime-owned browser. The
 * source, task, and environment identities are derived from exact canonical
 * artifact references rather than accepted as caller-selected strings.
 */
export async function openMutationFixtureSession(
  environment: MutationFixtureEnvironment,
  upstreamEvidence: unknown,
): Promise<MutationFixtureSession> {
  const { binding, actionPlan, captureSpec } =
    resolveMutationRuntimeBinding(upstreamEvidence);
  const environmentLease = acquireMutationFixtureEnvironment(
    environment,
    binding.capture_spec,
  );
  const { browser, fixtureDirectory } = environmentLease;
  const contextOptions = {
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
  } satisfies BrowserContextOptions;
  let context: BrowserContext | undefined;
  let contextCreationAttempted = false;
  try {
    const loaded = await loadMutationFixture(fixtureDirectory);
    contextCreationAttempted = true;
    context = await browser.newContext(contextOptions);
    const audit: MutationFixtureAuditState = {
      blockedExternalRequests: [],
      unexpectedFixtureRequests: [],
      cspViolations: [],
      pageErrors: [],
      integrityViolations: [],
      servedResourceCounts: new Map<string, number>(),
      navigationArmed: false,
      documentReplaced: false,
      auditOverflow: false,
      auditEventCount: 0,
      activeRouteHandlers: 0,
      requestEventCount: 0,
      routeEventCount: 0,
      closing: false,
    };
    context.on("request", () => {
      recordNetworkAuditCount(audit, "requestEventCount");
    });
    await context.route("**/*", async (route) => {
      recordNetworkAuditCount(audit, "routeEventCount");
      audit.activeRouteHandlers += 1;
      try {
        const request = route.request();
        const requestUrl = request.url();
        let url: URL;
        try {
          url = new URL(requestUrl);
        } catch {
          recordAuditEvent(audit, "unexpectedFixtureRequests", requestUrl);
          await route.abort("blockedbyclient");
          return;
        }
        if (url.origin !== closedFixture.origin) {
          recordAuditEvent(audit, "blockedExternalRequests", requestUrl);
          await route.abort("blockedbyclient");
          return;
        }
        const resourcePath =
          url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        const resource = loaded.resources.get(resourcePath);
        if (
          resource === undefined ||
          request.method() !== "GET" ||
          url.search !== "" ||
          url.username !== "" ||
          url.password !== "" ||
          (url.pathname !== "/" && url.pathname !== `/${resourcePath}`)
        ) {
          recordAuditEvent(audit, "unexpectedFixtureRequests", requestUrl);
          await route.abort("blockedbyclient");
          return;
        }
        audit.servedResourceCounts.set(
          resourcePath,
          (audit.servedResourceCounts.get(resourcePath) ?? 0) + 1,
        );
        await route.fulfill({
          status: 200,
          body: resource.body,
          contentType: resource.contentType,
          headers: { "cache-control": "no-store" },
        });
      } finally {
        audit.activeRouteHandlers -= 1;
      }
    });

    const page = await context.newPage();
    page.on("console", (message) => {
      const text = message.text();
      if (/content security policy|violates the following directive/iu.test(text)) {
        recordAuditEvent(audit, "cspViolations", text);
      }
    });
    page.on("pageerror", (error) => {
      recordAuditEvent(audit, "pageErrors", error.message);
    });
    page.on("framenavigated", (frame) => {
      if (audit.navigationArmed && frame === page.mainFrame()) {
        audit.documentReplaced = true;
      }
    });
    page.on("close", () => {
      if (!audit.closing) {
        audit.documentReplaced = true;
      }
    });
    page.setDefaultNavigationTimeout(captureSpec.budgets.navigation_timeout_ms);
    page.setDefaultTimeout(captureSpec.budgets.action_timeout_ms);
    await page.clock.install({ time: captureSpec.clock.epoch_ms });
    await page.clock.pauseAt(captureSpec.clock.epoch_ms);
    await page.goto(fixtureUrl, { waitUntil: "load" });
    await page.waitForFunction(
      () => {
        const state = Reflect.get(window, "__impactdiffFixtureV1") as
          { readonly ready?: unknown; readonly pendingRequests?: unknown } | undefined;
        return state?.ready === true && state.pendingRequests === 0;
      },
      undefined,
      { timeout: captureSpec.budgets.readiness_timeout_ms },
    );
    await assertFixtureReadiness(page, binding, captureSpec);
    await assertClosedChromiumFonts(page, {
      expectedPlatformFamilyName: "Noto Sans",
      createError: fixtureFontAuditError,
    });
    const now = await page.evaluate(() => Date.now());
    if (now !== captureSpec.clock.epoch_ms) {
      fail("mutation.clock_drift", "fixture virtual clock did not pause exactly");
    }
    const initialResourceIssues = servedResourceIssues(audit);
    if (
      initialResourceIssues.length > 0 ||
      networkAuditIssues(audit).length > 0 ||
      audit.unexpectedFixtureRequests.length > 0 ||
      audit.blockedExternalRequests.length > 0 ||
      audit.cspViolations.length > 0 ||
      audit.pageErrors.length > 0
    ) {
      fail(
        "mutation.fixture_initialization",
        "fixture browser initialization did not match the closed network/resource audit",
      );
    }
    const documentElement = await page.locator("html").elementHandle();
    if (documentElement === null) {
      fail(
        "mutation.fixture_initialization",
        "fixture document element could not be retained for provenance checks",
      );
    }
    const criticalElements: {
      readonly testId: string;
      readonly handle: ElementHandle<Element>;
    }[] = [];
    for (const testId of [
      "app-root",
      "checkout-review",
      "place-order",
      "order-confirmation",
    ]) {
      const handle = await page.getByTestId(testId).elementHandle();
      if (handle === null) {
        fail(
          "mutation.fixture_initialization",
          `fixture element ${testId} could not be retained for provenance checks`,
        );
      }
      criticalElements.push(Object.freeze({ testId, handle }));
    }
    const frozenCriticalElements = Object.freeze(criticalElements);
    const lookup = (testId: string): ElementHandle<Element> => {
      const match = frozenCriticalElements.find((entry) => entry.testId === testId);
      if (match === undefined) {
        fail(
          "mutation.fixture_initialization",
          `fixture integrity handle ${testId} is unavailable`,
        );
      }
      return match.handle;
    };
    const initialHandles: IntegrityHandles = {
      documentElement: documentElement as ElementHandle<HTMLElement>,
      appRoot: lookup("app-root"),
      review: lookup("checkout-review"),
      action: lookup("place-order"),
      confirmation: lookup("order-confirmation"),
    };
    const initialTaskState = await readFixtureTaskState(page, initialHandles);
    if (initialTaskState !== "review") {
      fail(
        "mutation.fixture_initialization",
        "closed fixture did not begin in its exact review state",
      );
    }
    const integrityGuard = await installIntegrityGuard(page);
    const pristineDocumentSha256 = await documentIntegritySha256(
      page,
      initialHandles,
      null,
    );
    const session = new MutationFixtureSession(sessionConstructorToken, page, binding);
    const state: MutationFixtureSessionState = {
      session,
      context,
      page,
      binding,
      actionPlan,
      captureSpec,
      releaseEnvironment: environmentLease.release,
      invalidateEnvironment: environmentLease.invalidate,
      primaryActionTargetId,
      documentElement: documentElement as ElementHandle<HTMLElement>,
      criticalElements: frozenCriticalElements,
      integrityGuard,
      pristineDocumentSha256,
      audit,
      lastTaskState: initialTaskState,
      activeOwnedMutation: null,
      captureTaskPhase: "unprepared",
      preparedCaptureGeometry: null,
      operationInProgress: false,
      closed: false,
    };
    fixtureSessions.set(session, state);
    pageSessions.set(page, state);
    Object.freeze(session);
    audit.navigationArmed = true;
    return session;
  } catch (error) {
    let contextReusable = !contextCreationAttempted;
    let cleanupFailure: { readonly error: unknown } | undefined;
    if (context !== undefined) {
      try {
        await context.close();
        contextReusable = true;
      } catch (cleanupError) {
        contextReusable = false;
        cleanupFailure = { error: cleanupError };
      }
    }
    try {
      if (contextReusable) {
        environmentLease.release();
      } else {
        environmentLease.invalidate();
      }
    } catch (cleanupError) {
      cleanupFailure = {
        error:
          cleanupFailure === undefined
            ? cleanupError
            : new AggregateError(
                [cleanupFailure.error, cleanupError],
                "fixture session cleanup failed",
              ),
      };
    }
    if (cleanupFailure !== undefined) {
      if (error instanceof MutationRuntimeError) {
        throw new MutationRuntimeError(error.code, error.message, {
          cause: new AggregateError(
            [error, cleanupFailure.error],
            "fixture session construction and cleanup both failed",
          ),
        });
      }
      throw new AggregateError(
        [error, cleanupFailure.error],
        "fixture session construction and cleanup both failed",
      );
    }
    throw error;
  }
}

type PointerClickAction = Extract<
  ActionPlan["actions"][number],
  { readonly intent: "pointer_click" }
>;

interface BrowserCaptureGeometry extends PreparedCaptureGeometry {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly centerHit: boolean;
}

function fixedCaptureAction(state: MutationFixtureSessionState): PointerClickAction {
  const action = state.actionPlan.actions[0];
  const checkpoints = state.actionPlan.checkpoints;
  if (
    state.actionPlan.actions.length !== 1 ||
    action === undefined ||
    action.ordinal !== 0 ||
    action.intent !== "pointer_click" ||
    action.target_id !== state.primaryActionTargetId ||
    action.value.kind !== "pointer" ||
    action.value.button !== "primary" ||
    checkpoints.length !== 2 ||
    checkpoints[0]?.ordinal !== 0 ||
    checkpoints[0]?.after_action_ordinal !== -1 ||
    checkpoints[1]?.ordinal !== 1 ||
    checkpoints[1]?.after_action_ordinal !== 0
  ) {
    fail(
      "mutation.capture_action_plan",
      "fixture capture requires one primary pointer click and the exact two-checkpoint schedule",
    );
  }
  return action;
}

function captureNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("mutation.capture_geometry", `${name} must be a finite browser number`);
  }
  return value;
}

async function readBrowserCaptureGeometry(
  state: MutationFixtureSessionState,
): Promise<BrowserCaptureGeometry> {
  const handles = integrityHandles(state);
  let value: {
    readonly scrollX: unknown;
    readonly scrollY: unknown;
    readonly viewportWidth: unknown;
    readonly viewportHeight: unknown;
    readonly centerHit: unknown;
    readonly targetBounds: {
      readonly x: unknown;
      readonly y: unknown;
      readonly width: unknown;
      readonly height: unknown;
    };
  };
  try {
    value = await handles.action.evaluate((action) => {
      const bounds = action.getBoundingClientRect();
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;
      return {
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        centerHit: document.elementFromPoint(centerX, centerY) === action,
        targetBounds: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        },
      };
    });
  } catch (error) {
    fail(
      "mutation.capture_geometry",
      "the authenticated primary action geometry could not be read",
      { cause: error },
    );
  }

  const geometry = {
    scrollX: captureNumber(value.scrollX, "scrollX"),
    scrollY: captureNumber(value.scrollY, "scrollY"),
    viewportWidth: captureNumber(value.viewportWidth, "viewportWidth"),
    viewportHeight: captureNumber(value.viewportHeight, "viewportHeight"),
    centerHit: value.centerHit === true,
    targetBounds: {
      x: captureNumber(value.targetBounds.x, "targetBounds.x"),
      y: captureNumber(value.targetBounds.y, "targetBounds.y"),
      width: captureNumber(value.targetBounds.width, "targetBounds.width"),
      height: captureNumber(value.targetBounds.height, "targetBounds.height"),
    },
  };
  const { targetBounds } = geometry;
  const viewport = state.captureSpec.display.viewport;
  if (
    geometry.viewportWidth !== viewport.width ||
    geometry.viewportHeight !== viewport.height ||
    !Number.isSafeInteger(geometry.scrollX) ||
    !Number.isSafeInteger(geometry.scrollY) ||
    geometry.scrollX < 0 ||
    geometry.scrollY < 0 ||
    targetBounds.width <= 0 ||
    targetBounds.height <= 0 ||
    targetBounds.x < 0 ||
    targetBounds.y < 0 ||
    targetBounds.x + targetBounds.width > geometry.viewportWidth ||
    targetBounds.y + targetBounds.height > geometry.viewportHeight
  ) {
    fail(
      "mutation.capture_geometry",
      "the primary action must have exact finite geometry inside the fixed viewport",
    );
  }
  return Object.freeze({
    ...geometry,
    targetBounds: Object.freeze(geometry.targetBounds),
  });
}

function samePreparedGeometry(
  prepared: PreparedCaptureGeometry,
  current: BrowserCaptureGeometry,
): boolean {
  return (
    prepared.scrollX === current.scrollX &&
    prepared.scrollY === current.scrollY &&
    prepared.targetBounds.x === current.targetBounds.x &&
    prepared.targetBounds.y === current.targetBounds.y &&
    prepared.targetBounds.width === current.targetBounds.width &&
    prepared.targetBounds.height === current.targetBounds.height
  );
}

async function assertPreparedCaptureGeometry(
  state: MutationFixtureSessionState,
  prepared: PreparedCaptureGeometry,
): Promise<void> {
  const current = await readBrowserCaptureGeometry(state);
  if (!samePreparedGeometry(prepared, current)) {
    fail(
      "mutation.capture_geometry_drift",
      "fixture scroll or target geometry changed after deterministic preparation",
    );
  }
}

/**
 * Performs the fixed initial scroll exactly once, before an optional mutation
 * is probed and applied. Both baseline and candidate roles use this operation.
 */
export async function prepareMutationFixtureTask(
  session: MutationFixtureSession,
): Promise<void> {
  const state = beginSessionOperation(session);
  try {
    fixedCaptureAction(state);
    if (state.captureTaskPhase !== "unprepared") {
      fail(
        "mutation.capture_phase",
        "fixture task preparation is single-use and must precede execution",
      );
    }
    if (state.activeOwnedMutation !== null || occupiedPages.has(state.page)) {
      fail(
        "mutation.capture_phase",
        "fixture task preparation must occur before applying a mutation",
      );
    }
    await assertAuthenticatedDocument(state);
    if (state.lastTaskState !== "review") {
      fail(
        "mutation.capture_initial_state",
        "fixture capture must begin from the exact review state",
      );
    }
    const handles = integrityHandles(state);
    await handles.action.scrollIntoViewIfNeeded();
    await assertAuthenticatedDocument(state);
    if (state.lastTaskState !== "review") {
      fail(
        "mutation.capture_initial_state",
        "fixture task changed during deterministic preparation",
      );
    }
    const geometry = await readBrowserCaptureGeometry(state);
    if (!geometry.centerHit) {
      fail(
        "mutation.capture_target_occluded",
        "the unmodified primary action center must be the viewport hit target",
      );
    }
    state.preparedCaptureGeometry = Object.freeze({
      scrollX: geometry.scrollX,
      scrollY: geometry.scrollY,
      targetBounds: Object.freeze({ ...geometry.targetBounds }),
    });
    state.captureTaskPhase = "prepared";
  } finally {
    endSessionOperation(state);
  }
}

function captureProtocolRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("mutation.capture_protocol", `${name} must be a CDP data object`);
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
    fail("mutation.capture_protocol", `${name} must be a bounded positive integer`);
  }
  return value;
}

async function captureTargetBackendNodeId(client: CDPSession): Promise<number> {
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
      selector: '[data-testid="place-order"]',
    }),
    "DOM.querySelectorAll response",
  );
  const nodeIds = queryResponse.nodeIds;
  if (!Array.isArray(nodeIds) || nodeIds.length !== 1) {
    fail(
      "mutation.capture_target",
      "the exact primary-action selector must resolve one DOM node",
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
      "mutation.capture_target",
      "the primary action must expose a valid CDP attribute vector",
    );
  }
  let testIdMatches = 0;
  for (let index = 0; index < attributes.length; index += 2) {
    if (
      attributes[index] === "data-testid" &&
      attributes[index + 1] === "place-order"
    ) {
      testIdMatches += 1;
    }
  }
  if (testIdMatches !== 1) {
    fail(
      "mutation.capture_target",
      "the resolved primary action must carry the exact fixture test ID",
    );
  }
  return captureProtocolInteger(
    node.backendNodeId,
    "primary action backendNodeId",
    4_294_967_295,
  );
}

function assertFixtureCheckpointTarget(
  state: MutationFixtureSessionState,
  layout: LayoutSnapshot,
  ordinal: 0 | 1,
): void {
  const actualCount = layout.nodes.filter(
    (node) => node.action_target_id === state.primaryActionTargetId,
  ).length;
  const expectedCount = ordinal === 0 || state.lastTaskState === "review" ? 1 : 0;
  if (actualCount !== expectedCount) {
    fail(
      "mutation.capture_target_binding",
      `checkpoint ${ordinal} must contain exactly ${expectedCount} authenticated primary-action layout targets`,
    );
  }
}

async function captureMutationCheckpoint(
  state: MutationFixtureSessionState,
  client: CDPSession,
  ordinal: 0 | 1,
  preparedGeometry: PreparedCaptureGeometry | null,
): Promise<MutationFixtureCheckpointBytes> {
  await assertAuthenticatedDocument(state);
  if (preparedGeometry !== null) {
    await assertPreparedCaptureGeometry(state, preparedGeometry);
  }
  await assertClosedChromiumFonts(state.page, {
    expectedPlatformFamilyName: "Noto Sans",
    createError: fixtureFontAuditError,
  });
  const targetBackendNodeId = await captureTargetBackendNodeId(client);
  const screenshotInput = await state.page.screenshot({
    type: state.captureSpec.screenshot.format,
    fullPage: state.captureSpec.screenshot.full_page,
    animations: state.captureSpec.screenshot.animations,
    caret: state.captureSpec.screenshot.caret,
    scale: state.captureSpec.screenshot.scale,
    omitBackground: state.captureSpec.screenshot.omit_background,
  });
  const domSnapshot = await client.send("DOMSnapshot.captureSnapshot", {
    computedStyles: [...chromiumLayoutComputedStyles],
    includePaintOrder: true,
    includeDOMRects: true,
    includeBlendedBackgroundColors: false,
    includeTextColorOpacities: false,
  });
  const layout = adaptChromiumLayoutSnapshot(domSnapshot, {
    viewport: state.captureSpec.display.viewport,
    target: {
      backendDomNodeId: targetBackendNodeId,
      actionTargetId: state.primaryActionTargetId,
    },
  });
  const accessibilityInput = await client.send("Accessibility.getFullAXTree");
  const accessibility = normalizeAccessibilitySnapshot(
    accessibilityInput,
    layout.backendDomNodeToLayoutIndex,
  );
  assertFixtureCheckpointTarget(state, layout.snapshot, ordinal);
  assertCaptureGraphBindings(state.actionPlan, accessibility, layout.snapshot);
  const screenshot = canonicalizePng(
    screenshotInput,
    state.captureSpec.display.viewport,
  ).bytes;
  const checkpoint = new MutationFixtureCheckpointBytes(checkpointConstructorToken, {
    checkpoint_id: computeCheckpointId(state.binding.action_plan, ordinal),
    ordinal,
    screenshot,
    accessibility_tree: Buffer.from(canonicalJson(accessibility), "utf8"),
    layout_graph: Buffer.from(canonicalJson(layout.snapshot), "utf8"),
  });
  await assertAuthenticatedDocument(state);
  if (preparedGeometry !== null) {
    await assertPreparedCaptureGeometry(state, preparedGeometry);
  }
  return checkpoint;
}

/**
 * Captures the exact initial checkpoint, performs the one true coordinate
 * click, and captures the exact final checkpoint under one authenticated
 * operation. Technical failures poison this run and never expose a partial
 * checkpoint sequence.
 */
export async function executeMutationFixtureTask(
  session: MutationFixtureSession,
): Promise<MutationFixtureTaskRun> {
  const state = beginSessionOperation(session);
  let started = false;
  let client: CDPSession | undefined;
  let result: MutationFixtureTaskRun | undefined;
  const errors: unknown[] = [];
  try {
    if (
      state.captureTaskPhase !== "prepared" ||
      state.preparedCaptureGeometry === null
    ) {
      fail(
        "mutation.capture_phase",
        "fixture task execution requires one successful deterministic preparation",
      );
    }
    const action = fixedCaptureAction(state);
    const prepared = state.preparedCaptureGeometry;
    started = true;
    state.captureTaskPhase = "executing";
    await assertAuthenticatedDocument(state);
    if (state.lastTaskState !== "review") {
      fail(
        "mutation.capture_initial_state",
        "fixture capture must execute from the exact review state",
      );
    }
    await assertPreparedCaptureGeometry(state, prepared);
    client = await state.page.context().newCDPSession(state.page);
    const initial = await captureMutationCheckpoint(state, client, 0, prepared);

    const { targetBounds } = prepared;
    await state.page.mouse.click(
      targetBounds.x + targetBounds.width / 2,
      targetBounds.y + targetBounds.height / 2,
    );

    const final = await captureMutationCheckpoint(state, client, 1, null);
    const finalTaskState = await readFixtureTaskState(
      state.page,
      integrityHandles(state),
    );
    if (
      finalTaskState === null ||
      !sameFixtureTaskState(finalTaskState, state.lastTaskState)
    ) {
      fail(
        "mutation.capture_result",
        "the final task outcome does not match the authenticated document state",
      );
    }
    const taskSuccess = finalTaskState === "confirmed";
    result = Object.freeze({
      checkpoints: Object.freeze([initial, final] as const),
      task_success: taskSuccess,
      first_unsatisfied_step_id: taskSuccess ? null : action.action_id,
      virtual_elapsed_ms: 0 as const,
    });
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
  if (started) {
    state.captureTaskPhase = errors.length === 0 ? "complete" : "failed";
  }
  endSessionOperation(state);

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, "fixture task capture and CDP cleanup failed");
  }
  if (result === undefined) {
    fail("mutation.capture_result", "fixture task capture produced no complete result");
  }
  return result;
}

function assertSupportedTarget(request: MutationRequest): void {
  const expected = supportedTargets[request.operator_key].mutationTestId;
  if (request.target.locator.value !== expected) {
    fail(
      "mutation.unsupported_target",
      `${request.operator_key} is closed to the ${expected} fixture target`,
    );
  }
}

function assertRequestBinding(
  request: MutationRequest,
  state: MutationFixtureSessionState,
): void {
  const { binding } = state;
  if (
    request.source_state_id !== binding.source_state_id ||
    request.task_id !== binding.task_id ||
    request.environment_id !== binding.environment_id
  ) {
    fail(
      "mutation.binding_request",
      "runtime provenance IDs must match the exact mutation request",
    );
  }
  const expectedNodeId = computeMutationTargetNodeId(
    binding.source_state_id,
    request.target.locator,
  );
  if (request.target.node_id !== expectedNodeId) {
    fail(
      "mutation.binding_task_target",
      "the mutation target node ID is not derived from the bound source state and locator",
    );
  }
  if (
    binding.primary_action_target_id !== state.primaryActionTargetId ||
    !state.actionPlan.actions.some(
      (action) => action.target_id === state.primaryActionTargetId,
    )
  ) {
    fail(
      "mutation.binding_task_target",
      "the mutation target has no authenticated relation to an action-plan target",
    );
  }
}

async function assertFixtureReadiness(
  page: Page,
  binding: MutationRuntimeBinding,
  captureSpec: CaptureSpec,
): Promise<void> {
  let evidence: {
    readonly ready: boolean;
    readonly revision: string | null;
    readonly pendingRequests: number | null;
    readonly sealed: boolean;
    readonly csp: string | null;
    readonly fontLoaded: boolean;
    readonly rootCount: number;
    readonly actionCount: number;
    readonly successCount: number;
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
  };
  try {
    evidence = await page.evaluate(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(
        window,
        "__impactdiffFixtureV1",
      );
      const state = descriptor?.value as
        | {
            readonly ready?: unknown;
            readonly revision?: unknown;
            readonly pendingRequests?: unknown;
          }
        | undefined;
      const csp = document
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute("content");
      return {
        ready: state?.ready === true,
        revision: typeof state?.revision === "string" ? state.revision : null,
        pendingRequests:
          typeof state?.pendingRequests === "number" ? state.pendingRequests : null,
        sealed:
          descriptor !== undefined &&
          descriptor.configurable === false &&
          descriptor.enumerable === false &&
          descriptor.writable === false &&
          state !== undefined &&
          Object.isFrozen(state),
        csp: csp ?? null,
        fontLoaded:
          document.fonts.status === "loaded" &&
          document.fonts.check('16px "ImpactDiff Noto Sans"'),
        rootCount: document.querySelectorAll('[data-testid="app-root"]').length,
        actionCount: document.querySelectorAll('[data-testid="place-order"]').length,
        successCount: document.querySelectorAll('[data-testid="order-confirmation"]')
          .length,
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
      };
    });
  } catch (error) {
    fail("mutation.fixture_readiness", "fixture readiness probing failed", {
      cause: error,
    });
  }
  const viewport = captureSpec.display.viewport;
  const screen = captureSpec.display.screen;
  if (
    !evidence.ready ||
    evidence.revision !== binding.fixture_revision ||
    evidence.pendingRequests !== captureSpec.budgets.maximum_pending_requests ||
    !evidence.sealed ||
    evidence.csp !== exactFixtureCsp ||
    !evidence.fontLoaded ||
    evidence.rootCount !== 1 ||
    evidence.actionCount !== 1 ||
    evidence.successCount !== 1 ||
    evidence.innerWidth !== viewport.width ||
    evidence.innerHeight !== viewport.height ||
    evidence.screenWidth !== screen.width ||
    evidence.screenHeight !== screen.height ||
    evidence.devicePixelRatio !== captureSpec.display.device_scale_factor ||
    evidence.language !== captureSpec.internationalization.locale ||
    evidence.timeZone !== captureSpec.internationalization.timezone_id ||
    evidence.lightScheme !== (captureSpec.media.color_scheme === "light") ||
    evidence.reducedMotion !== (captureSpec.media.reduced_motion === "reduce") ||
    evidence.forcedColors !== (captureSpec.media.forced_colors !== "none") ||
    evidence.serviceWorkerControlled ||
    evidence.serviceWorkerRegistrations !== 0 ||
    page.viewportSize()?.width !== viewport.width ||
    page.viewportSize()?.height !== viewport.height
  ) {
    fail(
      "mutation.fixture_readiness",
      "page readiness, revision, CSP, or pending-request state differs from the bound fixture",
    );
  }
}

function fixtureFontAuditError(
  message: string,
  options?: ErrorOptions,
): MutationRuntimeError {
  return new MutationRuntimeError("mutation.fixture_font_fallback", message, options);
}

function roundNearestTiesToEven(value: number): number {
  if (!Number.isFinite(value)) {
    fail("mutation.invalid_geometry", "browser geometry must be finite");
  }
  const lower = Math.floor(value);
  const fraction = value - lower;
  const rounded =
    fraction < 0.5
      ? lower
      : fraction > 0.5
        ? lower + 1
        : lower % 2 === 0
          ? lower
          : lower + 1;
  if (!Number.isSafeInteger(rounded)) {
    fail("mutation.invalid_geometry", "browser geometry exceeds safe integers");
  }
  return Object.is(rounded, -0) ? 0 : rounded;
}

function fixedRect(rect: BrowserTargetProbe["rect"]): FixedRect | null {
  const result = {
    x: roundNearestTiesToEven(rect.x * 1_000),
    y: roundNearestTiesToEven(rect.y * 1_000),
    width: roundNearestTiesToEven(rect.width * 1_000),
    height: roundNearestTiesToEven(rect.height * 1_000),
    scale: 1_000 as const,
  };
  return result.width > 0 && result.height > 0 ? result : null;
}

function observedNodeId(
  request: MutationRequest,
  centerHit: BrowserTargetProbe["centerHit"],
): string | null {
  if (centerHit === null) {
    return null;
  }
  if (centerHit.kind === "target") {
    return request.target.node_id;
  }
  const hash = createHash("sha256");
  hash.update("impactdiff:observed-center-hit:v1", "utf8");
  hash.update("\0", "utf8");
  hash.update(
    canonicalJson({
      source_state_id: request.source_state_id,
      element_path: centerHit.elementPath,
    }),
    "utf8",
  );
  return `idnd1_${hash.digest("hex")}`;
}

function palettePairs(): NonNullable<SourceProbe["palette"]["contrast_pairs"]> {
  return oceanPaletteDefinition.contrast_pairs.map((pair) => ({
    pair_id: pair.pair_id,
    foreground_rgb: [
      pair.foreground_rgb[0],
      pair.foreground_rgb[1],
      pair.foreground_rgb[2],
    ],
    background_rgb: [
      pair.background_rgb[0],
      pair.background_rgb[1],
      pair.background_rgb[2],
    ],
    ratio_milli: pair.ratio_milli,
  }));
}

function normalizedCssToken(value: string): string {
  return value.trim().toLowerCase();
}

function hasDefaultPalette(variables: BrowserTargetProbe["paletteVariables"]): boolean {
  return paletteVariableNames.every(
    (name) => normalizedCssToken(variables[name]) === defaultPaletteTokens[name],
  );
}

async function browserTargetProbe(
  targetHandle: ElementHandle<Element>,
): Promise<BrowserTargetProbe> {
  return targetHandle.evaluate((target) => {
    const rect = target.getBoundingClientRect();
    const style = getComputedStyle(target);
    const visible =
      target.isConnected &&
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.visibility !== "collapse";
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const inViewport =
      centerX >= 0 &&
      centerY >= 0 &&
      centerX < window.innerWidth &&
      centerY < window.innerHeight;
    const hit = inViewport ? document.elementFromPoint(centerX, centerY) : null;

    let centerHit: BrowserTargetProbe["centerHit"] = null;
    if (hit !== null && (hit === target || target.contains(hit))) {
      centerHit = { kind: "target" };
    } else if (hit !== null) {
      const elementPath: number[] = [];
      let current: Element | null = hit;
      while (current !== null) {
        let ordinal = 0;
        let sibling = current.previousElementSibling;
        while (sibling !== null) {
          ordinal += 1;
          sibling = sibling.previousElementSibling;
        }
        elementPath.push(ordinal);
        current = current.parentElement;
        if (elementPath.length > 128) {
          throw new Error("center hit DOM depth exceeds 128 elements");
        }
      }
      elementPath.reverse();
      centerHit = { kind: "other", elementPath };
    }

    return {
      connected: target.isConnected,
      visible,
      inViewport,
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      centerHit,
      paletteVariables: {
        canvas: style.getPropertyValue("--canvas"),
        panel: style.getPropertyValue("--panel"),
        text: style.getPropertyValue("--text"),
        border: style.getPropertyValue("--border"),
        primary: style.getPropertyValue("--primary"),
        primary_text: style.getPropertyValue("--primary_text"),
      },
    };
  });
}

async function collectProbe(
  state: MutationFixtureSessionState,
  requestValue: unknown,
): Promise<CollectedProbe> {
  await assertAuthenticatedDocument(state);
  const request = validateMutationRequest(requestValue);
  const { page, binding } = state;
  assertSupportedTarget(request);
  assertRequestBinding(request, state);
  const locator = page.getByTestId(request.target.locator.value);
  const resolutionCount = await locator.count();
  let targetHandle: ElementHandle<Element> | null = null;
  let observation: BrowserTargetProbe | null = null;

  if (resolutionCount === 1) {
    targetHandle = await locator.elementHandle();
    if (targetHandle === null) {
      fail(
        "mutation.probe_race",
        "the uniquely resolved mutation target detached during probing",
      );
    }
    try {
      observation = await browserTargetProbe(targetHandle);
    } catch (error) {
      await targetHandle.dispose();
      fail("mutation.probe_failed", "browser target probing failed", {
        cause: error,
      });
    }
    if (!observation.connected) {
      await targetHandle.dispose();
      fail(
        "mutation.probe_race",
        "the uniquely resolved mutation target detached during probing",
      );
    }
  }

  const bounds = observation === null ? null : fixedRect(observation.rect);
  const visible = observation === null ? null : observation.visible && bounds !== null;
  const inViewport = observation === null ? null : observation.inViewport;
  const paletteAvailable =
    request.operator_key === "palette_swap" && observation !== null;
  const sourceProfile =
    request.operator_key === "palette_swap" && observation !== null
      ? hasDefaultPalette(observation.paletteVariables)
        ? "default"
        : "other"
      : null;
  // Both operators map to the action-plan's deterministic place-order target:
  // pointer interception by identity, palette replacement because app-root
  // was just authenticated as the retained ancestor of that target.
  const targetPolicy = supportedTargets[request.operator_key];
  const taskTargetRelevant =
    targetPolicy.taskRelation === "contains" ||
    request.target.locator.value === primaryActionLocator.value;
  const draft: SourceProbe = {
    contract: "impactdiff.mutation-probe",
    version: 1,
    probe_fingerprint_sha256: "0".repeat(64),
    instance_id: computeMutationInstanceId(request),
    source_state_id: binding.source_state_id,
    task_id: binding.task_id,
    environment_id: binding.environment_id,
    runtime_clean: !occupiedPages.has(page),
    target: {
      resolution_count: resolutionCount,
      resolved_node_id: observation === null ? null : request.target.node_id,
      visible,
      in_viewport: inViewport,
      bounds,
      center_hit_node_id:
        observation === null ? null : observedNodeId(request, observation.centerHit),
      used_by_task: observation === null ? null : taskTargetRelevant,
    },
    palette: {
      source_profile: sourceProfile,
      candidate_palette_sha256: paletteAvailable ? oceanPaletteSha256 : null,
      contrast_pairs: paletteAvailable ? palettePairs() : null,
    },
  };

  try {
    return {
      probe: validateSourceProbe({
        ...draft,
        probe_fingerprint_sha256: computeSourceProbeFingerprint(draft),
      }),
      targetHandle,
    };
  } catch (error) {
    await targetHandle?.dispose();
    throw error;
  }
}

export async function probeMutation(
  session: MutationFixtureSession,
  requestValue: unknown,
): Promise<SourceProbe> {
  const state = beginSessionOperation(session);
  let targetHandle: ElementHandle<Element> | null = null;
  try {
    const collected = await collectProbe(state, requestValue);
    targetHandle = collected.targetHandle;
    return collected.probe;
  } finally {
    try {
      await targetHandle?.dispose();
    } finally {
      endSessionOperation(state);
    }
  }
}

function rgbFromCss(value: string): Rgb | null {
  const match = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/u.exec(value);
  if (match === null) {
    return null;
  }
  const channels = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  return channels.every(
    (channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255,
  )
    ? channels
    : null;
}

function equalRgb(left: Rgb, right: Rgb): boolean {
  return left.every((channel, index) => channel === right[index]);
}

function paletteLayerCssText(): string {
  const palette = oceanPaletteDefinition.tokens;
  return `
[data-testid="app-root"] {
  --canvas: ${palette.canvas} !important;
  --panel: ${palette.panel} !important;
  --text: ${palette.text} !important;
  --border: ${palette.border} !important;
  --primary: ${palette.primary} !important;
  --primary_text: ${palette.primary_text} !important;
}`;
}

async function installPaletteLayer(page: Page): Promise<ElementHandle<Element>> {
  const cssText = paletteLayerCssText();
  const handle = await page.evaluateHandle(
    ({ exactCssText, nonce }) => {
      const style = document.createElement("style");
      style.nonce = nonce;
      style.textContent = exactCssText;
      document.head.append(style);
      return style;
    },
    { exactCssText: cssText, nonce: fixtureStyleNonce },
  );
  const element = handle.asElement();
  if (element === null) {
    await handle.dispose();
    fail(
      "mutation.palette_installation",
      "palette installation did not return its owned style element",
    );
  }
  return element;
}

async function verifyPaletteLayer(styleHandle: ElementHandle<Element>): Promise<void> {
  let evidence: PaletteVerification;
  try {
    evidence = await styleHandle.evaluate(
      (style, expected) => {
        const root = document.querySelector('[data-testid="app-root"]');
        const action = document.querySelector('[data-testid="place-order"]');
        if (!(root instanceof HTMLElement) || !(action instanceof HTMLElement)) {
          throw new Error("closed fixture palette surfaces are missing");
        }
        const rootStyle = getComputedStyle(root);
        const actionStyle = getComputedStyle(action);
        const expectedSheet = new CSSStyleSheet();
        expectedSheet.replaceSync(expected.cssText);
        const ruleTexts = (sheet: CSSStyleSheet): string[] =>
          Array.from(sheet.cssRules, (rule) => rule.cssText);
        const actualRules =
          style instanceof HTMLStyleElement && style.sheet !== null
            ? ruleTexts(style.sheet)
            : [];
        const expectedRules = ruleTexts(expectedSheet);
        return {
          connected:
            style instanceof HTMLStyleElement &&
            style.isConnected &&
            style.parentElement === document.head,
          exactOwnedNode:
            style instanceof HTMLStyleElement &&
            style.attributes.length === 0 &&
            style.nonce === expected.nonce &&
            style.childNodes.length === 1 &&
            style.firstChild?.nodeType === Node.TEXT_NODE &&
            style.textContent === expected.cssText &&
            actualRules.length === expectedRules.length &&
            actualRules.every((rule, index) => rule === expectedRules[index]),
          variables: {
            canvas: rootStyle.getPropertyValue("--canvas"),
            panel: rootStyle.getPropertyValue("--panel"),
            text: rootStyle.getPropertyValue("--text"),
            border: rootStyle.getPropertyValue("--border"),
            primary: rootStyle.getPropertyValue("--primary"),
            primary_text: rootStyle.getPropertyValue("--primary_text"),
          },
          bodyForeground: rootStyle.color,
          bodyBackground: rootStyle.backgroundColor,
          actionForeground: actionStyle.color,
          actionBackground: actionStyle.backgroundColor,
        };
      },
      { cssText: paletteLayerCssText(), nonce: fixtureStyleNonce },
    );
  } catch (error) {
    fail("mutation.palette_verification", "palette verification failed", {
      cause: error,
    });
  }

  if (!evidence.connected || !evidence.exactOwnedNode) {
    fail(
      "mutation.palette_verification",
      "the owned palette style differs from its exact connected DOM/CSS definition",
    );
  }
  for (const name of paletteVariableNames) {
    if (
      normalizedCssToken(evidence.variables[name]) !==
      oceanPaletteDefinition.tokens[name]
    ) {
      fail(
        "mutation.palette_verification",
        `computed palette variable ${name} does not match its sealed definition`,
      );
    }
  }

  const bodyForeground = rgbFromCss(evidence.bodyForeground);
  const bodyBackground = rgbFromCss(evidence.bodyBackground);
  const actionForeground = rgbFromCss(evidence.actionForeground);
  const actionBackground = rgbFromCss(evidence.actionBackground);
  const bodyPair = oceanPaletteDefinition.contrast_pairs[0];
  const actionPair = oceanPaletteDefinition.contrast_pairs[1];
  if (bodyPair === undefined || actionPair === undefined) {
    fail(
      "mutation.palette_verification",
      "the sealed palette is missing required contrast pairs",
    );
  }
  if (
    bodyForeground === null ||
    bodyBackground === null ||
    actionForeground === null ||
    actionBackground === null ||
    !equalRgb(bodyForeground, bodyPair.foreground_rgb) ||
    !equalRgb(bodyBackground, bodyPair.background_rgb) ||
    !equalRgb(actionForeground, actionPair.foreground_rgb) ||
    !equalRgb(actionBackground, actionPair.background_rgb) ||
    contrastRatioMilli(bodyForeground, bodyBackground) !== bodyPair.ratio_milli ||
    contrastRatioMilli(actionForeground, actionBackground) !== actionPair.ratio_milli
  ) {
    fail(
      "mutation.palette_verification",
      "computed fixture colors or contrast ratios differ from the sealed palette",
    );
  }
}

function milliCssPixel(value: number): string {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const integer = Math.floor(absolute / 1_000);
  const fraction = String(absolute % 1_000).padStart(3, "0");
  return `${sign}${integer}.${fraction}px`;
}

interface PointerCssRect {
  readonly left: string;
  readonly top: string;
  readonly width: string;
  readonly height: string;
}

function pointerCssRect(rect: FixedRect): PointerCssRect {
  return {
    left: milliCssPixel(rect.x),
    top: milliCssPixel(rect.y),
    width: milliCssPixel(rect.width),
    height: milliCssPixel(rect.height),
  };
}

function pointerLayerCssText(geometry: PointerCssRect): string {
  return `
@scope {
  :scope > div {
    box-sizing: border-box;
    position: fixed;
    left: ${geometry.left};
    top: ${geometry.top};
    width: ${geometry.width};
    height: ${geometry.height};
    z-index: 2147483647;
    display: block;
    visibility: visible;
    pointer-events: auto;
    opacity: 1;
    background-color: rgba(0, 0, 0, 0);
    border: 0;
    margin: 0;
    padding: 0;
    transform: none;
  }
}`;
}

async function installPointerInterceptor(
  targetHandle: ElementHandle<Element>,
  rect: FixedRect,
): Promise<ElementHandle<Element>> {
  const cssRect = pointerCssRect(rect);
  const cssText = pointerLayerCssText(cssRect);
  const handle = await targetHandle.evaluateHandle(
    (_target, { exactCssText, nonce }) => {
      const wrapper = document.createElement("div");
      wrapper.setAttribute("aria-hidden", "true");
      const style = document.createElement("style");
      style.nonce = nonce;
      style.textContent = exactCssText;
      const overlay = document.createElement("div");
      wrapper.append(style, overlay);
      document.body.append(wrapper);
      return wrapper;
    },
    { exactCssText: cssText, nonce: fixtureStyleNonce },
  );
  const element = handle.asElement();
  if (element === null) {
    await handle.dispose();
    fail(
      "mutation.pointer_installation",
      "pointer installation did not return its owned overlay element",
    );
  }
  return element;
}

async function verifyPointerInterceptor(
  wrapperHandle: ElementHandle<Element>,
  targetHandle: ElementHandle<Element>,
  rect: FixedRect,
): Promise<void> {
  const expected = {
    x: rect.x / rect.scale,
    y: rect.y / rect.scale,
    width: rect.width / rect.scale,
    height: rect.height / rect.scale,
    nonce: fixtureStyleNonce,
    cssText: pointerLayerCssText(pointerCssRect(rect)),
  };
  let verified: boolean;
  try {
    const targetCenter = await targetHandle.evaluate((target) => {
      const targetRect = target.getBoundingClientRect();
      return {
        x: targetRect.x + targetRect.width / 2,
        y: targetRect.y + targetRect.height / 2,
      };
    });
    verified = await wrapperHandle.evaluate(
      (
        wrapper,
        input: {
          readonly expected: typeof expected;
          readonly targetCenter: { readonly x: number; readonly y: number };
        },
      ) => {
        const style = wrapper.firstElementChild;
        const overlay = wrapper.lastElementChild;
        const expectedSheet = new CSSStyleSheet();
        expectedSheet.replaceSync(input.expected.cssText);
        const ruleTexts = (sheet: CSSStyleSheet): string[] =>
          Array.from(sheet.cssRules, (rule) => rule.cssText);
        const actualRules =
          style instanceof HTMLStyleElement && style.sheet !== null
            ? ruleTexts(style.sheet)
            : [];
        const expectedRules = ruleTexts(expectedSheet);
        if (
          !wrapper.isConnected ||
          wrapper.attributes.length !== 1 ||
          wrapper.getAttribute("aria-hidden") !== "true" ||
          wrapper.children.length !== 2 ||
          wrapper.childNodes.length !== 2 ||
          !(style instanceof HTMLStyleElement) ||
          style.attributes.length !== 0 ||
          style.nonce !== input.expected.nonce ||
          style.sheet === null ||
          style.childNodes.length !== 1 ||
          style.firstChild?.nodeType !== Node.TEXT_NODE ||
          style.textContent !== input.expected.cssText ||
          actualRules.length !== expectedRules.length ||
          !actualRules.every((rule, index) => rule === expectedRules[index]) ||
          !(overlay instanceof HTMLDivElement) ||
          overlay.attributes.length !== 0 ||
          overlay.childNodes.length !== 0
        ) {
          return false;
        }
        const overlayStyle = getComputedStyle(overlay);
        const overlayRect = overlay.getBoundingClientRect();
        const tolerance = 1 / 64 + 0.001;
        const near = (left: number, right: number): boolean =>
          Math.abs(left - right) <= tolerance;
        return (
          overlayStyle.position === "fixed" &&
          overlayStyle.zIndex === "2147483647" &&
          overlayStyle.display === "block" &&
          overlayStyle.visibility === "visible" &&
          overlayStyle.pointerEvents === "auto" &&
          overlayStyle.opacity === "1" &&
          overlayStyle.backgroundColor === "rgba(0, 0, 0, 0)" &&
          near(overlayRect.x, input.expected.x) &&
          near(overlayRect.y, input.expected.y) &&
          near(overlayRect.width, input.expected.width) &&
          near(overlayRect.height, input.expected.height) &&
          document.elementFromPoint(input.targetCenter.x, input.targetCenter.y) ===
            overlay
        );
      },
      { expected, targetCenter },
    );
  } catch (error) {
    fail("mutation.pointer_verification", "pointer interceptor verification failed", {
      cause: error,
    });
  }
  if (!verified) {
    fail(
      "mutation.pointer_verification",
      "the owned pointer interceptor did not cover the compiled target center",
    );
  }
}

async function disconnectOwnedNode(handle: ElementHandle<Element>): Promise<void> {
  let disconnected: boolean;
  try {
    disconnected = await handle.evaluate((node) => {
      node.remove();
      return !node.isConnected;
    });
  } catch (error) {
    fail("mutation.cleanup_failed", "owned DOM node cleanup failed", {
      cause: error,
    });
  }
  if (!disconnected) {
    fail("mutation.cleanup_failed", "owned DOM node remained connected after cleanup");
  }
}

function staleProbe(plan: MutationPlan, observed: SourceProbe): void {
  if (observed.probe_fingerprint_sha256 !== plan.probe_fingerprint_sha256) {
    fail(
      "mutation.stale_probe",
      "the live source probe no longer matches the compiled mutation plan",
    );
  }
}

export async function applyCompiledMutation(
  session: MutationFixtureSession,
  planValue: unknown,
  preconditionValue: unknown,
): Promise<MutationCleanup> {
  const state = beginSessionOperation(session);
  const { page } = state;
  let targetHandle: ElementHandle<Element> | null = null;
  let ownedHandle: ElementHandle<Element> | null = null;
  try {
    const { plan } = validateMutationCompilation(planValue, preconditionValue);
    const collected = await collectProbe(state, plan.request);
    targetHandle = collected.targetHandle;
    if (occupiedPages.has(page)) {
      fail(
        "mutation.overlapping_application",
        "a page can own only one active ImpactDiff mutation",
      );
    }
    staleProbe(plan, collected.probe);
    if (targetHandle === null) {
      fail("mutation.probe_race", "the compiled target is no longer uniquely resolved");
    }

    occupiedPages.add(page);
    const operation = plan.forward[0];
    if (operation === undefined) {
      fail("mutation.invalid_opcode", "the mutation plan has no forward opcode");
    }
    try {
      switch (operation.opcode) {
        case "install_palette_layer":
          ownedHandle = await installPaletteLayer(page);
          state.activeOwnedMutation = {
            kind: "palette",
            handle: ownedHandle,
            rect: null,
          };
          break;
        case "install_pointer_interceptor":
          ownedHandle = await installPointerInterceptor(
            targetHandle,
            operation.rect_milli_css_px,
          );
          state.activeOwnedMutation = {
            kind: "pointer",
            handle: ownedHandle,
            rect: operation.rect_milli_css_px,
          };
          break;
        default: {
          const exhaustive: never = operation;
          void exhaustive;
          fail("mutation.invalid_opcode", "unsupported mutation opcode");
        }
      }
      await assertAuthenticatedDocument(state, "added");
    } catch (executionError) {
      const rollbackErrors: unknown[] = [];
      if (ownedHandle !== null) {
        let disconnected = false;
        try {
          await disconnectOwnedNode(ownedHandle);
          disconnected = true;
        } catch (error) {
          rollbackErrors.push(error);
        }
        if (disconnected) {
          try {
            await assertAuthenticatedDocument(state, "removed");
          } catch (error) {
            rollbackErrors.push(error);
          }
          occupiedPages.delete(page);
        }
        try {
          await ownedHandle.dispose();
        } catch (error) {
          rollbackErrors.push(error);
        }
        if (disconnected) state.activeOwnedMutation = null;
      } else {
        occupiedPages.delete(page);
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [executionError, ...rollbackErrors],
          "mutation execution and rollback audit failed",
        );
      }
      throw executionError;
    }
  } finally {
    try {
      await targetHandle?.dispose();
    } catch {
      // Observation handles own no page state and cannot invalidate a
      // successful owned-node rollback.
    } finally {
      endSessionOperation(state);
    }
  }

  if (ownedHandle === null) {
    occupiedPages.delete(page);
    fail("mutation.installation_failed", "mutation produced no owned DOM handle");
  }

  let cleaned = false;
  let cleaning = false;
  return async () => {
    if (cleaned || cleaning) {
      fail("mutation.cleanup_reused", "mutation cleanup is single-use");
    }
    cleaning = true;
    let cleanupState: MutationFixtureSessionState;
    try {
      cleanupState = beginSessionOperation(session);
    } catch (error) {
      cleaning = false;
      throw error;
    }
    const errors: unknown[] = [];
    let disconnected = false;
    try {
      if (
        cleanupState !== state ||
        state.activeOwnedMutation?.handle !== ownedHandle ||
        !occupiedPages.has(page)
      ) {
        fail(
          "mutation.cleanup_ownership",
          "mutation cleanup no longer owns the authenticated active node",
        );
      }
      try {
        await assertAuthenticatedDocument(state);
      } catch (error) {
        errors.push(error);
      }
      try {
        await disconnectOwnedNode(ownedHandle);
        disconnected = true;
      } catch (error) {
        errors.push(error);
      }
      if (disconnected) {
        try {
          await assertAuthenticatedDocument(state, "removed");
        } catch (error) {
          errors.push(error);
        }
      }
      try {
        await ownedHandle.dispose();
      } catch (error) {
        errors.push(error);
      }
      if (disconnected) {
        cleaned = true;
        occupiedPages.delete(page);
        state.activeOwnedMutation = null;
      }
    } finally {
      cleaning = false;
      endSessionOperation(cleanupState);
    }
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, "mutation cleanup audit failed");
    }
  };
}
