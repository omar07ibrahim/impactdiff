import { inflateSync } from "node:zlib";

import { PNG } from "pngjs";

import {
  maximumCaptureDimension,
  maximumCapturePixels,
  maximumCapturePngBytes,
} from "../capture/limits.js";
import {
  intrinsicUint8ArrayByteLength,
  snapshotUint8Array,
} from "../contracts/byte-array.js";
import { ArtifactPayloadError } from "./errors.js";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const maximumChunks = 1_024;
const allowedCriticalChunks = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);

export class CanonicalPng {
  readonly width: number;
  readonly height: number;
  readonly #bytes: Buffer;

  constructor(bytes: Uint8Array, width: number, height: number) {
    const byteLength = intrinsicUint8ArrayByteLength(bytes);
    if (byteLength === null || byteLength < 1 || byteLength > maximumCapturePngBytes) {
      fail("png.byte_length", `PNG exceeds ${maximumCapturePngBytes} bytes`);
    }
    try {
      this.#bytes = snapshotUint8Array(bytes, byteLength);
    } catch (error) {
      fail("png.input", "PNG input could not be copied into a stable snapshot", {
        cause: error,
      });
    }
    this.width = width;
    this.height = height;
    Object.freeze(this);
  }

  get bytes(): Buffer {
    return Buffer.from(this.#bytes);
  }
}

interface PngChunk {
  readonly type: string;
  readonly length: number;
}

interface PngScan {
  readonly width: number;
  readonly height: number;
  readonly colorType: 2 | 3 | 6;
  readonly expectedInflatedBytes: number;
  readonly idatParts: readonly Buffer[];
  readonly idatBytes: number;
  readonly chunks: readonly PngChunk[];
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb8_8320 : 0);
  }
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    const tableValue = crcTable[(crc ^ byte) & 0xff];
    if (tableValue === undefined) {
      fail("png.crc", "PNG CRC table lookup failed");
    }
    crc = (crc >>> 8) ^ tableValue;
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function fail(code: string, message: string, options?: ErrorOptions): never {
  throw new ArtifactPayloadError(code, message, options);
}

function scanPng(bytes: Buffer): PngScan {
  if (bytes.length > maximumCapturePngBytes) {
    fail("png.byte_length", `PNG exceeds ${maximumCapturePngBytes} bytes`);
  }
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(pngSignature)) {
    fail("png.signature", "invalid PNG signature");
  }

  const chunks: PngChunk[] = [];
  let offset = 8;
  let width: number | undefined;
  let height: number | undefined;
  let colorType: 2 | 3 | 6 | undefined;
  let sawPlte = false;
  let paletteEntries = 0;
  let sawTrns = false;
  let sawIdat = false;
  let leftIdatSequence = false;
  let sawIend = false;
  const idatParts: Buffer[] = [];
  let idatBytes = 0;

  while (offset < bytes.length) {
    if (bytes.length - offset < 12) {
      fail("png.truncated_chunk", "truncated PNG chunk header");
    }
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (!Number.isSafeInteger(end) || end > bytes.length) {
      fail("png.truncated_chunk", "PNG chunk exceeds the input boundary");
    }
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    if (
      [...typeBytes].some(
        (value) => !((value >= 65 && value <= 90) || (value >= 97 && value <= 122)),
      )
    ) {
      fail("png.chunk_type", "PNG chunk type is not alphabetic ASCII");
    }
    const type = typeBytes.toString("ascii");
    const reservedByte = typeBytes[2];
    if (reservedByte === undefined || reservedByte < 65 || reservedByte > 90) {
      fail("png.chunk_reserved_bit", "PNG chunk type has a lowercase reserved byte");
    }
    chunks.push({ type, length });
    if (chunks.length > maximumChunks) {
      fail("png.chunk_count", `PNG exceeds ${maximumChunks} chunks`);
    }
    const expectedCrc = bytes.readUInt32BE(end - 4);
    const actualCrc = crc32(bytes.subarray(offset + 4, end - 4));
    if (actualCrc !== expectedCrc) {
      fail("png.crc", `PNG chunk ${type} has an invalid CRC`);
    }

    if (chunks.length === 1) {
      if (type !== "IHDR" || length !== 13) {
        fail("png.ihdr", "IHDR must be the first chunk and contain 13 bytes");
      }
      width = bytes.readUInt32BE(offset + 8);
      height = bytes.readUInt32BE(offset + 12);
      const bitDepth = bytes[offset + 16];
      const parsedColorType = bytes[offset + 17];
      const compressionMethod = bytes[offset + 18];
      const filterMethod = bytes[offset + 19];
      const interlaceMethod = bytes[offset + 20];
      if (
        width === 0 ||
        height === 0 ||
        width > maximumCaptureDimension ||
        height > maximumCaptureDimension ||
        width * height > maximumCapturePixels
      ) {
        fail("png.dimensions", "PNG dimensions exceed the decoder budget");
      }
      if (bitDepth !== 8) {
        fail("png.bit_depth", "capture PNGs must use eight-bit channels or indexes");
      }
      if (parsedColorType !== 2 && parsedColorType !== 3 && parsedColorType !== 6) {
        fail("png.color_type", "capture PNG uses an unsupported color type");
      }
      colorType = parsedColorType;
      if (compressionMethod !== 0 || filterMethod !== 0) {
        fail(
          "png.ihdr_method",
          "capture PNG uses an unsupported compression or filter method",
        );
      }
      if (interlaceMethod !== 0) {
        fail("png.interlace", "interlaced PNGs are not accepted for capture evidence");
      }
    } else if (type === "IHDR") {
      fail("png.duplicate_ihdr", "PNG can contain exactly one IHDR chunk");
    }

    if (type === "acTL" || type === "fcTL" || type === "fdAT") {
      fail("png.apng", "animated PNG chunks are not supported");
    }
    const critical = type.charCodeAt(0) >= 65 && type.charCodeAt(0) <= 90;
    if (critical && !allowedCriticalChunks.has(type)) {
      fail("png.critical_chunk", `unsupported critical PNG chunk ${type}`);
    }
    if (type === "PLTE") {
      if (
        sawPlte ||
        sawTrns ||
        sawIdat ||
        length === 0 ||
        length > 768 ||
        length % 3 !== 0
      ) {
        fail("png.plte", "PNG contains an invalid PLTE chunk");
      }
      sawPlte = true;
      paletteEntries = length / 3;
    }
    if (type === "tRNS") {
      if (sawTrns || sawIdat || colorType === 6) {
        fail("png.trns", "PNG contains an invalid or misplaced tRNS chunk");
      }
      if (colorType === 3 && (!sawPlte || length < 1 || length > paletteEntries)) {
        fail("png.trns", "indexed PNG transparency must follow and fit its palette");
      }
      if (colorType === 2) {
        if (length !== 6) {
          fail("png.trns", "truecolor PNG transparency must contain three samples");
        }
        for (
          let sampleOffset = offset + 8;
          sampleOffset < offset + 14;
          sampleOffset += 2
        ) {
          if (bytes.readUInt16BE(sampleOffset) > 255) {
            fail("png.trns", "truecolor transparency samples exceed eight-bit depth");
          }
        }
      }
      sawTrns = true;
    }
    if (type === "IDAT") {
      if (sawIend || leftIdatSequence) {
        fail("png.chunk_order", "PNG IDAT chunks must be consecutive");
      }
      sawIdat = true;
      idatParts.push(bytes.subarray(offset + 8, offset + 8 + length));
      idatBytes += length;
    } else if (sawIdat && type !== "IEND") {
      leftIdatSequence = true;
    }
    if (type === "IEND") {
      if (length !== 0 || sawIend) {
        fail("png.iend", "PNG must contain one empty IEND chunk");
      }
      sawIend = true;
      if (end !== bytes.length) {
        fail("png.trailing_data", "bytes are present after IEND");
      }
    }

    offset = end;
  }

  if (
    !sawIdat ||
    !sawIend ||
    width === undefined ||
    height === undefined ||
    colorType === undefined
  ) {
    fail("png.incomplete", "PNG is missing required critical chunks");
  }
  if (colorType === 3 && !sawPlte) {
    fail("png.plte", "indexed PNGs must contain a palette before IDAT");
  }
  const channels = colorType === 2 ? 3 : colorType === 3 ? 1 : 4;
  const expectedInflatedBytes = height * (1 + width * channels);
  return {
    width,
    height,
    colorType,
    expectedInflatedBytes,
    idatParts,
    idatBytes,
    chunks,
  };
}

function decodePng(bytes: Buffer): PNG {
  try {
    return PNG.sync.read(bytes, { checkCRC: true, skipRescale: false });
  } catch (error) {
    fail("png.decode", "PNG decoding failed", { cause: error });
  }
}

function assertBoundedInflate(scan: PngScan): void {
  const compressed = Buffer.concat(scan.idatParts, scan.idatBytes);
  let inflated: Buffer;
  try {
    inflated = inflateSync(compressed, {
      maxOutputLength: scan.expectedInflatedBytes,
    });
  } catch (error) {
    fail("png.inflate", "PNG pixel stream exceeds its exact decoded budget", {
      cause: error,
    });
  }
  if (inflated.length !== scan.expectedInflatedBytes) {
    fail("png.inflate_length", "PNG pixel stream has an unexpected decoded length");
  }
}

function normalizeTransparentPixels(data: Buffer): void {
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
    }
  }
}

export function canonicalizePng(
  input: Uint8Array,
  expectedDimensions?: { readonly width: number; readonly height: number },
): CanonicalPng {
  const inputByteLength = intrinsicUint8ArrayByteLength(input);
  if (inputByteLength === null) {
    fail("png.input", "PNG input must be a byte array");
  }
  if (inputByteLength > maximumCapturePngBytes) {
    fail("png.byte_length", `PNG exceeds ${maximumCapturePngBytes} bytes`);
  }
  let source: Buffer;
  try {
    source = snapshotUint8Array(input, inputByteLength);
  } catch (error) {
    fail("png.input", "PNG input could not be copied into a stable snapshot", {
      cause: error,
    });
  }
  const header = scanPng(source);
  if (
    expectedDimensions !== undefined &&
    (header.width !== expectedDimensions.width ||
      header.height !== expectedDimensions.height)
  ) {
    fail(
      "png.dimension_mismatch",
      "PNG dimensions do not match the capture specification",
    );
  }
  assertBoundedInflate(header);

  const decoded = decodePng(source);
  if (
    decoded.width !== header.width ||
    decoded.height !== header.height ||
    decoded.data.length !== decoded.width * decoded.height * 4
  ) {
    fail("png.decoded_shape", "decoded PNG shape is inconsistent with IHDR");
  }

  const pixels = Buffer.from(decoded.data);
  normalizeTransparentPixels(pixels);
  const normalized = new PNG({ width: decoded.width, height: decoded.height });
  normalized.data = pixels;
  const bytes = PNG.sync.write(normalized, {
    bitDepth: 8,
    colorType: 6,
    deflateChunkSize: 32_768,
    deflateLevel: 9,
    deflateStrategy: 3,
    filterType: 4,
    inputColorType: 6,
    inputHasAlpha: true,
  });
  const canonicalHeader = scanPng(bytes);
  if (
    canonicalHeader.chunks.some(
      ({ type }) => type !== "IHDR" && type !== "IDAT" && type !== "IEND",
    )
  ) {
    fail("png.encoder_chunk", "canonical encoder emitted an unexpected chunk");
  }

  return new CanonicalPng(bytes, decoded.width, decoded.height);
}
