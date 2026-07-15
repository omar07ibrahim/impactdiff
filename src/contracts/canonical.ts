import { createHash } from "node:crypto";

import canonicalize from "canonicalize";

import { intrinsicUint8ArrayByteLength, snapshotUint8Array } from "./byte-array.js";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export class JsonDataError extends TypeError {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(message);
    this.name = "JsonDataError";
    this.code = code;
    this.path = path;
  }
}

interface JsonCloneState {
  readonly seen: Set<object>;
}

function jsonDataFailure(code: string, path: string, message: string): never {
  throw new JsonDataError(code, path, message);
}

function assertJsonString(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        jsonDataFailure(
          "unpaired_surrogate",
          path,
          "strings cannot contain unpaired Unicode surrogates",
        );
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      jsonDataFailure(
        "unpaired_surrogate",
        path,
        "strings cannot contain unpaired Unicode surrogates",
      );
    }
  }

  if (value.normalize("NFC") !== value) {
    jsonDataFailure("non_nfc_string", path, "strings must use NFC normalization");
  }
}

function cloneJsonData(
  value: unknown,
  path: string,
  depth: number,
  state: JsonCloneState,
): JsonValue {
  if (depth > 32) {
    jsonDataFailure("depth", path, "maximum object depth exceeded");
  }
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    assertJsonString(value, path);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      jsonDataFailure(
        "non_integer_number",
        path,
        "numbers must be safe integers other than negative zero",
      );
    }
    return value;
  }
  if (typeof value !== "object") {
    jsonDataFailure("non_json_value", path, "values must contain only JSON data");
  }

  if (state.seen.has(value)) {
    jsonDataFailure("cycle", path, "values cannot be cyclic");
  }
  state.seen.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      jsonDataFailure(
        "exotic_array",
        path,
        "arrays must use the built-in Array prototype",
      );
    }
    if (value.length > 1_000_000) {
      jsonDataFailure(
        "array_length",
        path,
        "arrays cannot contain more than 1000000 items",
      );
    }
    if (
      Reflect.ownKeys(value).some(
        (key) =>
          typeof key !== "string" ||
          (key !== "length" && !/^(0|[1-9][0-9]*)$/u.test(key)),
      )
    ) {
      jsonDataFailure(
        "hidden_property",
        path,
        "arrays cannot carry symbol or named properties",
      );
    }

    const result: JsonValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        jsonDataFailure(
          "hidden_property",
          `${path}/${index}`,
          "arrays must be dense and contain enumerable data properties only",
        );
      }
      result.push(
        cloneJsonData(descriptor.value, `${path}/${index}`, depth + 1, state),
      );
    }
    state.seen.delete(value);
    return Object.freeze(result) as unknown as JsonValue[];
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    jsonDataFailure(
      "exotic_object",
      path,
      "objects must have Object.prototype or a null prototype",
    );
  }

  const result: { [key: string]: JsonValue } = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      jsonDataFailure(
        "hidden_property",
        path,
        "objects cannot carry symbol properties",
      );
    }
    assertJsonString(key, path);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      jsonDataFailure(
        "hidden_property",
        `${path}/${key}`,
        "objects must contain enumerable data properties only",
      );
    }
    Object.defineProperty(result, key, {
      configurable: false,
      enumerable: true,
      value: cloneJsonData(descriptor.value, `${path}/${key}`, depth + 1, state),
      writable: false,
    });
  }
  state.seen.delete(value);
  return Object.freeze(result) as { [key: string]: JsonValue };
}

export function normalizeJsonData(value: unknown): JsonValue {
  return cloneJsonData(value, "", 0, { seen: new Set<object>() });
}

export class CanonicalJsonError extends Error {
  readonly code: string;
  readonly offset: number;

  constructor(code: string, offset: number, message: string) {
    super(message);
    this.name = "CanonicalJsonError";
    this.code = code;
    this.offset = offset;
  }
}

export interface ParseLimits {
  readonly maximumBytes: number;
  readonly maximumDepth: number;
  readonly maximumValues: number;
}

const defaultLimits: ParseLimits = {
  maximumBytes: 131_072,
  maximumDepth: 32,
  maximumValues: 100_000,
};

function validateParseLimit(name: keyof ParseLimits, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CanonicalJsonError(
      "json.limit",
      0,
      `${name} must be a positive safe integer`,
    );
  }
  return value;
}

function resolveParseLimits(limits: Partial<ParseLimits>): ParseLimits {
  const resolved = { ...defaultLimits, ...limits };
  return Object.freeze({
    maximumBytes: validateParseLimit("maximumBytes", resolved.maximumBytes),
    maximumDepth: validateParseLimit("maximumDepth", resolved.maximumDepth),
    maximumValues: validateParseLimit("maximumValues", resolved.maximumValues),
  });
}

const isWhitespace = (character: string | undefined): boolean =>
  character === " " || character === "\n" || character === "\r" || character === "\t";

const isDigit = (character: string | undefined): boolean =>
  character !== undefined && character >= "0" && character <= "9";

const isHexDigit = (character: string | undefined): boolean =>
  character !== undefined && /[0-9A-Fa-f]/u.test(character);

class StrictJsonParser {
  readonly #input: string;
  readonly #limits: ParseLimits;
  #offset = 0;
  #values = 0;

  constructor(input: string, limits: ParseLimits) {
    this.#input = input;
    this.#limits = limits;
  }

  parse(): JsonValue {
    this.#skipWhitespace();
    const value = this.#parseValue(0);
    this.#skipWhitespace();
    if (this.#offset !== this.#input.length) {
      this.#fail("json.trailing_data", "trailing data after the JSON value");
    }
    return value;
  }

  #parseValue(depth: number): JsonValue {
    if (depth > this.#limits.maximumDepth) {
      this.#fail("json.depth", "maximum JSON depth exceeded");
    }
    this.#values += 1;
    if (this.#values > this.#limits.maximumValues) {
      this.#fail("json.value_count", "maximum JSON value count exceeded");
    }

    this.#skipWhitespace();
    const character = this.#input[this.#offset];
    if (character === "{") {
      return this.#parseObject(depth);
    }
    if (character === "[") {
      return this.#parseArray(depth);
    }
    if (character === '"') {
      return this.#parseString();
    }
    if (character === "t") {
      this.#consumeLiteral("true");
      return true;
    }
    if (character === "f") {
      this.#consumeLiteral("false");
      return false;
    }
    if (character === "n") {
      this.#consumeLiteral("null");
      return null;
    }
    if (character === "-" || isDigit(character)) {
      return this.#parseNumber();
    }
    this.#fail("json.syntax", "expected a JSON value");
  }

  #parseObject(depth: number): { [key: string]: JsonValue } {
    this.#offset += 1;
    this.#skipWhitespace();
    const result: { [key: string]: JsonValue } = Object.create(null) as {
      [key: string]: JsonValue;
    };
    const keys = new Set<string>();

    if (this.#input[this.#offset] === "}") {
      this.#offset += 1;
      return result;
    }

    while (true) {
      this.#skipWhitespace();
      if (this.#input[this.#offset] !== '"') {
        this.#fail("json.object_key", "object keys must be JSON strings");
      }
      const keyOffset = this.#offset;
      const key = this.#parseString();
      if (keys.has(key)) {
        throw new CanonicalJsonError(
          "json.duplicate_key",
          keyOffset,
          "duplicate object key",
        );
      }
      keys.add(key);

      this.#skipWhitespace();
      this.#expect(":");
      result[key] = this.#parseValue(depth + 1);
      this.#skipWhitespace();

      const separator = this.#input[this.#offset];
      if (separator === "}") {
        this.#offset += 1;
        return result;
      }
      this.#expect(",");
    }
  }

  #parseArray(depth: number): JsonValue[] {
    this.#offset += 1;
    this.#skipWhitespace();
    const result: JsonValue[] = [];
    if (this.#input[this.#offset] === "]") {
      this.#offset += 1;
      return result;
    }

    while (true) {
      result.push(this.#parseValue(depth + 1));
      this.#skipWhitespace();
      const separator = this.#input[this.#offset];
      if (separator === "]") {
        this.#offset += 1;
        return result;
      }
      this.#expect(",");
    }
  }

  #parseString(): string {
    const start = this.#offset;
    this.#offset += 1;

    while (this.#offset < this.#input.length) {
      const character = this.#input[this.#offset];
      if (character === '"') {
        this.#offset += 1;
        const literal = this.#input.slice(start, this.#offset);
        let decoded: unknown;
        try {
          decoded = JSON.parse(literal) as unknown;
        } catch {
          throw new CanonicalJsonError("json.string", start, "invalid JSON string");
        }
        if (typeof decoded !== "string") {
          throw new CanonicalJsonError("json.string", start, "invalid JSON string");
        }
        this.#checkUnicode(decoded, start);
        return decoded;
      }
      if (character === "\\") {
        this.#offset += 1;
        const escape = this.#input[this.#offset];
        if (
          escape !== '"' &&
          escape !== "\\" &&
          escape !== "/" &&
          escape !== "b" &&
          escape !== "f" &&
          escape !== "n" &&
          escape !== "r" &&
          escape !== "t" &&
          escape !== "u"
        ) {
          this.#fail("json.string_escape", "invalid JSON string escape");
        }
        if (escape === "u") {
          for (let index = 1; index <= 4; index += 1) {
            if (!isHexDigit(this.#input[this.#offset + index])) {
              this.#fail("json.unicode_escape", "invalid Unicode escape");
            }
          }
          this.#offset += 5;
        } else {
          this.#offset += 1;
        }
        continue;
      }
      if (character !== undefined && character.charCodeAt(0) < 0x20) {
        this.#fail("json.control_character", "unescaped control character");
      }
      this.#offset += 1;
    }

    throw new CanonicalJsonError(
      "json.unterminated_string",
      start,
      "unterminated JSON string",
    );
  }

  #checkUnicode(value: string, offset: number): void {
    for (let index = 0; index < value.length; index += 1) {
      const codeUnit = value.charCodeAt(index);
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) {
          throw new CanonicalJsonError(
            "json.unpaired_surrogate",
            offset,
            "unpaired Unicode surrogate",
          );
        }
        index += 1;
      } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        throw new CanonicalJsonError(
          "json.unpaired_surrogate",
          offset,
          "unpaired Unicode surrogate",
        );
      }
    }

    if (value.normalize("NFC") !== value) {
      throw new CanonicalJsonError(
        "json.non_nfc_string",
        offset,
        "JSON strings must use NFC normalization",
      );
    }
  }

  #parseNumber(): number {
    const start = this.#offset;
    if (this.#input[this.#offset] === "-") {
      this.#offset += 1;
    }

    if (this.#input[this.#offset] === "0") {
      this.#offset += 1;
      if (isDigit(this.#input[this.#offset])) {
        this.#fail("json.leading_zero", "numbers cannot have leading zeroes");
      }
    } else {
      if (!isDigit(this.#input[this.#offset])) {
        this.#fail("json.number", "invalid JSON number");
      }
      while (isDigit(this.#input[this.#offset])) {
        this.#offset += 1;
      }
    }

    if (this.#input[this.#offset] === ".") {
      this.#offset += 1;
      if (!isDigit(this.#input[this.#offset])) {
        this.#fail("json.number", "fraction requires a digit");
      }
      while (isDigit(this.#input[this.#offset])) {
        this.#offset += 1;
      }
    }

    const exponent = this.#input[this.#offset];
    if (exponent === "e" || exponent === "E") {
      this.#offset += 1;
      const sign = this.#input[this.#offset];
      if (sign === "+" || sign === "-") {
        this.#offset += 1;
      }
      if (!isDigit(this.#input[this.#offset])) {
        this.#fail("json.number", "exponent requires a digit");
      }
      while (isDigit(this.#input[this.#offset])) {
        this.#offset += 1;
      }
    }

    const token = this.#input.slice(start, this.#offset);
    const value = Number(token);
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new CanonicalJsonError(
        "json.non_integer_number",
        start,
        "contract JSON numbers must be safe integers other than negative zero",
      );
    }
    return value;
  }

  #consumeLiteral(literal: string): void {
    if (this.#input.slice(this.#offset, this.#offset + literal.length) !== literal) {
      this.#fail("json.literal", "invalid JSON literal");
    }
    this.#offset += literal.length;
  }

  #expect(expected: string): void {
    if (this.#input[this.#offset] !== expected) {
      this.#fail("json.syntax", `expected '${expected}'`);
    }
    this.#offset += 1;
  }

  #skipWhitespace(): void {
    while (isWhitespace(this.#input[this.#offset])) {
      this.#offset += 1;
    }
  }

  #fail(code: string, message: string): never {
    throw new CanonicalJsonError(code, this.#offset, message);
  }
}

function decodeUtf8(input: string | Uint8Array, maximumBytes: number): string {
  const byteLength =
    typeof input === "string"
      ? Buffer.byteLength(input, "utf8")
      : intrinsicUint8ArrayByteLength(input);
  if (byteLength === null) {
    throw new CanonicalJsonError(
      "json.input",
      0,
      "canonical JSON input must be a genuine byte array",
    );
  }
  if (byteLength > maximumBytes) {
    throw new CanonicalJsonError(
      "json.byte_length",
      0,
      `canonical JSON exceeds ${maximumBytes} bytes`,
    );
  }

  if (typeof input === "string") {
    return input;
  }

  try {
    const snapshot = snapshotUint8Array(input, byteLength);
    return new TextDecoder("utf-8", { fatal: true }).decode(snapshot);
  } catch {
    throw new CanonicalJsonError("json.utf8", 0, "invalid UTF-8 input");
  }
}

export function canonicalJson(value: unknown): string {
  const result = canonicalize(normalizeJsonData(value));
  if (result === undefined) {
    throw new TypeError("value is not representable as canonical JSON");
  }
  return result;
}

export function parseCanonicalJson(
  input: string | Uint8Array,
  limits: Partial<ParseLimits> = {},
): JsonValue {
  const resolvedLimits = resolveParseLimits(limits);
  const text = decodeUtf8(input, resolvedLimits.maximumBytes);
  if (text.startsWith("\uFEFF")) {
    throw new CanonicalJsonError("json.bom", 0, "a UTF-8 BOM is not allowed");
  }
  const value = new StrictJsonParser(text, resolvedLimits).parse();
  if (canonicalJson(value) !== text) {
    throw new CanonicalJsonError(
      "json.noncanonical",
      0,
      "JSON input is not in RFC 8785 canonical form",
    );
  }
  return normalizeJsonData(value);
}

export function sha256Hex(input: string | Uint8Array): string {
  if (typeof input === "string") {
    return createHash("sha256").update(input).digest("hex");
  }

  const byteLength = intrinsicUint8ArrayByteLength(input);
  if (byteLength === null) {
    throw new TypeError("SHA-256 input must be a fixed, unshared genuine byte array");
  }
  let snapshot: Buffer;
  try {
    snapshot = snapshotUint8Array(input, byteLength);
  } catch (error) {
    throw new TypeError("SHA-256 input could not be copied into a stable snapshot", {
      cause: error,
    });
  }
  return createHash("sha256").update(snapshot).digest("hex");
}

export function canonicalSha256(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

const domainDigest = (domain: string, body: unknown): string => {
  const hash = createHash("sha256");
  hash.update(domain, "utf8");
  hash.update("\0", "utf8");
  hash.update(canonicalJson(body), "utf8");
  return hash.digest("hex");
};

export function computeFeatureProfileId(captureSpec: unknown): string {
  return `idfp1_${domainDigest("impactdiff:feature-profile:v1", captureSpec)}`;
}

export function computeTaskId(actionPlan: unknown): string {
  return `idtk1_${domainDigest("impactdiff:task:v1", actionPlan)}`;
}

export function computeEnvironmentId(captureSpec: unknown): string {
  return `iden1_${domainDigest("impactdiff:environment:v1", captureSpec)}`;
}

export function computeCheckpointId(actionPlan: unknown, ordinal: number): string {
  return `idck1_${domainDigest("impactdiff:checkpoint:v1", {
    action_plan: actionPlan,
    ordinal,
  })}`;
}

export function computeCaptureId<
  const Capture extends { readonly capture_id: unknown },
>(capture: Capture): string {
  const { capture_id: excluded, ...body } = capture;
  void excluded;
  return `idcp1_${domainDigest("impactdiff:capture:v1", body)}`;
}

export function computeSourceStateId<
  const Manifest extends {
    readonly task: { readonly task_id: unknown };
    readonly environment: { readonly environment_id: unknown };
    readonly pair: { readonly baseline: unknown };
  },
>(manifest: Manifest): string {
  return `idss1_${domainDigest("impactdiff:source-state:v1", {
    environment_id: manifest.environment.environment_id,
    baseline: manifest.pair.baseline,
    task_id: manifest.task.task_id,
  })}`;
}

export function computeSourceStateGroupId(sourceStateId: unknown): string {
  return `idsg1_${domainDigest("impactdiff:source-state-group:v1", sourceStateId)}`;
}

export function computeMutationFamilyGroupId(familyId: unknown): string {
  return `idmg1_${domainDigest("impactdiff:mutation-family-group:v1", familyId)}`;
}

export function computeEvidenceId<
  const Manifest extends { readonly evidence_id: unknown },
>(manifest: Manifest): string {
  const { evidence_id: excluded, ...body } = manifest;
  void excluded;
  return `idev1_${domainDigest("impactdiff:evidence:v1", body)}`;
}

export function computeSealedRecordId<
  const RecordValue extends { readonly sealed_record_id: unknown },
>(record: RecordValue): string {
  const { sealed_record_id: excluded, ...body } = record;
  void excluded;
  return `idsr1_${domainDigest("impactdiff:sealed-record:v1", body)}`;
}

export function computeSplitId<const Assignment extends { readonly split_id: unknown }>(
  assignment: Assignment,
): string {
  const { split_id: excluded, ...body } = assignment;
  void excluded;
  return `idsp1_${domainDigest("impactdiff:split-assignment:v1", body)}`;
}

export function computeSplitAuditId<
  const Audit extends { readonly split_audit_id: unknown },
>(audit: Audit): string {
  const { split_audit_id: excluded, ...body } = audit;
  void excluded;
  return `idsa1_${domainDigest("impactdiff:split-audit:v1", body)}`;
}
