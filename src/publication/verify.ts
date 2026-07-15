import { basename, join, resolve as resolvePath } from "node:path";

import { ArtifactStore, auditArtifactStorePair } from "../artifacts/cas.js";
import type { ArtifactStoreAudit } from "../artifacts/cas.js";
import { sealedArtifacts, visibleArtifacts } from "../contracts/artifacts.js";
import type { ArtifactRef } from "../contracts/artifacts.js";
import { parseCanonicalJson } from "../contracts/canonical.js";
import { validateResolvedEvidenceRecordBundle } from "../contracts/resolved-record.js";
import type { ResolvedEvidenceRecordBundle } from "../contracts/resolved-record.js";
import type { EvidenceManifest, SealedRecord } from "../contracts/schema.js";
import { createPublicationCodecSet } from "./codecs.js";
import { PairedPublicationError } from "./errors.js";
import {
  inspectPrivateDirectory,
  listDirectoryEntries,
  readStableImmutableFile,
} from "./filesystem.js";
import type { DirectoryEntrySnapshot, DirectoryIdentity } from "./filesystem.js";
import type { PairedPublicationCommit } from "./schema.js";
import {
  validatePairedPublicationCommit,
  validatePairedPublicationRecords,
} from "./validate.js";
import type { PairedPublicationRecords } from "./validate.js";

const maximumCommitBytes = 65_536;
const maximumRecordBytes = 16_777_216;
const evidenceIdPattern = /^idev1_[0-9a-f]{64}$/u;
const metadataParseLimits = Object.freeze({
  maximumDepth: 32,
  maximumValues: 1_000_000,
});

type EntryKind = "directory" | "file";

interface ExpectedEntry {
  readonly name: string;
  readonly kind: EntryKind;
}

interface InspectedDirectory {
  readonly path: string;
  readonly identity: DirectoryIdentity;
  readonly expected: readonly ExpectedEntry[];
}

export interface VerifiedPairedReleasePaths {
  readonly releasePath: string;
  readonly commitPath: string;
  readonly evidencePath: string;
  readonly visibleCasPath: string;
  readonly sealedRecordPath: string;
  readonly sealedCasPath: string;
}

export interface VerifiedPairedReleaseAudits {
  readonly visible: ArtifactStoreAudit;
  readonly sealed: ArtifactStoreAudit;
}

export interface VerifiedPairedRelease {
  readonly paths: VerifiedPairedReleasePaths;
  readonly records: PairedPublicationRecords;
  readonly audits: VerifiedPairedReleaseAudits;
  readonly resolved: ResolvedEvidenceRecordBundle;
  readonly commit: PairedPublicationCommit;
  readonly evidence: EvidenceManifest;
  readonly sealedRecord: SealedRecord;
}

function fail(code: string, message: string, options?: ErrorOptions): never {
  throw new PairedPublicationError(code, message, options);
}

function assertExactEntries(
  entries: readonly DirectoryEntrySnapshot[],
  expected: readonly ExpectedEntry[],
  path: string,
): void {
  const expectedByName = new Map(expected.map((entry) => [entry.name, entry]));
  if (entries.length !== expected.length) {
    fail(
      "publication.topology",
      `${path} does not contain the exact paired-release entries`,
    );
  }
  for (const entry of entries) {
    const wanted = expectedByName.get(entry.name);
    const exactKind =
      wanted?.kind === "directory"
        ? entry.isDirectory && !entry.isFile
        : wanted?.kind === "file"
          ? entry.isFile && !entry.isDirectory
          : false;
    if (wanted === undefined || entry.isSymbolicLink || !exactKind) {
      fail("publication.topology", `${path} contains an unexpected entry or file type`);
    }
  }
}

async function inspectExactDirectory(
  path: string,
  expected: readonly ExpectedEntry[],
): Promise<InspectedDirectory> {
  const identity = await inspectPrivateDirectory(path);
  const entries = await listDirectoryEntries(path, expected.length + 1, identity);
  assertExactEntries(entries, expected, path);
  return Object.freeze({ path, identity, expected });
}

async function recheckExactDirectory(directory: InspectedDirectory): Promise<void> {
  await inspectPrivateDirectory(directory.path, directory.identity);
  const entries = await listDirectoryEntries(
    directory.path,
    directory.expected.length + 1,
    directory.identity,
  );
  assertExactEntries(entries, directory.expected, directory.path);
}

function parseMetadata(bytes: Buffer, maximumBytes: number): unknown {
  return parseCanonicalJson(bytes, {
    ...metadataParseLimits,
    maximumBytes,
  });
}

function assertFinalReleasePath(
  rootPath: string,
  commit: PairedPublicationCommit,
): void {
  if (basename(rootPath) !== commit.evidence_manifest.id) {
    fail(
      "publication.path_binding",
      "final release directory name must equal its committed evidence identity",
    );
  }
}

export async function assertFinalPairedReleaseIdentity(
  releasePath: string,
): Promise<void> {
  if (typeof releasePath !== "string" || releasePath.length === 0) {
    fail("publication.path", "release path must be a non-empty string");
  }
  const rootPath = resolvePath(releasePath);
  const root = await inspectExactDirectory(rootPath, [
    { name: "COMMIT.json", kind: "file" },
    { name: "sealed", kind: "directory" },
    { name: "visible", kind: "directory" },
  ]);
  const commit = validatePairedPublicationCommit(
    parseMetadata(
      await readStableImmutableFile(join(rootPath, "COMMIT.json"), maximumCommitBytes),
      maximumCommitBytes,
    ),
  );
  assertFinalReleasePath(rootPath, commit);
  await recheckExactDirectory(root);
}

function cachedReader(
  store: ArtifactStore,
): (reference: ArtifactRef) => Promise<Buffer> {
  const reads = new Map<string, Promise<Buffer>>();
  return (reference) => {
    let pending = reads.get(reference.sha256);
    if (pending === undefined) {
      pending = store.readReferencedBytes(reference);
      reads.set(reference.sha256, pending);
    }
    return pending;
  };
}

type CheckpointReference = EvidenceManifest["pair"]["baseline"]["checkpoints"][number];

async function resolveCheckpoints(
  checkpoints: readonly CheckpointReference[],
  read: (reference: ArtifactRef) => Promise<Buffer>,
): Promise<
  readonly {
    readonly screenshot: Buffer;
    readonly accessibility_tree: Buffer;
    readonly layout_graph: Buffer;
  }[]
> {
  const resolved = await Promise.all(
    checkpoints.map(async (checkpoint) =>
      Object.freeze({
        screenshot: await read(checkpoint.screenshot),
        accessibility_tree: await read(checkpoint.accessibility_tree),
        layout_graph: await read(checkpoint.layout_graph),
      }),
    ),
  );
  return Object.freeze(resolved);
}

async function reconstructResolvedRecord(
  evidence: EvidenceManifest,
  sealedRecord: SealedRecord,
  visibleStore: ArtifactStore,
  sealedStore: ArtifactStore,
): Promise<ResolvedEvidenceRecordBundle> {
  const readVisible = cachedReader(visibleStore);
  const readSealed = cachedReader(sealedStore);
  const [actionPlan, captureSpec, baseline, candidate] = await Promise.all([
    readVisible(evidence.task.action_plan),
    readVisible(evidence.environment.capture_spec),
    resolveCheckpoints(evidence.pair.baseline.checkpoints, readVisible),
    resolveCheckpoints(evidence.pair.candidate.checkpoints, readVisible),
  ]);
  const [sourceState, mutationPlan, preconditionReport, changedSurface] =
    await Promise.all([
      readSealed(sealedRecord.provenance.source_state),
      readSealed(sealedRecord.intervention.parameters),
      readSealed(sealedRecord.intervention.preconditions),
      readSealed(sealedRecord.intervention.changed_surface),
    ]);

  const resolveOutcome = async (outcome: SealedRecord["execution"]["baseline"]) =>
    Object.freeze({
      final_state_oracle: await readSealed(outcome.final_state_oracle),
      accessibility_oracle: await readSealed(outcome.accessibility_oracle),
      raw_trace: await readSealed(outcome.raw_trace),
    });
  const [baselineOutcome, candidateOutcome, localization] = await Promise.all([
    resolveOutcome(sealedRecord.execution.baseline),
    resolveOutcome(sealedRecord.execution.candidate),
    sealedRecord.labels.localization === null
      ? Promise.resolve(null)
      : readSealed(sealedRecord.labels.localization),
  ]);

  return validateResolvedEvidenceRecordBundle({
    manifest: evidence,
    sealed_record: sealedRecord,
    action_plan: actionPlan,
    capture_spec: captureSpec,
    pair: Object.freeze({
      baseline: Object.freeze({ checkpoints: baseline }),
      candidate: Object.freeze({ checkpoints: candidate }),
    }),
    source_state: sourceState,
    mutation_plan: mutationPlan,
    precondition_report: preconditionReport,
    changed_surface: changedSurface,
    execution: Object.freeze({
      baseline: baselineOutcome,
      candidate: candidateOutcome,
    }),
    localization,
  });
}

/**
 * Reopens a committed paired release without accepting caller-selected codecs.
 * Every metadata file, CAS leaf, directory member, and resolved cross-record
 * derivation is verified before any result is returned.
 */
async function verifyPairedReleaseInternal(
  releasePath: string,
  stagedEvidenceId?: string,
): Promise<VerifiedPairedRelease> {
  if (typeof releasePath !== "string" || releasePath.length === 0) {
    fail("publication.path", "release path must be a non-empty string");
  }
  const rootPath = resolvePath(releasePath);
  const commitPath = join(rootPath, "COMMIT.json");
  const visiblePath = join(rootPath, "visible");
  const sealedPath = join(rootPath, "sealed");
  const root = await inspectExactDirectory(rootPath, [
    { name: "COMMIT.json", kind: "file" },
    { name: "sealed", kind: "directory" },
    { name: "visible", kind: "directory" },
  ]);

  const commitBytes = await readStableImmutableFile(commitPath, maximumCommitBytes);
  const commit = validatePairedPublicationCommit(
    parseMetadata(commitBytes, maximumCommitBytes),
  );
  if (stagedEvidenceId === undefined) {
    assertFinalReleasePath(rootPath, commit);
  } else if (commit.evidence_manifest.id !== stagedEvidenceId) {
    fail(
      "publication.path_binding",
      "staging release does not contain the expected evidence identity",
    );
  }
  const evidenceFileName = `${commit.evidence_manifest.id}.json`;
  const sealedRecordFileName = `${commit.sealed_record.id}.json`;
  const evidenceDirectoryPath = join(visiblePath, "evidence");
  const visibleCasPath = join(visiblePath, "cas");
  const sealedRecordsPath = join(sealedPath, "records");
  const sealedCasPath = join(sealedPath, "cas");
  const evidencePath = join(evidenceDirectoryPath, evidenceFileName);
  const sealedRecordPath = join(sealedRecordsPath, sealedRecordFileName);

  const [visible, sealed, evidenceDirectory, sealedRecords] = await Promise.all([
    inspectExactDirectory(visiblePath, [
      { name: "cas", kind: "directory" },
      { name: "evidence", kind: "directory" },
    ]),
    inspectExactDirectory(sealedPath, [
      { name: "cas", kind: "directory" },
      { name: "records", kind: "directory" },
    ]),
    inspectExactDirectory(evidenceDirectoryPath, [
      { name: evidenceFileName, kind: "file" },
    ]),
    inspectExactDirectory(sealedRecordsPath, [
      { name: sealedRecordFileName, kind: "file" },
    ]),
  ]);
  const [evidenceBytes, sealedRecordBytes] = await Promise.all([
    readStableImmutableFile(evidencePath, maximumRecordBytes),
    readStableImmutableFile(sealedRecordPath, maximumRecordBytes),
  ]);
  const records = validatePairedPublicationRecords(
    commit,
    parseMetadata(evidenceBytes, maximumRecordBytes),
    parseMetadata(sealedRecordBytes, maximumRecordBytes),
  );

  const codecSet = createPublicationCodecSet();
  const [visibleStore, sealedStore] = await Promise.all([
    ArtifactStore.open(visibleCasPath, codecSet.codecs),
    ArtifactStore.open(sealedCasPath, codecSet.codecs),
  ]);
  const audits = await auditArtifactStorePair(
    visibleStore,
    visibleArtifacts(records.evidence),
    sealedStore,
    sealedArtifacts(records.sealedRecord),
  );
  const resolved = await reconstructResolvedRecord(
    records.evidence,
    records.sealedRecord,
    visibleStore,
    sealedStore,
  );

  await Promise.all(
    [root, visible, sealed, evidenceDirectory, sealedRecords].map(
      recheckExactDirectory,
    ),
  );
  const paths = Object.freeze({
    releasePath: rootPath,
    commitPath,
    evidencePath,
    visibleCasPath,
    sealedRecordPath,
    sealedCasPath,
  });
  return Object.freeze({
    paths,
    records,
    audits,
    resolved,
    commit: records.commit,
    evidence: records.evidence,
    sealedRecord: records.sealedRecord,
  });
}

export function verifyPairedRelease(
  releasePath: string,
): Promise<VerifiedPairedRelease> {
  return verifyPairedReleaseInternal(releasePath);
}

export function verifyStagedPairedRelease(
  releasePath: string,
  evidenceId: string,
): Promise<VerifiedPairedRelease> {
  if (!evidenceIdPattern.test(evidenceId)) {
    return Promise.reject(
      new PairedPublicationError(
        "publication.path_binding",
        "expected staging evidence identity is malformed",
      ),
    );
  }
  return verifyPairedReleaseInternal(releasePath, evidenceId);
}
