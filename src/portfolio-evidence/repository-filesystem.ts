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
import { basename, dirname, resolve } from "node:path";

import { PilotPortfolioEvidenceError } from "./errors.js";

const repositoryDirectoryMode = 0o755;
const repositoryFileMode = 0o644;
const stagingNamePattern = /^\.impactdiff-stage-[0-9a-f]{32}\.tmp$/u;
const maximumCleanupEntries = 32;

export interface RepositoryDirectoryIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
}

export interface RepositoryDirectoryEntry {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
  readonly isSymbolicLink: boolean;
}

interface OpenRepositoryDirectory {
  readonly path: string;
  readonly handle: FileHandle;
  readonly stats: BigIntStats;
  readonly identity: RepositoryDirectoryIdentity;
}

function fail(code: string, message: string, options?: ErrorOptions): never {
  throw new PilotPortfolioEvidenceError(code, message, options);
}

function errorCode(error: unknown): string | number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === "string" || typeof code === "number" ? code : undefined;
}

function currentUid(): bigint {
  if (process.getuid === undefined) {
    fail(
      "portfolio_evidence.filesystem_platform",
      "repository evidence filesystem checks require numeric uid ownership",
    );
  }
  return BigInt(process.getuid());
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

function sameDirectoryIdentity(
  left: RepositoryDirectoryIdentity,
  right: RepositoryDirectoryIdentity,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function directoryIdentity(stats: BigIntStats): RepositoryDirectoryIdentity {
  return Object.freeze({ dev: stats.dev, ino: stats.ino });
}

function assertSafeDirectory(stats: BigIntStats): void {
  const mode = stats.mode & 0o7777n;
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    stats.nlink < 1n ||
    stats.uid !== currentUid() ||
    (mode & 0o7022n) !== 0n
  ) {
    fail(
      "portfolio_evidence.directory",
      "evidence directories must be owned real directories without special or group/world-write bits",
    );
  }
}

function assertSafeFile(
  stats: BigIntStats,
  maximumBytes: number,
  expectedBytes?: number,
): void {
  const mode = stats.mode & 0o7777n;
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.nlink !== 1n ||
    stats.uid !== currentUid() ||
    (mode & 0o7133n) !== 0n
  ) {
    fail(
      "portfolio_evidence.file",
      "evidence files must be owned, non-executable, non-linked regular files without special or group/world-write bits",
    );
  }
  if (
    stats.size < 1n ||
    stats.size > BigInt(maximumBytes) ||
    stats.size > BigInt(Number.MAX_SAFE_INTEGER) ||
    (expectedBytes !== undefined && stats.size !== BigInt(expectedBytes))
  ) {
    fail(
      "portfolio_evidence.file_size",
      "evidence file exceeds its byte bound or expected length",
    );
  }
}

function assertRemovableFile(stats: BigIntStats): void {
  const mode = stats.mode & 0o7777n;
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.nlink !== 1n ||
    stats.uid !== currentUid() ||
    stats.size < 0n ||
    stats.size > 16_777_216n ||
    (mode & 0o7133n) !== 0n
  ) {
    fail(
      "portfolio_evidence.stage_cleanup",
      "stage cleanup refuses unsafe, linked, or oversized files",
    );
  }
}

function validLeafName(name: string): boolean {
  return (
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

async function closeHandle(handle: FileHandle, primaryError: unknown): Promise<void> {
  try {
    await handle.close();
  } catch (error) {
    if (primaryError === undefined) {
      fail(
        "portfolio_evidence.file_close",
        "evidence filesystem handle could not be closed",
        { cause: error },
      );
    }
  }
}

async function closeDirectory(directory: Dir, primaryError: unknown): Promise<void> {
  try {
    await directory.close();
  } catch (error) {
    if (primaryError === undefined) {
      fail(
        "portfolio_evidence.directory_close",
        "evidence directory iterator could not be closed",
        { cause: error },
      );
    }
  }
}

async function openRepositoryDirectory(
  pathInput: string,
  expectedIdentity?: RepositoryDirectoryIdentity,
): Promise<OpenRepositoryDirectory> {
  const path = resolve(pathInput);
  let handle: FileHandle | undefined;
  try {
    const before = await lstat(path, { bigint: true });
    assertSafeDirectory(before);
    if ((await realpath(path)) !== path) {
      fail(
        "portfolio_evidence.directory_alias",
        "evidence directory cannot use symbolic path components",
      );
    }
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const opened = await handle.stat({ bigint: true });
    const after = await lstat(path, { bigint: true });
    assertSafeDirectory(opened);
    assertSafeDirectory(after);
    if (!sameDirectoryState(before, opened) || !sameDirectoryState(opened, after)) {
      fail(
        "portfolio_evidence.directory_changed",
        "evidence directory changed while being opened",
      );
    }
    const identity = directoryIdentity(opened);
    if (
      expectedIdentity !== undefined &&
      !sameDirectoryIdentity(identity, expectedIdentity)
    ) {
      fail(
        "portfolio_evidence.directory_identity",
        "evidence directory no longer has its expected identity",
      );
    }
    return { path, handle, stats: opened, identity };
  } catch (error) {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        // Preserve the primary inspection failure.
      }
    }
    if (error instanceof PilotPortfolioEvidenceError) throw error;
    fail("portfolio_evidence.directory", "evidence directory could not be inspected", {
      cause: error,
    });
  }
}

export async function inspectRepositoryDirectory(
  path: string,
  expectedIdentity?: RepositoryDirectoryIdentity,
): Promise<RepositoryDirectoryIdentity> {
  const opened = await openRepositoryDirectory(path, expectedIdentity);
  let primaryError: unknown;
  try {
    return opened.identity;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await closeHandle(opened.handle, primaryError);
  }
}

export async function syncRepositoryDirectory(
  path: string,
  expectedIdentity?: RepositoryDirectoryIdentity,
): Promise<void> {
  const opened = await openRepositoryDirectory(path, expectedIdentity);
  let primaryError: unknown;
  try {
    await opened.handle.sync();
    const after = await lstat(opened.path, { bigint: true });
    assertSafeDirectory(after);
    if (!sameDirectoryState(opened.stats, after)) {
      fail(
        "portfolio_evidence.directory_changed",
        "evidence directory changed while being synchronized",
      );
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await closeHandle(opened.handle, primaryError);
  }
}

export async function listRepositoryDirectory(
  path: string,
  maximumEntries: number,
  expectedIdentity?: RepositoryDirectoryIdentity,
): Promise<readonly RepositoryDirectoryEntry[]> {
  if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 0) {
    fail(
      "portfolio_evidence.directory_budget",
      "directory entry bound must be a non-negative safe integer",
    );
  }
  const opened = await openRepositoryDirectory(path, expectedIdentity);
  let directory: Dir | undefined;
  let primaryError: unknown;
  try {
    directory = await opendir(opened.path);
    const entries: RepositoryDirectoryEntry[] = [];
    const names = new Set<string>();
    while (true) {
      const entry = await directory.read();
      if (entry === null) break;
      if (!validLeafName(entry.name) || names.has(entry.name)) {
        fail(
          "portfolio_evidence.directory_entry",
          "evidence directory contains an unsafe or duplicate entry",
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
          "portfolio_evidence.directory_budget",
          "evidence directory exceeds its entry-count bound",
        );
      }
    }
    await directory.close();
    directory = undefined;
    const after = await lstat(opened.path, { bigint: true });
    assertSafeDirectory(after);
    if (!sameDirectoryState(opened.stats, after)) {
      fail(
        "portfolio_evidence.directory_changed",
        "evidence directory changed while being listed",
      );
    }
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    return Object.freeze(entries);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (directory !== undefined) {
      await closeDirectory(directory, primaryError);
    }
    await closeHandle(opened.handle, primaryError);
  }
}

async function readAll(handle: FileHandle, byteLength: number): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(byteLength);
  let offset = 0;
  while (offset < byteLength) {
    const { bytesRead } = await handle.read(bytes, offset, byteLength - offset, offset);
    if (bytesRead < 1) {
      fail(
        "portfolio_evidence.short_read",
        "evidence file ended before its audited byte length",
      );
    }
    offset += bytesRead;
  }
  return bytes;
}

export async function readStableRepositoryFile(
  pathInput: string,
  maximumBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    fail(
      "portfolio_evidence.file_budget",
      "file byte bound must be a positive safe integer",
    );
  }
  const path = resolve(pathInput);
  const parent = await openRepositoryDirectory(dirname(path));
  let handle: FileHandle | undefined;
  let primaryError: unknown;
  try {
    const pathBefore = await lstat(path, { bigint: true });
    assertSafeFile(pathBefore, maximumBytes);
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    assertSafeFile(before, maximumBytes);
    if (!sameFileState(pathBefore, before)) {
      fail(
        "portfolio_evidence.file_changed",
        "evidence file changed while being opened",
      );
    }
    const bytes = await readAll(handle, Number(before.size));
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstat(path, { bigint: true });
    if (!sameFileState(before, after) || !sameFileState(after, pathAfter)) {
      fail(
        "portfolio_evidence.file_changed",
        "evidence file changed during stable read",
      );
    }
    const parentAfter = await lstat(parent.path, { bigint: true });
    assertSafeDirectory(parentAfter);
    if (!sameDirectoryState(parent.stats, parentAfter)) {
      fail(
        "portfolio_evidence.directory_changed",
        "evidence directory changed during stable file read",
      );
    }
    return bytes;
  } catch (error) {
    primaryError = error;
    if (error instanceof PilotPortfolioEvidenceError) throw error;
    return fail(
      "portfolio_evidence.file_read",
      "evidence file could not be read safely",
      {
        cause: error,
      },
    );
  } finally {
    if (handle !== undefined) await closeHandle(handle, primaryError);
    await closeHandle(parent.handle, primaryError);
  }
}

async function assertMissing(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    fail(
      "portfolio_evidence.file_inspection",
      "evidence destination could not be inspected",
      { cause: error },
    );
  }
  fail("portfolio_evidence.file_exists", "evidence destination already exists");
}

async function writeAll(handle: FileHandle, bytes: Buffer): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      offset,
    );
    if (bytesWritten < 1) {
      fail("portfolio_evidence.short_write", "evidence file write made no progress");
    }
    offset += bytesWritten;
  }
}

export async function writeRepositoryFile(
  directoryPath: string,
  fileName: string,
  input: Uint8Array,
  expectedDirectoryIdentity?: RepositoryDirectoryIdentity,
): Promise<void> {
  if (
    !validLeafName(fileName) ||
    input.byteLength < 1 ||
    input.byteLength > 16_777_216
  ) {
    fail(
      "portfolio_evidence.file_input",
      "evidence file name or bytes are outside the bounded contract",
    );
  }
  const bytes = Buffer.from(input);
  const directory = await openRepositoryDirectory(
    directoryPath,
    expectedDirectoryIdentity,
  );
  const finalPath = resolve(directory.path, fileName);
  const temporaryPath = resolve(
    directory.path,
    `.impactdiff-write-${randomBytes(12).toString("hex")}.tmp`,
  );
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
    if (
      !initial.isFile() ||
      initial.isSymbolicLink() ||
      initial.nlink !== 1n ||
      initial.uid !== currentUid() ||
      initial.size !== 0n ||
      (initial.mode & 0o7777n) !== 0o600n
    ) {
      fail(
        "portfolio_evidence.temporary_file",
        "evidence temporary file has an unsafe initial state",
      );
    }
    await writeAll(handle, bytes);
    await handle.chmod(repositoryFileMode);
    const complete = await handle.stat({ bigint: true });
    assertSafeFile(complete, bytes.byteLength, bytes.byteLength);
    await handle.sync();
    await handle.close();
    handle = undefined;
    const pathStats = await lstat(temporaryPath, { bigint: true });
    if (!sameFileState(complete, pathStats)) {
      fail(
        "portfolio_evidence.file_changed",
        "evidence temporary file changed before rename",
      );
    }
    await assertMissing(finalPath);
    await rename(temporaryPath, finalPath);
    temporaryExists = false;
    await directory.handle.sync();
    const published = await readStableRepositoryFile(finalPath, bytes.byteLength);
    if (!published.equals(bytes)) {
      fail(
        "portfolio_evidence.file_changed",
        "published evidence file differs from its input bytes",
      );
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (handle !== undefined) await closeHandle(handle, primaryError);
    if (temporaryExists) {
      try {
        await unlink(temporaryPath);
        await directory.handle.sync();
      } catch (cleanupError) {
        if (primaryError === undefined) throw cleanupError;
      }
    }
    await closeHandle(directory.handle, primaryError);
  }
}

export async function createRepositoryStage(
  pathInput: string,
  parentPath: string,
  expectedParentIdentity: RepositoryDirectoryIdentity,
): Promise<RepositoryDirectoryIdentity> {
  const path = resolve(pathInput);
  const parent = resolve(parentPath);
  if (dirname(path) !== parent || !stagingNamePattern.test(basename(path))) {
    fail(
      "portfolio_evidence.stage_name",
      "owned evidence stage must be one reserved direct child",
    );
  }
  await inspectRepositoryDirectory(parent, expectedParentIdentity);
  let created = false;
  try {
    await mkdir(path, { mode: repositoryDirectoryMode });
    created = true;
    await chmod(path, repositoryDirectoryMode);
    const identity = await inspectRepositoryDirectory(path);
    await syncRepositoryDirectory(path, identity);
    await syncRepositoryDirectory(parent, expectedParentIdentity);
    return identity;
  } catch (error) {
    if (created) {
      try {
        const identity = await inspectRepositoryDirectory(path);
        if ((await listRepositoryDirectory(path, 0, identity)).length !== 0) {
          fail(
            "portfolio_evidence.stage_create_uncertain",
            "failed evidence stage is unexpectedly nonempty",
          );
        }
        await rmdir(path);
        await syncRepositoryDirectory(parent, expectedParentIdentity);
      } catch (cleanupError) {
        fail(
          "portfolio_evidence.stage_create_uncertain",
          "evidence stage creation and rollback both failed",
          {
            cause: new AggregateError(
              [error, cleanupError],
              "stage creation and rollback failure",
            ),
          },
        );
      }
    }
    fail(
      "portfolio_evidence.stage_create",
      "owned evidence stage could not be created",
      { cause: error },
    );
  }
}

export async function removeRepositoryStage(
  pathInput: string,
  parentPath: string,
  expectedIdentity: RepositoryDirectoryIdentity,
  expectedParentIdentity: RepositoryDirectoryIdentity,
): Promise<void> {
  const path = resolve(pathInput);
  const parent = resolve(parentPath);
  if (dirname(path) !== parent || !stagingNamePattern.test(basename(path))) {
    fail(
      "portfolio_evidence.stage_name",
      "stage cleanup is restricted to one reserved direct child",
    );
  }
  await inspectRepositoryDirectory(parent, expectedParentIdentity);
  await inspectRepositoryDirectory(path, expectedIdentity);
  const entries = await listRepositoryDirectory(
    path,
    maximumCleanupEntries,
    expectedIdentity,
  );
  for (const entry of entries) {
    if (entry.isSymbolicLink || entry.isDirectory || !entry.isFile) {
      fail(
        "portfolio_evidence.stage_cleanup",
        "stage cleanup refuses non-regular entries",
      );
    }
    const leafPath = resolve(path, entry.name);
    const stats = await lstat(leafPath, { bigint: true });
    assertRemovableFile(stats);
    await unlink(leafPath);
  }
  if ((await listRepositoryDirectory(path, 0, expectedIdentity)).length !== 0) {
    fail(
      "portfolio_evidence.stage_cleanup",
      "stage remained nonempty after owned cleanup",
    );
  }
  await rmdir(path);
  await syncRepositoryDirectory(parent, expectedParentIdentity);
}
