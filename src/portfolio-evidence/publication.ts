import { randomBytes } from "node:crypto";
import { lstat, rename } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { canonicalizePng } from "../artifacts/png.js";
import {
  assertCaptureGraphBindings,
  parseAccessibilitySnapshot,
  parseActionPlan,
  parseCaptureSpec,
  parseLayoutSnapshot,
} from "../capture/validate.js";
import {
  canonicalJson,
  computeCheckpointId,
  computeEnvironmentId,
  computeSourceStateId,
  computeTaskId,
  parseCanonicalJson,
  sha256Hex,
} from "../contracts/canonical.js";
import type { ArtifactRef } from "../contracts/artifacts.js";
import { buildPilotFixtureActionPlanArtifacts } from "../pilot/fixture/action-plan.js";
import { parsePilotFixtureManifest } from "../pilot/fixture/validate.js";
import { parseSourceState } from "../source/validate.js";
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
  pilotPortfolioEvidenceCatalog,
  pilotPortfolioEvidenceManifestFile,
  type CapturedPilotPortfolioEvidence,
  type PilotPortfolioEvidenceManifest,
  type PilotPortfolioNamedArtifactIdentity,
  type PilotPortfolioScreenshotIdentity,
  type VerifiedPilotPortfolioEvidence,
} from "./schema.js";
import { verifyPilotPortfolioSourceFreshness } from "./source-identity.js";
import { parsePilotPortfolioEvidenceManifest } from "./validate.js";

const outputNamePattern = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const maximumManifestBytes = 131_072;
const maximumEntries = 50;

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

type BundleArtifactReference =
  PilotPortfolioNamedArtifactIdentity | PilotPortfolioScreenshotIdentity;

function bundleArtifactReferences(
  manifest: PilotPortfolioEvidenceManifest,
): readonly BundleArtifactReference[] {
  const references: BundleArtifactReference[] = [
    Object.freeze({
      file: pilotPortfolioEvidenceCaptureSpecFile,
      ...manifest.runtime.capture_spec,
    }),
  ];
  for (const fixture of manifest.fixtures) {
    references.push(fixture.fixture_manifest, fixture.source_state);
    for (const workflow of fixture.workflows) {
      references.push(workflow.action_plan, workflow.workflow_audit);
      for (const checkpoint of workflow.checkpoints) {
        references.push(
          checkpoint.screenshot,
          checkpoint.accessibility_tree,
          checkpoint.layout_graph,
        );
      }
    }
  }
  return Object.freeze(references);
}

function exactExpectedFileNames(
  manifest: PilotPortfolioEvidenceManifest,
): readonly string[] {
  const names = [
    pilotPortfolioEvidenceManifestFile,
    ...bundleArtifactReferences(manifest).map(({ file }) => file),
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
  const artifactByName = new Map(
    bundleArtifactReferences(manifest).map((reference) => [reference.file, reference]),
  );
  for (const file of files) {
    const reference = artifactByName.get(file.name);
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

function artifactReference(
  identity: Pick<
    PilotPortfolioNamedArtifactIdentity,
    "sha256" | "byte_length" | "media_type" | "format_version"
  >,
): ArtifactRef {
  return Object.freeze({
    sha256: identity.sha256,
    byte_length: identity.byte_length,
    media_type: identity.media_type,
    format_version: identity.format_version,
  });
}

function exactPlainRecord(
  value: unknown,
  expectedKeys: readonly string[],
  code: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(code, "portfolio evidence artifact must be a plain canonical object");
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpected.length ||
    actualKeys.some((key, index) => key !== sortedExpected[index])
  ) {
    fail(code, "portfolio evidence artifact has unexpected contract keys");
  }
  return record;
}

function authoredFixtureManifest(bytes: Buffer) {
  const payload =
    bytes.byteLength > 1 &&
    bytes[bytes.byteLength - 1] === 0x0a &&
    bytes[bytes.byteLength - 2] !== 0x0a &&
    bytes[bytes.byteLength - 2] !== 0x0d
      ? bytes.subarray(0, bytes.byteLength - 1)
      : bytes;
  try {
    const manifest = parsePilotFixtureManifest(payload);
    const canonical = Buffer.from(canonicalJson(manifest), "utf8");
    if (!canonical.equals(payload)) {
      fail(
        "portfolio_evidence.fixture_manifest_canonical",
        "fixture manifest artifact is not canonical JSON with at most one authored newline",
      );
    }
    return manifest;
  } catch (error) {
    if (error instanceof PilotPortfolioEvidenceError) throw error;
    fail(
      "portfolio_evidence.fixture_manifest_codec",
      "fixture manifest artifact is invalid",
      { cause: error },
    );
  }
}

function assertWorkflowAuditBindings(
  bytes: Buffer,
  fixtureManifest: ReturnType<typeof parsePilotFixtureManifest>,
  fixture: PilotPortfolioEvidenceManifest["fixtures"][number],
  workflow: PilotPortfolioEvidenceManifest["fixtures"][number]["workflows"][number],
): void {
  let value;
  try {
    value = parseCanonicalJson(bytes, {
      maximumBytes: 131_072,
      maximumDepth: 8,
      maximumValues: 1_024,
    });
  } catch (error) {
    fail(
      "portfolio_evidence.workflow_audit_codec",
      "workflow audit is not bounded canonical JSON",
      { cause: error },
    );
  }
  const audit = exactPlainRecord(
    value,
    [
      "kind",
      "official",
      "fixture_key",
      "fixture_revision",
      "source_state_id",
      "workflow_key",
      "task_id",
      "environment_id",
      "actions_executed",
      "checkpoint_after_action_ordinals",
      "resource_requests",
      "blocked_external_requests",
      "unexpected_fixture_requests",
    ],
    "portfolio_evidence.workflow_audit_schema",
  );
  const schedule = workflow.checkpoint_after_action_ordinals;
  if (
    audit.kind !== "pilot_fixture_workflow_authoring_audit" ||
    audit.official !== false ||
    audit.fixture_key !== fixture.fixture_key ||
    audit.fixture_revision !== fixture.fixture_revision ||
    audit.source_state_id !== fixture.source_state_id ||
    audit.workflow_key !== workflow.workflow_key ||
    audit.task_id !== workflow.task_id ||
    audit.environment_id !== workflow.environment_id ||
    audit.actions_executed !== workflow.actions_executed ||
    !Array.isArray(audit.checkpoint_after_action_ordinals) ||
    audit.checkpoint_after_action_ordinals.length !== schedule.length ||
    audit.checkpoint_after_action_ordinals.some(
      (ordinal, index) => ordinal !== schedule[index],
    ) ||
    !Array.isArray(audit.blocked_external_requests) ||
    audit.blocked_external_requests.length !== 0 ||
    !Array.isArray(audit.unexpected_fixture_requests) ||
    audit.unexpected_fixture_requests.length !== 0 ||
    !Array.isArray(audit.resource_requests)
  ) {
    fail(
      "portfolio_evidence.workflow_audit_binding",
      "workflow audit differs from its manifest workflow identity",
    );
  }
  const fixtureResourcePaths = new Set(
    fixtureManifest.resources.map(({ path }) => path),
  );
  const requestCounts = new Map<string, number>();
  let previousPath: string | undefined;
  let requestCount = 0;
  for (const requestValue of audit.resource_requests) {
    const request = exactPlainRecord(
      requestValue,
      ["path", "request_count"],
      "portfolio_evidence.workflow_audit_schema",
    );
    if (
      typeof request.path !== "string" ||
      !fixtureResourcePaths.has(request.path) ||
      (previousPath !== undefined && request.path <= previousPath) ||
      !Number.isSafeInteger(request.request_count) ||
      (request.request_count as number) < 1 ||
      (request.request_count as number) > 32
    ) {
      fail(
        "portfolio_evidence.workflow_audit_requests",
        "workflow resource requests are not unique, sorted, bounded fixture resources",
      );
    }
    previousPath = request.path;
    const boundedRequestCount = request.request_count as number;
    requestCounts.set(request.path, boundedRequestCount);
    requestCount += boundedRequestCount;
  }
  if (
    requestCount !== workflow.resource_request_count ||
    requestCounts.get(fixtureManifest.entrypoint) !== 1 ||
    requestCounts.get(fixtureManifest.font.path) !== 1 ||
    workflow.blocked_external_requests !== 0 ||
    workflow.unexpected_fixture_requests !== 0
  ) {
    fail(
      "portfolio_evidence.workflow_audit_count",
      "workflow request audit counts differ from the manifest",
    );
  }
}

function assertFixtureArtifactBindings(
  manifest: PilotPortfolioEvidenceManifest,
  bytesByName: ReadonlyMap<string, Buffer>,
): void {
  for (const [fixtureIndex, fixture] of manifest.fixtures.entries()) {
    const catalogFixture = pilotPortfolioEvidenceCatalog[fixtureIndex]!;
    const fixtureManifestBytes = bytesByName.get(fixture.fixture_manifest.file);
    const sourceStateBytes = bytesByName.get(fixture.source_state.file);
    if (fixtureManifestBytes === undefined || sourceStateBytes === undefined) {
      fail(
        "portfolio_evidence.fixture_artifacts",
        "fixture manifest or source-state artifact is absent",
      );
    }
    const fixtureManifest = authoredFixtureManifest(fixtureManifestBytes);
    if (
      fixtureManifest.application_key !== fixture.application_key ||
      fixtureManifest.fixture_key !== fixture.fixture_key ||
      fixtureManifest.revision !== fixture.fixture_revision ||
      fixtureManifest.workflows.length !== fixture.workflows.length
    ) {
      fail(
        "portfolio_evidence.fixture_manifest_binding",
        "fixture manifest differs from the closed portfolio catalog",
      );
    }
    let sourceState;
    try {
      sourceState = parseSourceState(sourceStateBytes);
    } catch (error) {
      fail(
        "portfolio_evidence.source_state_codec",
        "source-state artifact is invalid",
        { cause: error },
      );
    }
    const sourceStateReference = artifactReference(fixture.source_state);
    const expectedSourceState = {
      contract: "impactdiff.source-state",
      version: 1,
      source: {
        kind: "closed_fixture",
        fixture_id: fixtureManifest.fixture_key,
        revision: fixtureManifest.revision,
        license: fixtureManifest.license,
        entrypoint: fixtureManifest.entrypoint,
        raw_manifest: {
          sha256: fixture.fixture_manifest.sha256,
          byte_length: fixture.fixture_manifest.byte_length,
        },
        resources: fixtureManifest.resources,
      },
      initial_state: {
        kind: "fixture_default",
        route: "/",
        storage: "empty",
      },
    };
    if (
      !sameCanonicalJson(sourceState, expectedSourceState) ||
      fixture.source_state_id !== computeSourceStateId(sourceStateReference)
    ) {
      fail(
        "portfolio_evidence.source_state_binding",
        "source-state bytes or identity differ from the fixture manifest",
      );
    }

    const expectedPlans = buildPilotFixtureActionPlanArtifacts(
      fixtureManifest,
      fixture.fixture_manifest.sha256,
    );
    for (const [workflowIndex, workflow] of fixture.workflows.entries()) {
      const catalogWorkflow = catalogFixture.workflows[workflowIndex]!;
      const fixtureWorkflow = fixtureManifest.workflows[workflowIndex];
      const expectedPlan = expectedPlans[workflowIndex];
      const actionPlanBytes = bytesByName.get(workflow.action_plan.file);
      const workflowAuditBytes = bytesByName.get(workflow.workflow_audit.file);
      if (
        fixtureWorkflow === undefined ||
        fixtureWorkflow.workflow_key !== catalogWorkflow.workflow_key ||
        expectedPlan === undefined ||
        expectedPlan.workflow_key !== workflow.workflow_key ||
        actionPlanBytes === undefined ||
        workflowAuditBytes === undefined
      ) {
        fail(
          "portfolio_evidence.workflow_artifacts",
          "workflow artifacts differ from the fixture workflow catalog",
        );
      }
      let actionPlan;
      try {
        actionPlan = parseActionPlan(actionPlanBytes);
      } catch (error) {
        fail(
          "portfolio_evidence.action_plan_codec",
          "action-plan artifact is invalid",
          { cause: error },
        );
      }
      const actionPlanReference = artifactReference(workflow.action_plan);
      if (
        !Buffer.from(expectedPlan.bytes).equals(actionPlanBytes) ||
        !sameCanonicalJson(expectedPlan.reference, actionPlanReference) ||
        workflow.task_id !== computeTaskId(actionPlanReference) ||
        workflow.task_id !== expectedPlan.task_id ||
        actionPlan.actions.length !== workflow.actions_executed ||
        !sameCanonicalJson(
          actionPlan.checkpoints.map(
            ({ after_action_ordinal: afterActionOrdinal }) => afterActionOrdinal,
          ),
          workflow.checkpoint_after_action_ordinals,
        )
      ) {
        fail(
          "portfolio_evidence.action_plan_binding",
          "action-plan bytes, task identity, or schedule differ from the fixture workflow",
        );
      }
      assertWorkflowAuditBindings(
        workflowAuditBytes,
        fixtureManifest,
        fixture,
        workflow,
      );
      for (const [checkpointIndex, checkpoint] of workflow.checkpoints.entries()) {
        if (
          checkpoint.checkpoint_id !==
          computeCheckpointId(actionPlanReference, checkpointIndex)
        ) {
          fail(
            "portfolio_evidence.checkpoint_identity",
            "checkpoint identity is not derived from its action plan",
          );
        }
        const accessibilityBytes = bytesByName.get(checkpoint.accessibility_tree.file);
        const layoutBytes = bytesByName.get(checkpoint.layout_graph.file);
        if (accessibilityBytes === undefined || layoutBytes === undefined) {
          fail(
            "portfolio_evidence.checkpoint_artifacts",
            "checkpoint modality artifact is absent",
          );
        }
        let accessibility: ReturnType<typeof parseAccessibilitySnapshot>;
        let layout: ReturnType<typeof parseLayoutSnapshot>;
        try {
          accessibility = parseAccessibilitySnapshot(accessibilityBytes);
          layout = parseLayoutSnapshot(layoutBytes);
        } catch (error) {
          fail(
            "portfolio_evidence.checkpoint_modality_codec",
            "checkpoint accessibility or layout artifact is invalid",
            { cause: error },
          );
        }
        try {
          assertCaptureGraphBindings(actionPlan, accessibility, layout);
        } catch (error) {
          fail(
            "portfolio_evidence.checkpoint_graph_binding",
            "checkpoint accessibility and layout graphs differ from the action plan",
            { cause: error },
          );
        }
      }
    }
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

  const bytesByName = new Map<string, Buffer>();
  for (const reference of bundleArtifactReferences(manifest)) {
    const bytes = await readStableRepositoryFile(
      resolve(root, reference.file),
      reference.byte_length,
    );
    if (
      bytes.byteLength !== reference.byte_length ||
      sha256Hex(bytes) !== reference.sha256
    ) {
      fail(
        "portfolio_evidence.artifact_binding",
        "bundle artifact differs from its manifest byte identity",
      );
    }
    bytesByName.set(reference.file, bytes);
  }
  if (bytesByName.size !== maximumEntries - 1) {
    fail(
      "portfolio_evidence.artifact_cardinality",
      "bundle artifact identities are not unique and complete",
    );
  }
  const captureSpecBytes = bytesByName.get(pilotPortfolioEvidenceCaptureSpecFile);
  if (captureSpecBytes === undefined) {
    fail("portfolio_evidence.capture_spec_binding", "capture specification is absent");
  }
  assertManifestCaptureSpecBindings(manifest, captureSpecBytes);
  assertFixtureArtifactBindings(manifest, bytesByName);
  for (const screenshot of screenshotReferences(manifest)) {
    const bytes = bytesByName.get(screenshot.file);
    if (bytes === undefined) {
      fail("portfolio_evidence.screenshot_binding", "checkpoint screenshot is absent");
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
  await verifyPilotPortfolioSourceFreshness(repositoryRoot, verified.manifest);
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
