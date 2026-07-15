import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { deflateSync } from "node:zlib";

import { PNG } from "pngjs";

import { pngCodec } from "../src/artifacts/codecs.js";
import { ArtifactPayloadError } from "../src/artifacts/errors.js";
import { CanonicalPng, canonicalizePng } from "../src/artifacts/png.js";

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function chunk(type: string, data: Uint8Array = new Uint8Array()): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const payload = Buffer.from(data);
  const result = Buffer.alloc(12 + payload.length);
  result.writeUInt32BE(payload.length, 0);
  typeBytes.copy(result, 4);
  payload.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, result.length - 4)), result.length - 4);
  return result;
}

function insertBeforeIdat(png: Buffer, insertedChunk: Buffer): Buffer {
  let offset = signature.length;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") {
      return Buffer.concat([
        png.subarray(0, offset),
        insertedChunk,
        png.subarray(offset),
      ]);
    }
    offset += 12 + length;
  }
  throw new Error("fixture PNG has no IDAT chunk");
}

function insertBeforeIend(png: Buffer, insertedChunk: Buffer): Buffer {
  let offset = signature.length;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IEND") {
      return Buffer.concat([
        png.subarray(0, offset),
        insertedChunk,
        png.subarray(offset),
      ]);
    }
    offset += 12 + length;
  }
  throw new Error("fixture PNG has no IEND chunk");
}

function mutateIhdr(png: Buffer, mutation: (header: Buffer) => void): Buffer {
  const result = Buffer.from(png);
  const header = result.subarray(16, 29);
  mutation(header);
  result.writeUInt32BE(crc32(result.subarray(12, 29)), 29);
  return result;
}

function splitFirstIdat(png: Buffer): Buffer {
  let offset = signature.length;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") {
      assert.ok(length > 1);
      const data = png.subarray(offset + 8, offset + 8 + length);
      const midpoint = Math.floor(data.length / 2);
      return Buffer.concat([
        png.subarray(0, offset),
        chunk("IDAT", data.subarray(0, midpoint)),
        chunk("IDAT", data.subarray(midpoint)),
        png.subarray(offset + 12 + length),
      ]);
    }
    offset += 12 + length;
  }
  throw new Error("fixture PNG has no IDAT chunk");
}

function rgbaPng(
  width: number,
  height: number,
  pixels: readonly number[],
  options: {
    readonly deflateLevel?: number;
    readonly deflateStrategy?: number;
    readonly filterType?: number;
  } = {},
): Buffer {
  const png = new PNG({ width, height });
  png.data = Buffer.from(pixels);
  return PNG.sync.write(png, {
    colorType: 6,
    inputColorType: 6,
    inputHasAlpha: true,
    ...options,
  });
}

function indexedPng(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 3;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("PLTE", Buffer.from([255, 0, 0, 0, 255, 0])),
    chunk("IDAT", deflateSync(Buffer.from([0, 0, 1]))),
    chunk("IEND"),
  ]);
}

function expectPngError(input: Uint8Array, code: string): void {
  assert.throws(
    () => canonicalizePng(input),
    (error: unknown) => error instanceof ArtifactPayloadError && error.code === code,
  );
}

const opaquePixels = [
  255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
] as const;

test("canonical PNG bytes depend on decoded pixels, not encoder choices", () => {
  const first = rgbaPng(2, 2, opaquePixels, {
    deflateLevel: 1,
    deflateStrategy: 0,
    filterType: 0,
  });
  const second = rgbaPng(2, 2, opaquePixels, {
    deflateLevel: 9,
    deflateStrategy: 3,
    filterType: 4,
  });

  const expected = canonicalizePng(first);
  assert.deepEqual(canonicalizePng(second).bytes, expected.bytes);
  assert.deepEqual(canonicalizePng(splitFirstIdat(first)).bytes, expected.bytes);
  assert.deepEqual(canonicalizePng(expected.bytes).bytes, expected.bytes);
  assert.equal(
    createHash("sha256").update(expected.bytes).digest("hex"),
    "4ca3a70d8f6ce0be858cb9c2c22e26dd55e6b1e9dd72d4e288357f33d4ad582c",
  );
});

test("palette and RGBA encodings of the same pixels converge", () => {
  const rgba = rgbaPng(2, 1, [255, 0, 0, 255, 0, 255, 0, 255]);

  assert.deepEqual(canonicalizePng(indexedPng()).bytes, canonicalizePng(rgba).bytes);
});

test("valid indexed transparency converges with the same RGBA pixels", () => {
  const indexed = insertBeforeIdat(indexedPng(), chunk("tRNS", Buffer.from([0])));
  const rgba = rgbaPng(2, 1, [0, 0, 0, 0, 0, 255, 0, 255]);

  assert.deepEqual(canonicalizePng(indexed).bytes, canonicalizePng(rgba).bytes);
});

test("invisible RGB values cannot carry a covert channel", () => {
  const first = rgbaPng(1, 1, [12, 34, 56, 0]);
  const second = rgbaPng(1, 1, [210, 109, 8, 0]);

  assert.deepEqual(canonicalizePng(first).bytes, canonicalizePng(second).bytes);
});

test("ancillary metadata and private chunks are removed", () => {
  const source = rgbaPng(2, 2, opaquePixels);
  const expected = canonicalizePng(source).bytes;
  const canary = Buffer.from("sealed-outcome-canary", "utf8");
  const metadataChunks = [
    chunk("tEXt", Buffer.concat([Buffer.from("note\0"), canary])),
    chunk("zTXt", Buffer.concat([Buffer.from("note\0\0"), deflateSync(canary)])),
    chunk("iTXt", Buffer.concat([Buffer.from("note\0\0\0\0\0"), canary])),
    chunk("eXIf", canary),
    chunk("tIME", Buffer.from([0x07, 0xe8, 1, 2, 3, 4, 5])),
    chunk("iCCP", Buffer.concat([Buffer.from("profile\0\0"), deflateSync(canary)])),
    chunk("vpAg", canary),
  ];

  for (const metadata of metadataChunks) {
    const canonical = canonicalizePng(insertBeforeIdat(source, metadata)).bytes;
    assert.deepEqual(canonical, expected);
    assert.equal(canonical.includes(canary), false);
  }
});

test("malformed and active PNG structures fail closed", () => {
  const source = rgbaPng(2, 2, opaquePixels);
  const badSignature = Buffer.from(source);
  badSignature[0] = 0;
  expectPngError(badSignature, "png.signature");

  const badCrc = Buffer.from(source);
  const corruptedOffset = badCrc.length - 1;
  badCrc.writeUInt8(badCrc.readUInt8(corruptedOffset) ^ 1, corruptedOffset);
  expectPngError(badCrc, "png.crc");

  const privateChunk = chunk("vpAg", Buffer.from("canary"));
  privateChunk.writeUInt32BE(
    (privateChunk.readUInt32BE(privateChunk.length - 4) ^ 1) >>> 0,
    privateChunk.length - 4,
  );
  expectPngError(insertBeforeIdat(source, privateChunk), "png.crc");

  expectPngError(insertBeforeIdat(source, chunk("acTL", Buffer.alloc(8))), "png.apng");
  expectPngError(
    insertBeforeIdat(source, chunk("ABCD", Buffer.alloc(0))),
    "png.critical_chunk",
  );
  expectPngError(
    insertBeforeIdat(source, chunk("A[CD", Buffer.alloc(0))),
    "png.chunk_type",
  );
  expectPngError(
    insertBeforeIdat(source, chunk("vpag", Buffer.alloc(0))),
    "png.chunk_reserved_bit",
  );

  const indexed = indexedPng();
  const transparency = chunk("tRNS", Buffer.from([0]));
  const indexedWithTransparency = insertBeforeIdat(indexed, transparency);
  expectPngError(insertBeforeIdat(indexedWithTransparency, transparency), "png.trns");
  expectPngError(insertBeforeIend(indexed, transparency), "png.trns");
  expectPngError(Buffer.concat([source, Buffer.from("trailing")]), "png.trailing_data");

  const huge = mutateIhdr(source, (header) => header.writeUInt32BE(4_097, 0));
  expectPngError(huge, "png.dimensions");

  const tooManyPixels = mutateIhdr(source, (header) => {
    header.writeUInt32BE(2_049, 0);
    header.writeUInt32BE(2_049, 4);
  });
  expectPngError(tooManyPixels, "png.dimensions");

  const interlaced = mutateIhdr(source, (header) => {
    header[12] = 1;
  });
  expectPngError(interlaced, "png.interlace");

  const sixteenBit = mutateIhdr(source, (header) => {
    header[8] = 16;
  });
  expectPngError(sixteenBit, "png.bit_depth");

  const inflateBomb = Buffer.concat([
    source.subarray(0, 33),
    chunk("IDAT", deflateSync(Buffer.alloc(1_048_576))),
    chunk("IEND"),
  ]);
  expectPngError(inflateBomb, "png.inflate");

  let idatOffset = signature.length;
  while (source.subarray(idatOffset + 4, idatOffset + 8).toString("ascii") !== "IDAT") {
    idatOffset += 12 + source.readUInt32BE(idatOffset);
  }
  const excessiveChunks = Buffer.concat([
    source.subarray(0, idatOffset),
    ...Array.from({ length: 1_025 }, () => chunk("vpAg")),
    source.subarray(idatOffset),
  ]);
  expectPngError(excessiveChunks, "png.chunk_count");

  const shadowedLength = new Uint8Array(8_388_609);
  Object.defineProperty(shadowedLength, "byteLength", { value: 1 });
  expectPngError(shadowedLength, "png.byte_length");
});

test("capture dimensions are bound to the canonical payload", () => {
  const source = rgbaPng(2, 2, opaquePixels);
  const canonical = canonicalizePng(source, { width: 2, height: 2 });

  assert.equal(canonical.width, 2);
  assert.equal(canonical.height, 2);
  const callerCopy = canonical.bytes;
  callerCopy[0] = 0;
  assert.equal(canonical.bytes[0], signature[0]);
  assert.throws(
    () => canonicalizePng(source, { width: 2, height: 3 }),
    (error: unknown) =>
      error instanceof ArtifactPayloadError && error.code === "png.dimension_mismatch",
  );
});

test("CanonicalPng construction requires the module-private capability", () => {
  const source = rgbaPng(2, 2, opaquePixels);
  const RuntimeCanonicalPng = CanonicalPng as unknown as new (
    ...arguments_: readonly unknown[]
  ) => CanonicalPng;

  assert.throws(
    () => new RuntimeCanonicalPng(source, 2, 2),
    (error: unknown) =>
      error instanceof ArtifactPayloadError && error.code === "png.capability",
  );
  assert.throws(
    () => new RuntimeCanonicalPng(Symbol("guessed capability"), source, 2, 2),
    (error: unknown) =>
      error instanceof ArtifactPayloadError && error.code === "png.capability",
  );

  const canonical = canonicalizePng(source);
  assert.ok(canonical instanceof CanonicalPng);
  const callerCopy = canonical.bytes;
  callerCopy.fill(0);
  assert.notDeepEqual(canonical.bytes, callerCopy);
});

test("the production PNG codec canonicalizes and validates its bound dimensions", async () => {
  const codec = pngCodec({ width: 2, height: 2 });
  const source = rgbaPng(2, 2, opaquePixels, {
    deflateLevel: 1,
    filterType: 0,
  });
  const canonical = Buffer.from(await codec.canonicalize(source));
  const decoded = await codec.validate(canonical);

  assert.deepEqual(canonical, canonicalizePng(source, { width: 2, height: 2 }).bytes);
  assert.equal(decoded.width, 2);
  assert.equal(decoded.height, 2);
  await assert.rejects(
    async () => pngCodec({ width: 3, height: 2 }).validate(canonical),
    (error: unknown) =>
      error instanceof ArtifactPayloadError && error.code === "png.dimension_mismatch",
  );
});

test("the production PNG codec can bootstrap publication verification without dimensions", async () => {
  const image = rgbaPng(2, 1, [255, 0, 0, 255, 0, 0, 255, 255]);
  const codec = pngCodec();
  const canonical = await codec.canonicalize(image);
  const parsed = await codec.validate(Buffer.from(canonical));

  assert.equal(parsed.width, 2);
  assert.equal(parsed.height, 1);
});
