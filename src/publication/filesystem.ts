import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import type { BigIntStats, Dir } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  intrinsicUint8ArrayByteLength,
  snapshotUint8Array,
} from "../contracts/byte-array.js";
import { PairedPublicationError } from "./errors.js";

export const PUBLICATION_PRIVATE_DIRECTORY_MODE = 0o700;
export const PUBLICATION_IMMUTABLE_FILE_MODE = 0o400;
export const MAXIMUM_PUBLICATION_FILE_BYTES = 16_777_216;
export const MAXIMUM_STAGING_DIRECTORY_ENTRIES = 8_192;
export const MAXIMUM_STAGING_DIRECTORIES = 2_048;
export const MAXIMUM_STAGING_DEPTH = 32;
const ownedStagingNamePattern = /^\.impactdiff-stage-[0-9a-f]{32}\.tmp$/u;

/**
 * Node's path APIs cannot exclude a hostile same-uid process between every
 * pathname lookup. V1 therefore requires one publisher and private,
 * current-uid directories. Every operation still pins and rechecks inode
 * identity so accidental aliases and replacement by other users fail closed.
 */
export const PAIRED_PUBLICATION_FILESYSTEM_V1_THREAT_MODEL = Object.freeze({
  ownership: "private current-uid directories",
  writers: "one same-process paired publisher",
  unsupportedMutators: "external processes and additional same-uid writers",
});

export interface DirectoryIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
}

export interface EnsuredPrivateDirectory {
  readonly identity: DirectoryIdentity;
  readonly created: boolean;
}

export interface DirectoryEntrySnapshot {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
  readonly isSymbolicLink: boolean;
}

interface OpenPrivateDirectory {
  readonly path: string;
  readonly handle: FileHandle;
  readonly stats: BigIntStats;
  readonly identity: DirectoryIdentity;
}

function fail(code: string, message: string, options?: ErrorOptions): never {
  throw new PairedPublicationError(code, message, options);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function currentUid(): bigint {
  if (process.getuid === undefined) {
    fail(
      "publication.platform",
      "paired publication requires a platform with numeric uid ownership",
    );
  }
  return BigInt(process.getuid());
}

function exactPath(input: string, code: string): string {
  if (typeof input !== "string" || input.length === 0 || input.includes("\0")) {
    fail(code, "publication filesystem paths must be non-empty strings");
  }
  return resolve(input);
}

function assertExpectedIdentity(identity: DirectoryIdentity): void {
  if (
    typeof identity !== "object" ||
    identity === null ||
    typeof identity.dev !== "bigint" ||
    typeof identity.ino !== "bigint" ||
    identity.dev < 0n ||
    identity.ino < 0n
  ) {
    fail(
      "publication.directory_identity",
      "expected directory identity must contain non-negative bigint dev and ino",
    );
  }
}

function directoryIdentity(stats: BigIntStats): DirectoryIdentity {
  return Object.freeze({ dev: stats.dev, ino: stats.ino });
}

function sameDirectoryIdentity(
  left: DirectoryIdentity,
  right: DirectoryIdentity,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameDirectoryState(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function sameFileState(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function assertPrivateDirectoryStats(stats: BigIntStats): void {
  if (stats.isSymbolicLink() || !stats.isDirectory() || stats.nlink < 1n) {
    fail(
      "publication.directory_type",
      "publication directory must be a real directory",
    );
  }
  if (stats.uid !== currentUid()) {
    fail(
      "publication.directory_owner",
      "publication directory must belong to the current process uid",
    );
  }
  if ((stats.mode & 0o7777n) !== BigInt(PUBLICATION_PRIVATE_DIRECTORY_MODE)) {
    fail(
      "publication.directory_permissions",
      "publication directory must have exact mode 0700",
    );
  }
}

async function closeFileHandle(
  handle: FileHandle,
  primaryError: unknown,
  code: string,
  message: string,
): Promise<void> {
  try {
    await handle.close();
  } catch (error) {
    if (primaryError === undefined) {
      fail(code, message, { cause: error });
    }
  }
}

async function closeDirectory(directory: Dir, primaryError: unknown): Promise<void> {
  try {
    await directory.close();
  } catch (error) {
    if (primaryError === undefined) {
      fail(
        "publication.directory_close",
        "publication directory iterator could not be closed",
        { cause: error },
      );
    }
  }
}

async function openPrivateDirectory(
  input: string,
  expectedIdentity?: DirectoryIdentity,
): Promise<OpenPrivateDirectory> {
  const path = exactPath(input, "publication.directory_path");
  if (expectedIdentity !== undefined) {
    assertExpectedIdentity(expectedIdentity);
  }

  let handle: FileHandle | undefined;
  try {
    const before = await lstat(path, { bigint: true });
    assertPrivateDirectoryStats(before);
    const canonicalPath = await realpath(path);
    if (canonicalPath !== path) {
      fail(
        "publication.directory_alias",
        "publication directory cannot use symbolic path components",
      );
    }

    handle = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const opened = await handle.stat({ bigint: true });
    assertPrivateDirectoryStats(opened);
    const after = await lstat(path, { bigint: true });
    assertPrivateDirectoryStats(after);
    if (!sameDirectoryState(before, opened) || !sameDirectoryState(opened, after)) {
      fail(
        "publication.directory_changed",
        "publication directory changed while its identity was opened",
      );
    }

    const identity = directoryIdentity(opened);
    if (
      expectedIdentity !== undefined &&
      !sameDirectoryIdentity(identity, expectedIdentity)
    ) {
      fail(
        "publication.directory_identity",
        "publication directory no longer matches its expected identity",
      );
    }
    return { path, handle, stats: opened, identity };
  } catch (error) {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        // Preserve the inspection failure that made this handle unusable.
      }
    }
    if (error instanceof PairedPublicationError) {
      throw error;
    }
    fail(
      "publication.directory",
      "publication directory could not be inspected safely",
      { cause: error },
    );
  }
}

export async function inspectPrivateDirectory(
  path: string,
  expectedIdentity?: DirectoryIdentity,
): Promise<DirectoryIdentity> {
  const opened = await openPrivateDirectory(path, expectedIdentity);
  let primaryError: unknown;
  try {
    return opened.identity;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await closeFileHandle(
      opened.handle,
      primaryError,
      "publication.directory_close",
      "publication directory handle could not be closed",
    );
  }
}

export async function syncDirectory(
  path: string,
  expectedIdentity?: DirectoryIdentity,
): Promise<void> {
  const opened = await openPrivateDirectory(path, expectedIdentity);
  let primaryError: unknown;
  try {
    await opened.handle.sync();
    const after = await lstat(opened.path, { bigint: true });
    assertPrivateDirectoryStats(after);
    if (!sameDirectoryState(opened.stats, after)) {
      fail(
        "publication.directory_changed",
        "publication directory changed while it was being synchronized",
      );
    }
  } catch (error) {
    const failure =
      error instanceof PairedPublicationError
        ? error
        : new PairedPublicationError(
            "publication.directory_sync",
            "publication directory could not be synchronized",
            { cause: error },
          );
    primaryError = failure;
    throw failure;
  } finally {
    await closeFileHandle(
      opened.handle,
      primaryError,
      "publication.directory_close",
      "publication directory handle could not be closed after sync",
    );
  }
}

export async function ensurePrivateDirectory(
  path: string,
  parentPath: string,
  expectedParentIdentity?: DirectoryIdentity,
): Promise<EnsuredPrivateDirectory> {
  const child = exactPath(path, "publication.directory_path");
  const parent = exactPath(parentPath, "publication.directory_path");
  if (dirname(child) !== parent) {
    fail(
      "publication.directory_parent",
      "publication directory must be a direct child of its declared parent",
    );
  }
  const parentIdentity = await inspectPrivateDirectory(parent, expectedParentIdentity);

  let created = false;
  try {
    await mkdir(child, { mode: PUBLICATION_PRIVATE_DIRECTORY_MODE });
    created = true;
  } catch (error) {
    if (errorCode(error) !== "EEXIST") {
      fail("publication.mkdir", "private publication directory could not be created", {
        cause: error,
      });
    }
  }

  if (!created) {
    const identity = await inspectPrivateDirectory(child);
    return Object.freeze({ identity, created: false });
  }
  try {
    const initial = await lstat(child, { bigint: true });
    if (
      initial.isSymbolicLink() ||
      !initial.isDirectory() ||
      initial.nlink < 1n ||
      initial.uid !== currentUid()
    ) {
      fail(
        "publication.directory_type",
        "new publication directory is not an owned real directory",
      );
    }
    await chmod(child, PUBLICATION_PRIVATE_DIRECTORY_MODE);
    const identity = await inspectPrivateDirectory(child);
    await syncDirectory(child, identity);
    await syncDirectory(parent, parentIdentity);
    return Object.freeze({ identity, created: true });
  } catch (error) {
    try {
      let failed: BigIntStats | undefined;
      try {
        failed = await lstat(child, { bigint: true });
      } catch (inspectionError) {
        if (errorCode(inspectionError) === "ENOENT") {
          await syncDirectory(parent, parentIdentity);
        } else {
          throw inspectionError;
        }
      }
      if (failed !== undefined) {
        if (
          failed.isSymbolicLink() ||
          !failed.isDirectory() ||
          failed.uid !== currentUid()
        ) {
          fail(
            "publication.directory_create_uncertain",
            "failed publication directory cannot be identified for rollback",
          );
        }
        await chmod(child, PUBLICATION_PRIVATE_DIRECTORY_MODE);
        await rmdir(child);
        await syncDirectory(parent, parentIdentity);
      }
    } catch (cleanupError) {
      throw new PairedPublicationError(
        "publication.directory_create_uncertain",
        "new publication directory failed validation and rollback is unconfirmed",
        {
          cause: new AggregateError(
            [error, cleanupError],
            "directory creation failure and rollback failure",
          ),
        },
      );
    }
    throw error;
  }
}

function validLeafName(name: string): boolean {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("\0") &&
    !/[\u0000-\u001f\u007f]/u.test(name) &&
    name.normalize("NFC") === name &&
    Buffer.byteLength(name, "utf8") <= 255
  );
}

async function assertMissing(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return;
    }
    fail("publication.file_inspect", "publication destination could not be inspected", {
      cause: error,
    });
  }
  fail("publication.file_exists", "immutable publication destination already exists");
}

function assertWritableTemporaryFile(stats: BigIntStats): void {
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n) {
    fail(
      "publication.temporary_file",
      "publication temporary leaf must be a one-link regular file",
    );
  }
  if (stats.uid !== currentUid()) {
    fail(
      "publication.file_owner",
      "publication temporary leaf must belong to the current process uid",
    );
  }
  if (stats.size !== 0n || (stats.mode & 0o7777n) !== 0o600n) {
    fail(
      "publication.temporary_file",
      "publication temporary leaf must start empty with exact mode 0600",
    );
  }
}

function assertImmutableFile(
  stats: BigIntStats,
  maximumBytes: number,
  expectedBytes?: number,
): void {
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail("publication.file_type", "published record must be a regular file");
  }
  if (stats.nlink !== 1n) {
    fail("publication.file_links", "published record must have exactly one hard link");
  }
  if (stats.uid !== currentUid()) {
    fail(
      "publication.file_owner",
      "published record must belong to the current process uid",
    );
  }
  if ((stats.mode & 0o7777n) !== BigInt(PUBLICATION_IMMUTABLE_FILE_MODE)) {
    fail("publication.file_permissions", "published record must have exact mode 0400");
  }
  if (
    stats.size < 1n ||
    stats.size > BigInt(maximumBytes) ||
    stats.size > BigInt(Number.MAX_SAFE_INTEGER) ||
    (expectedBytes !== undefined && stats.size !== BigInt(expectedBytes))
  ) {
    fail(
      "publication.file_size",
      "published record exceeds its byte bound or expected length",
    );
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
    if (bytesWritten < 1) {
      fail("publication.short_write", "publication record write made no progress");
    }
    offset += bytesWritten;
  }
}

export async function writeImmutableFile(
  directoryPath: string,
  fileName: string,
  bytes: Uint8Array,
  expectedDirectoryIdentity?: DirectoryIdentity,
): Promise<void> {
  if (!validLeafName(fileName)) {
    fail(
      "publication.file_name",
      "publication file name must be one bounded canonical path component",
    );
  }
  const byteLength = intrinsicUint8ArrayByteLength(bytes);
  if (
    byteLength === null ||
    byteLength < 1 ||
    byteLength > MAXIMUM_PUBLICATION_FILE_BYTES
  ) {
    fail(
      "publication.file_size",
      "publication file bytes must be a bounded stable byte array",
    );
  }
  let payload: Buffer;
  try {
    payload = snapshotUint8Array(bytes, byteLength);
  } catch (error) {
    fail(
      "publication.file_bytes",
      "publication file bytes could not be copied into a stable snapshot",
      { cause: error },
    );
  }
  const temporaryName = `.publication-${randomBytes(12).toString("hex")}.tmp`;

  const openedDirectory = await openPrivateDirectory(
    directoryPath,
    expectedDirectoryIdentity,
  );
  const finalPath = join(openedDirectory.path, fileName);
  const temporaryPath = join(openedDirectory.path, temporaryName);
  let handle: FileHandle | undefined;
  let temporaryExists = false;
  let primaryError: unknown;
  try {
    await assertMissing(finalPath);
    handle = await open(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    temporaryExists = true;
    await handle.chmod(0o600);
    const initial = await handle.stat({ bigint: true });
    assertWritableTemporaryFile(initial);
    await writeAll(handle, payload);
    await handle.chmod(PUBLICATION_IMMUTABLE_FILE_MODE);
    const immutable = await handle.stat({ bigint: true });
    assertImmutableFile(immutable, payload.length, payload.length);
    await handle.sync();
    await handle.close();
    handle = undefined;

    const pathStats = await lstat(temporaryPath, { bigint: true });
    if (!sameFileState(immutable, pathStats)) {
      fail(
        "publication.file_changed",
        "publication temporary leaf changed before its atomic rename",
      );
    }
    await assertMissing(finalPath);
    await rename(temporaryPath, finalPath);
    temporaryExists = false;
    await openedDirectory.handle.sync();

    const published = await readStableImmutableFile(finalPath, payload.length);
    if (!published.equals(payload)) {
      fail(
        "publication.file_changed",
        "published record differs from its canonical input bytes",
      );
    }
  } catch (error) {
    const failure =
      error instanceof PairedPublicationError
        ? error
        : new PairedPublicationError(
            "publication.file_write",
            "immutable publication record could not be written",
            { cause: error },
          );
    primaryError = failure;
    throw failure;
  } finally {
    if (handle !== undefined) {
      await closeFileHandle(
        handle,
        primaryError,
        "publication.file_close",
        "publication temporary file could not be closed",
      );
    }
    if (temporaryExists) {
      try {
        await unlink(temporaryPath);
        await openedDirectory.handle.sync();
      } catch (error) {
        if (primaryError === undefined) {
          fail(
            "publication.temporary_cleanup",
            "publication temporary leaf could not be removed durably",
            { cause: error },
          );
        }
      }
    }
    await closeFileHandle(
      openedDirectory.handle,
      primaryError,
      "publication.directory_close",
      "publication directory handle could not be closed after file write",
    );
  }
}

async function readAll(handle: FileHandle, byteLength: number): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(byteLength);
  let offset = 0;
  while (offset < byteLength) {
    const { bytesRead } = await handle.read(bytes, offset, byteLength - offset, offset);
    if (bytesRead < 1) {
      fail(
        "publication.short_read",
        "published record ended before its audited byte length",
      );
    }
    offset += bytesRead;
  }
  return bytes;
}

export async function readStableImmutableFile(
  pathInput: string,
  maximumBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    fail(
      "publication.file_budget",
      "publication file byte bound must be a positive safe integer",
    );
  }
  const path = exactPath(pathInput, "publication.file_path");
  const parent = await openPrivateDirectory(dirname(path));
  let handle: FileHandle | undefined;
  let primaryError: unknown;
  try {
    const pathBefore = await lstat(path, { bigint: true });
    assertImmutableFile(pathBefore, maximumBytes);
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    assertImmutableFile(before, maximumBytes);
    if (!sameFileState(pathBefore, before)) {
      fail(
        "publication.file_changed",
        "published record changed while it was being opened",
      );
    }

    const byteLength = Number(before.size);
    const bytes = await readAll(handle, byteLength);
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstat(path, { bigint: true });
    if (!sameFileState(before, after) || !sameFileState(after, pathAfter)) {
      fail(
        "publication.file_changed",
        "published record changed during its stable read",
      );
    }
    const parentAfter = await lstat(parent.path, { bigint: true });
    assertPrivateDirectoryStats(parentAfter);
    if (!sameDirectoryState(parent.stats, parentAfter)) {
      fail(
        "publication.directory_changed",
        "publication directory changed during stable record read",
      );
    }
    return bytes;
  } catch (error) {
    const failure =
      error instanceof PairedPublicationError
        ? error
        : new PairedPublicationError(
            "publication.file_read",
            "published record could not be read safely",
            { cause: error },
          );
    primaryError = failure;
    throw failure;
  } finally {
    if (handle !== undefined) {
      await closeFileHandle(
        handle,
        primaryError,
        "publication.file_close",
        "published record handle could not be closed",
      );
    }
    await closeFileHandle(
      parent.handle,
      primaryError,
      "publication.directory_close",
      "publication parent directory handle could not be closed",
    );
  }
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function listDirectoryEntries(
  path: string,
  maximumEntries: number,
  expectedIdentity?: DirectoryIdentity,
): Promise<readonly DirectoryEntrySnapshot[]> {
  if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 0) {
    fail(
      "publication.directory_budget",
      "publication directory entry bound must be a non-negative safe integer",
    );
  }
  const opened = await openPrivateDirectory(path, expectedIdentity);
  let directory: Dir | undefined;
  let primaryError: unknown;
  try {
    directory = await opendir(opened.path);
    const entries: DirectoryEntrySnapshot[] = [];
    const names = new Set<string>();
    while (true) {
      const entry = await directory.read();
      if (entry === null) {
        break;
      }
      if (names.has(entry.name)) {
        fail(
          "publication.directory_changed",
          "publication directory returned a duplicate entry name",
        );
      }
      names.add(entry.name);
      entries.push(
        Object.freeze({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
          isSymbolicLink: entry.isSymbolicLink(),
        }),
      );
      if (entries.length > maximumEntries) {
        fail(
          "publication.directory_budget",
          "publication directory exceeds its entry-count bound",
        );
      }
    }
    await directory.close();
    directory = undefined;

    const after = await lstat(opened.path, { bigint: true });
    assertPrivateDirectoryStats(after);
    if (!sameDirectoryState(opened.stats, after)) {
      fail(
        "publication.directory_changed",
        "publication directory changed while its entries were listed",
      );
    }
    entries.sort((left, right) => codeUnitCompare(left.name, right.name));
    return Object.freeze(entries);
  } catch (error) {
    const failure =
      error instanceof PairedPublicationError
        ? error
        : new PairedPublicationError(
            "publication.directory_entries",
            "publication directory entries could not be listed safely",
            { cause: error },
          );
    primaryError = failure;
    throw failure;
  } finally {
    if (directory !== undefined) {
      await closeDirectory(directory, primaryError);
    }
    await closeFileHandle(
      opened.handle,
      primaryError,
      "publication.directory_close",
      "publication directory handle could not be closed after listing",
    );
  }
}

function assertRemovableStagingLeaf(stats: BigIntStats): void {
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n) {
    fail(
      "publication.staging_cleanup",
      "staging cleanup refuses non-regular or linked directory entries",
    );
  }
  if (stats.uid !== currentUid()) {
    fail(
      "publication.staging_cleanup",
      "staging cleanup refuses files owned by another uid",
    );
  }
  const mode = stats.mode & 0o7777n;
  if ((mode & ~0o600n) !== 0n) {
    fail(
      "publication.staging_cleanup",
      "staging cleanup refuses non-private file permissions",
    );
  }
}

interface StagingRemovalBudget {
  entries: number;
  directories: number;
}

async function preflightPrivateDirectoryTree(
  path: string,
  expectedIdentity: DirectoryIdentity,
  budget: StagingRemovalBudget,
  depth: number,
): Promise<void> {
  budget.directories += 1;
  if (
    depth > MAXIMUM_STAGING_DEPTH ||
    budget.directories > MAXIMUM_STAGING_DIRECTORIES
  ) {
    fail(
      "publication.staging_cleanup",
      "staging cleanup exceeds its directory depth or count bound",
    );
  }
  await inspectPrivateDirectory(path, expectedIdentity);
  const remainingBudget = MAXIMUM_STAGING_DIRECTORY_ENTRIES - budget.entries;
  const entries = await listDirectoryEntries(path, remainingBudget, expectedIdentity);
  budget.entries += entries.length;
  for (const entry of entries) {
    const leafPath = join(path, entry.name);
    if (entry.isSymbolicLink) {
      fail("publication.staging_cleanup", "staging cleanup refuses symbolic links");
    }
    if (entry.isDirectory && !entry.isFile) {
      const childIdentity = await inspectPrivateDirectory(leafPath);
      await preflightPrivateDirectoryTree(leafPath, childIdentity, budget, depth + 1);
      continue;
    }
    if (!entry.isFile || entry.isDirectory) {
      fail(
        "publication.staging_cleanup",
        "staging cleanup refuses special filesystem entries",
      );
    }
    assertRemovableStagingLeaf(await lstat(leafPath, { bigint: true }));
  }
}

async function removePrivateDirectoryTree(
  path: string,
  expectedIdentity: DirectoryIdentity,
  budget: StagingRemovalBudget,
  depth: number,
): Promise<void> {
  budget.directories += 1;
  if (
    depth > MAXIMUM_STAGING_DEPTH ||
    budget.directories > MAXIMUM_STAGING_DIRECTORIES
  ) {
    fail(
      "publication.staging_cleanup",
      "staging cleanup exceeds its directory depth or count bound",
    );
  }

  const opened = await openPrivateDirectory(path, expectedIdentity);
  let primaryError: unknown;
  try {
    const remainingBudget = MAXIMUM_STAGING_DIRECTORY_ENTRIES - budget.entries;
    const entries = await listDirectoryEntries(path, remainingBudget, expectedIdentity);
    budget.entries += entries.length;
    for (const entry of entries) {
      const leafPath = join(path, entry.name);
      if (entry.isSymbolicLink) {
        fail("publication.staging_cleanup", "staging cleanup refuses symbolic links");
      }
      if (entry.isDirectory && !entry.isFile) {
        const childIdentity = await inspectPrivateDirectory(leafPath);
        await removePrivateDirectoryTree(leafPath, childIdentity, budget, depth + 1);
        await opened.handle.sync();
        continue;
      }
      if (!entry.isFile || entry.isDirectory) {
        fail(
          "publication.staging_cleanup",
          "staging cleanup refuses special filesystem entries",
        );
      }
      const stats = await lstat(leafPath, { bigint: true });
      assertRemovableStagingLeaf(stats);
      await unlink(leafPath);
    }

    const remaining = await listDirectoryEntries(path, 0, expectedIdentity);
    if (remaining.length !== 0) {
      fail(
        "publication.staging_cleanup",
        "staging directory was not empty after owned-tree cleanup",
      );
    }
    await opened.handle.sync();
    await rmdir(path);
  } catch (error) {
    const failure =
      error instanceof PairedPublicationError
        ? error
        : new PairedPublicationError(
            "publication.staging_cleanup",
            "owned staging subtree could not be removed safely",
            { cause: error },
          );
    primaryError = failure;
    throw failure;
  } finally {
    await closeFileHandle(
      opened.handle,
      primaryError,
      "publication.directory_close",
      "staging directory handle could not be closed after cleanup",
    );
  }
}

export async function removeOwnedStagingDirectory(
  path: string,
  parentPath: string,
  expectedIdentity: DirectoryIdentity,
  expectedParentIdentity?: DirectoryIdentity,
): Promise<void> {
  assertExpectedIdentity(expectedIdentity);
  const stagingPath = exactPath(path, "publication.directory_path");
  const parent = exactPath(parentPath, "publication.directory_path");
  if (dirname(stagingPath) !== parent) {
    fail(
      "publication.directory_parent",
      "staging directory must be a direct child of its declared parent",
    );
  }
  if (!ownedStagingNamePattern.test(basename(stagingPath))) {
    fail(
      "publication.staging_name",
      "staging cleanup is restricted to reserved owned staging names",
    );
  }

  const openedParent = await openPrivateDirectory(parent, expectedParentIdentity);
  let primaryError: unknown;
  try {
    try {
      await lstat(stagingPath);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        await openedParent.handle.sync();
        return;
      }
      throw error;
    }

    await preflightPrivateDirectoryTree(
      stagingPath,
      expectedIdentity,
      { entries: 0, directories: 0 },
      0,
    );
    await removePrivateDirectoryTree(
      stagingPath,
      expectedIdentity,
      { entries: 0, directories: 0 },
      0,
    );
    try {
      await lstat(stagingPath);
      fail(
        "publication.staging_cleanup",
        "staging directory remained visible after removal",
      );
    } catch (error) {
      if (error instanceof PairedPublicationError) {
        throw error;
      }
      if (errorCode(error) !== "ENOENT") {
        throw error;
      }
    }
    const parentAfter = await lstat(parent, { bigint: true });
    assertPrivateDirectoryStats(parentAfter);
    if (!sameDirectoryIdentity(directoryIdentity(parentAfter), openedParent.identity)) {
      fail(
        "publication.directory_changed",
        "publication parent changed during staging cleanup",
      );
    }
    await openedParent.handle.sync();
  } catch (error) {
    const failure =
      error instanceof PairedPublicationError
        ? error
        : new PairedPublicationError(
            "publication.staging_cleanup",
            "owned staging directory could not be removed safely",
            { cause: error },
          );
    primaryError = failure;
    throw failure;
  } finally {
    await closeFileHandle(
      openedParent.handle,
      primaryError,
      "publication.directory_close",
      "publication parent directory handle could not be closed after cleanup",
    );
  }
}
