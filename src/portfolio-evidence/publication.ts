import { randomBytes } from "node:crypto";
import { lstat, rename } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { canonicalizePng } from "../artifacts/png.js";
import { parseCaptureSpec } from "../capture/validate.js";
import {
  canonicalJson,
  computeEnvironmentId,
  sha256Hex,
} from "../contracts/canonical.js";
import { PilotPortfolioEvidenceError } from "./errors.js";
import {
  createRepositoryStage,
  inspectRepositoryDirectory,
  listRepositoryDirectory,
  readStableRepositoryFile,
  removeRepositoryStage,
  syncRepositoryDirectory,
  writeRepositoryFile,
  type RepositoryDirectoryIdentity,
} from "./repository-filesystem.js";
import {
  pilotPortfolioEvidenceCaptureSpecFile,
  pilotPortfolioEvidenceManifestFile,
  type CapturedPilotPortfolioEvidence,
  type PilotPortfolioEvidenceManifest,
  type PilotPortfolioScreenshotIdentity,
  type VerifiedPilotPortfolioEvidence,
} from "./schema.js";
import { verifyPilotPortfolioSourceFreshness } from "./source-identity.js";
import { parsePilotPortfolioEvidenceManifest } from "./validate.js";

const outputNamePattern = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const maximumManifestBytes = 131_072;
const maximumEntries = 14;

export const PILOT_PORTFOLIO_EVIDENCE_V1_THREAT_MODEL = Object.freeze({
  filesystem:
    "owned local Linux filesystem; repository directories are non-writable by group/world",
  writers: "one cooperative same-process writer for the publication parent",
  readers:
    "standard Git checkout files; final directories only; MANIFEST.json is written last inside the stage",
  unsupportedMutators: "external same-uid writers, remote filesystems, root compromise",
});

function fail(code: string, message: string, options?: ErrorOptions): never {
  throw new PilotPortfolioEvidenceError(code, message, options);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

async function assertMissing(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return;
    }
    fail(
      "portfolio_evidence.output_inspection",
      "portfolio evidence output path could not be inspected",
      { cause: error },
    );
  }
  fail(
    "portfolio_evidence.output_exists",
    "portfolio evidence output must not already exist",
  );
}

function outputLocation(outputDirectory: unknown): {
  readonly output: string;
  readonly parent: string;
} {
  if (
    typeof outputDirectory !== "string" ||
    outputDirectory.length < 1 ||
    outputDirectory.length > 4_096 ||
    outputDirectory.includes("\0")
  ) {
    fail(
      "portfolio_evidence.output",
      "portfolio evidence output must be one bounded nonempty path",
    );
  }
  const output = resolve(outputDirectory);
  if (!outputNamePattern.test(basename(output))) {
    fail(
      "portfolio_evidence.output_name",
      "portfolio evidence output must use one canonical lowercase leaf name",
    );
  }
  return Object.freeze({ output, parent: dirname(output) });
}

function screenshotReferences(
  manifest: PilotPortfolioEvidenceManifest,
): readonly PilotPortfolioScreenshotIdentity[] {
  return Object.freeze(
    manifest.fixtures.flatMap((fixture) =>
      fixture.workflows.flatMap((workflow) =>
        workflow.checkpoints.map(({ screenshot }) => screenshot),
      ),
    ),
  );
}

function exactExpectedFileNames(
  manifest: PilotPortfolioEvidenceManifest,
): readonly string[] {
  const names = [
    pilotPortfolioEvidenceManifestFile,
    pilotPortfolioEvidenceCaptureSpecFile,
    ...screenshotReferences(manifest).map(({ file }) => file),
  ].sort();
  if (new Set(names).size !== maximumEntries) {
    fail(
      "portfolio_evidence.file_identity",
      "portfolio evidence file identities must be unique and complete",
    );
  }
  return Object.freeze(names);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
}

function verifyCaptureInput(capture: CapturedPilotPortfolioEvidence): {
  readonly manifest: PilotPortfolioEvidenceManifest;
  readonly manifestBytes: Buffer;
  readonly files: readonly {
    readonly name: string;
    readonly bytes: Buffer;
  }[];
} {
  if (
    capture === null ||
    typeof capture !== "object" ||
    capture.kind !== "captured_pilot_portfolio_evidence" ||
    capture.official !== false
  ) {
    fail(
      "portfolio_evidence.capture_capability",
      "publication requires a completed local Pilot portfolio capture",
    );
  }
  const manifestBytes = Buffer.from(capture.manifest_bytes);
  const manifest = parsePilotPortfolioEvidenceManifest(manifestBytes);
  if (canonicalJson(capture.manifest) !== canonicalJson(manifest)) {
    fail(
      "portfolio_evidence.manifest_binding",
      "capture manifest object differs from its canonical bytes",
    );
  }
  const expectedNames = exactExpectedFileNames(manifest).filter(
    (name) => name !== pilotPortfolioEvidenceManifestFile,
  );
  const files = capture.files
    .map(({ name, bytes }) => Object.freeze({ name, bytes: Buffer.from(bytes) }))
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
  if (
    files.length !== maximumEntries - 1 ||
    !sameStrings(
      files.map(({ name }) => name),
      expectedNames,
    )
  ) {
    fail(
      "portfolio_evidence.capture_files",
      "capture does not contain the exact closed evidence file set",
    );
  }
  const screenshotByName = new Map(
    screenshotReferences(manifest).map((reference) => [reference.file, reference]),
  );
  for (const file of files) {
    const reference =
      file.name === pilotPortfolioEvidenceCaptureSpecFile
        ? manifest.runtime.capture_spec
        : screenshotByName.get(file.name);
    if (
      reference === undefined ||
      reference.sha256 !== sha256Hex(file.bytes) ||
      reference.byte_length !== file.bytes.byteLength
    ) {
      fail(
        "portfolio_evidence.capture_file_binding",
        "capture file differs from its manifest byte identity",
      );
    }
  }
  return Object.freeze({
    manifest,
    manifestBytes,
    files: Object.freeze(files),
  });
}

function assertExactDirectoryEntries(
  actual: Awaited<ReturnType<typeof listRepositoryDirectory>>,
  expectedNames: readonly string[],
): void {
  if (
    actual.length !== expectedNames.length ||
    actual.some(
      (entry, index) =>
        entry.name !== expectedNames[index] ||
        !entry.isFile ||
        entry.isDirectory ||
        entry.isSymbolicLink,
    )
  ) {
    fail(
      "portfolio_evidence.topology",
      "portfolio evidence directory does not contain the exact immutable file set",
    );
  }
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function assertManifestCaptureSpecBindings(
  manifest: PilotPortfolioEvidenceManifest,
  captureSpecBytes: Buffer,
): void {
  if (
    manifest.runtime.capture_spec.sha256 !== sha256Hex(captureSpecBytes) ||
    manifest.runtime.capture_spec.byte_length !== captureSpecBytes.byteLength
  ) {
    fail(
      "portfolio_evidence.capture_spec_binding",
      "capture specification differs from its manifest byte identity",
    );
  }
  const captureSpec = parseCaptureSpec(captureSpecBytes);
  if (
    captureSpec.display.viewport.width !== 800 ||
    captureSpec.display.viewport.height !== 600 ||
    captureSpec.execution.kind !== "host" ||
    captureSpec.execution.platform !== "linux/amd64" ||
    !sameCanonicalJson(captureSpec.software.browser, manifest.runtime.browser) ||
    captureSpec.software.playwright.packages.playwright.version !==
      manifest.runtime.playwright.version ||
    captureSpec.software.playwright.installed_file_tree_sha256 !==
      manifest.runtime.playwright.installed_file_tree_sha256
  ) {
    fail(
      "portfolio_evidence.runtime_binding",
      "manifest runtime identity differs from the verified CaptureSpec",
    );
  }
  const environmentId = computeEnvironmentId(manifest.runtime.capture_spec);
  const taskIds = new Set<string>();
  const checkpointIds = new Set<string>();
  for (const fixture of manifest.fixtures) {
    for (const workflow of fixture.workflows) {
      if (workflow.environment_id !== environmentId) {
        fail(
          "portfolio_evidence.environment_binding",
          "workflow environment identity differs from the CaptureSpec",
        );
      }
      taskIds.add(workflow.task_id);
      for (const checkpoint of workflow.checkpoints) {
        checkpointIds.add(checkpoint.checkpoint_id);
      }
    }
  }
  if (taskIds.size !== 4 || checkpointIds.size !== 12) {
    fail(
      "portfolio_evidence.identity_collision",
      "portfolio task and checkpoint identities must be unique",
    );
  }
}

export async function verifyPilotPortfolioEvidence(
  bundleDirectory: string,
): Promise<VerifiedPilotPortfolioEvidence> {
  const root = resolve(bundleDirectory);
  const rootIdentity = await inspectRepositoryDirectory(root);
  const initialEntries = await listRepositoryDirectory(
    root,
    maximumEntries + 1,
    rootIdentity,
  );
  const manifestBytes = await readStableRepositoryFile(
    resolve(root, pilotPortfolioEvidenceManifestFile),
    maximumManifestBytes,
  );
  const manifest = parsePilotPortfolioEvidenceManifest(manifestBytes);
  const expectedNames = exactExpectedFileNames(manifest);
  assertExactDirectoryEntries(initialEntries, expectedNames);

  const captureSpecBytes = await readStableRepositoryFile(
    resolve(root, pilotPortfolioEvidenceCaptureSpecFile),
    65_536,
  );
  assertManifestCaptureSpecBindings(manifest, captureSpecBytes);
  for (const screenshot of screenshotReferences(manifest)) {
    const bytes = await readStableRepositoryFile(
      resolve(root, screenshot.file),
      screenshot.byte_length,
    );
    if (
      bytes.byteLength !== screenshot.byte_length ||
      sha256Hex(bytes) !== screenshot.sha256
    ) {
      fail(
        "portfolio_evidence.screenshot_binding",
        "screenshot differs from its checkpoint byte identity",
      );
    }
    let canonical;
    try {
      canonical = canonicalizePng(bytes, {
        width: screenshot.width,
        height: screenshot.height,
      }).bytes;
    } catch (error) {
      fail(
        "portfolio_evidence.screenshot_codec",
        "checkpoint screenshot is not a bounded canonical PNG",
        { cause: error },
      );
    }
    if (!canonical.equals(bytes)) {
      fail(
        "portfolio_evidence.screenshot_canonical",
        "checkpoint screenshot is not canonical PNG",
      );
    }
  }

  const finalEntries = await listRepositoryDirectory(
    root,
    maximumEntries + 1,
    rootIdentity,
  );
  assertExactDirectoryEntries(finalEntries, expectedNames);
  return Object.freeze({
    kind: "verified_pilot_portfolio_evidence",
    official: false,
    manifest,
    manifest_sha256: sha256Hex(manifestBytes),
    fixture_count: 2,
    workflow_count: 4,
    checkpoint_count: 12,
  });
}

export async function verifyPilotPortfolioEvidenceForRepository(
  repositoryRoot: string,
  bundleDirectory: string,
): Promise<VerifiedPilotPortfolioEvidence> {
  const verified = await verifyPilotPortfolioEvidence(bundleDirectory);
  await verifyPilotPortfolioSourceFreshness(repositoryRoot, verified.manifest.source);
  return verified;
}

/**
 * Writes every artifact into an owned repository-compatible stage, writes
 * MANIFEST.json last, verifies the complete stage, then exposes the directory
 * with one same-parent rename. Existing outputs are never replaced.
 */
export async function publishPilotPortfolioEvidence(
  outputDirectory: string,
  capture: CapturedPilotPortfolioEvidence,
): Promise<VerifiedPilotPortfolioEvidence> {
  const input = verifyCaptureInput(capture);
  const location = outputLocation(outputDirectory);
  const parentIdentity = await inspectRepositoryDirectory(location.parent);
  await assertMissing(location.output);
  const stagingName = `.impactdiff-stage-${randomBytes(16).toString("hex")}.tmp`;
  const stagingPath = resolve(location.parent, stagingName);
  let stagingIdentity: RepositoryDirectoryIdentity | undefined;
  let committed = false;
  let primaryError: unknown;
  try {
    stagingIdentity = await createRepositoryStage(
      stagingPath,
      location.parent,
      parentIdentity,
    );
    for (const file of input.files) {
      await writeRepositoryFile(stagingPath, file.name, file.bytes, stagingIdentity);
    }
    await writeRepositoryFile(
      stagingPath,
      pilotPortfolioEvidenceManifestFile,
      input.manifestBytes,
      stagingIdentity,
    );
    await syncRepositoryDirectory(stagingPath, stagingIdentity);
    await verifyPilotPortfolioEvidence(stagingPath);
    await assertMissing(location.output);
    await rename(stagingPath, location.output);
    committed = true;
    await syncRepositoryDirectory(location.parent, parentIdentity);
    await inspectRepositoryDirectory(location.output, stagingIdentity);
    return await verifyPilotPortfolioEvidence(location.output);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (!committed && stagingIdentity !== undefined) {
      try {
        await removeRepositoryStage(
          stagingPath,
          location.parent,
          stagingIdentity,
          parentIdentity,
        );
      } catch (cleanupError) {
        if (primaryError !== undefined) {
          throw new PilotPortfolioEvidenceError(
            "portfolio_evidence.stage_cleanup_uncertain",
            "evidence publication and owned stage cleanup both failed",
            {
              cause: new AggregateError(
                [primaryError, cleanupError],
                "publication and stage cleanup failure",
              ),
            },
          );
        }
        throw cleanupError;
      }
    }
  }
}
