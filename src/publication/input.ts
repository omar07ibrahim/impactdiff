import { createHash } from "node:crypto";

import { validateArtifactReference } from "../artifacts/cas.js";
import { visibleArtifacts, sealedArtifacts } from "../contracts/artifacts.js";
import type { ArtifactRef } from "../contracts/artifacts.js";
import {
  intrinsicUint8ArrayByteLength,
  snapshotUint8Array,
} from "../contracts/byte-array.js";
import type { EvidenceManifest, SealedRecord } from "../contracts/schema.js";
import { validateEvidenceRecordPair } from "../contracts/validate.js";
import { PairedPublicationError } from "./errors.js";
import type { PairedPublicationCommit } from "./schema.js";
import { createPairedPublicationCommit } from "./validate.js";

const maximumVisibleArtifacts = 98;
const maximumSealedArtifacts = 11;
const maximumArtifactBytes = 8_388_608;

const releaseInputKeys = [
  "evidence",
  "sealed_record",
  "visible_artifacts",
  "sealed_artifacts",
] as const;
const artifactInputKeys = ["reference", "bytes"] as const;

interface InputRecord {
  readonly [key: string]: unknown;
}

export interface PairedReleaseArtifactInput {
  readonly reference: ArtifactRef;
  readonly bytes: Uint8Array;
}

export interface PairedReleaseInput {
  readonly evidence: EvidenceManifest;
  readonly sealed_record: SealedRecord;
  readonly visible_artifacts: readonly PairedReleaseArtifactInput[];
  readonly sealed_artifacts: readonly PairedReleaseArtifactInput[];
}

interface DeferredArtifactInput {
  readonly reference: ArtifactRef;
  readonly bytes: Uint8Array;
  readonly byteLength: number;
}

export interface SnapshottedPairedReleaseArtifact {
  readonly reference: ArtifactRef;
  readonly bytes: Buffer;
}

export interface SnapshottedPairedReleaseInput {
  readonly commit: PairedPublicationCommit;
  readonly evidence: EvidenceManifest;
  readonly sealedRecord: SealedRecord;
  readonly visibleArtifacts: readonly SnapshottedPairedReleaseArtifact[];
  readonly sealedArtifacts: readonly SnapshottedPairedReleaseArtifact[];
}

function fail(code: string, message: string, cause?: unknown): never {
  if (cause === undefined) {
    throw new PairedPublicationError(code, message);
  }
  throw new PairedPublicationError(code, message, { cause });
}

function closedRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): InputRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("publication.input_wrapper", `${path} must be a closed plain data object`);
  }

  let prototype: object | null;
  let ownKeys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    ownKeys = Reflect.ownKeys(value);
  } catch (error) {
    fail(
      "publication.input_wrapper",
      `${path} could not be inspected as a closed plain data object`,
      error,
    );
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail(
      "publication.input_wrapper_prototype",
      `${path} must use Object.prototype or a null prototype`,
    );
  }

  const expected = new Set(keys);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !expected.has(key))
  ) {
    fail(
      "publication.input_wrapper_fields",
      `${path} has unknown, hidden, or missing fields`,
    );
  }

  const result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (error) {
      fail(
        "publication.input_wrapper_descriptor",
        `${path}/${key} could not be inspected`,
        error,
      );
    }
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      fail(
        "publication.input_wrapper_descriptor",
        `${path}/${key} must be an enumerable data property`,
      );
    }
    result[key] = descriptor.value;
  }
  return result;
}

function denseArray(
  value: unknown,
  path: string,
  maximumLength: number,
): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail("publication.input_array", `${path} must be a built-in dense array`);
  }

  let prototype: object | null;
  let ownKeys: readonly PropertyKey[];
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    prototype = Object.getPrototypeOf(value);
    ownKeys = Reflect.ownKeys(value);
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  } catch (error) {
    fail(
      "publication.input_array",
      `${path} could not be inspected as a built-in dense array`,
      error,
    );
  }
  if (prototype !== Array.prototype) {
    fail(
      "publication.input_array_prototype",
      `${path} must use the built-in Array prototype`,
    );
  }
  if (
    lengthDescriptor === undefined ||
    lengthDescriptor.enumerable ||
    lengthDescriptor.configurable ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > maximumLength
  ) {
    fail(
      "publication.input_array_length",
      `${path} has an invalid or out-of-bounds length descriptor`,
    );
  }
  const length = lengthDescriptor.value;

  if (
    ownKeys.length !== length + 1 ||
    ownKeys.some(
      (key) =>
        key !== "length" &&
        (typeof key !== "string" ||
          !/^(0|[1-9][0-9]*)$/u.test(key) ||
          Number(key) >= length),
    )
  ) {
    fail(
      "publication.input_array_fields",
      `${path} must be dense and cannot carry named or symbol properties`,
    );
  }

  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch (error) {
      fail(
        "publication.input_array_descriptor",
        `${path}/${index} could not be inspected`,
        error,
      );
    }
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      fail(
        "publication.input_array_descriptor",
        `${path}/${index} must be an enumerable data property`,
      );
    }
    result.push(descriptor.value);
  }
  return result;
}

function sameReference(left: ArtifactRef, right: ArtifactRef): boolean {
  return (
    left.sha256 === right.sha256 &&
    left.byte_length === right.byte_length &&
    left.media_type === right.media_type &&
    left.format_version === right.format_version
  );
}

function validatedReference(value: unknown, path: string): ArtifactRef {
  try {
    return validateArtifactReference(value, maximumArtifactBytes);
  } catch (error) {
    fail(
      "publication.input_reference",
      `${path} is not a valid artifact reference`,
      error,
    );
  }
}

function uniqueExpectedReferences(
  references: readonly ArtifactRef[],
  path: string,
  maximumLength: number,
): ReadonlyMap<string, ArtifactRef> {
  const expected = new Map<string, ArtifactRef>();
  for (let index = 0; index < references.length; index += 1) {
    const reference = validatedReference(references[index], `${path}/${index}`);
    const prior = expected.get(reference.sha256);
    if (prior !== undefined && !sameReference(prior, reference)) {
      fail(
        "publication.expected_metadata_conflict",
        `${path} binds one digest to conflicting artifact metadata`,
      );
    }
    if (prior === undefined) {
      expected.set(reference.sha256, reference);
    }
  }
  if (expected.size > maximumLength) {
    fail(
      "publication.expected_artifact_count",
      `${path} exceeds the supported unique-artifact bound`,
    );
  }
  return expected;
}

function deferredArtifacts(
  value: unknown,
  expected: ReadonlyMap<string, ArtifactRef>,
  path: string,
  maximumLength: number,
): ReadonlyMap<string, DeferredArtifactInput> {
  const entries = denseArray(value, path, maximumLength);
  const supplied = new Map<string, DeferredArtifactInput>();
  for (let index = 0; index < entries.length; index += 1) {
    const entryPath = `${path}/${index}`;
    const record = closedRecord(entries[index], artifactInputKeys, entryPath);
    const reference = validatedReference(record.reference, `${entryPath}/reference`);
    const prior = supplied.get(reference.sha256);
    if (prior !== undefined) {
      if (!sameReference(prior.reference, reference)) {
        fail(
          "publication.input_metadata_conflict",
          `${path} supplies conflicting metadata for one digest`,
        );
      }
      fail(
        "publication.input_duplicate_artifact",
        `${path} supplies one digest more than once`,
      );
    }

    const expectedReference = expected.get(reference.sha256);
    if (expectedReference === undefined) {
      fail(
        "publication.input_unexpected_artifact",
        `${entryPath}/reference does not occur in the canonical record`,
      );
    }
    if (!sameReference(reference, expectedReference)) {
      fail(
        "publication.input_reference_mismatch",
        `${entryPath}/reference metadata does not match the canonical record`,
      );
    }

    const byteLength = intrinsicUint8ArrayByteLength(record.bytes);
    if (byteLength === null) {
      fail(
        "publication.input_bytes",
        `${entryPath}/bytes must be a genuine fixed, unshared Uint8Array`,
      );
    }
    if (byteLength !== expectedReference.byte_length) {
      fail(
        "publication.input_byte_length",
        `${entryPath}/bytes does not match the canonical byte length`,
      );
    }
    supplied.set(
      reference.sha256,
      Object.freeze({
        reference: expectedReference,
        bytes: record.bytes as Uint8Array,
        byteLength,
      }),
    );
  }

  for (const digest of expected.keys()) {
    if (!supplied.has(digest)) {
      fail(
        "publication.input_missing_artifact",
        `${path} is missing an artifact required by the canonical record`,
      );
    }
  }
  return supplied;
}

function immutableArtifact(
  reference: ArtifactRef,
  bytes: Buffer,
): SnapshottedPairedReleaseArtifact {
  const privateBytes = Buffer.from(bytes);
  const artifact = {} as SnapshottedPairedReleaseArtifact;
  Object.defineProperties(artifact, {
    reference: {
      configurable: false,
      enumerable: true,
      value: reference,
      writable: false,
    },
    bytes: {
      configurable: false,
      enumerable: true,
      get: () => Buffer.from(privateBytes),
    },
  });
  return Object.freeze(artifact);
}

function snapshotArtifacts(
  deferred: ReadonlyMap<string, DeferredArtifactInput>,
  expected: ReadonlyMap<string, ArtifactRef>,
  path: string,
): readonly SnapshottedPairedReleaseArtifact[] {
  const result: SnapshottedPairedReleaseArtifact[] = [];
  for (const [digest, expectedReference] of expected) {
    const input = deferred.get(digest);
    if (input === undefined) {
      fail(
        "publication.input_missing_artifact",
        `${path} is missing an artifact required by the canonical record`,
      );
    }

    let bytes: Buffer;
    try {
      bytes = snapshotUint8Array(input.bytes, input.byteLength);
    } catch (error) {
      fail(
        "publication.input_unstable_bytes",
        `${path} contains bytes that could not be copied into a stable snapshot`,
        error,
      );
    }
    if (bytes.byteLength !== expectedReference.byte_length) {
      fail(
        "publication.input_byte_length",
        `${path} contains bytes with a changed byte length`,
      );
    }
    if (createHash("sha256").update(bytes).digest("hex") !== digest) {
      fail(
        "publication.input_digest",
        `${path} contains bytes that do not match their canonical digest`,
      );
    }
    result.push(immutableArtifact(expectedReference, bytes));
  }
  return Object.freeze(result);
}

/**
 * Validates and owns every byte needed by a paired release before publication
 * performs its first asynchronous operation.
 */
export function snapshotPairedReleaseInput(
  value: unknown,
): SnapshottedPairedReleaseInput {
  const input = closedRecord(value, releaseInputKeys, "/");

  let pair: ReturnType<typeof validateEvidenceRecordPair>;
  try {
    pair = validateEvidenceRecordPair(input.evidence, input.sealed_record);
  } catch (error) {
    fail(
      "publication.input_record_pair",
      "visible and sealed records do not form a valid canonical pair",
      error,
    );
  }

  const expectedVisible = uniqueExpectedReferences(
    visibleArtifacts(pair.evidence),
    "/visible_artifacts",
    maximumVisibleArtifacts,
  );
  const expectedSealed = uniqueExpectedReferences(
    sealedArtifacts(pair.sealedRecord),
    "/sealed_artifacts",
    maximumSealedArtifacts,
  );
  for (const digest of expectedVisible.keys()) {
    if (expectedSealed.has(digest)) {
      fail(
        "publication.input_artifact_overlap",
        "visible and sealed records cannot share an artifact digest",
      );
    }
  }

  const visible = deferredArtifacts(
    input.visible_artifacts,
    expectedVisible,
    "/visible_artifacts",
    maximumVisibleArtifacts,
  );
  const sealed = deferredArtifacts(
    input.sealed_artifacts,
    expectedSealed,
    "/sealed_artifacts",
    maximumSealedArtifacts,
  );
  const visibleSnapshots = snapshotArtifacts(
    visible,
    expectedVisible,
    "/visible_artifacts",
  );
  const sealedSnapshots = snapshotArtifacts(
    sealed,
    expectedSealed,
    "/sealed_artifacts",
  );

  let commit: PairedPublicationCommit;
  try {
    commit = createPairedPublicationCommit(pair.evidence, pair.sealedRecord);
  } catch (error) {
    fail(
      "publication.input_commit",
      "paired publication commit could not be derived from canonical records",
      error,
    );
  }

  return Object.freeze({
    commit,
    evidence: pair.evidence,
    sealedRecord: pair.sealedRecord,
    visibleArtifacts: visibleSnapshots,
    sealedArtifacts: sealedSnapshots,
  });
}
