import { Buffer } from "node:buffer";

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const discoveredByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const discoveredBufferGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer",
)?.get;
const discoveredArrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
const arrayBufferResizableGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "resizable",
)?.get;

if (
  discoveredByteLengthGetter === undefined ||
  discoveredBufferGetter === undefined ||
  discoveredArrayBufferByteLengthGetter === undefined
) {
  throw new Error("required intrinsic byte-array getters are unavailable");
}
const byteLengthGetter: (this: Uint8Array) => number = discoveredByteLengthGetter;
const bufferGetter: (this: Uint8Array) => ArrayBufferLike = discoveredBufferGetter;
const arrayBufferByteLengthGetter: (this: ArrayBuffer) => number =
  discoveredArrayBufferByteLengthGetter;

function hasFixedArrayBufferBacking(value: Uint8Array): boolean {
  try {
    const backing = Reflect.apply(bufferGetter, value, []);
    // This intrinsic getter rejects SharedArrayBuffer and forged backing
    // objects. Shared memory is deliberately outside this stable snapshot
    // boundary because another thread can mutate it during validation.
    Reflect.apply(arrayBufferByteLengthGetter, backing, []);
    return (
      arrayBufferResizableGetter === undefined ||
      Reflect.apply(arrayBufferResizableGetter, backing, []) !== true
    );
  } catch {
    return false;
  }
}

/**
 * Reads a Uint8Array's internal byte length without consulting an overridable
 * instance property. Proxies and values without the Uint8Array internal slots
 * are rejected.
 */
export function intrinsicUint8ArrayByteLength(value: unknown): number | null {
  if (!(value instanceof Uint8Array) || !hasFixedArrayBufferBacking(value)) {
    return null;
  }
  try {
    const byteLength = Reflect.apply(byteLengthGetter, value, []) as unknown;
    return typeof byteLength === "number" && Number.isSafeInteger(byteLength)
      ? byteLength
      : null;
  } catch {
    return null;
  }
}

/**
 * Copies exactly the already-validated intrinsic byte length into a fresh,
 * fixed-size Buffer. A resizable view changing length during the copy fails
 * instead of widening the allocation or returning a partial snapshot.
 */
export function snapshotUint8Array(
  value: Uint8Array,
  expectedByteLength: number,
): Buffer {
  if (
    !Number.isSafeInteger(expectedByteLength) ||
    expectedByteLength < 0 ||
    intrinsicUint8ArrayByteLength(value) !== expectedByteLength
  ) {
    throw new TypeError("byte array length changed before snapshot");
  }

  const snapshot = Buffer.alloc(expectedByteLength);
  try {
    Uint8Array.prototype.set.call(snapshot, value);
  } catch (error) {
    throw new TypeError("byte array could not be copied into a fixed snapshot", {
      cause: error,
    });
  }
  if (intrinsicUint8ArrayByteLength(value) !== expectedByteLength) {
    throw new TypeError("byte array length changed during snapshot");
  }
  return snapshot;
}
