import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import type { BigIntStats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path";

import type { ArtifactRef } from "../contracts/artifacts.js";
import {
  intrinsicUint8ArrayByteLength,
  snapshotUint8Array,
} from "../contracts/byte-array.js";
import { ImmutableMapView } from "../contracts/immutable-map.js";
import { ArtifactStoreError } from "./errors.js";

const sha256Pattern = /^[0-9a-f]{64}$/u;
const mediaTypePattern =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/u;
const shardPattern = /^[0-9a-f]{2}$/u;
const defaultMaximumArtifactBytes = 8_388_608;
const artifactKeys = ["byte_length", "format_version", "media_type", "sha256"] as const;
const privateDirectoryMode = 0o700;
const immutableLeafMode = 0o400;

interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
}

interface VerifiedArtifact {
  readonly bytes: Buffer;
  readonly stats: BigIntStats;
}

interface RegisteredCodec<T = unknown> {
  readonly source: ArtifactCodec<T>;
  readonly mediaType: string;
  readonly maximumBytes: number;
  readonly canonicalize: ArtifactCodec<T>["canonicalize"];
  readonly validate: ArtifactCodec<T>["validate"];
}

/**
 * The only supported v1 deployment boundary. A store is private, owned by this
 * process' uid, and all mutation happens through one ArtifactStore instance in
 * the same process. The instance serializes publication. External processes,
 * additional same-uid writers, and hostile concurrent filesystem mutation are
 * explicitly out of scope; those require an openat2/renameat2-backed helper and
 * inter-process locking rather than Node path APIs.
 */
export const ARTIFACT_STORE_V1_THREAT_MODEL = Object.freeze({
  ownership: "private process-owned staging root",
  writers: "one same-process ArtifactStore instance",
  unsupportedMutators: "external processes and additional same-uid writers",
});

/**
 * A codec is the authority for one artifact media type. canonicalize may turn a
 * raw input into canonical bytes; validate must reject malformed canonical
 * bytes. Both resolve and audit run canonicalize again and demand byte equality.
 */
export interface ArtifactCodec<T> {
  readonly mediaType: string;
  readonly maximumBytes: number;
  readonly canonicalize: (bytes: Buffer) => Uint8Array | Promise<Uint8Array>;
  readonly validate: (canonicalBytes: Buffer) => T | Promise<T>;
}

/** @deprecated Use ArtifactCodec. */
export type ArtifactDecoder<T> = ArtifactCodec<T>;

export interface ArtifactAuditEntry {
  readonly sha256: string;
  readonly byteLength: number;
  readonly device: bigint;
  readonly inode: bigint;
}

export interface ArtifactStoreAudit {
  readonly rootPath: string;
  readonly entries: ReadonlyMap<string, ArtifactAuditEntry>;
}

function fail(code: string, message: string, options?: ErrorOptions): never {
  throw new ArtifactStoreError(code, message, options);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function validateDigest(value: unknown): string {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    fail("cas.digest", "artifact digest must be 64 lowercase hexadecimal characters");
  }
  return value;
}

function validateMediaType(value: unknown): string {
  if (typeof value !== "string" || !mediaTypePattern.test(value)) {
    fail("cas.media_type", "artifact media type is not a bounded lowercase MIME type");
  }
  return value;
}

function validateMaximumBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail("cas.byte_budget", "artifact byte budget must be a positive safe integer");
  }
  return value;
}

function currentUid(): bigint {
  if (process.getuid === undefined) {
    fail(
      "cas.platform",
      "artifact stores require a platform with numeric uid ownership",
    );
  }
  return BigInt(process.getuid());
}

export function validateArtifactReference(
  input: unknown,
  maximumBytes = defaultMaximumArtifactBytes,
): ArtifactRef {
  const byteBudget = validateMaximumBytes(maximumBytes);
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("cas.reference", "artifact reference must be a closed data object");
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("cas.reference", "artifact reference must use a data-only prototype");
  }

  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== artifactKeys.length ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        !artifactKeys.includes(key as (typeof artifactKeys)[number]),
    )
  ) {
    fail("cas.reference", "artifact reference contains unknown or missing fields");
  }
  for (const key of artifactKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      fail(
        "cas.reference",
        "artifact reference fields must be enumerable data properties",
      );
    }
  }

  const record = input as Record<(typeof artifactKeys)[number], unknown>;
  const digest = validateDigest(record.sha256);
  const byteLength = record.byte_length;
  if (
    typeof byteLength !== "number" ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 1 ||
    byteLength > byteBudget
  ) {
    fail("cas.byte_length", "artifact byte length exceeds its declared budget");
  }
  const mediaType = validateMediaType(record.media_type);
  if (record.format_version !== 1) {
    fail("cas.format_version", "artifact format version must be 1");
  }

  return Object.freeze({
    sha256: digest,
    byte_length: byteLength,
    media_type: mediaType,
    format_version: 1,
  });
}

function artifactPath(rootPath: string, digest: string): string {
  return join(rootPath, "sha256", digest.slice(0, 2), digest);
}

function assertOwnedMode(
  stats: BigIntStats,
  expectedMode: number,
  ownerCode: string,
  modeCode: string,
  kind: string,
): void {
  if (stats.uid !== currentUid()) {
    fail(ownerCode, `${kind} must belong to the current process uid`);
  }
  if ((stats.mode & 0o7777n) !== BigInt(expectedMode)) {
    fail(modeCode, `${kind} must have mode ${expectedMode.toString(8)}`);
  }
}

async function inspectPrivateDirectory(
  path: string,
  code: string,
): Promise<BigIntStats> {
  let stats: BigIntStats;
  try {
    stats = await lstat(path, { bigint: true });
  } catch (error) {
    fail(code, "artifact store directory cannot be inspected", { cause: error });
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    fail(code, "artifact store path must be a real directory");
  }
  assertOwnedMode(
    stats,
    privateDirectoryMode,
    `${code}_owner`,
    `${code}_permissions`,
    "artifact store directory",
  );
  return stats;
}

async function syncDirectory(path: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    const pathStats = await inspectPrivateDirectory(path, "cas.directory_sync");
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const handleStats = await handle.stat({ bigint: true });
    if (pathStats.dev !== handleStats.dev || pathStats.ino !== handleStats.ino) {
      fail("cas.directory_sync", "artifact directory changed while opening for sync");
    }
    await handle.sync();
  } catch (error) {
    if (error instanceof ArtifactStoreError) {
      throw error;
    }
    fail("cas.directory_sync", "artifact store directory sync failed", {
      cause: error,
    });
  } finally {
    await handle?.close();
  }
}

async function ensurePrivateDirectory(path: string, parent: string): Promise<void> {
  let created = false;
  try {
    await mkdir(path, { mode: privateDirectoryMode });
    created = true;
  } catch (error) {
    if (errorCode(error) !== "EEXIST") {
      fail("cas.mkdir", "artifact store directory cannot be created", {
        cause: error,
      });
    }
  }
  await inspectPrivateDirectory(path, "cas.directory");
  if (created) {
    // Persist the empty child before persisting its name in the parent.
    await syncDirectory(path);
    await syncDirectory(parent);
  }
}

function sameFileState(first: BigIntStats, second: BigIntStats): boolean {
  return (
    first.dev === second.dev &&
    first.ino === second.ino &&
    first.size === second.size &&
    first.mode === second.mode &&
    first.uid === second.uid &&
    first.nlink === second.nlink &&
    first.mtimeNs === second.mtimeNs &&
    first.ctimeNs === second.ctimeNs
  );
}

function assertRegularImmutableFile(stats: BigIntStats, expectedLength: number): void {
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail("cas.file_type", "artifact leaf must be a regular file");
  }
  if (stats.nlink !== 1n) {
    fail("cas.link_count", "artifact leaf must have exactly one hard link");
  }
  assertOwnedMode(
    stats,
    immutableLeafMode,
    "cas.file_owner",
    "cas.file_permissions",
    "published artifact leaf",
  );
  if (stats.size !== BigInt(expectedLength)) {
    fail("cas.byte_length", "resolved artifact length differs from its reference");
  }
}

async function writeAll(handle: FileHandle, bytes: Buffer): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.length - offset,
      offset,
    );
    if (bytesWritten === 0) {
      fail("cas.short_write", "artifact write made no progress");
    }
    offset += bytesWritten;
  }
}

async function readAll(handle: FileHandle, byteLength: number): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(byteLength);
  let offset = 0;
  while (offset < byteLength) {
    const { bytesRead } = await handle.read(bytes, offset, byteLength - offset, offset);
    if (bytesRead === 0) {
      fail("cas.short_read", "artifact ended before its declared byte length");
    }
    offset += bytesRead;
  }
  return bytes;
}

function containsPath(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return (
    pathFromParent === "" ||
    (!isAbsolute(pathFromParent) &&
      pathFromParent !== ".." &&
      !pathFromParent.startsWith(`..${sep}`))
  );
}

function registerCodecs(codecs: readonly ArtifactCodec<unknown>[]): {
  readonly byMediaType: ReadonlyMap<string, RegisteredCodec>;
  readonly bySource: ReadonlyMap<ArtifactCodec<unknown>, RegisteredCodec>;
} {
  if (!Array.isArray(codecs)) {
    fail("cas.codec", "artifact codecs must be supplied as an array");
  }
  const byMediaType = new Map<string, RegisteredCodec>();
  const bySource = new Map<ArtifactCodec<unknown>, RegisteredCodec>();
  for (const codec of codecs) {
    if (typeof codec !== "object" || codec === null) {
      fail("cas.codec", "artifact codec must be an object");
    }
    const mediaType = validateMediaType(codec.mediaType);
    const maximumBytes = validateMaximumBytes(codec.maximumBytes);
    if (
      typeof codec.canonicalize !== "function" ||
      typeof codec.validate !== "function"
    ) {
      fail("cas.codec", "artifact codec must provide canonicalize and validate");
    }
    if (byMediaType.has(mediaType) || bySource.has(codec)) {
      fail("cas.codec_conflict", "artifact codecs must have unique media types");
    }
    const registered = Object.freeze({
      source: codec,
      mediaType,
      maximumBytes,
      canonicalize: codec.canonicalize,
      validate: codec.validate,
    });
    byMediaType.set(mediaType, registered);
    bySource.set(codec, registered);
  }
  return { byMediaType, bySource };
}

export class ArtifactStore {
  readonly rootPath: string;
  readonly maximumArtifactBytes: number;
  readonly #rootIdentity: FileIdentity;
  readonly #codecsByMediaType: ReadonlyMap<string, RegisteredCodec>;
  readonly #codecsBySource: ReadonlyMap<ArtifactCodec<unknown>, RegisteredCodec>;
  #writeQueue: Promise<void> = Promise.resolve();
  #sealed = false;

  private constructor(
    rootPath: string,
    maximumArtifactBytes: number,
    rootIdentity: FileIdentity,
    codecs: ReturnType<typeof registerCodecs>,
  ) {
    this.rootPath = rootPath;
    this.maximumArtifactBytes = maximumArtifactBytes;
    this.#rootIdentity = rootIdentity;
    this.#codecsByMediaType = codecs.byMediaType;
    this.#codecsBySource = codecs.bySource;
    Object.freeze(this);
  }

  static async open(
    root: string,
    codecs: readonly ArtifactCodec<unknown>[],
    maximumArtifactBytes = defaultMaximumArtifactBytes,
  ): Promise<ArtifactStore> {
    const byteBudget = validateMaximumBytes(maximumArtifactBytes);
    const registeredCodecs = registerCodecs(codecs);
    const absoluteRoot = resolvePath(root);
    let canonicalRoot: string;
    try {
      canonicalRoot = await realpath(absoluteRoot);
    } catch (error) {
      fail("cas.root", "artifact store root does not exist", { cause: error });
    }
    if (canonicalRoot !== absoluteRoot) {
      fail(
        "cas.root_alias",
        "artifact store root cannot contain symbolic-link aliases",
      );
    }
    const stats = await inspectPrivateDirectory(absoluteRoot, "cas.root");
    return new ArtifactStore(
      absoluteRoot,
      byteBudget,
      { dev: stats.dev, ino: stats.ino },
      registeredCodecs,
    );
  }

  #registeredCodec<T>(codec: ArtifactCodec<T>): RegisteredCodec<T> {
    const registered = this.#codecsBySource.get(codec) as
      RegisteredCodec<T> | undefined;
    if (registered === undefined) {
      fail("cas.codec", "artifact operation requires a codec registered at open");
    }
    return registered;
  }

  #codecForMediaType(mediaType: string): RegisteredCodec {
    const codec = this.#codecsByMediaType.get(mediaType);
    if (codec === undefined) {
      fail("cas.codec", "artifact reference media type has no registered codec");
    }
    return codec;
  }

  async #serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#writeQueue.then(operation);
    this.#writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #assertRootIdentity(): Promise<void> {
    const stats = await inspectPrivateDirectory(this.rootPath, "cas.root_changed");
    if (stats.dev !== this.#rootIdentity.dev || stats.ino !== this.#rootIdentity.ino) {
      fail("cas.root_changed", "artifact store root identity changed after opening");
    }
    let canonicalRoot: string;
    try {
      canonicalRoot = await realpath(this.rootPath);
    } catch (error) {
      fail("cas.root_changed", "artifact store root cannot be resolved", {
        cause: error,
      });
    }
    if (canonicalRoot !== this.rootPath) {
      fail("cas.root_changed", "artifact store root became a symbolic-link alias");
    }
  }

  async #ensureShard(digest: string): Promise<string> {
    await this.#assertRootIdentity();
    const algorithmDirectory = join(this.rootPath, "sha256");
    await ensurePrivateDirectory(algorithmDirectory, this.rootPath);
    const shardDirectory = join(algorithmDirectory, digest.slice(0, 2));
    await ensurePrivateDirectory(shardDirectory, algorithmDirectory);
    return shardDirectory;
  }

  async #inspectArtifactDirectories(digest: string): Promise<void> {
    await this.#assertRootIdentity();
    const algorithmDirectory = join(this.rootPath, "sha256");
    await inspectPrivateDirectory(algorithmDirectory, "cas.algorithm_directory");
    const shardDirectory = join(algorithmDirectory, digest.slice(0, 2));
    await inspectPrivateDirectory(shardDirectory, "cas.shard_directory");
  }

  async #verifiedArtifact(
    digest: string,
    byteLength: number,
  ): Promise<VerifiedArtifact> {
    await this.#inspectArtifactDirectories(digest);
    const path = artifactPath(this.rootPath, digest);

    let pathStats: BigIntStats;
    try {
      pathStats = await lstat(path, { bigint: true });
    } catch (error) {
      fail("cas.missing", "artifact leaf cannot be inspected", { cause: error });
    }
    if (pathStats.isSymbolicLink()) {
      fail("cas.symlink", "artifact leaf cannot be a symbolic link");
    }

    let handle: FileHandle | undefined;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const before = await handle.stat({ bigint: true });
      if (before.dev !== pathStats.dev || before.ino !== pathStats.ino) {
        fail("cas.replaced", "artifact leaf changed while it was being opened");
      }
      assertRegularImmutableFile(before, byteLength);
      const bytes = await readAll(handle, byteLength);
      const after = await handle.stat({ bigint: true });
      if (!sameFileState(before, after)) {
        fail("cas.replaced", "artifact leaf changed while it was being read");
      }
      if (sha256(bytes) !== digest) {
        fail("cas.hash", "resolved artifact bytes do not match their digest");
      }
      return Object.freeze({ bytes, stats: after });
    } catch (error) {
      if (error instanceof ArtifactStoreError) {
        throw error;
      }
      return fail("cas.open", "artifact leaf cannot be resolved safely", {
        cause: error,
      });
    } finally {
      await handle?.close();
    }
  }

  #assertWithinBudget(bytes: Buffer, codec: RegisteredCodec): void {
    const budget = Math.min(codec.maximumBytes, this.maximumArtifactBytes);
    if (bytes.length < 1 || bytes.length > budget) {
      fail("cas.byte_length", "artifact payload exceeds its codec or store budget");
    }
  }

  async #invokeCanonicalize(bytes: Buffer, codec: RegisteredCodec): Promise<Buffer> {
    let result: Uint8Array;
    try {
      result = await codec.canonicalize(Buffer.from(bytes));
    } catch (error) {
      fail("cas.codec_canonicalize", "artifact canonicalization failed", {
        cause: error,
      });
    }
    const resultByteLength = intrinsicUint8ArrayByteLength(result);
    if (resultByteLength === null) {
      fail("cas.codec_canonicalize", "artifact codec returned non-byte output");
    }
    const budget = Math.min(codec.maximumBytes, this.maximumArtifactBytes);
    if (resultByteLength < 1 || resultByteLength > budget) {
      fail("cas.byte_length", "artifact payload exceeds its codec or store budget");
    }
    let canonical: Buffer;
    try {
      canonical = snapshotUint8Array(result, resultByteLength);
    } catch (error) {
      fail("cas.codec_canonicalize", "artifact codec returned an unstable byte array", {
        cause: error,
      });
    }
    return canonical;
  }

  async #invokeValidate<T>(bytes: Buffer, codec: RegisteredCodec<T>): Promise<T> {
    try {
      return await codec.validate(Buffer.from(bytes));
    } catch (error) {
      fail("cas.codec_validate", "artifact validation failed", { cause: error });
    }
  }

  async #canonicalizeForPut(
    input: Uint8Array,
    codec: RegisteredCodec,
  ): Promise<Buffer> {
    const inputByteLength = intrinsicUint8ArrayByteLength(input);
    if (inputByteLength === null) {
      fail("cas.input", "artifact input must be a byte array");
    }
    const budget = Math.min(codec.maximumBytes, this.maximumArtifactBytes);
    if (inputByteLength < 1 || inputByteLength > budget) {
      fail("cas.byte_length", "artifact input exceeds its codec or store budget");
    }
    let raw: Buffer;
    try {
      raw = snapshotUint8Array(input, inputByteLength);
    } catch (error) {
      fail("cas.input", "artifact input could not be copied into a stable snapshot", {
        cause: error,
      });
    }
    const canonical = await this.#invokeCanonicalize(raw, codec);
    await this.#invokeValidate(canonical, codec);
    const stabilized = await this.#invokeCanonicalize(canonical, codec);
    if (!stabilized.equals(canonical)) {
      fail("cas.codec_non_idempotent", "artifact codec is not byte-idempotent");
    }
    return canonical;
  }

  async #validateStoredCanonical<T>(
    bytes: Buffer,
    codec: RegisteredCodec<T>,
  ): Promise<T> {
    this.#assertWithinBudget(bytes, codec);
    const canonical = await this.#invokeCanonicalize(bytes, codec);
    if (!canonical.equals(bytes)) {
      fail("cas.noncanonical", "stored artifact bytes are not codec-canonical");
    }
    return this.#invokeValidate(bytes, codec);
  }

  async #finalPathExists(path: string): Promise<boolean> {
    try {
      await lstat(path);
      return true;
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        return false;
      }
      fail("cas.publish", "artifact final path cannot be inspected", {
        cause: error,
      });
    }
  }

  async put<T>(input: Uint8Array, codec: ArtifactCodec<T>): Promise<ArtifactRef> {
    const registered = this.#registeredCodec(codec);
    return this.#serializeWrite(async () => {
      if (this.#sealed) {
        fail(
          "cas.sealed",
          "artifact store cannot be modified after a successful audit",
        );
      }
      const payload = await this.#canonicalizeForPut(input, registered);
      const digest = sha256(payload);
      const reference = Object.freeze({
        sha256: digest,
        byte_length: payload.length,
        media_type: registered.mediaType,
        format_version: 1 as const,
      });
      const shardDirectory = await this.#ensureShard(digest);
      const finalPath = artifactPath(this.rootPath, digest);

      if (await this.#finalPathExists(finalPath)) {
        const existing = await this.#verifiedArtifact(digest, payload.length);
        await this.#validateStoredCanonical(existing.bytes, registered);
        if (!existing.bytes.equals(payload)) {
          fail("cas.collision", "existing digest path contains different bytes");
        }
        return reference;
      }

      const temporaryPath = join(
        shardDirectory,
        `.${digest}.${randomBytes(12).toString("hex")}.tmp`,
      );
      let handle: FileHandle | undefined;
      let temporaryExists = false;
      try {
        handle = await open(
          temporaryPath,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        temporaryExists = true;
        await writeAll(handle, payload);
        await handle.chmod(immutableLeafMode);
        // This final file fsync persists both content and the restrictive mode.
        await handle.sync();
        await handle.close();
        handle = undefined;

        // Under the documented single-writer/private-root boundary this check
        // and rename cannot race another publisher. rename makes the complete
        // one-link inode visible atomically; the temp name is never hard-linked.
        if (await this.#finalPathExists(finalPath)) {
          await unlink(temporaryPath);
          temporaryExists = false;
          const existing = await this.#verifiedArtifact(digest, payload.length);
          await this.#validateStoredCanonical(existing.bytes, registered);
          if (!existing.bytes.equals(payload)) {
            fail("cas.collision", "existing digest path contains different bytes");
          }
          return reference;
        }
        await rename(temporaryPath, finalPath);
        temporaryExists = false;
        await syncDirectory(shardDirectory);

        const published = await this.#verifiedArtifact(digest, payload.length);
        await this.#validateStoredCanonical(published.bytes, registered);
        if (!published.bytes.equals(payload)) {
          fail("cas.collision", "published digest path contains different bytes");
        }
        return reference;
      } catch (error) {
        if (error instanceof ArtifactStoreError) {
          throw error;
        }
        return fail("cas.write", "artifact write failed", { cause: error });
      } finally {
        await handle?.close();
        if (temporaryExists) {
          try {
            await unlink(temporaryPath);
          } catch {
            // Audit rejects an abandoned private staging leaf after a failed cleanup.
          }
        }
      }
    });
  }

  async readBytes<T>(input: unknown, codec: ArtifactCodec<T>): Promise<Buffer> {
    const registered = this.#registeredCodec(codec);
    const byteBudget = Math.min(registered.maximumBytes, this.maximumArtifactBytes);
    const reference = validateArtifactReference(input, byteBudget);
    if (reference.media_type !== registered.mediaType) {
      fail("cas.media_type", "artifact reference has the wrong media type");
    }
    const artifact = await this.#verifiedArtifact(
      reference.sha256,
      reference.byte_length,
    );
    await this.#validateStoredCanonical(artifact.bytes, registered);
    return artifact.bytes;
  }

  async resolve<T>(input: unknown, codec: ArtifactCodec<T>): Promise<T> {
    const registered = this.#registeredCodec(codec);
    const byteBudget = Math.min(registered.maximumBytes, this.maximumArtifactBytes);
    const reference = validateArtifactReference(input, byteBudget);
    if (reference.media_type !== registered.mediaType) {
      fail("cas.media_type", "artifact reference has the wrong media type");
    }
    const artifact = await this.#verifiedArtifact(
      reference.sha256,
      reference.byte_length,
    );
    return this.#validateStoredCanonical(artifact.bytes, registered);
  }

  hasSameRootIdentity(other: ArtifactStore): boolean {
    return (
      this.#rootIdentity.dev === other.#rootIdentity.dev &&
      this.#rootIdentity.ino === other.#rootIdentity.ino
    );
  }

  async #auditUnserialized(
    expectedReferences: readonly unknown[],
  ): Promise<ArtifactStoreAudit> {
    await this.#assertRootIdentity();
    const expected = new Map<
      string,
      { readonly reference: ArtifactRef; readonly codec: RegisteredCodec }
    >();
    for (const input of expectedReferences) {
      const reference = validateArtifactReference(input, this.maximumArtifactBytes);
      const codec = this.#codecForMediaType(reference.media_type);
      if (reference.byte_length > codec.maximumBytes) {
        fail("cas.byte_length", "artifact reference exceeds its codec byte budget");
      }
      const prior = expected.get(reference.sha256);
      if (
        prior !== undefined &&
        (prior.reference.byte_length !== reference.byte_length ||
          prior.reference.media_type !== reference.media_type ||
          prior.reference.format_version !== reference.format_version)
      ) {
        fail("cas.reference_conflict", "one digest has conflicting reference metadata");
      }
      expected.set(reference.sha256, { reference, codec });
    }

    const expectedShards = new Set(
      [...expected.keys()].map((digest) => digest.slice(0, 2)),
    );
    const rootEntries = await readdir(this.rootPath, { withFileTypes: true });
    if (rootEntries.some((entry) => entry.name !== "sha256" || !entry.isDirectory())) {
      fail("cas.unexpected_entry", "artifact store root contains an unexpected entry");
    }
    if (expected.size === 0 && rootEntries.length !== 0) {
      fail(
        "cas.unexpected_entry",
        "an empty artifact store cannot contain digest directories",
      );
    }
    if (expected.size > 0 && rootEntries.length !== 1) {
      fail("cas.membership", "artifact store is missing its digest directory");
    }

    const entries = new Map<string, ArtifactAuditEntry>();
    const algorithmDirectory = join(this.rootPath, "sha256");
    if (rootEntries.length !== 0) {
      await inspectPrivateDirectory(algorithmDirectory, "cas.algorithm_directory");
      const shards = await readdir(algorithmDirectory, { withFileTypes: true });
      const actualShards = new Set<string>();
      for (const shard of shards) {
        if (!shardPattern.test(shard.name) || !shard.isDirectory()) {
          fail("cas.unexpected_entry", "artifact store contains an invalid shard");
        }
        if (!expectedShards.has(shard.name)) {
          fail("cas.unexpected_entry", "artifact store contains an unreferenced shard");
        }
        actualShards.add(shard.name);
        const shardDirectory = join(algorithmDirectory, shard.name);
        await inspectPrivateDirectory(shardDirectory, "cas.shard_directory");
        const leaves = await readdir(shardDirectory, { withFileTypes: true });
        for (const leaf of leaves) {
          if (
            !sha256Pattern.test(leaf.name) ||
            !leaf.name.startsWith(shard.name) ||
            !leaf.isFile()
          ) {
            fail("cas.unexpected_entry", "artifact store contains an invalid leaf");
          }
          const expectedEntry = expected.get(leaf.name);
          if (expectedEntry === undefined) {
            fail("cas.membership", "artifact store contains an unreferenced leaf");
          }
          const artifact = await this.#verifiedArtifact(
            leaf.name,
            expectedEntry.reference.byte_length,
          );
          await this.#validateStoredCanonical(artifact.bytes, expectedEntry.codec);
          if (entries.has(leaf.name)) {
            fail(
              "cas.duplicate",
              "artifact digest appears more than once in the store",
            );
          }
          entries.set(
            leaf.name,
            Object.freeze({
              sha256: leaf.name,
              byteLength: expectedEntry.reference.byte_length,
              device: artifact.stats.dev,
              inode: artifact.stats.ino,
            }),
          );
        }
      }
      if (
        actualShards.size !== expectedShards.size ||
        [...expectedShards].some((shard) => !actualShards.has(shard))
      ) {
        fail("cas.membership", "artifact store shard topology is incomplete");
      }
    }

    if (
      entries.size !== expected.size ||
      [...expected.keys()].some((digest) => !entries.has(digest))
    ) {
      fail("cas.membership", "artifact store membership differs from its references");
    }
    return Object.freeze({
      rootPath: this.rootPath,
      entries: new ImmutableMapView(entries),
    });
  }

  async audit(expectedReferences: readonly unknown[]): Promise<ArtifactStoreAudit> {
    return this.#serializeWrite(async () => {
      const audit = await this.#auditUnserialized(expectedReferences);
      this.#sealed = true;
      return audit;
    });
  }
}

export function assertDisjointArtifactStores(
  visible: ArtifactStore,
  sealed: ArtifactStore,
): void {
  if (
    visible.hasSameRootIdentity(sealed) ||
    containsPath(visible.rootPath, sealed.rootPath) ||
    containsPath(sealed.rootPath, visible.rootPath)
  ) {
    fail(
      "cas.store_alias",
      "visible and sealed artifact roots must be distinct and non-nested",
    );
  }
}

export async function auditArtifactStorePair(
  visible: ArtifactStore,
  visibleReferences: readonly unknown[],
  sealed: ArtifactStore,
  sealedReferences: readonly unknown[],
): Promise<{
  readonly visible: ArtifactStoreAudit;
  readonly sealed: ArtifactStoreAudit;
}> {
  assertDisjointArtifactStores(visible, sealed);
  const [visibleAudit, sealedAudit] = await Promise.all([
    visible.audit(visibleReferences),
    sealed.audit(sealedReferences),
  ]);
  const visibleInodes = new Set(
    [...visibleAudit.entries.values()].map((entry) => `${entry.device}:${entry.inode}`),
  );
  for (const [digest, entry] of sealedAudit.entries) {
    if (visibleAudit.entries.has(digest)) {
      fail(
        "cas.cross_store_digest",
        "visible and sealed stores contain identical bytes",
      );
    }
    if (visibleInodes.has(`${entry.device}:${entry.inode}`)) {
      fail("cas.cross_store_inode", "visible and sealed stores share an inode");
    }
  }
  return Object.freeze({ visible: visibleAudit, sealed: sealedAudit });
}
