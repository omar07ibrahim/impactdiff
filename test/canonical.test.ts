import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  canonicalJson,
  canonicalSha256,
  CanonicalJsonError,
  computeCaptureId,
  computeCheckpointId,
  computeEnvironmentId,
  computeEvidenceId,
  computeFeatureProfileId,
  computeMutationFamilyGroupId,
  computeSealedRecordId,
  computeSourceStateGroupId,
  computeSourceStateId,
  computeSplitAuditId,
  computeSplitId,
  computeTaskId,
  parseCanonicalJson,
  JsonDataError,
  sha256Hex,
} from "../src/contracts/canonical.js";
import {
  actionPlan,
  captureSpec,
  evidence,
  familyId,
  grouping,
  sealedRecord,
  sourceState,
  splitAssignment,
  splitAudit,
} from "./fixtures.js";

const expectCanonicalError = (input: string | Uint8Array, code: string): void => {
  assert.throws(
    () => parseCanonicalJson(input),
    (error: unknown) => error instanceof CanonicalJsonError && error.code === code,
  );
};

const expectJsonDataError = (operation: () => unknown, code: string): void => {
  assert.throws(
    operation,
    (error: unknown) => error instanceof JsonDataError && error.code === code,
  );
};

test("canonical JSON is stable across object insertion order", () => {
  const first = { z: [true, null, 2], a: { beta: "β", alpha: 1 } };
  const second = { a: { alpha: 1, beta: "β" }, z: [true, null, 2] };

  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(canonicalSha256(first), canonicalSha256(second));
  assert.equal(
    canonicalJson(parseCanonicalJson(canonicalJson(first))),
    canonicalJson(first),
  );
  assert.ok(Object.isFrozen(parseCanonicalJson(canonicalJson(first))));
  assert.equal(
    sha256Hex("impactdiff"),
    sha256Hex(new TextEncoder().encode("impactdiff")),
  );
});

test("strict decoding rejects ambiguous JSON representations", () => {
  expectCanonicalError('{"a":1,"a":2}', "json.duplicate_key");
  expectCanonicalError('{ "a":1}', "json.noncanonical");
  expectCanonicalError('{"b":1,"a":2}', "json.noncanonical");
  expectCanonicalError('{"a":"\\u0061"}', "json.noncanonical");
  expectCanonicalError('{"a":1}x', "json.trailing_data");
  expectCanonicalError("\uFEFF{}", "json.bom");
});

test("strict decoding rejects invalid Unicode and UTF-8", () => {
  expectCanonicalError(new Uint8Array([0xff]), "json.utf8");
  expectCanonicalError('{"a":"\\ud800"}', "json.unpaired_surrogate");
  expectCanonicalError('{"a":"é"}', "json.non_nfc_string");

  const ResizableArrayBuffer = ArrayBuffer as unknown as new (
    byteLength: number,
    options: { readonly maxByteLength: number },
  ) => ArrayBuffer;
  const resizable = new Uint8Array(new ResizableArrayBuffer(2, { maxByteLength: 4 }));
  resizable.set(new TextEncoder().encode("{}"));
  expectCanonicalError(resizable, "json.input");

  const shared = new Uint8Array(new SharedArrayBuffer(2));
  shared.set(new TextEncoder().encode("{}"));
  expectCanonicalError(shared, "json.input");
});

test("contract numbers are exact safe integers", () => {
  expectCanonicalError("1.5", "json.non_integer_number");
  expectCanonicalError("-0", "json.non_integer_number");
  expectCanonicalError("9007199254740992", "json.non_integer_number");
  assert.equal(parseCanonicalJson("9007199254740991"), Number.MAX_SAFE_INTEGER);
});

test("decoder resource limits fail closed", () => {
  assert.throws(
    () => parseCanonicalJson('"abcdef"', { maximumBytes: 4 }),
    (error: unknown) =>
      error instanceof CanonicalJsonError && error.code === "json.byte_length",
  );
  assert.throws(
    () => parseCanonicalJson("[[0]]", { maximumDepth: 1 }),
    (error: unknown) =>
      error instanceof CanonicalJsonError && error.code === "json.depth",
  );
  assert.throws(
    () => parseCanonicalJson("[0,1]", { maximumValues: 2 }),
    (error: unknown) =>
      error instanceof CanonicalJsonError && error.code === "json.value_count",
  );

  const shadowedLength = new Uint8Array(5);
  shadowedLength.set(new TextEncoder().encode("null "));
  Object.defineProperty(shadowedLength, "byteLength", { value: 1 });
  assert.throws(
    () => parseCanonicalJson(shadowedLength, { maximumBytes: 4 }),
    (error: unknown) =>
      error instanceof CanonicalJsonError && error.code === "json.byte_length",
  );
});

test("decoder rejects malformed resource-limit overrides", () => {
  const invalidValues = [
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ] as const;

  for (const name of ["maximumBytes", "maximumDepth", "maximumValues"] as const) {
    for (const value of invalidValues) {
      const limits = { [name]: value } as unknown as Partial<
        import("../src/contracts/canonical.js").ParseLimits
      >;
      assert.throws(
        () => parseCanonicalJson("0", limits),
        (error: unknown) =>
          error instanceof CanonicalJsonError && error.code === "json.limit",
        `${name} accepted ${String(value)}`,
      );
    }
  }

  assert.equal(parseCanonicalJson("0", { maximumBytes: 1 }), 0);
  assert.equal(parseCanonicalJson("0", { maximumDepth: 1 }), 0);
  assert.equal(parseCanonicalJson("0", { maximumValues: 1 }), 0);
});

test("SHA-256 snapshots fixed byte views and rejects unstable backing memory", () => {
  const fixed = new TextEncoder().encode("impactdiff");
  Object.defineProperty(fixed, "byteLength", { value: 1 });
  assert.equal(
    sha256Hex(fixed),
    createHash("sha256").update("impactdiff").digest("hex"),
  );

  const shared = new Uint8Array(new SharedArrayBuffer(4));
  assert.throws(() => sha256Hex(shared), TypeError);

  const ResizableArrayBuffer = ArrayBuffer as unknown as new (
    byteLength: number,
    options: { readonly maxByteLength: number },
  ) => ArrayBuffer;
  const resizable = new Uint8Array(new ResizableArrayBuffer(4, { maxByteLength: 8 }));
  assert.throws(() => sha256Hex(resizable), TypeError);
});

test("domain-separated identities bind their canonical bodies", () => {
  assert.equal(computeEvidenceId(evidence), evidence.evidence_id);
  assert.equal(computeSealedRecordId(sealedRecord), sealedRecord.sealed_record_id);
  assert.equal(computeSplitId(splitAssignment), splitAssignment.split_id);
  assert.equal(computeSplitAuditId(splitAudit), splitAudit.split_audit_id);
  assert.equal(computeTaskId(actionPlan), evidence.task.task_id);
  assert.equal(computeEnvironmentId(captureSpec), evidence.environment.environment_id);
  assert.equal(computeFeatureProfileId(captureSpec), evidence.feature_profile_id);
  assert.equal(
    computeCheckpointId(actionPlan, 0),
    evidence.pair.baseline.checkpoints[0]!.checkpoint_id,
  );
  assert.equal(
    computeCaptureId(evidence.pair.baseline),
    evidence.pair.baseline.capture_id,
  );
  assert.equal(computeSourceStateId(sourceState), evidence.source_state_id);
  assert.notEqual(
    computeSourceStateId({ ...sourceState, sha256: "f".repeat(64) }),
    evidence.source_state_id,
  );
  assert.equal(
    computeSourceStateGroupId(evidence.source_state_id),
    grouping.source_state_group_id,
  );
  assert.equal(
    computeMutationFamilyGroupId(familyId),
    grouping.mutation_family_group_id,
  );

  assert.notEqual(
    computeTaskId(actionPlan).slice(6),
    computeEnvironmentId(actionPlan).slice(6),
  );
  assert.notEqual(
    computeEvidenceId({
      ...evidence,
      source_state_id: evidence.source_state_id.replace(/.$/u, "0"),
    }),
    evidence.evidence_id,
  );
});

test("canonical encoder rejects values outside the JSON data model", () => {
  assert.throws(() => canonicalJson(undefined), TypeError);
  expectJsonDataError(() => canonicalJson({ x: undefined }), "non_json_value");
  expectJsonDataError(() => canonicalJson([, 1]), "hidden_property");
  expectJsonDataError(() => canonicalJson(new Date(0)), "exotic_object");
  expectJsonDataError(() => canonicalJson({ x: 1.5 }), "non_integer_number");

  let invoked = false;
  expectJsonDataError(
    () =>
      canonicalJson({
        value: 1,
        toJSON: () => {
          invoked = true;
          return null;
        },
      }),
    "non_json_value",
  );
  assert.equal(invoked, false);
});

test("canonical encoder and decoder apply the same Unicode rules to keys", () => {
  expectJsonDataError(() => canonicalJson({ ["é"]: 1 }), "non_nfc_string");
  expectJsonDataError(
    () => canonicalJson({ [String.fromCharCode(0xd800)]: 1 }),
    "unpaired_surrogate",
  );
});
