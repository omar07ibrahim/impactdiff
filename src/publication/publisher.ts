import { randomBytes } from "node:crypto";
import { lstat, realpath, rename } from "node:fs/promises";
import { join, resolve } from "node:path";

import { ArtifactStore, auditArtifactStorePair } from "../artifacts/cas.js";
import { canonicalJson } from "../contracts/canonical.js";
import type { ArtifactRef } from "../contracts/artifacts.js";
import { visibleArtifacts, sealedArtifacts } from "../contracts/artifacts.js";
import { createPublicationCodecSet } from "./codecs.js";
import { PairedPublicationError } from "./errors.js";
import {
  ensurePrivateDirectory,
  inspectPrivateDirectory,
  listDirectoryEntries,
  removeOwnedStagingDirectory,
  syncDirectory,
  writeImmutableFile,
} from "./filesystem.js";
import type { DirectoryIdentity } from "./filesystem.js";
import { snapshotPairedReleaseInput } from "./input.js";
import type { PairedReleaseInput, SnapshottedPairedReleaseInput } from "./input.js";
import {
  assertFinalPairedReleaseIdentity,
  verifyPairedRelease,
  verifyStagedPairedRelease,
} from "./verify.js";
import type { VerifiedPairedRelease } from "./verify.js";

const evidenceIdPattern = /^idev1_[0-9a-f]{64}$/u;
const stagingNamePattern = /^\.impactdiff-stage-[0-9a-f]{32}\.tmp$/u;
const maximumRepositoryEntries = 4_096;

interface SharedPublisherState {
  queue: Promise<void>;
  poisoned: boolean;
}

const sharedStates = new Map<string, SharedPublisherState>();
const openingStates = new Map<string, SharedPublisherState>();

function fail(code: string, message: string, options?: ErrorOptions): never {
  throw new PairedPublicationError(code, message, options);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }
    fail("publication.path", "publication path cannot be inspected", {
      cause: error,
    });
  }
}

function identityKey(identity: DirectoryIdentity): string {
  return `${identity.dev}:${identity.ino}`;
}

async function serializeSharedState<T>(
  shared: SharedPublisherState,
  operation: () => Promise<T>,
): Promise<T> {
  const result = shared.queue.then(async () => {
    if (shared.poisoned) {
      fail(
        "publication.poisoned",
        "publisher cannot continue after an uncertain committed state",
      );
    }
    return operation();
  });
  shared.queue = result.then(
    () => undefined,
    () => undefined,
  );
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

async function publishArtifacts(
  store: ArtifactStore,
  artifacts: SnapshottedPairedReleaseInput["visibleArtifacts"],
  codecs: ReturnType<typeof createPublicationCodecSet>,
): Promise<void> {
  for (const artifact of artifacts) {
    const codec = codecs.byMediaType.get(artifact.reference.media_type);
    if (codec === undefined) {
      fail(
        "publication.codec",
        `no fixed publication codec exists for ${artifact.reference.media_type}`,
      );
    }
    const published = await store.put(artifact.bytes, codec);
    if (!sameReference(published, artifact.reference)) {
      fail(
        "publication.canonical_reference",
        "canonical store output differs from the snapshotted artifact reference",
      );
    }
  }
}

async function assertRepositoryRoot(rootPath: string): Promise<{
  readonly rootIdentity: DirectoryIdentity;
  readonly releasesPath: string;
  readonly releasesIdentity: DirectoryIdentity;
}> {
  const absoluteRoot = resolve(rootPath);
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(absoluteRoot);
  } catch (error) {
    fail("publication.root", "publication repository root does not exist", {
      cause: error,
    });
  }
  if (canonicalRoot !== absoluteRoot) {
    fail(
      "publication.root_alias",
      "publication repository root cannot contain symbolic aliases",
    );
  }
  const rootIdentity = await inspectPrivateDirectory(absoluteRoot);
  const before = await listDirectoryEntries(absoluteRoot, 2, rootIdentity);
  if (before.some((entry) => entry.name !== "releases")) {
    fail(
      "publication.root_topology",
      "publication repository root contains an unexpected entry",
    );
  }
  const releasesPath = join(absoluteRoot, "releases");
  const ensured = await ensurePrivateDirectory(
    releasesPath,
    absoluteRoot,
    rootIdentity,
  );
  const after = await listDirectoryEntries(absoluteRoot, 2, rootIdentity);
  if (after.length !== 1 || after[0]?.name !== "releases" || !after[0].isDirectory) {
    fail(
      "publication.root_topology",
      "publication repository root must contain exactly releases",
    );
  }
  await syncDirectory(releasesPath, ensured.identity);
  await syncDirectory(absoluteRoot, rootIdentity);
  return Object.freeze({
    rootIdentity,
    releasesPath,
    releasesIdentity: ensured.identity,
  });
}

async function recoverOwnedStages(
  releasesPath: string,
  releasesIdentity: DirectoryIdentity,
): Promise<void> {
  const entries = await listDirectoryEntries(
    releasesPath,
    maximumRepositoryEntries,
    releasesIdentity,
  );
  for (const entry of entries) {
    const path = join(releasesPath, entry.name);
    if (stagingNamePattern.test(entry.name)) {
      if (!entry.isDirectory || entry.isSymbolicLink) {
        fail(
          "publication.staging_topology",
          "owned staging names must refer to real private directories",
        );
      }
      const identity = await inspectPrivateDirectory(path);
      await removeOwnedStagingDirectory(path, releasesPath, identity, releasesIdentity);
      continue;
    }
    if (!evidenceIdPattern.test(entry.name) || !entry.isDirectory) {
      fail(
        "publication.release_topology",
        "releases contains an unknown or malformed entry",
      );
    }
    await assertFinalPairedReleaseIdentity(path);
  }
}

export const PAIRED_PUBLICATION_V1_THREAT_MODEL = Object.freeze({
  filesystem: "private local Linux filesystem with same-parent directory rename",
  writers: "one same-process shared publisher queue per canonical root inode",
  readers: "final release directories only; visible child is the model boundary",
  unsupportedMutators: "external same-uid writers, remote filesystems, root compromise",
});

export class PairedReleasePublisher {
  readonly rootPath: string;
  readonly releasesPath: string;
  readonly #rootIdentity: DirectoryIdentity;
  readonly #releasesIdentity: DirectoryIdentity;
  readonly #shared: SharedPublisherState;

  private constructor(
    rootPath: string,
    releasesPath: string,
    rootIdentity: DirectoryIdentity,
    releasesIdentity: DirectoryIdentity,
    shared: SharedPublisherState,
  ) {
    this.rootPath = rootPath;
    this.releasesPath = releasesPath;
    this.#rootIdentity = rootIdentity;
    this.#releasesIdentity = releasesIdentity;
    this.#shared = shared;
    Object.freeze(this);
  }

  static async open(rootPath: string): Promise<PairedReleasePublisher> {
    const absoluteRoot = resolve(rootPath);
    let opening = openingStates.get(absoluteRoot);
    if (opening === undefined) {
      opening = { queue: Promise.resolve(), poisoned: false };
      openingStates.set(absoluteRoot, opening);
    }
    const repository = await serializeSharedState(opening, async () =>
      assertRepositoryRoot(absoluteRoot),
    );
    const key = identityKey(repository.rootIdentity);
    let shared = sharedStates.get(key);
    if (shared === undefined) {
      shared = { queue: Promise.resolve(), poisoned: false };
      sharedStates.set(key, shared);
    }
    const publisher = new PairedReleasePublisher(
      resolve(rootPath),
      repository.releasesPath,
      repository.rootIdentity,
      repository.releasesIdentity,
      shared,
    );
    await publisher.#serialize(async () => {
      await inspectPrivateDirectory(publisher.rootPath, publisher.#rootIdentity);
      await recoverOwnedStages(publisher.releasesPath, publisher.#releasesIdentity);
    });
    return publisher;
  }

  async #serialize<T>(operation: () => Promise<T>): Promise<T> {
    return serializeSharedState(this.#shared, operation);
  }

  publish(input: PairedReleaseInput): Promise<VerifiedPairedRelease>;
  async publish(input: unknown): Promise<VerifiedPairedRelease> {
    const snapshot = snapshotPairedReleaseInput(input);
    return this.#serialize(async () => this.#publishSnapshot(snapshot));
  }

  async #publishSnapshot(
    snapshot: SnapshottedPairedReleaseInput,
  ): Promise<VerifiedPairedRelease> {
    await inspectPrivateDirectory(this.rootPath, this.#rootIdentity);
    await inspectPrivateDirectory(this.releasesPath, this.#releasesIdentity);
    const finalPath = join(this.releasesPath, snapshot.evidence.evidence_id);
    if (await pathExists(finalPath)) {
      const existing = await verifyPairedRelease(finalPath);
      if (existing.commit.publication_id !== snapshot.commit.publication_id) {
        fail(
          "publication.conflict",
          "visible evidence identity already names a different sealed publication",
        );
      }
      return existing;
    }
    const releaseEntries = await listDirectoryEntries(
      this.releasesPath,
      maximumRepositoryEntries,
      this.#releasesIdentity,
    );
    if (releaseEntries.length >= maximumRepositoryEntries) {
      fail(
        "publication.repository_capacity",
        "publication repository has reached its bounded release capacity",
      );
    }

    const stagingName = `.impactdiff-stage-${randomBytes(16).toString("hex")}.tmp`;
    const stagingPath = join(this.releasesPath, stagingName);
    let stagingIdentity: DirectoryIdentity | undefined;
    let committed = false;
    try {
      const staging = await ensurePrivateDirectory(
        stagingPath,
        this.releasesPath,
        this.#releasesIdentity,
      );
      if (!staging.created) {
        fail("publication.stage_collision", "random staging path already exists");
      }
      stagingIdentity = staging.identity;

      const visiblePath = join(stagingPath, "visible");
      const sealedPath = join(stagingPath, "sealed");
      const visible = await ensurePrivateDirectory(
        visiblePath,
        stagingPath,
        stagingIdentity,
      );
      const sealed = await ensurePrivateDirectory(
        sealedPath,
        stagingPath,
        stagingIdentity,
      );
      const evidencePath = join(visiblePath, "evidence");
      const visibleCasPath = join(visiblePath, "cas");
      const recordsPath = join(sealedPath, "records");
      const sealedCasPath = join(sealedPath, "cas");
      const evidenceDirectory = await ensurePrivateDirectory(
        evidencePath,
        visiblePath,
        visible.identity,
      );
      await ensurePrivateDirectory(visibleCasPath, visiblePath, visible.identity);
      const recordsDirectory = await ensurePrivateDirectory(
        recordsPath,
        sealedPath,
        sealed.identity,
      );
      await ensurePrivateDirectory(sealedCasPath, sealedPath, sealed.identity);

      const codecs = createPublicationCodecSet();
      const visibleStore = await ArtifactStore.open(visibleCasPath, codecs.codecs);
      const sealedStore = await ArtifactStore.open(sealedCasPath, codecs.codecs);
      await publishArtifacts(visibleStore, snapshot.visibleArtifacts, codecs);
      await publishArtifacts(sealedStore, snapshot.sealedArtifacts, codecs);

      await writeImmutableFile(
        evidencePath,
        `${snapshot.evidence.evidence_id}.json`,
        Buffer.from(canonicalJson(snapshot.evidence), "utf8"),
        evidenceDirectory.identity,
      );
      await writeImmutableFile(
        recordsPath,
        `${snapshot.sealedRecord.sealed_record_id}.json`,
        Buffer.from(canonicalJson(snapshot.sealedRecord), "utf8"),
        recordsDirectory.identity,
      );
      await auditArtifactStorePair(
        visibleStore,
        visibleArtifacts(snapshot.evidence),
        sealedStore,
        sealedArtifacts(snapshot.sealedRecord),
      );
      await writeImmutableFile(
        stagingPath,
        "COMMIT.json",
        Buffer.from(canonicalJson(snapshot.commit), "utf8"),
        stagingIdentity,
      );
      await syncDirectory(visiblePath, visible.identity);
      await syncDirectory(sealedPath, sealed.identity);
      await syncDirectory(stagingPath, stagingIdentity);

      const staged = await verifyStagedPairedRelease(
        stagingPath,
        snapshot.evidence.evidence_id,
      );
      if (staged.commit.publication_id !== snapshot.commit.publication_id) {
        fail(
          "publication.staging_verification",
          "staging verification returned a different publication identity",
        );
      }
      if (await pathExists(finalPath)) {
        fail(
          "publication.conflict",
          "final publication path appeared before the commit point",
        );
      }
      await inspectPrivateDirectory(stagingPath, stagingIdentity);
      await rename(stagingPath, finalPath);
      committed = true;
      try {
        await inspectPrivateDirectory(finalPath, stagingIdentity);
      } catch (error) {
        this.#shared.poisoned = true;
        fail(
          "publication.commit_uncertain",
          "publication rename completed but final directory identity is unconfirmed",
          { cause: error },
        );
      }
      try {
        await syncDirectory(this.releasesPath, this.#releasesIdentity);
      } catch (error) {
        this.#shared.poisoned = true;
        fail(
          "publication.commit_uncertain",
          "publication is visible but parent-directory durability is unconfirmed",
          { cause: error },
        );
      }
      try {
        const published = await verifyPairedRelease(finalPath);
        if (published.commit.publication_id !== snapshot.commit.publication_id) {
          fail(
            "publication.final_identity",
            "reopened publication has a different commit identity",
          );
        }
        return published;
      } catch (error) {
        this.#shared.poisoned = true;
        fail(
          "publication.committed_invalid",
          "committed publication failed strict reopen verification",
          { cause: error },
        );
      }
    } catch (error) {
      if (committed) {
        throw error;
      }
      if (stagingIdentity === undefined) {
        if (errorCode(error) === "publication.directory_create_uncertain") {
          this.#shared.poisoned = true;
        }
        throw error;
      }
      try {
        await removeOwnedStagingDirectory(
          stagingPath,
          this.releasesPath,
          stagingIdentity,
          this.#releasesIdentity,
        );
      } catch (cleanupError) {
        this.#shared.poisoned = true;
        throw new PairedPublicationError(
          "publication.cleanup_uncertain",
          "paired publication failed and staging cleanup could not be confirmed",
          {
            cause: new AggregateError(
              [error, cleanupError],
              "publication failure and cleanup failure",
            ),
          },
        );
      }
      throw error;
    }
  }
}
