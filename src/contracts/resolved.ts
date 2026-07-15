import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { canonicalizePng } from "../artifacts/png.js";
import type { CanonicalPng } from "../artifacts/png.js";
import {
  assertCaptureGraphBindings,
  parseAccessibilitySnapshot,
  parseActionPlan,
  parseCaptureSpec,
  parseLayoutSnapshot,
} from "../capture/validate.js";
import type {
  AccessibilitySnapshot,
  ActionPlan,
  CaptureSpec,
  LayoutSnapshot,
} from "../capture/schema.js";
import { canonicalJson, parseCanonicalJson } from "./canonical.js";
import type { ParseLimits } from "./canonical.js";
import { assertNoIssues, issue } from "./errors.js";
import { ContractValidationError } from "./errors.js";
import type { ContractIssue } from "./errors.js";
import type { ArtifactRef } from "./artifacts.js";
import { intrinsicUint8ArrayByteLength, snapshotUint8Array } from "./byte-array.js";
import type { EvidenceManifest, SealedRecord } from "./schema.js";
import { validateEvidenceManifest, validateEvidenceRecordPair } from "./validate.js";
import {
  validateMutationCompilation,
  validateMutationPlan,
  validatePreconditionReport,
} from "../mutations/compiler.js";
import type {
  MutationPlan,
  PreconditionReport,
  SourceProbe,
} from "../mutations/schema.js";

const resolvedEvidenceContract = "impactdiff.resolved-evidence/v1";
const resolvedInterventionContract = "impactdiff.resolved-intervention/v1";

const actionPlanMediaType = "application/vnd.impactdiff.action-plan+json";
const captureSpecMediaType = "application/vnd.impactdiff.capture-spec+json";
const accessibilityMediaType = "application/vnd.impactdiff.accessibility+json";
const layoutMediaType = "application/vnd.impactdiff.layout+json";
const mutationPlanMediaType = "application/vnd.impactdiff.intervention-parameters+json";
const preconditionMediaType =
  "application/vnd.impactdiff.intervention-preconditions+json";
const actionPlanMaximumBytes = 131_072;
const captureSpecMaximumBytes = 65_536;
const screenshotMaximumBytes = 8_388_608;
const accessibilityMaximumBytes = 2_097_152;
const layoutMaximumBytes = 4_194_304;
const mutationMaximumBytes = 131_072;
const evidenceMaximumUniqueBytes = 67_108_864;
const interventionMaximumUniqueBytes = 8_388_608;

const mutationLimits = Object.freeze({
  maximumBytes: 131_072,
  maximumDepth: 16,
  maximumValues: 20_000,
}) satisfies ParseLimits;

interface InputRecord {
  readonly [key: string]: unknown;
}

/** A phase-one byte view whose intrinsic shape is known but has not been copied. */
interface DeferredArtifact {
  readonly value: Uint8Array;
  readonly byteLength: number;
}

interface DeferredResolvedCheckpoint {
  readonly screenshot: DeferredArtifact;
  readonly accessibility_tree: DeferredArtifact;
  readonly layout_graph: DeferredArtifact;
}

interface DeferredResolvedEvidence {
  readonly manifest: unknown;
  readonly action_plan: DeferredArtifact;
  readonly capture_spec: DeferredArtifact;
  readonly pair: {
    readonly baseline: readonly DeferredResolvedCheckpoint[];
    readonly candidate: readonly DeferredResolvedCheckpoint[];
  };
}

interface DeferredResolvedIntervention {
  readonly manifest: unknown;
  readonly sealed_record: unknown;
  readonly mutation_plan: DeferredArtifact;
  readonly precondition_report: DeferredArtifact;
}

interface RawResolvedCheckpoint {
  readonly screenshot: Buffer;
  readonly accessibility_tree: Buffer;
  readonly layout_graph: Buffer;
}

export interface ResolvedCaptureCheckpoint {
  readonly screenshot: CanonicalPng;
  readonly accessibility_tree: AccessibilitySnapshot;
  readonly layout_graph: LayoutSnapshot;
}

export interface ResolvedEvidenceBundle {
  readonly manifest: EvidenceManifest;
  readonly action_plan: ActionPlan;
  readonly capture_spec: CaptureSpec;
  readonly pair: {
    readonly baseline: readonly ResolvedCaptureCheckpoint[];
    readonly candidate: readonly ResolvedCaptureCheckpoint[];
  };
}

export interface ResolvedInterventionBundle {
  readonly manifest: EvidenceManifest;
  readonly sealed_record: SealedRecord;
  readonly mutation_plan: MutationPlan;
  readonly precondition_report: PreconditionReport;
  readonly probe: SourceProbe;
}

function prefixedPath(prefix: string, path: string): string {
  if (path === "" || path === "/") {
    return prefix;
  }
  return `${prefix}${path}`;
}

function appendFailure(issues: ContractIssue[], path: string, error: unknown): void {
  if (error instanceof ContractValidationError) {
    for (const nested of error.issues) {
      issues.push({
        code: nested.code,
        path: prefixedPath(path, nested.path),
        message: nested.message,
      });
    }
    return;
  }

  const errorCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "resolved.payload_invalid";
  const message = error instanceof Error ? error.message : "artifact validation failed";
  issues.push(issue(errorCode, path, message));
}

function closedRecord(
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
  issues: ContractIssue[],
): InputRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push(
      issue(
        "resolved.wrapper_object",
        path,
        "resolved bundle fields must use closed plain objects",
      ),
    );
    return undefined;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    issues.push(
      issue(
        "resolved.wrapper_prototype",
        path,
        "resolved bundle objects must use Object.prototype or a null prototype",
      ),
    );
    return undefined;
  }

  const expected = new Set(expectedKeys);
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      issues.push(
        issue(
          "resolved.wrapper_hidden_property",
          path,
          "resolved bundle objects cannot carry symbol properties",
        ),
      );
      continue;
    }
    if (!expected.has(key)) {
      issues.push(
        issue(
          "resolved.wrapper_extra_property",
          `${path}/${key}`,
          "resolved bundle objects cannot carry unknown properties",
        ),
      );
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      issues.push(
        issue(
          "resolved.wrapper_hidden_property",
          `${path}/${key}`,
          "resolved bundle fields must be enumerable data properties",
        ),
      );
      continue;
    }
    result[key] = descriptor.value;
  }

  for (const key of expectedKeys) {
    if (!Object.hasOwn(result, key)) {
      issues.push(
        issue(
          "resolved.wrapper_missing_property",
          `${path}/${key}`,
          "resolved bundle object is missing a required property",
        ),
      );
    }
  }
  return result;
}

function denseArray(
  value: unknown,
  path: string,
  maximumLength: number,
  issues: ContractIssue[],
): readonly unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    issues.push(
      issue(
        "resolved.wrapper_array",
        path,
        "resolved checkpoints must use a built-in dense array",
      ),
    );
    return undefined;
  }
  if (value.length > maximumLength) {
    issues.push(
      issue(
        "resolved.wrapper_array_length",
        path,
        `resolved checkpoint arrays cannot contain more than ${maximumLength} items`,
      ),
    );
    return undefined;
  }

  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") {
      continue;
    }
    if (
      typeof key !== "string" ||
      !/^(0|[1-9][0-9]*)$/u.test(key) ||
      Number(key) >= value.length
    ) {
      issues.push(
        issue(
          "resolved.wrapper_extra_property",
          path,
          "resolved checkpoint arrays cannot carry symbol or named properties",
        ),
      );
    }
  }

  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      issues.push(
        issue(
          "resolved.wrapper_sparse_array",
          `${path}/${index}`,
          "resolved checkpoint arrays must be dense enumerable data",
        ),
      );
      result.push(undefined);
    } else {
      result.push(descriptor.value);
    }
  }
  return result;
}

function deferredArtifact(
  value: unknown,
  path: string,
  maximumBytes: number,
  issues: ContractIssue[],
): DeferredArtifact | undefined {
  const byteLength = intrinsicUint8ArrayByteLength(value);
  if (byteLength === null) {
    issues.push(
      issue(
        "resolved.wrapper_bytes",
        path,
        "resolved artifacts must be supplied as byte arrays",
      ),
    );
    return undefined;
  }
  if (byteLength < 1 || byteLength > maximumBytes) {
    issues.push(
      issue(
        "resolved.wrapper_byte_length",
        path,
        `resolved artifact byte length must be between 1 and ${maximumBytes}`,
      ),
    );
    return undefined;
  }
  return Object.freeze({ value: value as Uint8Array, byteLength });
}

function deferredCheckpoint(
  value: unknown,
  path: string,
  issues: ContractIssue[],
): DeferredResolvedCheckpoint | undefined {
  const record = closedRecord(
    value,
    ["screenshot", "accessibility_tree", "layout_graph"],
    path,
    issues,
  );
  if (record === undefined) {
    return undefined;
  }
  const screenshot = deferredArtifact(
    record.screenshot,
    `${path}/screenshot`,
    screenshotMaximumBytes,
    issues,
  );
  const accessibilityTree = deferredArtifact(
    record.accessibility_tree,
    `${path}/accessibility_tree`,
    accessibilityMaximumBytes,
    issues,
  );
  const layoutGraph = deferredArtifact(
    record.layout_graph,
    `${path}/layout_graph`,
    layoutMaximumBytes,
    issues,
  );
  if (
    screenshot === undefined ||
    accessibilityTree === undefined ||
    layoutGraph === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    screenshot,
    accessibility_tree: accessibilityTree,
    layout_graph: layoutGraph,
  });
}

function captureInput(
  value: unknown,
  path: string,
  issues: ContractIssue[],
): readonly DeferredResolvedCheckpoint[] | undefined {
  const record = closedRecord(value, ["checkpoints"], path, issues);
  if (record === undefined) {
    return undefined;
  }
  const checkpoints = denseArray(record.checkpoints, `${path}/checkpoints`, 16, issues);
  if (checkpoints === undefined) {
    return undefined;
  }
  const parsed = checkpoints.map((checkpoint, index) =>
    deferredCheckpoint(checkpoint, `${path}/checkpoints/${index}`, issues),
  );
  return parsed.every(
    (checkpoint): checkpoint is DeferredResolvedCheckpoint => checkpoint !== undefined,
  )
    ? Object.freeze(parsed)
    : undefined;
}

function resolvedEvidenceInput(
  value: unknown,
  issues: ContractIssue[],
): DeferredResolvedEvidence | undefined {
  const root = closedRecord(
    value,
    ["manifest", "action_plan", "capture_spec", "pair"],
    "",
    issues,
  );
  if (root === undefined) {
    return undefined;
  }
  const pair = closedRecord(root.pair, ["baseline", "candidate"], "/pair", issues);
  const actionPlan = deferredArtifact(
    root.action_plan,
    "/action_plan",
    actionPlanMaximumBytes,
    issues,
  );
  const captureSpec = deferredArtifact(
    root.capture_spec,
    "/capture_spec",
    captureSpecMaximumBytes,
    issues,
  );
  const baseline =
    pair === undefined
      ? undefined
      : captureInput(pair.baseline, "/pair/baseline", issues);
  const candidate =
    pair === undefined
      ? undefined
      : captureInput(pair.candidate, "/pair/candidate", issues);
  if (
    actionPlan === undefined ||
    captureSpec === undefined ||
    baseline === undefined ||
    candidate === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    manifest: root.manifest,
    action_plan: actionPlan,
    capture_spec: captureSpec,
    pair: Object.freeze({ baseline, candidate }),
  });
}

function resolvedInterventionInput(
  value: unknown,
  issues: ContractIssue[],
): DeferredResolvedIntervention | undefined {
  const root = closedRecord(
    value,
    ["manifest", "sealed_record", "mutation_plan", "precondition_report"],
    "",
    issues,
  );
  if (root === undefined) {
    return undefined;
  }
  const mutationPlan = deferredArtifact(
    root.mutation_plan,
    "/mutation_plan",
    mutationMaximumBytes,
    issues,
  );
  const preconditionReport = deferredArtifact(
    root.precondition_report,
    "/precondition_report",
    mutationMaximumBytes,
    issues,
  );
  if (mutationPlan === undefined || preconditionReport === undefined) {
    return undefined;
  }
  return Object.freeze({
    manifest: root.manifest,
    sealed_record: root.sealed_record,
    mutation_plan: mutationPlan,
    precondition_report: preconditionReport,
  });
}

interface ResolvedArtifactEntry {
  readonly reference: ArtifactRef;
  readonly bytes: Buffer;
  readonly verifiedInputs: WeakSet<Uint8Array>;
}

function inputMatchesSnapshot(input: DeferredArtifact, snapshot: Buffer): boolean {
  if (
    input.byteLength !== snapshot.byteLength ||
    intrinsicUint8ArrayByteLength(input.value) !== input.byteLength
  ) {
    return false;
  }
  for (let index = 0; index < input.byteLength; index += 1) {
    if (input.value[index] !== snapshot[index]) {
      return false;
    }
  }
  return intrinsicUint8ArrayByteLength(input.value) === input.byteLength;
}

/**
 * Binds phase-one views to normalized references. Only the first occurrence of
 * a digest is copied; later occurrences must equal that owned snapshot before
 * it is reused. The declared unique-byte budget is charged before allocation.
 */
class ArtifactResolver {
  readonly #maximumUniqueBytes: number;
  readonly #entries = new Map<string, ResolvedArtifactEntry>();
  #uniqueBytes = 0;

  constructor(maximumUniqueBytes: number) {
    this.#maximumUniqueBytes = maximumUniqueBytes;
  }

  resolve(
    input: DeferredArtifact,
    reference: ArtifactRef,
    expectedMediaType: string,
    path: string,
    issues: ContractIssue[],
  ): Buffer | undefined {
    let validMetadata = true;
    if (reference.media_type !== expectedMediaType) {
      issues.push(
        issue(
          "resolved.ref_media_type",
          `${path}/media_type`,
          `artifact reference must use ${expectedMediaType}`,
        ),
      );
      validMetadata = false;
    }
    if (reference.format_version !== 1) {
      issues.push(
        issue(
          "resolved.ref_format_version",
          `${path}/format_version`,
          "resolved artifact format version must be 1",
        ),
      );
      validMetadata = false;
    }

    const currentByteLength = intrinsicUint8ArrayByteLength(input.value);
    if (currentByteLength === null || currentByteLength !== input.byteLength) {
      issues.push(
        issue(
          "resolved.wrapper_bytes",
          path,
          "resolved artifact changed after wrapper validation",
        ),
      );
      return undefined;
    }
    if (reference.byte_length !== currentByteLength) {
      issues.push(
        issue(
          "resolved.ref_byte_length",
          `${path}/byte_length`,
          "resolved artifact byte length differs from its reference",
        ),
      );
      return undefined;
    }
    if (!validMetadata) {
      return undefined;
    }

    const existing = this.#entries.get(reference.sha256);
    if (existing !== undefined) {
      if (
        existing.reference.byte_length !== reference.byte_length ||
        existing.reference.media_type !== reference.media_type ||
        existing.reference.format_version !== reference.format_version
      ) {
        issues.push(
          issue(
            "resolved.ref_metadata_conflict",
            path,
            "one digest cannot identify artifacts with conflicting metadata",
          ),
        );
        return undefined;
      }
      if (existing.verifiedInputs.has(input.value)) {
        return existing.bytes;
      }
      if (!inputMatchesSnapshot(input, existing.bytes)) {
        issues.push(
          issue(
            "resolved.ref_digest",
            `${path}/sha256`,
            "resolved artifact bytes differ from their referenced digest",
          ),
        );
        return undefined;
      }
      existing.verifiedInputs.add(input.value);
      return existing.bytes;
    }

    const nextUniqueBytes = this.#uniqueBytes + reference.byte_length;
    if (nextUniqueBytes > this.#maximumUniqueBytes) {
      issues.push(
        issue(
          "resolved.unique_byte_budget",
          path,
          `resolved unique artifact bytes exceed ${this.#maximumUniqueBytes}`,
        ),
      );
      return undefined;
    }

    let snapshot: Buffer;
    try {
      snapshot = snapshotUint8Array(input.value, input.byteLength);
    } catch (error) {
      appendFailure(issues, path, error);
      return undefined;
    }
    const digest = createHash("sha256").update(snapshot).digest("hex");
    if (reference.sha256 !== digest) {
      issues.push(
        issue(
          "resolved.ref_digest",
          `${path}/sha256`,
          "resolved artifact bytes differ from their referenced digest",
        ),
      );
      return undefined;
    }

    this.#uniqueBytes = nextUniqueBytes;
    this.#entries.set(reference.sha256, {
      reference,
      bytes: snapshot,
      verifiedInputs: new WeakSet([input.value]),
    });
    return snapshot;
  }
}

function parsePayload<T>(
  parse: (bytes: Buffer) => T,
  bytes: Buffer,
  path: string,
  issues: ContractIssue[],
): T | undefined {
  try {
    return parse(bytes);
  } catch (error) {
    appendFailure(issues, path, error);
    return undefined;
  }
}

function parseCanonicalPng(
  bytes: Buffer,
  path: string,
  issues: ContractIssue[],
): CanonicalPng | undefined {
  const png = parsePayload(canonicalizePng, bytes, path, issues);
  if (png !== undefined && !png.bytes.equals(bytes)) {
    issues.push(
      issue(
        "resolved.png_noncanonical",
        path,
        "resolved screenshots must already use canonical PNG encoding",
      ),
    );
  }
  return png;
}

interface DecodedPayloadCache {
  readonly screenshots: Map<string, CanonicalPng>;
  readonly accessibility: Map<string, AccessibilitySnapshot>;
  readonly layouts: Map<string, LayoutSnapshot>;
}

function cachedPayload<T>(
  cache: Map<string, T>,
  digest: string,
  decode: () => T | undefined,
): T | undefined {
  const cached = cache.get(digest);
  if (cached !== undefined) {
    return cached;
  }
  const decoded = decode();
  if (decoded !== undefined) {
    cache.set(digest, decoded);
  }
  return decoded;
}

function decodeCheckpoint(
  input: RawResolvedCheckpoint,
  screenshotRef: ArtifactRef,
  accessibilityRef: ArtifactRef,
  layoutRef: ArtifactRef,
  dimensions: CaptureSpec["display"]["viewport"],
  actionPlan: ActionPlan,
  path: string,
  issues: ContractIssue[],
  cache: DecodedPayloadCache,
): ResolvedCaptureCheckpoint | undefined {
  const screenshot = cachedPayload(cache.screenshots, screenshotRef.sha256, () =>
    parseCanonicalPng(input.screenshot, `${path}/screenshot`, issues),
  );
  const accessibility = cachedPayload(
    cache.accessibility,
    accessibilityRef.sha256,
    () =>
      parsePayload(
        parseAccessibilitySnapshot,
        input.accessibility_tree,
        `${path}/accessibility_tree`,
        issues,
      ),
  );
  const layout = cachedPayload(cache.layouts, layoutRef.sha256, () =>
    parsePayload(
      parseLayoutSnapshot,
      input.layout_graph,
      `${path}/layout_graph`,
      issues,
    ),
  );

  if (
    screenshot !== undefined &&
    (screenshot.width !== dimensions.width || screenshot.height !== dimensions.height)
  ) {
    issues.push(
      issue(
        "resolved.png_dimensions",
        `${path}/screenshot`,
        "screenshot dimensions must equal the capture-spec viewport",
      ),
    );
  }
  if (accessibility !== undefined && layout !== undefined) {
    try {
      assertCaptureGraphBindings(actionPlan, accessibility, layout);
    } catch (error) {
      appendFailure(issues, path, error);
    }
  }
  if (screenshot === undefined || accessibility === undefined || layout === undefined) {
    return undefined;
  }
  return Object.freeze({
    screenshot,
    accessibility_tree: accessibility,
    layout_graph: layout,
  });
}

function wrapperCheckpointCountIssues(
  manifest: EvidenceManifest,
  input: DeferredResolvedEvidence,
  issues: ContractIssue[],
): void {
  for (const name of ["baseline", "candidate"] as const) {
    if (manifest.pair[name].checkpoints.length !== input.pair[name].length) {
      issues.push(
        issue(
          "resolved.checkpoint_count",
          `/pair/${name}/checkpoints`,
          "manifest and resolved checkpoint counts must match",
        ),
      );
    }
  }
}

function checkpointScheduleIssues(
  manifest: EvidenceManifest,
  actionPlan: ActionPlan,
  issues: ContractIssue[],
): void {
  const expected = actionPlan.checkpoints.length;
  for (const name of ["baseline", "candidate"] as const) {
    if (manifest.pair[name].checkpoints.length !== expected) {
      issues.push(
        issue(
          "resolved.checkpoint_count",
          `/pair/${name}/checkpoints`,
          "manifest and resolved checkpoint counts must equal the action-plan schedule",
        ),
      );
    }
  }

  for (const [index, scheduled] of actionPlan.checkpoints.entries()) {
    const baseline = manifest.pair.baseline.checkpoints[index];
    const candidate = manifest.pair.candidate.checkpoints[index];
    if (
      baseline !== undefined &&
      candidate !== undefined &&
      (scheduled.ordinal !== index ||
        baseline.ordinal !== scheduled.ordinal ||
        candidate.ordinal !== scheduled.ordinal)
    ) {
      issues.push(
        issue(
          "resolved.checkpoint_schedule",
          `/pair/baseline/checkpoints/${index}/ordinal`,
          "paired checkpoint ordinals must match the action-plan schedule",
        ),
      );
    }
  }
}

function resolveCheckpoint(
  input: DeferredResolvedCheckpoint,
  reference: EvidenceManifest["pair"]["baseline"]["checkpoints"][number],
  path: string,
  resolver: ArtifactResolver,
  issues: ContractIssue[],
): RawResolvedCheckpoint | undefined {
  const screenshot = resolver.resolve(
    input.screenshot,
    reference.screenshot,
    "image/png",
    `${path}/screenshot`,
    issues,
  );
  if (screenshot === undefined) {
    return undefined;
  }
  const accessibility = resolver.resolve(
    input.accessibility_tree,
    reference.accessibility_tree,
    accessibilityMediaType,
    `${path}/accessibility_tree`,
    issues,
  );
  if (accessibility === undefined) {
    return undefined;
  }
  const layout = resolver.resolve(
    input.layout_graph,
    reference.layout_graph,
    layoutMediaType,
    `${path}/layout_graph`,
    issues,
  );
  if (layout === undefined) {
    return undefined;
  }
  return Object.freeze({
    screenshot,
    accessibility_tree: accessibility,
    layout_graph: layout,
  });
}

/**
 * Validates the complete model-visible payload bundle after artifact resolution.
 * The wrapper deliberately contains bytes rather than filenames or selectors.
 */
export function validateResolvedEvidenceBundle(value: unknown): ResolvedEvidenceBundle {
  const issues: ContractIssue[] = [];
  const input = resolvedEvidenceInput(value, issues);
  assertNoIssues(resolvedEvidenceContract, issues);
  if (input === undefined) {
    throw new Error("unreachable resolved evidence input state");
  }

  // This is the second small-data phase: normalize the manifest and reject
  // wrapper/manifest count mismatches before any artifact snapshot is retained.
  const manifest = validateEvidenceManifest(input.manifest);
  wrapperCheckpointCountIssues(manifest, input, issues);
  assertNoIssues(resolvedEvidenceContract, issues);

  const resolver = new ArtifactResolver(evidenceMaximumUniqueBytes);
  const actionPlanBytes = resolver.resolve(
    input.action_plan,
    manifest.task.action_plan,
    actionPlanMediaType,
    "/manifest/task/action_plan",
    issues,
  );
  const captureSpecBytes = resolver.resolve(
    input.capture_spec,
    manifest.environment.capture_spec,
    captureSpecMediaType,
    "/manifest/environment/capture_spec",
    issues,
  );
  assertNoIssues(resolvedEvidenceContract, issues);
  if (actionPlanBytes === undefined || captureSpecBytes === undefined) {
    throw new Error("unreachable resolved evidence reference state");
  }

  const actionPlan = parsePayload(
    parseActionPlan,
    actionPlanBytes,
    "/action_plan",
    issues,
  );
  const captureSpec = parsePayload(
    parseCaptureSpec,
    captureSpecBytes,
    "/capture_spec",
    issues,
  );

  if (actionPlan === undefined || captureSpec === undefined) {
    assertNoIssues(resolvedEvidenceContract, issues);
    throw new Error("unreachable resolved evidence payload state");
  }
  checkpointScheduleIssues(manifest, actionPlan, issues);
  assertNoIssues(resolvedEvidenceContract, issues);

  const resolveRole = (name: "baseline" | "candidate"): RawResolvedCheckpoint[] => {
    const resolved: RawResolvedCheckpoint[] = [];
    const inputs = input.pair[name];
    const references = manifest.pair[name].checkpoints;
    for (let index = 0; index < references.length; index += 1) {
      const checkpointInput = inputs[index];
      const reference = references[index];
      if (checkpointInput === undefined || reference === undefined) {
        throw new Error("unreachable resolved checkpoint binding state");
      }
      const checkpoint = resolveCheckpoint(
        checkpointInput,
        reference,
        `/pair/${name}/checkpoints/${index}`,
        resolver,
        issues,
      );
      assertNoIssues(resolvedEvidenceContract, issues);
      if (checkpoint === undefined) {
        throw new Error("unreachable resolved checkpoint reference state");
      }
      resolved.push(checkpoint);
    }
    return resolved;
  };

  const resolvedBaseline = resolveRole("baseline");
  const resolvedCandidate = resolveRole("candidate");
  const cache: DecodedPayloadCache = {
    screenshots: new Map(),
    accessibility: new Map(),
    layouts: new Map(),
  };

  const decodeRole = (
    name: "baseline" | "candidate",
    resolved: readonly RawResolvedCheckpoint[],
  ): readonly ResolvedCaptureCheckpoint[] => {
    const references = manifest.pair[name].checkpoints;
    const checkpoints: ResolvedCaptureCheckpoint[] = [];
    for (let index = 0; index < references.length; index += 1) {
      const checkpoint = resolved[index];
      const reference = references[index];
      if (checkpoint === undefined || reference === undefined) {
        throw new Error("unreachable resolved checkpoint decoding state");
      }
      const decoded = decodeCheckpoint(
        checkpoint,
        reference.screenshot,
        reference.accessibility_tree,
        reference.layout_graph,
        captureSpec.display.viewport,
        actionPlan,
        `/pair/${name}/checkpoints/${index}`,
        issues,
        cache,
      );
      assertNoIssues(resolvedEvidenceContract, issues);
      if (decoded === undefined) {
        throw new Error("unreachable resolved checkpoint payload state");
      }
      checkpoints.push(decoded);
    }
    return checkpoints;
  };

  const baseline = decodeRole("baseline", resolvedBaseline);
  const candidate = decodeRole("candidate", resolvedCandidate);

  return Object.freeze({
    manifest,
    action_plan: actionPlan,
    capture_spec: captureSpec,
    pair: Object.freeze({
      baseline: Object.freeze(baseline),
      candidate: Object.freeze(candidate),
    }),
  });
}

function parseMutationPlan(bytes: Buffer): MutationPlan {
  return validateMutationPlan(parseCanonicalJson(bytes, mutationLimits));
}

function parsePreconditionReport(bytes: Buffer): PreconditionReport {
  return validatePreconditionReport(parseCanonicalJson(bytes, mutationLimits));
}

function mutationBindingIssues(
  manifest: EvidenceManifest,
  record: SealedRecord,
  plan: MutationPlan,
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  for (const [field, actual, expected] of [
    ["source_state_id", plan.request.source_state_id, manifest.source_state_id],
    ["task_id", plan.request.task_id, manifest.task.task_id],
    [
      "environment_id",
      plan.request.environment_id,
      manifest.environment.environment_id,
    ],
  ] as const) {
    if (actual !== expected) {
      issues.push(
        issue(
          `resolved.request_${field}`,
          `/mutation_plan/request/${field}`,
          `mutation request ${field} must match the visible evidence manifest`,
        ),
      );
    }
  }

  for (const [field, actual, expected] of [
    ["family_id", plan.operator.family_id, record.intervention.family_id],
    ["operator_id", plan.operator.operator_id, record.intervention.operator_id],
    [
      "operator_version",
      plan.operator.operator_version,
      record.intervention.operator_version,
    ],
    ["instance_id", plan.instance_id, record.intervention.instance_id],
    [
      "expected_task_relation",
      plan.operator.expected_task_relation,
      record.intervention.expected_task_relation,
    ],
  ] as const) {
    if (actual !== expected) {
      issues.push(
        issue(
          `resolved.intervention_${field}`,
          `/sealed_record/intervention/${field}`,
          `sealed intervention ${field} must match the compiled mutation plan`,
        ),
      );
    }
  }
  return issues;
}

/**
 * Validates resolved sealed mutation provenance against one visible manifest.
 * This composes already-captured provenance; it does not independently recompute
 * the probe's task-relevance observation without a browser execution surface.
 */
export function validateResolvedInterventionBundle(
  value: unknown,
): ResolvedInterventionBundle {
  const issues: ContractIssue[] = [];
  const input = resolvedInterventionInput(value, issues);
  assertNoIssues(resolvedInterventionContract, issues);
  if (input === undefined) {
    throw new Error("unreachable resolved intervention input state");
  }

  const pair = validateEvidenceRecordPair(input.manifest, input.sealed_record);
  const resolver = new ArtifactResolver(interventionMaximumUniqueBytes);
  const mutationPlanBytes = resolver.resolve(
    input.mutation_plan,
    pair.sealedRecord.intervention.parameters,
    mutationPlanMediaType,
    "/sealed_record/intervention/parameters",
    issues,
  );
  const preconditionBytes = resolver.resolve(
    input.precondition_report,
    pair.sealedRecord.intervention.preconditions,
    preconditionMediaType,
    "/sealed_record/intervention/preconditions",
    issues,
  );
  assertNoIssues(resolvedInterventionContract, issues);
  if (mutationPlanBytes === undefined || preconditionBytes === undefined) {
    throw new Error("unreachable resolved intervention reference state");
  }

  const plan = parsePayload(
    parseMutationPlan,
    mutationPlanBytes,
    "/mutation_plan",
    issues,
  );
  const preconditions = parsePayload(
    parsePreconditionReport,
    preconditionBytes,
    "/precondition_report",
    issues,
  );
  let probe: SourceProbe | undefined;
  if (plan !== undefined && preconditions !== undefined) {
    try {
      probe = validateMutationCompilation(plan, preconditions).probe;
    } catch (error) {
      appendFailure(issues, "/", error);
    }
    issues.push(...mutationBindingIssues(pair.evidence, pair.sealedRecord, plan));
  }
  assertNoIssues(resolvedInterventionContract, issues);
  if (plan === undefined || preconditions === undefined || probe === undefined) {
    throw new Error("unreachable resolved intervention payload state");
  }

  // Re-encoding here is an explicit assertion that the accepted parsed values are
  // represented by exactly the bytes whose references were checked above.
  if (
    canonicalJson(plan) !== mutationPlanBytes.toString("utf8") ||
    canonicalJson(preconditions) !== preconditionBytes.toString("utf8")
  ) {
    throw new Error("unreachable noncanonical mutation payload state");
  }

  return Object.freeze({
    manifest: pair.evidence,
    sealed_record: pair.sealedRecord,
    mutation_plan: plan,
    precondition_report: preconditions,
    probe,
  });
}
