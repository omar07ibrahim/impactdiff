import { createHash } from "node:crypto";
import { constants } from "node:fs";
import type { BigIntStats, Dirent } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join, posix, resolve } from "node:path";

import { ImmutableMapView } from "../contracts/immutable-map.js";
import { MutationRuntimeError } from "./errors.js";

const maximumTreeFiles = 4_096;
const maximumTreeDirectories = 1_024;
const maximumTreeEntries = 8_192;
const maximumTreeDepth = 32;
const maximumTreePathBytes = 1_024;
const fileReadChunkBytes = 1_048_576;

export interface ProvenanceTreeFile {
  readonly path: string;
  readonly byte_length: number;
  readonly sha256: string;
}

export interface StableProvenanceFile {
  readonly byteLength: number;
  readonly mode: number;
  readonly sha256: string;
  readonly bytes?: Buffer;
}

export interface ProvenanceFileTreeAudit {
  readonly files: readonly ProvenanceTreeFile[];
  readonly captures: ReadonlyMap<string, StableProvenanceFile>;
}

export interface ProvenanceFileTreeOptions {
  readonly maximumFileBytes: number;
  readonly maximumTreeBytes: number;
  readonly capturePaths: ReadonlySet<string>;
  readonly captureBytePaths: ReadonlySet<string>;
}

function fail(code: string, message: string, options?: ErrorOptions): never {
  throw new MutationRuntimeError(code, message, options);
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameFileIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function validTreeName(name: string): boolean {
  return (
    name.length > 0 &&
    Buffer.byteLength(name, "utf8") <= 255 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("\0") &&
    !/[\u0000-\u001f\u007f]/u.test(name) &&
    name.normalize("NFC") === name
  );
}

export async function readStableProvenanceFile(
  path: string,
  maximumBytes: number,
  captureBytes: boolean,
  expectedIdentity?: BigIntStats,
): Promise<StableProvenanceFile> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    fail(
      "mutation.environment_file",
      "environment provenance file budgets must be non-negative safe integers",
    );
  }
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (
      (expectedIdentity !== undefined && !sameFileIdentity(expectedIdentity, before)) ||
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size < 0n ||
      before.size > BigInt(maximumBytes) ||
      before.size > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      fail(
        "mutation.environment_file",
        "environment provenance files must be bounded regular files",
      );
    }
    const byteLength = Number(before.size);
    const hash = createHash("sha256");
    const captured: Buffer[] = [];
    const buffer = Buffer.allocUnsafe(
      Math.max(1, Math.min(fileReadChunkBytes, byteLength)),
    );
    let position = 0;
    while (position < byteLength) {
      const requested = Math.min(buffer.byteLength, byteLength - position);
      const { bytesRead } = await handle.read(buffer, 0, requested, position);
      if (bytesRead < 1) {
        fail(
          "mutation.environment_file",
          "environment provenance file ended before its audited byte length",
        );
      }
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      if (captureBytes) {
        captured.push(Buffer.from(chunk));
      }
      position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstat(path, { bigint: true });
    if (
      !sameFileIdentity(before, after) ||
      !sameFileIdentity(before, pathAfter) ||
      position !== byteLength
    ) {
      fail(
        "mutation.environment_file",
        "environment provenance file changed during its stable read",
      );
    }
    const capturedBytes = captureBytes
      ? Buffer.concat(captured, byteLength)
      : undefined;
    const result: {
      byteLength: number;
      mode: number;
      sha256: string;
      bytes?: Buffer;
    } = {
      byteLength,
      mode: Number(before.mode & 0o777n),
      sha256: hash.digest("hex"),
    };
    if (capturedBytes !== undefined) {
      Object.defineProperty(result, "bytes", {
        configurable: false,
        enumerable: true,
        get: () => Buffer.from(capturedBytes),
      });
    }
    return Object.freeze(result);
  } catch (error) {
    if (error instanceof MutationRuntimeError) {
      throw error;
    }
    throw new MutationRuntimeError(
      "mutation.environment_file",
      "environment provenance file verification failed",
      { cause: error },
    );
  } finally {
    await handle?.close();
  }
}

export async function auditProvenanceFileTree(
  rootInput: string,
  options: ProvenanceFileTreeOptions,
): Promise<ProvenanceFileTreeAudit> {
  if (
    !Number.isSafeInteger(options.maximumFileBytes) ||
    options.maximumFileBytes < 0 ||
    !Number.isSafeInteger(options.maximumTreeBytes) ||
    options.maximumTreeBytes < 0
  ) {
    fail(
      "mutation.environment_tree",
      "environment provenance tree budgets must be non-negative safe integers",
    );
  }
  const root = resolve(rootInput);
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(root);
  } catch (error) {
    fail(
      "mutation.environment_tree",
      "environment provenance tree root cannot be resolved",
      { cause: error },
    );
  }
  if (canonicalRoot !== root) {
    fail(
      "mutation.environment_tree",
      "environment provenance tree roots cannot be symbolic aliases",
    );
  }

  const files: ProvenanceTreeFile[] = [];
  const captures = new Map<string, StableProvenanceFile>();
  const inodes = new Set<string>();
  let totalBytes = 0;
  let totalDirectories = 0;
  let totalEntries = 0;

  const visit = async (
    directory: string,
    relativeDirectory: string,
    depth: number,
  ): Promise<void> => {
    totalDirectories += 1;
    if (totalDirectories > maximumTreeDirectories) {
      fail(
        "mutation.environment_tree",
        "environment provenance tree exceeds its directory-count budget",
      );
    }
    if (depth > maximumTreeDepth) {
      fail(
        "mutation.environment_tree",
        "environment provenance tree exceeds its directory-depth budget",
      );
    }
    const before = await lstat(directory, { bigint: true });
    if (!before.isDirectory()) {
      fail(
        "mutation.environment_tree",
        "environment provenance tree may contain only directories and regular files",
      );
    }
    const entries: Dirent[] = [];
    const directoryHandle = await opendir(directory);
    for await (const entry of directoryHandle) {
      totalEntries += 1;
      if (totalEntries > maximumTreeEntries) {
        fail(
          "mutation.environment_tree",
          "environment provenance tree exceeds its total-entry budget",
        );
      }
      entries.push(entry);
    }
    entries.sort((left, right) => codeUnitCompare(left.name, right.name));
    for (const entry of entries) {
      if (!validTreeName(entry.name)) {
        fail(
          "mutation.environment_tree",
          "environment provenance tree contains an unsafe or noncanonical name",
        );
      }
      const manifestPath =
        relativeDirectory === ""
          ? entry.name
          : posix.join(relativeDirectory, entry.name);
      if (Buffer.byteLength(manifestPath, "utf8") > maximumTreePathBytes) {
        fail(
          "mutation.environment_tree",
          "environment provenance tree path exceeds its byte-domain budget",
        );
      }
      const absolutePath = join(directory, entry.name);
      const stats = await lstat(absolutePath, { bigint: true });
      if (stats.isDirectory()) {
        await visit(absolutePath, manifestPath, depth + 1);
        continue;
      }
      if (!stats.isFile()) {
        fail(
          "mutation.environment_tree",
          "environment provenance tree rejects symbolic links and special entries",
        );
      }
      if (stats.nlink !== 1n) {
        fail(
          "mutation.environment_tree",
          "environment provenance tree cannot contain hard-linked files",
        );
      }
      const inodeKey = `${stats.dev}:${stats.ino}`;
      if (inodes.has(inodeKey)) {
        fail(
          "mutation.environment_tree",
          "environment provenance tree cannot contain hard-linked file aliases",
        );
      }
      inodes.add(inodeKey);
      if (files.length >= maximumTreeFiles) {
        fail(
          "mutation.environment_tree",
          "environment provenance tree exceeds its file-count budget",
        );
      }
      if (
        stats.size > BigInt(Number.MAX_SAFE_INTEGER) ||
        totalBytes + Number(stats.size) > options.maximumTreeBytes
      ) {
        fail(
          "mutation.environment_tree",
          "environment provenance tree exceeds its aggregate byte budget",
        );
      }
      const result = await readStableProvenanceFile(
        absolutePath,
        options.maximumFileBytes,
        options.captureBytePaths.has(manifestPath),
        stats,
      );
      totalBytes += result.byteLength;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > options.maximumTreeBytes) {
        fail(
          "mutation.environment_tree",
          "environment provenance tree exceeds its aggregate byte budget",
        );
      }
      files.push(
        Object.freeze({
          path: manifestPath,
          byte_length: result.byteLength,
          sha256: result.sha256,
        }),
      );
      if (options.capturePaths.has(manifestPath)) {
        captures.set(manifestPath, result);
      }
    }
    const after = await lstat(directory, { bigint: true });
    if (!sameFileIdentity(before, after)) {
      fail(
        "mutation.environment_tree",
        "environment provenance directory changed during traversal",
      );
    }
  };

  try {
    await visit(root, "", 0);
  } catch (error) {
    if (error instanceof MutationRuntimeError) {
      throw error;
    }
    fail(
      "mutation.environment_tree",
      "environment provenance tree verification failed",
      { cause: error },
    );
  }
  for (const capturePath of options.capturePaths) {
    if (!captures.has(capturePath)) {
      fail(
        "mutation.environment_tree",
        `environment provenance tree is missing required file ${capturePath}`,
      );
    }
  }
  files.sort((left, right) => codeUnitCompare(left.path, right.path));
  return Object.freeze({
    files: Object.freeze(files),
    captures: new ImmutableMapView(captures),
  });
}
