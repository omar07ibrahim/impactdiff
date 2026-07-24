import { join } from "node:path";

import { canonicalizePng } from "../artifacts/png.js";
import {
  parseAccessibilitySnapshot,
  parseCaptureSpec,
  parseLayoutSnapshot,
} from "../capture/validate.js";
import { canonicalJson, sha256Hex } from "../contracts/canonical.js";
import { readStableProvenanceFile } from "../mutations/provenance-files.js";
import { loadPilotFixtureAuthoringPackage } from "../pilot/fixture/package.js";
import {
  capturePilotFixtureAuthoringWorkflow,
  launchPilotFixtureAuthoringEnvironment,
  type PilotFixtureAuthoringEnvironment,
} from "../pilot/runtime/index.js";
import { PilotPortfolioEvidenceError } from "./errors.js";
import { publishPilotPortfolioEvidence } from "./publication.js";
import {
  pilotPortfolioCheckpointKeys,
  pilotPortfolioEvidenceCaptureSpecFile,
  pilotPortfolioEvidenceCatalog,
  pilotPortfolioEvidenceContract,
  pilotPortfolioEvidenceVersion,
  pilotPortfolioScreenshotFileName,
  type CapturedPilotPortfolioEvidence,
  type PilotPortfolioCatalogFixture,
  type PilotPortfolioEvidenceFile,
  type PilotPortfolioEvidenceManifest,
  type PilotPortfolioFixtureEvidence,
  type PilotPortfolioWorkflowEvidence,
  type VerifiedPilotPortfolioEvidence,
} from "./schema.js";
import { inspectPilotPortfolioSourceIdentity } from "./source-identity.js";
import { parsePilotPortfolioEvidenceManifest } from "./validate.js";

function fail(code: string, message: string, options?: ErrorOptions): never {
  throw new PilotPortfolioEvidenceError(code, message, options);
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactStrings(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

async function closeEnvironment(
  environment: PilotFixtureAuthoringEnvironment,
  primaryError: unknown,
): Promise<void> {
  try {
    await environment.close();
  } catch (closeError) {
    if (primaryError === undefined) {
      fail(
        "portfolio_evidence.environment_close",
        "Pilot capture environment could not be closed",
        { cause: closeError },
      );
    }
    throw new PilotPortfolioEvidenceError(
      "portfolio_evidence.capture_cleanup",
      "Pilot evidence capture and browser cleanup both failed",
      {
        cause: new AggregateError(
          [primaryError, closeError],
          "capture failure and browser cleanup failure",
        ),
      },
    );
  }
}

function assertPinnedNodeRuntime(): string {
  if (
    process.versions.node !== "22.23.1" ||
    process.platform !== "linux" ||
    process.arch !== "x64" ||
    typeof process.versions.modules !== "string" ||
    !/^[1-9][0-9]{0,5}$/u.test(process.versions.modules)
  ) {
    fail(
      "portfolio_evidence.node_runtime",
      "portfolio capture requires the pinned Node.js 22.23.1 linux/amd64 runtime",
    );
  }
  return process.versions.modules;
}

function assertFixtureCatalog(
  fixture: PilotPortfolioCatalogFixture,
  authoringPackage: Awaited<ReturnType<typeof loadPilotFixtureAuthoringPackage>>,
): void {
  const manifest = authoringPackage.manifest;
  if (
    manifest.application_key !== fixture.application_key ||
    manifest.fixture_key !== fixture.fixture_key ||
    manifest.revision !== fixture.fixture_revision ||
    !exactStrings(
      manifest.workflows.map(({ workflow_key: key }) => key),
      fixture.workflows.map(({ workflow_key: key }) => key),
    ) ||
    !exactStrings(
      authoringPackage.workflows.map(({ workflow_key: key }) => key),
      fixture.workflows.map(({ workflow_key: key }) => key),
    )
  ) {
    fail(
      "portfolio_evidence.fixture_catalog",
      "Pilot fixture package differs from the closed two-application portfolio catalog",
    );
  }
}

function byteIdentity(bytes: Uint8Array) {
  return Object.freeze({
    sha256: sha256Hex(bytes),
    byte_length: bytes.byteLength,
  });
}

async function captureFixture(
  repositoryRoot: string,
  fixture: PilotPortfolioCatalogFixture,
  expectedCaptureSpec: Buffer | undefined,
): Promise<{
  readonly fixture: PilotPortfolioFixtureEvidence;
  readonly captureSpec: Buffer;
  readonly files: readonly PilotPortfolioEvidenceFile[];
}> {
  const fixtureDirectory = join(repositoryRoot, fixture.fixture_directory);
  const [authoringPackage, manifestFile] = await Promise.all([
    loadPilotFixtureAuthoringPackage(fixtureDirectory),
    readStableProvenanceFile(join(fixtureDirectory, "fixture.json"), 131_072, false),
  ]);
  assertFixtureCatalog(fixture, authoringPackage);

  const environment = await launchPilotFixtureAuthoringEnvironment(fixtureDirectory);
  let primaryError: unknown;
  let closeAttempted = false;
  try {
    const captureSpec = Buffer.from(environment.capture_spec.bytes);
    if (
      expectedCaptureSpec !== undefined &&
      !sameBytes(captureSpec, expectedCaptureSpec)
    ) {
      fail(
        "portfolio_evidence.capture_spec_drift",
        "Pilot applications produced different verified capture environments",
      );
    }

    const files: PilotPortfolioEvidenceFile[] = [];
    const workflows: PilotPortfolioWorkflowEvidence[] = [];
    for (const [workflowIndex, catalogWorkflow] of fixture.workflows.entries()) {
      const result = await capturePilotFixtureAuthoringWorkflow(
        environment,
        catalogWorkflow.workflow_key,
      );
      const audit = result.audit;
      if (
        result.official !== false ||
        audit.official !== false ||
        audit.fixture_key !== fixture.fixture_key ||
        audit.fixture_revision !== fixture.fixture_revision ||
        audit.source_state_id !== authoringPackage.source_state_id ||
        audit.workflow_key !== catalogWorkflow.workflow_key ||
        audit.actions_executed !== 4 ||
        !exactStrings(
          audit.checkpoint_after_action_ordinals.map(String),
          catalogWorkflow.checkpoint_after_action_ordinals.map(String),
        ) ||
        audit.blocked_external_requests.length !== 0 ||
        audit.unexpected_fixture_requests.length !== 0
      ) {
        fail(
          "portfolio_evidence.capture_audit",
          "Pilot capture audit differs from the closed portfolio evidence boundary",
        );
      }
      const checkpoints = result.checkpoints.map((checkpoint, checkpointIndex) => {
        if (
          checkpoint.ordinal !== checkpointIndex ||
          checkpointIndex < 0 ||
          checkpointIndex > 2
        ) {
          fail(
            "portfolio_evidence.checkpoint_order",
            "Pilot checkpoints must remain contiguous and three-wide",
          );
        }
        const ordinal = checkpointIndex as 0 | 1 | 2;
        const screenshot = checkpoint.screenshot;
        const canonicalScreenshot = canonicalizePng(screenshot, {
          width: 800,
          height: 600,
        }).bytes;
        if (!canonicalScreenshot.equals(screenshot)) {
          fail(
            "portfolio_evidence.screenshot_canonical",
            "Pilot checkpoint screenshot is not canonical PNG",
          );
        }
        const accessibilityTree = checkpoint.accessibility_tree;
        const layoutGraph = checkpoint.layout_graph;
        parseAccessibilitySnapshot(accessibilityTree);
        parseLayoutSnapshot(layoutGraph);
        const fileName = pilotPortfolioScreenshotFileName(
          fixture,
          catalogWorkflow,
          ordinal,
        );
        files.push(
          Object.freeze({
            name: fileName,
            bytes: Buffer.from(screenshot),
          }),
        );
        return Object.freeze({
          key: pilotPortfolioCheckpointKeys[ordinal],
          ordinal,
          after_action_ordinal:
            catalogWorkflow.checkpoint_after_action_ordinals[ordinal],
          checkpoint_id: checkpoint.checkpoint_id,
          screenshot: Object.freeze({
            file: fileName,
            media_type: "image/png" as const,
            width: 800 as const,
            height: 600 as const,
            ...byteIdentity(screenshot),
          }),
          accessibility_tree: byteIdentity(accessibilityTree),
          layout_graph: byteIdentity(layoutGraph),
        });
      });
      if (checkpoints.length !== 3) {
        fail(
          "portfolio_evidence.checkpoint_count",
          "each Pilot workflow must produce exactly three checkpoints",
        );
      }
      const resourceRequestCount = audit.resource_requests.reduce(
        (total, request) => total + request.request_count,
        0,
      );
      workflows.push(
        Object.freeze({
          workflow_key: catalogWorkflow.workflow_key,
          official: false as const,
          task_id: audit.task_id,
          environment_id: audit.environment_id,
          actions_executed: 4 as const,
          checkpoint_after_action_ordinals:
            catalogWorkflow.checkpoint_after_action_ordinals,
          resource_request_audit_sha256: sha256Hex(
            canonicalJson(audit.resource_requests),
          ),
          resource_request_count: resourceRequestCount,
          blocked_external_requests: 0 as const,
          unexpected_fixture_requests: 0 as const,
          checkpoints: checkpoints as [
            (typeof checkpoints)[number],
            (typeof checkpoints)[number],
            (typeof checkpoints)[number],
          ],
        }),
      );
      if (workflowIndex > 1) {
        fail(
          "portfolio_evidence.workflow_count",
          "fixture contains more workflows than the closed portfolio catalog",
        );
      }
    }
    if (workflows.length !== 2) {
      fail(
        "portfolio_evidence.workflow_count",
        "fixture must expose exactly two portfolio workflows",
      );
    }
    const fixtureEvidence = Object.freeze({
      application_key: fixture.application_key,
      fixture_key: fixture.fixture_key,
      fixture_revision: fixture.fixture_revision,
      fixture_manifest: Object.freeze({
        sha256: manifestFile.sha256,
        byte_length: manifestFile.byteLength,
      }),
      source_state_id: authoringPackage.source_state_id,
      workflows: workflows as [
        PilotPortfolioWorkflowEvidence,
        PilotPortfolioWorkflowEvidence,
      ],
    });
    closeAttempted = true;
    await closeEnvironment(environment, undefined);
    return Object.freeze({
      fixture: fixtureEvidence,
      captureSpec,
      files: Object.freeze(files),
    });
  } catch (error) {
    primaryError = error;
    if (!closeAttempted) {
      closeAttempted = true;
      await closeEnvironment(environment, primaryError);
    }
    throw error;
  }
}

/**
 * Executes the complete, fixed Pilot application/workflow matrix. No result is
 * returned until every success oracle and owned browser cleanup has completed.
 */
export async function capturePilotPortfolioEvidence(
  repositoryRoot: string,
): Promise<CapturedPilotPortfolioEvidence> {
  const nodeModuleAbi = assertPinnedNodeRuntime();
  const source = await inspectPilotPortfolioSourceIdentity(repositoryRoot);
  const fixtures: PilotPortfolioFixtureEvidence[] = [];
  const files: PilotPortfolioEvidenceFile[] = [];
  let captureSpecBytes: Buffer | undefined;
  for (const catalogFixture of pilotPortfolioEvidenceCatalog) {
    const captured = await captureFixture(
      source.repository_root,
      catalogFixture,
      captureSpecBytes,
    );
    captureSpecBytes ??= captured.captureSpec;
    fixtures.push(captured.fixture);
    files.push(...captured.files);
  }
  if (captureSpecBytes === undefined || fixtures.length !== 2 || files.length !== 12) {
    fail(
      "portfolio_evidence.capture_cardinality",
      "complete Pilot portfolio capture did not produce two fixtures and twelve screenshots",
    );
  }
  const sourceAfterCapture = await inspectPilotPortfolioSourceIdentity(
    source.repository_root,
  );
  if (
    sourceAfterCapture.git_revision !== source.git_revision ||
    sourceAfterCapture.git_tree !== source.git_tree ||
    sourceAfterCapture.authored_source_tree_sha256 !==
      source.authored_source_tree_sha256 ||
    sourceAfterCapture.compiled_runtime_tree_sha256 !==
      source.compiled_runtime_tree_sha256
  ) {
    fail(
      "portfolio_evidence.source_changed",
      "authored or compiled source bytes changed during Pilot portfolio capture",
    );
  }
  const captureSpec = parseCaptureSpec(captureSpecBytes);
  const captureSpecReference = Object.freeze({
    sha256: sha256Hex(captureSpecBytes),
    byte_length: captureSpecBytes.byteLength,
    media_type: "application/vnd.impactdiff.capture-spec+json" as const,
    format_version: 1 as const,
  });
  files.push(
    Object.freeze({
      name: pilotPortfolioEvidenceCaptureSpecFile,
      bytes: Buffer.from(captureSpecBytes),
    }),
  );
  files.sort((left, right) => codeUnitCompare(left.name, right.name));
  const uniqueNames = new Set(files.map(({ name }) => name));
  if (uniqueNames.size !== files.length) {
    fail(
      "portfolio_evidence.file_collision",
      "portfolio screenshot file names must be unique",
    );
  }
  const fixtureTuple = fixtures as [
    PilotPortfolioFixtureEvidence,
    PilotPortfolioFixtureEvidence,
  ];

  const manifestDraft = {
    contract: pilotPortfolioEvidenceContract,
    version: pilotPortfolioEvidenceVersion,
    official: false,
    scope: "local-authoring-checkpoint-evidence",
    source: {
      git_revision: source.git_revision,
      git_tree: source.git_tree,
      root_files: source.root_files,
      authored_source_tree_sha256: source.authored_source_tree_sha256,
      compiled_runtime_tree_sha256: source.compiled_runtime_tree_sha256,
    },
    runtime: {
      node_version: "22.23.1",
      node_module_abi: nodeModuleAbi,
      platform: "linux",
      architecture: "x64",
      capture_spec_file: pilotPortfolioEvidenceCaptureSpecFile,
      capture_spec: captureSpecReference,
      playwright: {
        version: captureSpec.software.playwright.packages.playwright.version,
        installed_file_tree_sha256:
          captureSpec.software.playwright.installed_file_tree_sha256,
      },
      browser: captureSpec.software.browser,
    },
    evidence_boundary: {
      establishes: [
        "deterministic_local_pilot_authoring_replay",
        "checkpoint_screenshot_and_modality_byte_identities",
        "closed_fixture_task_and_capture_environment_bindings",
      ],
      does_not_establish: [
        "official_dataset_release",
        "model_quality_or_benchmark_performance",
        "production_browser_compatibility",
      ],
    },
    fixtures: fixtureTuple,
  } as const satisfies PilotPortfolioEvidenceManifest;
  const manifestBytes = Buffer.from(canonicalJson(manifestDraft), "utf8");
  const manifest = parsePilotPortfolioEvidenceManifest(manifestBytes);
  return Object.freeze({
    kind: "captured_pilot_portfolio_evidence",
    official: false,
    manifest,
    manifest_bytes: manifestBytes,
    files: Object.freeze(files),
  });
}

export async function captureAndPublishPilotPortfolioEvidence(
  repositoryRoot: string,
  outputDirectory: string,
): Promise<VerifiedPilotPortfolioEvidence> {
  const capture = await capturePilotPortfolioEvidence(repositoryRoot);
  return publishPilotPortfolioEvidence(outputDirectory, capture);
}
