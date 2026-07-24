import { parseCanonicalJson } from "../contracts/canonical.js";
import type { ArtifactRef } from "../contracts/artifacts.js";
import { PilotPortfolioEvidenceError } from "./errors.js";
import {
  pilotPortfolioActionPlanFileName,
  pilotPortfolioCheckpointArtifactFileName,
  pilotPortfolioCheckpointKeys,
  pilotPortfolioEvidenceCaptureSpecFile,
  pilotPortfolioEvidenceCatalog,
  pilotPortfolioEvidenceContract,
  pilotPortfolioEvidenceVersion,
  pilotPortfolioFixtureManifestFileName,
  pilotPortfolioScreenshotFileName,
  pilotPortfolioSourceStateFileName,
  pilotPortfolioWorkflowAuditFileName,
  type PilotPortfolioByteIdentity,
  type PilotPortfolioEvidenceManifest,
} from "./schema.js";

const sha256Pattern = /^[0-9a-f]{64}$/u;
const gitObjectPattern = /^[0-9a-f]{40}$/u;
const checkpointIdPattern = /^idck1_[0-9a-f]{64}$/u;
const sourceStateIdPattern = /^idss1_[0-9a-f]{64}$/u;
const taskIdPattern = /^idtk1_[0-9a-f]{64}$/u;
const environmentIdPattern = /^iden1_[0-9a-f]{64}$/u;
const maximumManifestBytes = 131_072;

function fail(code: string, message: string, options?: ErrorOptions): never {
  throw new PilotPortfolioEvidenceError(code, message, options);
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail("portfolio_evidence.schema", `${path} must be a plain object`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(
      "portfolio_evidence.schema",
      `${path} must contain exactly the closed contract keys`,
    );
  }
  return record;
}

function exactArray(value: unknown, length: number, path: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length !== length) {
    fail("portfolio_evidence.schema", `${path} must contain exactly ${length} items`);
  }
  return value;
}

function exactString(
  value: unknown,
  expected: string,
  path: string,
): asserts value is string {
  if (value !== expected) {
    fail("portfolio_evidence.schema", `${path} differs from the closed contract`);
  }
}

function patternString(
  value: unknown,
  pattern: RegExp,
  path: string,
): asserts value is string {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail("portfolio_evidence.schema", `${path} has an invalid identity`);
  }
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail("portfolio_evidence.schema", `${path} must be a bounded integer`);
  }
}

function byteIdentity(
  value: unknown,
  path: string,
  maximumBytes: number,
): PilotPortfolioByteIdentity {
  const record = exactRecord(value, ["sha256", "byte_length"], path);
  patternString(record.sha256, sha256Pattern, `${path}/sha256`);
  boundedInteger(record.byte_length, 1, maximumBytes, `${path}/byte_length`);
  return record as unknown as PilotPortfolioByteIdentity;
}

function artifactReference(value: unknown, path: string): ArtifactRef {
  const record = exactRecord(
    value,
    ["sha256", "byte_length", "media_type", "format_version"],
    path,
  );
  patternString(record.sha256, sha256Pattern, `${path}/sha256`);
  boundedInteger(record.byte_length, 1, 65_536, `${path}/byte_length`);
  exactString(
    record.media_type,
    "application/vnd.impactdiff.capture-spec+json",
    `${path}/media_type`,
  );
  if (record.format_version !== 1) {
    fail("portfolio_evidence.schema", `${path}/format_version must equal 1`);
  }
  return record as unknown as ArtifactRef;
}

function namedArtifactReference(
  value: unknown,
  path: string,
  expectedFile: string,
  expectedMediaType: string,
  maximumBytes: number,
): void {
  const record = exactRecord(
    value,
    ["file", "sha256", "byte_length", "media_type", "format_version"],
    path,
  );
  exactString(record.file, expectedFile, `${path}/file`);
  patternString(record.sha256, sha256Pattern, `${path}/sha256`);
  boundedInteger(record.byte_length, 1, maximumBytes, `${path}/byte_length`);
  exactString(record.media_type, expectedMediaType, `${path}/media_type`);
  if (record.format_version !== 1) {
    fail("portfolio_evidence.schema", `${path}/format_version must equal 1`);
  }
}

function validateSource(value: unknown): void {
  const source = exactRecord(
    value,
    [
      "git_revision",
      "git_tree",
      "root_files",
      "authored_source_tree_sha256",
      "compiled_runtime_tree_sha256",
    ],
    "/source",
  );
  patternString(source.git_revision, gitObjectPattern, "/source/git_revision");
  patternString(source.git_tree, gitObjectPattern, "/source/git_tree");
  const rootFiles = exactRecord(
    source.root_files,
    ["node_version_file", "package_lock", "package_manifest", "typescript_config"],
    "/source/root_files",
  );
  byteIdentity(
    rootFiles.node_version_file,
    "/source/root_files/node_version_file",
    1_024,
  );
  byteIdentity(rootFiles.package_lock, "/source/root_files/package_lock", 4_194_304);
  byteIdentity(
    rootFiles.package_manifest,
    "/source/root_files/package_manifest",
    131_072,
  );
  byteIdentity(
    rootFiles.typescript_config,
    "/source/root_files/typescript_config",
    131_072,
  );
  patternString(
    source.authored_source_tree_sha256,
    sha256Pattern,
    "/source/authored_source_tree_sha256",
  );
  patternString(
    source.compiled_runtime_tree_sha256,
    sha256Pattern,
    "/source/compiled_runtime_tree_sha256",
  );
}

function validateRuntime(value: unknown): void {
  const runtime = exactRecord(
    value,
    [
      "node_version",
      "node_module_abi",
      "platform",
      "architecture",
      "capture_spec_file",
      "capture_spec",
      "playwright",
      "browser",
    ],
    "/runtime",
  );
  exactString(runtime.node_version, "22.23.1", "/runtime/node_version");
  exactString(runtime.node_module_abi, "127", "/runtime/node_module_abi");
  exactString(runtime.platform, "linux", "/runtime/platform");
  exactString(runtime.architecture, "x64", "/runtime/architecture");
  exactString(
    runtime.capture_spec_file,
    pilotPortfolioEvidenceCaptureSpecFile,
    "/runtime/capture_spec_file",
  );
  artifactReference(runtime.capture_spec, "/runtime/capture_spec");

  const playwright = exactRecord(
    runtime.playwright,
    ["version", "installed_file_tree_sha256"],
    "/runtime/playwright",
  );
  exactString(playwright.version, "1.61.1", "/runtime/playwright/version");
  patternString(
    playwright.installed_file_tree_sha256,
    sha256Pattern,
    "/runtime/playwright/installed_file_tree_sha256",
  );

  const browser = exactRecord(
    runtime.browser,
    [
      "engine",
      "distribution",
      "playwright_registry_revision",
      "version",
      "source_revision",
      "installation_file_tree_sha256",
      "executable_sha256",
      "launch_profile_sha256",
    ],
    "/runtime/browser",
  );
  exactString(browser.engine, "chromium", "/runtime/browser/engine");
  exactString(
    browser.distribution,
    "chromium_headless_shell",
    "/runtime/browser/distribution",
  );
  exactString(
    browser.playwright_registry_revision,
    "1228",
    "/runtime/browser/playwright_registry_revision",
  );
  exactString(browser.version, "149.0.7827.55", "/runtime/browser/version");
  patternString(
    browser.source_revision,
    gitObjectPattern,
    "/runtime/browser/source_revision",
  );
  for (const key of [
    "installation_file_tree_sha256",
    "executable_sha256",
    "launch_profile_sha256",
  ] as const) {
    patternString(browser[key], sha256Pattern, `/runtime/browser/${key}`);
  }
}

function validateEvidenceBoundary(value: unknown): void {
  const boundary = exactRecord(
    value,
    ["establishes", "does_not_establish"],
    "/evidence_boundary",
  );
  const establishes = exactArray(
    boundary.establishes,
    3,
    "/evidence_boundary/establishes",
  );
  const doesNotEstablish = exactArray(
    boundary.does_not_establish,
    3,
    "/evidence_boundary/does_not_establish",
  );
  const expectedEstablishes = [
    "deterministic_local_pilot_authoring_replay",
    "checkpoint_screenshot_and_modality_byte_identities",
    "closed_fixture_task_and_capture_environment_bindings",
  ] as const;
  const expectedNonClaims = [
    "official_dataset_release",
    "model_quality_or_benchmark_performance",
    "production_browser_compatibility",
  ] as const;
  expectedEstablishes.forEach((expected, index) =>
    exactString(
      establishes[index],
      expected,
      `/evidence_boundary/establishes/${index}`,
    ),
  );
  expectedNonClaims.forEach((expected, index) =>
    exactString(
      doesNotEstablish[index],
      expected,
      `/evidence_boundary/does_not_establish/${index}`,
    ),
  );
}

function validateCheckpoint(
  value: unknown,
  fixtureIndex: number,
  workflowIndex: number,
  checkpointIndex: number,
): void {
  const path = `/fixtures/${fixtureIndex}/workflows/${workflowIndex}/checkpoints/${checkpointIndex}`;
  const checkpoint = exactRecord(
    value,
    [
      "key",
      "ordinal",
      "after_action_ordinal",
      "checkpoint_id",
      "screenshot",
      "accessibility_tree",
      "layout_graph",
    ],
    path,
  );
  const catalogFixture = pilotPortfolioEvidenceCatalog[fixtureIndex]!;
  const catalogWorkflow = catalogFixture.workflows[workflowIndex]!;
  const checkpointKey = pilotPortfolioCheckpointKeys[checkpointIndex]!;
  exactString(checkpoint.key, checkpointKey, `${path}/key`);
  if (checkpoint.ordinal !== checkpointIndex) {
    fail("portfolio_evidence.schema", `${path}/ordinal is not contiguous`);
  }
  const expectedActionOrdinal =
    catalogWorkflow.checkpoint_after_action_ordinals[checkpointIndex];
  if (checkpoint.after_action_ordinal !== expectedActionOrdinal) {
    fail(
      "portfolio_evidence.schema",
      `${path}/after_action_ordinal differs from the authored schedule`,
    );
  }
  patternString(checkpoint.checkpoint_id, checkpointIdPattern, `${path}/checkpoint_id`);

  const screenshot = exactRecord(
    checkpoint.screenshot,
    [
      "file",
      "media_type",
      "format_version",
      "width",
      "height",
      "sha256",
      "byte_length",
    ],
    `${path}/screenshot`,
  );
  exactString(
    screenshot.file,
    pilotPortfolioScreenshotFileName(
      catalogFixture,
      catalogWorkflow,
      checkpointIndex as 0 | 1 | 2,
    ),
    `${path}/screenshot/file`,
  );
  exactString(screenshot.media_type, "image/png", `${path}/screenshot/media_type`);
  if (screenshot.format_version !== 1) {
    fail("portfolio_evidence.schema", `${path}/screenshot/format_version must equal 1`);
  }
  if (screenshot.width !== 800 || screenshot.height !== 600) {
    fail(
      "portfolio_evidence.schema",
      `${path}/screenshot dimensions differ from the capture contract`,
    );
  }
  patternString(screenshot.sha256, sha256Pattern, `${path}/screenshot/sha256`);
  boundedInteger(
    screenshot.byte_length,
    1,
    8_388_608,
    `${path}/screenshot/byte_length`,
  );
  namedArtifactReference(
    checkpoint.accessibility_tree,
    `${path}/accessibility_tree`,
    pilotPortfolioCheckpointArtifactFileName(
      catalogFixture,
      catalogWorkflow,
      checkpointIndex as 0 | 1 | 2,
      "accessibility",
    ),
    "application/vnd.impactdiff.accessibility+json",
    2_097_152,
  );
  namedArtifactReference(
    checkpoint.layout_graph,
    `${path}/layout_graph`,
    pilotPortfolioCheckpointArtifactFileName(
      catalogFixture,
      catalogWorkflow,
      checkpointIndex as 0 | 1 | 2,
      "layout",
    ),
    "application/vnd.impactdiff.layout+json",
    4_194_304,
  );
}

function validateWorkflow(
  value: unknown,
  fixtureIndex: number,
  workflowIndex: number,
): void {
  const path = `/fixtures/${fixtureIndex}/workflows/${workflowIndex}`;
  const workflow = exactRecord(
    value,
    [
      "workflow_key",
      "official",
      "action_plan",
      "workflow_audit",
      "task_id",
      "environment_id",
      "actions_executed",
      "checkpoint_after_action_ordinals",
      "resource_request_count",
      "blocked_external_requests",
      "unexpected_fixture_requests",
      "checkpoints",
    ],
    path,
  );
  const catalogWorkflow =
    pilotPortfolioEvidenceCatalog[fixtureIndex]!.workflows[workflowIndex]!;
  const catalogFixture = pilotPortfolioEvidenceCatalog[fixtureIndex]!;
  exactString(
    workflow.workflow_key,
    catalogWorkflow.workflow_key,
    `${path}/workflow_key`,
  );
  if (workflow.official !== false) {
    fail("portfolio_evidence.schema", `${path}/official must be false`);
  }
  namedArtifactReference(
    workflow.action_plan,
    `${path}/action_plan`,
    pilotPortfolioActionPlanFileName(catalogFixture, catalogWorkflow),
    "application/vnd.impactdiff.action-plan+json",
    131_072,
  );
  namedArtifactReference(
    workflow.workflow_audit,
    `${path}/workflow_audit`,
    pilotPortfolioWorkflowAuditFileName(catalogFixture, catalogWorkflow),
    "application/vnd.impactdiff.pilot-workflow-authoring-audit+json",
    131_072,
  );
  patternString(workflow.task_id, taskIdPattern, `${path}/task_id`);
  patternString(
    workflow.environment_id,
    environmentIdPattern,
    `${path}/environment_id`,
  );
  if (workflow.actions_executed !== 4) {
    fail("portfolio_evidence.schema", `${path}/actions_executed must equal 4`);
  }
  const actionOrdinals = exactArray(
    workflow.checkpoint_after_action_ordinals,
    3,
    `${path}/checkpoint_after_action_ordinals`,
  );
  catalogWorkflow.checkpoint_after_action_ordinals.forEach((expected, index) => {
    if (actionOrdinals[index] !== expected) {
      fail(
        "portfolio_evidence.schema",
        `${path}/checkpoint_after_action_ordinals differs from the authored schedule`,
      );
    }
  });
  boundedInteger(
    workflow.resource_request_count,
    1,
    256,
    `${path}/resource_request_count`,
  );
  if (
    workflow.blocked_external_requests !== 0 ||
    workflow.unexpected_fixture_requests !== 0
  ) {
    fail(
      "portfolio_evidence.schema",
      `${path} cannot report blocked or unexpected requests as accepted evidence`,
    );
  }
  const checkpoints = exactArray(workflow.checkpoints, 3, `${path}/checkpoints`);
  checkpoints.forEach((checkpoint, checkpointIndex) =>
    validateCheckpoint(checkpoint, fixtureIndex, workflowIndex, checkpointIndex),
  );
}

function validateFixture(value: unknown, fixtureIndex: number): void {
  const path = `/fixtures/${fixtureIndex}`;
  const fixture = exactRecord(
    value,
    [
      "application_key",
      "fixture_key",
      "fixture_revision",
      "fixture_manifest",
      "source_state",
      "source_state_id",
      "workflows",
    ],
    path,
  );
  const catalogFixture = pilotPortfolioEvidenceCatalog[fixtureIndex]!;
  exactString(
    fixture.application_key,
    catalogFixture.application_key,
    `${path}/application_key`,
  );
  exactString(fixture.fixture_key, catalogFixture.fixture_key, `${path}/fixture_key`);
  exactString(
    fixture.fixture_revision,
    catalogFixture.fixture_revision,
    `${path}/fixture_revision`,
  );
  namedArtifactReference(
    fixture.fixture_manifest,
    `${path}/fixture_manifest`,
    pilotPortfolioFixtureManifestFileName(catalogFixture),
    "application/vnd.impactdiff.pilot-fixture-manifest+json",
    131_072,
  );
  namedArtifactReference(
    fixture.source_state,
    `${path}/source_state`,
    pilotPortfolioSourceStateFileName(catalogFixture),
    "application/vnd.impactdiff.source-state+json",
    1_048_576,
  );
  patternString(
    fixture.source_state_id,
    sourceStateIdPattern,
    `${path}/source_state_id`,
  );
  const workflows = exactArray(fixture.workflows, 2, `${path}/workflows`);
  workflows.forEach((workflow, workflowIndex) =>
    validateWorkflow(workflow, fixtureIndex, workflowIndex),
  );
}

export function validatePilotPortfolioEvidenceManifest(
  value: unknown,
): PilotPortfolioEvidenceManifest {
  const manifest = exactRecord(
    value,
    [
      "contract",
      "version",
      "official",
      "scope",
      "source",
      "runtime",
      "evidence_boundary",
      "fixtures",
    ],
    "/",
  );
  exactString(manifest.contract, pilotPortfolioEvidenceContract, "/contract");
  if (manifest.version !== pilotPortfolioEvidenceVersion) {
    fail("portfolio_evidence.schema", "/version must equal 1");
  }
  if (manifest.official !== false) {
    fail("portfolio_evidence.schema", "/official must be false");
  }
  exactString(manifest.scope, "local-authoring-checkpoint-evidence", "/scope");
  validateSource(manifest.source);
  validateRuntime(manifest.runtime);
  validateEvidenceBoundary(manifest.evidence_boundary);
  const fixtures = exactArray(manifest.fixtures, 2, "/fixtures");
  fixtures.forEach((fixture, fixtureIndex) => validateFixture(fixture, fixtureIndex));
  return manifest as unknown as PilotPortfolioEvidenceManifest;
}

export function parsePilotPortfolioEvidenceManifest(
  input: string | Uint8Array,
): PilotPortfolioEvidenceManifest {
  try {
    return validatePilotPortfolioEvidenceManifest(
      parseCanonicalJson(input, {
        maximumBytes: maximumManifestBytes,
        maximumDepth: 16,
        maximumValues: 2_000,
      }),
    );
  } catch (error) {
    if (error instanceof PilotPortfolioEvidenceError) {
      throw error;
    }
    fail(
      "portfolio_evidence.manifest",
      "portfolio evidence manifest is not bounded canonical JSON",
      { cause: error },
    );
  }
}
