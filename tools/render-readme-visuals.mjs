#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format as formatWithPrettier } from "prettier";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const evidenceRelative = "docs/images/pilot-portfolio-evidence";
const evidenceRoot = join(repositoryRoot, evidenceRelative);
const qualityRelative = "docs/quality";
const outputRelative = "docs/images/readme";
const outputRoot = join(repositoryRoot, outputRelative);
const manifestName = "visuals-manifest.json";
const maximumEvidenceFiles = 50;
const maximumEvidenceBytes = 16 * 1024 * 1024;
const maximumSourceBytes = 2 * 1024 * 1024;

const expectedCatalog = Object.freeze([
  Object.freeze({
    applicationKey: "incident_command",
    fixtureStem: "incident-command",
    workflows: Object.freeze([
      Object.freeze({
        workflowKey: "acknowledge_alert",
        workflowStem: "acknowledge-alert",
      }),
      Object.freeze({
        workflowKey: "assign_responder",
        workflowStem: "assign-responder",
      }),
    ]),
  }),
  Object.freeze({
    applicationKey: "market_basket",
    fixtureStem: "market-basket",
    workflows: Object.freeze([
      Object.freeze({
        workflowKey: "add_bundle",
        workflowStem: "add-bundle",
      }),
      Object.freeze({
        workflowKey: "choose_pickup",
        workflowStem: "choose-pickup",
      }),
    ]),
  }),
]);

const checkpointCatalog = Object.freeze([
  Object.freeze({
    key: "initial_state",
    stem: "initial-state",
    short: "Initial",
  }),
  Object.freeze({
    key: "pre_primary_action",
    stem: "pre-primary-action",
    short: "Pre",
  }),
  Object.freeze({
    key: "post_primary_action",
    stem: "post-primary-action",
    short: "Post",
  }),
]);

const expectedQuality = Object.freeze({
  sourceRevision: "752115fe535d164db951c4f57c426923619998d1",
  runtime: Object.freeze({
    node: "22.23.1",
    nodeModuleAbi: "127",
    npm: "10.9.8",
    platform: "linux",
    architecture: "x64",
    playwright: "1.61.1",
    browser: "Chromium 149.0.7827.55",
  }),
  test: Object.freeze({
    command: "npm test",
    tests: 388,
    passed: 388,
    durationMs: 256853.061961,
    logFile: "full-test.tap",
    logSha256: "5a28b5bd31c6bf335e2a3b28118b6a831b00bc1077a07724788f0d2ef15d1c4f",
    logBytes: 76812,
  }),
  coverage: Object.freeze({
    command: "npm run coverage",
    tests: 388,
    passed: 388,
    durationMs: 674177.861505,
    linePercent: 90.83,
    branchPercent: 83.46,
    functionPercent: 95.59,
    logFile: "full-coverage.tap",
    logSha256: "788ba66eaf674fb13112872c111637b6ac447c0a2aa774c1226c2bd7617c8872",
    logBytes: 103960,
  }),
});

const outputCatalog = Object.freeze([
  Object.freeze({
    file: "architecture-contours.svg",
    type: "source-derived",
    title: "Implemented and planned ImpactDiff architecture",
  }),
  Object.freeze({
    file: "evidence-trust-chain.svg",
    type: "source-derived",
    title: "Evidence trust chain and byte bindings",
  }),
  Object.freeze({
    file: "atomic-publication.svg",
    type: "source-derived",
    title: "Manifest-last atomic evidence publication",
  }),
  Object.freeze({
    file: "pilot-implementation-grid.svg",
    type: "source-derived",
    title: "Pilot v0.1 implementation coverage",
  }),
  Object.freeze({
    file: "checkpoint-modalities.svg",
    type: "captured",
    title: "Accessibility and layout nodes by checkpoint",
  }),
  Object.freeze({
    file: "evidence-bundle-overview.svg",
    type: "captured",
    title: "Pilot portfolio evidence bundle receipt",
  }),
  Object.freeze({
    file: "quality-verification.svg",
    type: "mixed",
    title: "Verified tests and loaded-JavaScript coverage",
  }),
]);

const sourceCatalog = Object.freeze({
  architecture: Object.freeze([
    "docs/pilot-v0.1-application-catalog.md",
    "docs/pilot-v0.1-protocol.md",
    "src/benchmark/application-catalog.ts",
    "src/portfolio-evidence/publication.ts",
    "src/portfolio-evidence/schema.ts",
  ]),
  trust: Object.freeze([
    "src/portfolio-evidence/capture.ts",
    "src/portfolio-evidence/publication.ts",
    "src/portfolio-evidence/repository-filesystem.ts",
    "src/portfolio-evidence/source-identity.ts",
    "src/portfolio-evidence/schema.ts",
  ]),
  publication: Object.freeze([
    "src/portfolio-evidence/publication.ts",
    "src/portfolio-evidence/repository-filesystem.ts",
  ]),
  implementation: Object.freeze([
    "docs/pilot-v0.1-protocol.md",
    "src/benchmark/application-catalog.ts",
    "src/mutations/catalog/spec.ts",
    "src/pilot/runtime/pointer-operator.ts",
    "src/portfolio-evidence/schema.ts",
  ]),
  quality: Object.freeze([".node-version", "package.json"]),
});

function fail(message) {
  throw new Error(`readme visuals: ${message}`);
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function formatInteger(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("visual integer must be one non-negative safe integer");
  }
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

function formatDecimal(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail("visual decimal must be one non-negative finite number");
  }
  const [integer, fraction] = String(value).split(".");
  return `${formatInteger(Number(integer))}${
    fraction === undefined ? "" : `.${fraction}`
  }`;
}

function byteIdentity(path, bytes) {
  return Object.freeze({
    path,
    sha256: sha256(bytes),
    byte_length: bytes.byteLength,
  });
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function assertPlainRecord(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(`${label} must be one plain JSON object`);
  }
  return value;
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(assertPlainRecord(value, label)).sort(compareCodeUnits);
  const sortedExpected = [...expected].sort(compareCodeUnits);
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    fail(`${label} has an unexpected object shape`);
  }
}

function assertCanonicalJson(bytes, label) {
  const text = bytes.toString("utf8");
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
  const compact = JSON.stringify(value);
  if (text !== compact && text !== `${compact}\n`) {
    fail(`${label} must be canonical compact JSON`);
  }
  return value;
}

function parseJsonDocument(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

async function readBounded(relativePath, maximumBytes = maximumSourceBytes) {
  if (
    typeof relativePath !== "string" ||
    relativePath.startsWith("/") ||
    relativePath.includes("\0") ||
    relativePath.split("/").includes("..")
  ) {
    fail("input path escaped the repository");
  }
  const absolutePath = join(repositoryRoot, relativePath);
  const stats = await lstat(absolutePath);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size < 1 ||
    stats.size > maximumBytes
  ) {
    fail(`${relativePath} is absent, linked, empty, or outside its byte budget`);
  }
  const bytes = await readFile(absolutePath);
  if (bytes.byteLength !== stats.size) {
    fail(`${relativePath} changed while it was read`);
  }
  return bytes;
}

function artifactReferences(manifest) {
  const references = [
    {
      file: manifest.runtime.capture_spec_file,
      ...manifest.runtime.capture_spec,
    },
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
  return references;
}

function expectedEvidenceNames() {
  const names = ["MANIFEST.json", "capture-spec.json"];
  for (const fixture of expectedCatalog) {
    names.push(
      `${fixture.fixtureStem}--fixture-manifest.json`,
      `${fixture.fixtureStem}--source-state.json`,
    );
    for (const workflow of fixture.workflows) {
      names.push(
        `${fixture.fixtureStem}--${workflow.workflowStem}--action-plan.json`,
        `${fixture.fixtureStem}--${workflow.workflowStem}--workflow-audit.json`,
      );
      for (const checkpoint of checkpointCatalog) {
        const stem = `${fixture.fixtureStem}--${workflow.workflowStem}--${checkpoint.stem}`;
        names.push(
          `${stem}.png`,
          `${stem}--accessibility.json`,
          `${stem}--layout.json`,
        );
      }
    }
  }
  return names.sort(compareCodeUnits);
}

function assertManifestShape(manifest) {
  assertPlainRecord(manifest, "evidence manifest");
  if (
    manifest.contract !== "impactdiff.pilot-portfolio-evidence" ||
    manifest.version !== 1 ||
    manifest.official !== false ||
    manifest.scope !== "local-authoring-checkpoint-evidence"
  ) {
    fail("evidence manifest has an unsupported contract, version, scope, or claim");
  }
  if (
    manifest.runtime?.node_version !== "22.23.1" ||
    manifest.runtime?.node_module_abi !== "127" ||
    manifest.runtime?.platform !== "linux" ||
    manifest.runtime?.architecture !== "x64" ||
    manifest.runtime?.playwright?.version !== "1.61.1" ||
    manifest.runtime?.browser?.engine !== "chromium" ||
    manifest.runtime?.capture_spec_file !== "capture-spec.json"
  ) {
    fail("evidence manifest runtime differs from the pinned evidence contract");
  }
  if (
    !Array.isArray(manifest.fixtures) ||
    manifest.fixtures.length !== expectedCatalog.length
  ) {
    fail("evidence manifest must contain exactly two expected fixtures");
  }

  for (const [fixtureIndex, expectedFixture] of expectedCatalog.entries()) {
    const fixture = manifest.fixtures[fixtureIndex];
    if (
      fixture?.application_key !== expectedFixture.applicationKey ||
      fixture?.fixture_manifest?.file !==
        `${expectedFixture.fixtureStem}--fixture-manifest.json` ||
      fixture?.fixture_manifest?.media_type !==
        "application/vnd.impactdiff.pilot-fixture-manifest+json" ||
      fixture?.source_state?.file !==
        `${expectedFixture.fixtureStem}--source-state.json` ||
      fixture?.source_state?.media_type !==
        "application/vnd.impactdiff.source-state+json" ||
      !Array.isArray(fixture.workflows) ||
      fixture.workflows.length !== expectedFixture.workflows.length
    ) {
      fail("evidence fixture order or identity differs from the closed catalog");
    }
    for (const [
      workflowIndex,
      expectedWorkflow,
    ] of expectedFixture.workflows.entries()) {
      const workflow = fixture.workflows[workflowIndex];
      if (
        workflow?.workflow_key !== expectedWorkflow.workflowKey ||
        workflow?.action_plan?.file !==
          `${expectedFixture.fixtureStem}--${expectedWorkflow.workflowStem}--action-plan.json` ||
        workflow?.action_plan?.media_type !==
          "application/vnd.impactdiff.action-plan+json" ||
        workflow?.workflow_audit?.file !==
          `${expectedFixture.fixtureStem}--${expectedWorkflow.workflowStem}--workflow-audit.json` ||
        workflow?.workflow_audit?.media_type !==
          "application/vnd.impactdiff.pilot-workflow-authoring-audit+json" ||
        workflow?.official !== false ||
        workflow?.actions_executed !== 4 ||
        !Number.isSafeInteger(workflow?.resource_request_count) ||
        workflow.resource_request_count < 0 ||
        workflow?.blocked_external_requests !== 0 ||
        workflow?.unexpected_fixture_requests !== 0 ||
        !Array.isArray(workflow.checkpoints) ||
        workflow.checkpoints.length !== checkpointCatalog.length
      ) {
        fail("evidence workflow differs from the closed authoring contract");
      }
      for (const [checkpointIndex, expectedCheckpoint] of checkpointCatalog.entries()) {
        const checkpoint = workflow.checkpoints[checkpointIndex];
        const expectedStem = `${expectedFixture.fixtureStem}--${expectedWorkflow.workflowStem}--${expectedCheckpoint.stem}`;
        if (
          checkpoint?.key !== expectedCheckpoint.key ||
          checkpoint?.ordinal !== checkpointIndex ||
          checkpoint?.screenshot?.file !== `${expectedStem}.png` ||
          checkpoint?.accessibility_tree?.file !==
            `${expectedStem}--accessibility.json` ||
          checkpoint?.accessibility_tree?.media_type !==
            "application/vnd.impactdiff.accessibility+json" ||
          checkpoint?.layout_graph?.file !== `${expectedStem}--layout.json` ||
          checkpoint?.layout_graph?.media_type !==
            "application/vnd.impactdiff.layout+json"
        ) {
          fail("checkpoint identity or file topology differs from the closed catalog");
        }
      }
    }
  }

  const boundary = manifest.evidence_boundary;
  if (
    !Array.isArray(boundary?.does_not_establish) ||
    !boundary.does_not_establish.includes("official_dataset_release") ||
    !boundary.does_not_establish.includes("model_quality_or_benchmark_performance") ||
    !boundary.does_not_establish.includes("production_browser_compatibility")
  ) {
    fail("evidence non-claim boundary is incomplete");
  }
}

function assertPng(bytes, reference, label) {
  const signature = "89504e470d0a1a0a";
  if (
    bytes.byteLength < 24 ||
    bytes.subarray(0, 8).toString("hex") !== signature ||
    bytes.subarray(12, 16).toString("ascii") !== "IHDR" ||
    bytes.readUInt32BE(16) !== 800 ||
    bytes.readUInt32BE(20) !== 600 ||
    reference.width !== 800 ||
    reference.height !== 600 ||
    reference.media_type !== "image/png"
  ) {
    fail(`${label} is not one expected 800 by 600 PNG`);
  }
}

function assertGraph(graph, contract, label) {
  assertExactKeys(graph, ["contract", "nodes", "root_index", "version"], label);
  if (
    graph.contract !== contract ||
    graph.version !== 1 ||
    graph.root_index !== 0 ||
    !Array.isArray(graph.nodes) ||
    graph.nodes.length < 1 ||
    graph.nodes.length > 4096
  ) {
    fail(`${label} has an invalid graph envelope`);
  }
  for (const [index, node] of graph.nodes.entries()) {
    if (node?.index !== index) {
      fail(`${label} node indices are not canonical and contiguous`);
    }
  }
  return graph.nodes.length;
}

async function loadEvidence() {
  const directoryStats = await lstat(evidenceRoot);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    fail(`${evidenceRelative} must be one real directory`);
  }
  const actualNames = (await readdir(evidenceRoot)).sort(compareCodeUnits);
  const expectedNames = expectedEvidenceNames();
  if (
    actualNames.length !== maximumEvidenceFiles ||
    actualNames.length !== expectedNames.length ||
    actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    fail("evidence directory has missing or unknown entries");
  }

  const bytesByName = new Map();
  let totalBytes = 0;
  for (const name of actualNames) {
    const bytes = await readBounded(
      `${evidenceRelative}/${name}`,
      name.endsWith(".png") ? 8 * 1024 * 1024 : 1024 * 1024,
    );
    totalBytes += bytes.byteLength;
    if (totalBytes > maximumEvidenceBytes) {
      fail("evidence directory exceeds its aggregate byte budget");
    }
    bytesByName.set(name, bytes);
  }

  const manifestBytes = bytesByName.get("MANIFEST.json");
  const manifest = assertCanonicalJson(manifestBytes, "MANIFEST.json");
  assertManifestShape(manifest);
  const references = artifactReferences(manifest);
  if (references.length !== 49) {
    fail("evidence manifest must reference exactly 49 non-manifest artifacts");
  }
  const referenceNames = references.map((reference) => reference.file);
  if (
    new Set(referenceNames).size !== 49 ||
    [...referenceNames, "MANIFEST.json"]
      .sort(compareCodeUnits)
      .some((name, index) => name !== actualNames[index])
  ) {
    fail("evidence manifest references do not close the 50-file topology");
  }

  for (const reference of references) {
    const bytes = bytesByName.get(reference.file);
    if (
      reference.format_version !== 1 ||
      !/^[0-9a-f]{64}$/u.test(reference.sha256) ||
      !Number.isSafeInteger(reference.byte_length) ||
      reference.byte_length < 1 ||
      bytes === undefined ||
      bytes.byteLength !== reference.byte_length ||
      sha256(bytes) !== reference.sha256
    ) {
      fail(`${reference.file} differs from its manifest byte identity`);
    }
    if (reference.file.endsWith(".json")) {
      assertCanonicalJson(bytes, reference.file);
    } else if (reference.file.endsWith(".png")) {
      assertPng(bytes, reference, reference.file);
    } else {
      fail(`unsupported evidence artifact ${reference.file}`);
    }
  }
  const captureSpec = assertCanonicalJson(
    bytesByName.get("capture-spec.json"),
    "capture-spec.json",
  );
  if (
    captureSpec?.contract !== "impactdiff.capture-spec" ||
    captureSpec?.version !== 1 ||
    captureSpec?.display?.viewport?.width !== 800 ||
    captureSpec?.display?.viewport?.height !== 600 ||
    captureSpec?.execution?.kind !== "host" ||
    captureSpec?.execution?.platform !== "linux/amd64" ||
    captureSpec?.network?.connect_policy !== "none" ||
    captureSpec?.network?.external_requests !== "abort" ||
    captureSpec?.software?.playwright?.packages?.playwright?.version !==
      manifest.runtime.playwright.version ||
    captureSpec?.software?.browser?.version !== manifest.runtime.browser.version
  ) {
    fail("capture-spec.json differs from the closed portfolio runtime settings");
  }

  const rows = [];
  for (const fixture of manifest.fixtures) {
    for (const workflow of fixture.workflows) {
      for (const checkpoint of workflow.checkpoints) {
        const accessibility = assertCanonicalJson(
          bytesByName.get(checkpoint.accessibility_tree.file),
          checkpoint.accessibility_tree.file,
        );
        const layout = assertCanonicalJson(
          bytesByName.get(checkpoint.layout_graph.file),
          checkpoint.layout_graph.file,
        );
        const accessibilityNodes = assertGraph(
          accessibility,
          "impactdiff.accessibility",
          checkpoint.accessibility_tree.file,
        );
        const layoutNodes = assertGraph(
          layout,
          "impactdiff.layout",
          checkpoint.layout_graph.file,
        );
        for (const node of accessibility.nodes) {
          if (
            node.layout_node_index !== null &&
            (!Number.isSafeInteger(node.layout_node_index) ||
              node.layout_node_index < 0 ||
              node.layout_node_index >= layoutNodes)
          ) {
            fail("accessibility node references an absent layout node");
          }
        }
        rows.push(
          Object.freeze({
            application: fixture.application_key,
            workflow: workflow.workflow_key,
            checkpoint: checkpoint.key,
            accessibilityNodes,
            layoutNodes,
          }),
        );
      }
    }
  }
  if (rows.length !== 12) {
    fail("evidence manifest must resolve exactly 12 checkpoints");
  }
  const resourceRequests = manifest.fixtures.reduce(
    (fixtureTotal, fixture) =>
      fixtureTotal +
      fixture.workflows.reduce(
        (workflowTotal, workflow) => workflowTotal + workflow.resource_request_count,
        0,
      ),
    0,
  );

  const evidenceSources = actualNames.map((name) =>
    byteIdentity(`${evidenceRelative}/${name}`, bytesByName.get(name)),
  );
  return Object.freeze({
    manifest,
    manifestBytes,
    manifestSha256: sha256(manifestBytes),
    rows: Object.freeze(rows),
    resourceRequests,
    totalBytes,
    sources: Object.freeze(evidenceSources),
  });
}

function assertZeroRunOutcomes(run, label) {
  for (const field of ["failed", "skipped", "cancelled", "todo"]) {
    if (run?.[field] !== 0) {
      fail(`${label} must record zero ${field} tests`);
    }
  }
}

function assertQualityLogReference(reference, expected, label) {
  if (
    reference?.file !== expected.logFile ||
    reference?.media_type !== "text/plain; charset=utf-8" ||
    reference?.sha256 !== expected.logSha256 ||
    reference?.byte_length !== expected.logBytes
  ) {
    fail(`${label} raw log reference differs from the verified run`);
  }
}

async function loadQuality() {
  const manifestPath = `${qualityRelative}/verified-run.json`;
  const manifestBytes = await readBounded(manifestPath, 128 * 1024);
  const record = parseJsonDocument(manifestBytes, manifestPath);
  assertExactKeys(
    record,
    [
      "contract",
      "version",
      "official",
      "source",
      "runtime",
      "runs",
      "evidence_boundary",
    ],
    manifestPath,
  );
  if (
    record.contract !== "impactdiff.quality-run-evidence" ||
    record.version !== 1 ||
    record.official !== false ||
    record.source?.git_revision !== expectedQuality.sourceRevision ||
    !/^[0-9a-f]{40}$/u.test(record.source?.git_tree)
  ) {
    fail("quality run has an unsupported contract, source revision, or claim");
  }
  const runtime = record.runtime;
  if (
    runtime?.node !== expectedQuality.runtime.node ||
    runtime?.node_module_abi !== expectedQuality.runtime.nodeModuleAbi ||
    runtime?.npm !== expectedQuality.runtime.npm ||
    runtime?.platform !== expectedQuality.runtime.platform ||
    runtime?.architecture !== expectedQuality.runtime.architecture ||
    runtime?.playwright !== expectedQuality.runtime.playwright ||
    runtime?.browser !== expectedQuality.runtime.browser
  ) {
    fail("quality run runtime differs from the pinned verification runtime");
  }

  const test = record.runs?.test;
  if (
    test?.command !== expectedQuality.test.command ||
    test?.tests !== expectedQuality.test.tests ||
    test?.passed !== expectedQuality.test.passed ||
    test?.duration_ms !== expectedQuality.test.durationMs
  ) {
    fail("quality test result differs from the verified complete run");
  }
  assertZeroRunOutcomes(test, "quality test result");
  assertQualityLogReference(test.log, expectedQuality.test, "quality test result");

  const coverage = record.runs?.coverage;
  if (
    coverage?.command !== expectedQuality.coverage.command ||
    coverage?.tests !== expectedQuality.coverage.tests ||
    coverage?.passed !== expectedQuality.coverage.passed ||
    coverage?.duration_ms !== expectedQuality.coverage.durationMs ||
    coverage?.line_percent !== expectedQuality.coverage.linePercent ||
    coverage?.branch_percent !== expectedQuality.coverage.branchPercent ||
    coverage?.function_percent !== expectedQuality.coverage.functionPercent ||
    coverage?.scope !==
      "All loaded JavaScript emitted under dist, including dist/src and dist/test." ||
    JSON.stringify(coverage?.excludes) !==
      JSON.stringify([
        "JavaScript executed inside Chromium pages",
        "non-JavaScript assets",
        "modules not loaded by the test run",
      ]) ||
    coverage?.minimum_thresholds_configured !== false
  ) {
    fail("coverage totals or declared scope differ from the verified run");
  }
  assertZeroRunOutcomes(coverage, "coverage test result");
  assertQualityLogReference(
    coverage.log,
    expectedQuality.coverage,
    "coverage test result",
  );
  if (
    JSON.stringify(record.evidence_boundary?.does_not_establish) !==
    JSON.stringify([
      "minimum coverage enforcement",
      "production browser compatibility",
      "model quality or benchmark performance",
    ])
  ) {
    fail("quality evidence non-claim boundary is incomplete");
  }

  const testLogPath = `${qualityRelative}/${expectedQuality.test.logFile}`;
  const coverageLogPath = `${qualityRelative}/${expectedQuality.coverage.logFile}`;
  const [testLogBytes, coverageLogBytes] = await Promise.all([
    readBounded(testLogPath, 4 * 1024 * 1024),
    readBounded(coverageLogPath, 4 * 1024 * 1024),
  ]);
  if (
    testLogBytes.byteLength !== expectedQuality.test.logBytes ||
    sha256(testLogBytes) !== expectedQuality.test.logSha256 ||
    coverageLogBytes.byteLength !== expectedQuality.coverage.logBytes ||
    sha256(coverageLogBytes) !== expectedQuality.coverage.logSha256
  ) {
    fail("quality raw log bytes differ from their verified identities");
  }
  const testSummary = `# tests 388
# suites 0
# pass 388
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 256853.061961
`;
  const coverageSummary = `# tests 388
# suites 0
# pass 388
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 674177.861505
`;
  const testText = testLogBytes.toString("utf8");
  const coverageText = coverageLogBytes.toString("utf8");
  if (
    !testText.endsWith(testSummary) ||
    !coverageText.includes(coverageSummary) ||
    !/^# all files\s+\|\s+90\.83\s+\|\s+83\.46\s+\|\s+95\.59\s+\|/mu.test(coverageText)
  ) {
    fail("quality raw log summaries differ from the declared run totals");
  }

  return Object.freeze({
    record,
    manifestSha256: sha256(manifestBytes),
    sources: Object.freeze([
      byteIdentity(manifestPath, manifestBytes),
      byteIdentity(testLogPath, testLogBytes),
      byteIdentity(coverageLogPath, coverageLogBytes),
    ]),
  });
}

async function loadSources() {
  const allPaths = [...new Set(Object.values(sourceCatalog).flat())].sort(
    compareCodeUnits,
  );
  const bytesByPath = new Map();
  for (const path of allPaths) {
    bytesByPath.set(path, await readBounded(path));
  }

  const applicationSource = bytesByPath
    .get("src/benchmark/application-catalog.ts")
    .toString("utf8");
  const applicationPattern =
    /application\(\s*"([a-z_]+)"\s*,\s*"[^"]+"\s*,\s*"block_[0-3]"\s*,\s*"([a-z_]+)"\s*,\s*"([a-z_]+)"\s*,?\s*\)/gu;
  const applications = [...applicationSource.matchAll(applicationPattern)].map(
    (match) =>
      Object.freeze({
        key: match[1],
        workflows: Object.freeze([match[2], match[3]]),
      }),
  );
  if (
    applications.length !== 20 ||
    new Set(applications.map(({ key }) => key)).size !== 20 ||
    applications.some(({ workflows }) => new Set(workflows).size !== 2)
  ) {
    fail("Pilot application source no longer defines exactly 20 apps and 40 workflows");
  }

  const portfolioSchemaSource = bytesByPath
    .get("src/portfolio-evidence/schema.ts")
    .toString("utf8");
  const implementedApplicationKeys = [
    ...portfolioSchemaSource.matchAll(/application_key:\s*"([a-z_]+)"/gu),
  ].map((match) => match[1]);
  const implementedWorkflowKeys = [
    ...portfolioSchemaSource.matchAll(/workflow_key:\s*"([a-z_]+)"/gu),
  ].map((match) => match[1]);
  if (
    JSON.stringify(implementedApplicationKeys) !==
      JSON.stringify(expectedCatalog.map(({ applicationKey }) => applicationKey)) ||
    JSON.stringify(implementedWorkflowKeys) !==
      JSON.stringify(
        expectedCatalog.flatMap(({ workflows }) =>
          workflows.map(({ workflowKey }) => workflowKey),
        ),
      )
  ) {
    fail("portfolio source no longer defines the expected two apps and four workflows");
  }

  const mutationSource = bytesByPath
    .get("src/mutations/catalog/spec.ts")
    .toString("utf8");
  const definitions = [...mutationSource.matchAll(/definitionKey:\s*"([^"]+)"/gu)].map(
    (match) => match[1],
  );
  if (definitions.length !== 16 || new Set(definitions).size !== 16) {
    fail("Pilot mutation source no longer defines exactly 16 unique definitions");
  }

  const pointerSource = bytesByPath
    .get("src/pilot/runtime/pointer-operator.ts")
    .toString("utf8");
  const pointerDefinitionStart = pointerSource.indexOf("const pointerDefinitionKeys");
  const pointerDefinitionEnd = pointerSource.indexOf(
    "const pointerRelations",
    pointerDefinitionStart + 1,
  );
  if (pointerDefinitionStart < 0 || pointerDefinitionEnd < 0) {
    fail("browser runtime no longer exposes its closed pointer definition map");
  }
  const pointerDefinitionBlock = pointerSource.slice(
    pointerDefinitionStart,
    pointerDefinitionEnd,
  );
  const executablePointerDefinitions = [
    ...pointerDefinitionBlock.matchAll(/^\s*(?:intercept|pass):\s*"([^"]+)"[,]?$/gmu),
  ].map((match) => match[1]);
  if (
    executablePointerDefinitions.length !== 2 ||
    new Set(executablePointerDefinitions).size !== 2 ||
    executablePointerDefinitions.some((definition) => !definitions.includes(definition))
  ) {
    fail(
      "browser runtime no longer selects exactly two catalogued pointer definitions",
    );
  }

  const protocol = bytesByPath.get("docs/pilot-v0.1-protocol.md").toString("utf8");
  const normalizedProtocol = protocol.replace(/\s+/gu, " ");
  if (
    !normalizedProtocol.includes("exactly `20 × 2 × 8 × 2 × 1 = 640` planned pairs") ||
    !normalizedProtocol.includes(
      "before any official corpus captures, labels, features, or model results exist",
    )
  ) {
    fail("Pilot protocol no longer supports the planned-pair and zero-result status");
  }

  const nodeVersion = bytesByPath.get(".node-version").toString("utf8").trim();
  const packageManifest = parseJsonDocument(
    bytesByPath.get("package.json"),
    "package.json",
  );
  if (
    nodeVersion !== expectedQuality.runtime.node ||
    packageManifest?.packageManager !== `npm@${expectedQuality.runtime.npm}` ||
    packageManifest?.scripts?.test !==
      "npm run build && node --test --test-concurrency=1 'dist/test/**/*.test.js'" ||
    packageManifest?.scripts?.coverage !==
      "npm run build && node --test --test-concurrency=1 --experimental-test-coverage 'dist/test/**/*.test.js'"
  ) {
    fail("quality run commands or pinned Node/npm source configuration changed");
  }

  const publication = bytesByPath
    .get("src/portfolio-evidence/publication.ts")
    .toString("utf8");
  const orderedPublicationFragments = [
    "createRepositoryStage(",
    "for (const file of input.files)",
    "pilotPortfolioEvidenceManifestFile,",
    "syncRepositoryDirectory(stagingPath",
    "verifyPilotPortfolioEvidence(stagingPath)",
    "rename(stagingPath, location.output)",
    "syncRepositoryDirectory(location.parent",
    "verifyPilotPortfolioEvidence(location.output)",
  ];
  let cursor = -1;
  for (const fragment of orderedPublicationFragments) {
    const next = publication.indexOf(fragment, cursor + 1);
    if (next < 0) {
      fail("portfolio publication implementation no longer matches manifest-last flow");
    }
    cursor = next;
  }

  const identityByPath = new Map(
    allPaths.map((path) => [path, byteIdentity(path, bytesByPath.get(path))]),
  );
  const identitiesFor = (paths) =>
    paths.map((path) => {
      const identity = identityByPath.get(path);
      if (identity === undefined) fail(`missing source identity for ${path}`);
      return identity;
    });

  return Object.freeze({
    applications: Object.freeze(applications),
    implementedApplications: Object.freeze(implementedApplicationKeys),
    implementedWorkflows: Object.freeze(implementedWorkflowKeys),
    definitions: Object.freeze(definitions),
    executablePointerDefinitions: Object.freeze(executablePointerDefinitions),
    identitiesFor,
  });
}

const palette = Object.freeze({
  canvas: "#F6F8FC",
  surface: "#FFFFFF",
  ink: "#18243C",
  muted: "#53627A",
  border: "#CDD5E3",
  line: "#A8B4C8",
  blue: "#2359C4",
  blueSoft: "#E8F0FF",
  teal: "#087A6A",
  tealSoft: "#DFF5F0",
  amber: "#9A5300",
  amberSoft: "#FFF0D5",
  violet: "#6842B8",
  violetSoft: "#EFE8FF",
  red: "#A83930",
  redSoft: "#FDE8E6",
  greySoft: "#EEF1F6",
});

function text(x, y, value, className = "body", options = "") {
  return `<text x="${x}" y="${y}" class="${className}" ${options}>${escapeXml(
    value,
  )}</text>`;
}

function multiline(x, y, lines, className = "body", lineHeight = 24, options = "") {
  return `<text x="${x}" y="${y}" class="${className}" ${options}>${lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(
          line,
        )}</tspan>`,
    )
    .join("")}</text>`;
}

function rect(
  x,
  y,
  width,
  height,
  fill,
  stroke = palette.border,
  radius = 18,
  extra = "",
) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="2" ${extra}/>`;
}

function line(x1, y1, x2, y2, color, extra = "", width = 3) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" ${extra}/>`;
}

function arrow(x1, y1, x2, y2, markerId, dashed = false) {
  return line(
    x1,
    y1,
    x2,
    y2,
    dashed ? palette.line : palette.blue,
    `marker-end="url(#${markerId})"${dashed ? ' stroke-dasharray="9 8"' : ""}`,
  );
}

function pill(x, y, width, label, fill, color) {
  return `${rect(x, y, width, 32, fill, fill, 16)}${text(
    x + width / 2,
    y + 22,
    label,
    "pill",
    `text-anchor="middle" style="fill:${color}"`,
  )}`;
}

function nodeCard({
  x,
  y,
  width,
  height,
  eyebrow,
  title,
  lines,
  fill = palette.surface,
  stroke = palette.border,
  dashed = false,
}) {
  return [
    rect(x, y, width, height, fill, stroke, 16, dashed ? 'stroke-dasharray="9 8"' : ""),
    text(x + 20, y + 29, eyebrow.toUpperCase(), "eyebrow"),
    text(x + 20, y + 58, title, "node-title"),
    multiline(x + 20, y + 84, lines, "small", 21),
  ].join("");
}

function markerDefinitions(id) {
  return `<defs><marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${palette.blue}"/></marker><marker id="${id}-muted" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${palette.line}"/></marker></defs>`;
}

function svgDocument({ id, width, height, title, description, body }) {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="${id}-title ${id}-desc">
  <title id="${id}-title">${escapeXml(title)}</title>
  <desc id="${id}-desc">${escapeXml(description)}</desc>
  <style>
    text { font-family: Inter, "Segoe UI", Arial, sans-serif; fill: ${palette.ink}; }
    .title { font-size: 34px; font-weight: 750; letter-spacing: -0.5px; }
    .subtitle { font-size: 17px; fill: ${palette.muted}; }
    .section { font-size: 21px; font-weight: 720; }
    .node-title { font-size: 18px; font-weight: 720; }
    .body { font-size: 16px; }
    .small { font-size: 14px; fill: ${palette.muted}; }
    .tiny { font-size: 12px; fill: ${palette.muted}; }
    .eyebrow { font-size: 11px; font-weight: 750; fill: ${palette.muted}; letter-spacing: 1.2px; }
    .pill { font-size: 12px; font-weight: 750; }
    .metric { font-size: 35px; font-weight: 780; }
    .metric-label { font-size: 14px; font-weight: 650; fill: ${palette.muted}; }
    .axis { font-size: 12px; fill: ${palette.muted}; }
    .bar-value { font-size: 12px; font-weight: 720; }
    .inverse { fill: #FFFFFF; }
  </style>
  <rect width="${width}" height="${height}" fill="${palette.canvas}"/>
  ${body}
</svg>
`;
  if (
    /<(?:linearGradient|radialGradient|filter|image|foreignObject)\b/u.test(svg) ||
    /(?:https?:)?\/\//u.test(svg.replace('xmlns="http://www.w3.org/2000/svg"', ""))
  ) {
    fail(`${id} introduced a gradient, embedded image, filter, or network reference`);
  }
  return svg;
}

function renderArchitecture() {
  const marker = "architecture-arrow";
  const implementedNodes = [
    {
      x: 92,
      y: 250,
      eyebrow: "Inputs",
      title: "Authored Pilot inputs",
      lines: ["2 fixtures · 4 workflows", "closed actions and source state"],
    },
    {
      x: 370,
      y: 250,
      eyebrow: "Runtime",
      title: "Pinned browser runtime",
      lines: ["Node 22.23.1 · Playwright 1.61.1", "Chromium + closed CaptureSpec"],
    },
    {
      x: 648,
      y: 250,
      eyebrow: "Execution",
      title: "Audited browser replay",
      lines: ["isolated contexts · no network", "task, lifecycle and cleanup audits"],
    },
    {
      x: 648,
      y: 510,
      eyebrow: "Modalities",
      title: "Canonical checkpoints",
      lines: ["12 PNG · 12 AX · 12 layout", "manifest-bound byte identities"],
    },
    {
      x: 370,
      y: 510,
      eyebrow: "Publication",
      title: "Manifest-last bundle",
      lines: ["50-file closed topology", "stage · verify · atomic rename"],
    },
    {
      x: 92,
      y: 510,
      eyebrow: "Evidence",
      title: "Local evidence receipt",
      lines: ["50-file closed receipt", "official: false boundary"],
    },
  ];
  const futureNodes = [
    ["Frozen generation plan", "20 apps · 40 workflows"],
    ["Official capture matrix", "640 planned pairs"],
    ["Isolated feature runner", "pixel + AX/layout projections"],
    ["Learned comparison", "pixel · structured · fused"],
    ["Grouped evaluation", "application-disjoint claim gate"],
  ];
  const body = [
    markerDefinitions(marker),
    text(64, 68, "ImpactDiff architecture: implemented and planned contours", "title"),
    text(
      64,
      101,
      "Solid paths are implemented code; dashed paths are the frozen research plan.",
      "subtitle",
    ),
    pill(64, 126, 152, "IMPLEMENTED", palette.tealSoft, palette.teal),
    line(236, 142, 282, 142, palette.blue),
    pill(302, 126, 132, "PLANNED", palette.greySoft, palette.muted),
    line(454, 142, 500, 142, palette.line, 'stroke-dasharray="9 8"'),
    rect(64, 190, 862, 635, palette.surface, palette.teal, 24),
    text(92, 226, "Implemented contour", "section"),
    text(716, 225, "Tested authoring + evidence path", "small", 'text-anchor="end"'),
    rect(
      954,
      190,
      422,
      635,
      palette.surface,
      palette.line,
      24,
      'stroke-dasharray="12 9"',
    ),
    text(982, 226, "Future research contour", "section"),
    ...implementedNodes.map((node) => nodeCard({ ...node, width: 234, height: 132 })),
    arrow(326, 316, 358, 316, marker),
    arrow(604, 316, 636, 316, marker),
    arrow(765, 382, 765, 494, marker),
    arrow(648, 576, 616, 576, marker),
    arrow(370, 576, 338, 576, marker),
    nodeCard({
      x: 648,
      y: 684,
      width: 234,
      height: 116,
      eyebrow: "Executable slice",
      title: "2 pointer definitions",
      lines: ["breaking + preserving", "replayed across 4 workflows"],
      fill: palette.blueSoft,
      stroke: palette.blue,
    }),
    `<path d="M 882 316 H 916 V 742 H 894" fill="none" stroke="${palette.blue}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#${marker})"/>`,
    ...futureNodes.map(([titleValue, detail], index) =>
      nodeCard({
        x: 982,
        y: 248 + index * 104,
        width: 366,
        height: 94,
        eyebrow: `Planned ${index + 1}`,
        title: titleValue,
        lines: [detail],
        fill: palette.greySoft,
        stroke: palette.line,
        dashed: true,
      }),
    ),
    ...futureNodes
      .slice(0, -1)
      .map((_, index) =>
        arrow(
          1165,
          342 + index * 104,
          1165,
          350 + index * 104,
          `${marker}-muted`,
          true,
        ),
      ),
    text(
      1165,
      794,
      "0 official pairs · 0 released datasets · 0 trained models",
      "small",
      'text-anchor="middle"',
    ),
  ].join("");
  return svgDocument({
    id: "architecture-contours",
    width: 1440,
    height: 880,
    title: "Implemented and planned ImpactDiff architecture",
    description:
      "A two-contour architecture. The implemented authoring and evidence contour is solid. The future official dataset, isolated features, models, and evaluation contour is dashed.",
    body,
  });
}

function renderTrustChain() {
  const marker = "trust-arrow";
  const cards = [
    {
      eyebrow: "1 · source",
      title: "Committed source",
      lines: [
        "Git revision + tree",
        "root + authored + compiled",
        "SHA-256 identities",
      ],
    },
    {
      eyebrow: "2 · runtime",
      title: "Pinned runtime",
      lines: ["Node 22.23.1 · ABI 127", "Playwright 1.61.1", "Chromium 149.0.7827.55"],
    },
    {
      eyebrow: "3 · replay",
      title: "Closed replay IDs",
      lines: [
        "fixture · source · task",
        "environment · checkpoint",
        "audited resources and lifecycle",
      ],
    },
    {
      eyebrow: "4 · artifacts",
      title: "Artifact byte refs",
      lines: [
        "file · media type · byte length",
        "SHA-256 for every artifact",
        "PNG 800×600 · AX · layout",
      ],
    },
    {
      eyebrow: "5 · publication",
      title: "Exact 50-file topology",
      lines: [
        "49 artifacts + MANIFEST",
        "unknown and missing files fail",
        "manifest written last",
      ],
    },
  ];
  const body = [
    markerDefinitions(marker),
    text(64, 68, "Evidence trust chain", "title"),
    text(
      64,
      101,
      "Source, runtime, replay and artifact bytes converge on one inspectable receipt.",
      "subtitle",
    ),
    ...cards.map((card, index) =>
      nodeCard({
        ...card,
        x: 55 + index * 276,
        y: 198,
        width: 242,
        height: 160,
        fill: index === 4 ? palette.tealSoft : palette.surface,
        stroke: index === 4 ? palette.teal : palette.border,
      }),
    ),
    ...cards
      .slice(0, -1)
      .map((_, index) => arrow(297 + index * 276, 278, 319 + index * 276, 278, marker)),
    rect(92, 438, 1256, 232, palette.surface, palette.blue, 22),
    pill(120, 466, 150, "BOUND RECEIPT", palette.blueSoft, palette.blue),
    text(120, 533, "MANIFEST.json", "section"),
    text(120, 570, "SHA-256 binds canonical manifest bytes", "body"),
    text(
      120,
      605,
      "2 fixtures · 4 workflows · 12 checkpoints · 50 exact files · official: false",
      "small",
    ),
    line(816, 470, 816, 638, palette.border),
    text(850, 500, "Freshness check", "section"),
    multiline(
      850,
      536,
      [
        "Recorded revision must be current or an ancestor.",
        "Tracked root, source and fixture bytes must still match.",
        "Compiled runtime bytes must still match.",
        "Worktree must be globally clean.",
      ],
      "small",
      26,
    ),
    pill(92, 712, 136, "ESTABLISHES", palette.tealSoft, palette.teal),
    text(
      248,
      733,
      "deterministic local replay · checkpoint byte identities · closed environment bindings",
      "small",
    ),
    pill(92, 758, 174, "DOES NOT ESTABLISH", palette.redSoft, palette.red),
    text(
      286,
      779,
      "official dataset · model quality · benchmark performance · production-browser compatibility",
      "small",
    ),
  ].join("");
  return svgDocument({
    id: "evidence-trust-chain",
    width: 1440,
    height: 830,
    title: "Evidence trust chain and byte bindings",
    description:
      "Five source-derived trust stages bind a clean Git baseline, pinned runtime, replay identities, artifact byte references, and exact publication topology to one non-official evidence manifest.",
    body,
  });
}

function renderPublication() {
  const marker = "publication-arrow";
  const steps = [
    [["Validate", "capture"], "closed capability", "49 exact artifacts"],
    [["Create", "stage"], "owned sibling", "repository modes"],
    [["Write", "artifacts"], "stable sorted files", "manifest absent"],
    [["Write manifest", "last"], "MANIFEST.json", "visibility marker"],
    [["Sync + verify", "stage"], "exact topology", "semantic checks"],
    [["Same-parent", "rename"], "single visibility", "commit point"],
    [["Sync + verify", "final"], "re-bind inode", "reopen receipt"],
  ];
  const coordinates = [135, 326, 517, 708, 899, 1090, 1281];
  const body = [
    markerDefinitions(marker),
    text(64, 68, "Manifest-last atomic evidence publication", "title"),
    text(
      64,
      101,
      "The final directory is exposed only after every artifact and the last-written manifest verify.",
      "subtitle",
    ),
    ...steps.map(([titleLines, detail1, detail2], index) => {
      const centerX = coordinates[index];
      const y = 215;
      const x = centerX - 83;
      return [
        `<circle cx="${centerX}" cy="${y - 38}" r="19" fill="${index < 5 ? palette.blue : palette.teal}"/>`,
        text(
          centerX,
          y - 32,
          String(index + 1),
          "pill inverse",
          'text-anchor="middle"',
        ),
        rect(
          x,
          y,
          166,
          160,
          index === 5 ? palette.tealSoft : palette.surface,
          index === 5 ? palette.teal : palette.border,
          16,
        ),
        multiline(
          centerX,
          y + 35,
          titleLines,
          "node-title",
          21,
          'text-anchor="middle"',
        ),
        text(centerX, y + 94, detail1, "small", 'text-anchor="middle"'),
        text(centerX, y + 119, detail2, "small", 'text-anchor="middle"'),
      ].join("");
    }),
    ...steps
      .slice(0, -1)
      .map((_, index) =>
        arrow(coordinates[index] + 83, 295, coordinates[index + 1] - 95, 295, marker),
      ),
    line(995, 165, 995, 430, palette.amber, 'stroke-dasharray="8 7"'),
    pill(897, 410, 196, "VISIBILITY BOUNDARY", palette.amberSoft, palette.amber),
    rect(78, 495, 602, 182, palette.surface, palette.border, 20),
    pill(106, 521, 148, "BEFORE RENAME", palette.blueSoft, palette.blue),
    multiline(
      106,
      577,
      [
        "Destination must be absent.",
        "A failure removes only the bounded owned stage.",
        "Unknown links, modes or topology are rejected.",
      ],
      "small",
      28,
    ),
    rect(760, 495, 602, 182, palette.surface, palette.teal, 20),
    pill(788, 521, 140, "AFTER RENAME", palette.tealSoft, palette.teal),
    multiline(
      788,
      577,
      [
        "The directory is visible under its final name.",
        "Parent fsync, inode re-bind and full verification follow.",
        "Existing outputs are never replaced.",
      ],
      "small",
      28,
    ),
    text(
      720,
      724,
      "Supported boundary: owned local Linux filesystem · one cooperative same-process writer",
      "small",
      'text-anchor="middle"',
    ),
  ].join("");
  return svgDocument({
    id: "atomic-publication",
    width: 1440,
    height: 770,
    title: "Manifest-last atomic evidence publication",
    description:
      "Seven source-derived steps show capture validation, staging, writing 49 artifacts, writing the manifest last, verifying, same-parent rename, and final verification.",
    body,
  });
}

function gridCells({
  x,
  y,
  columns,
  count,
  active,
  cellSize,
  gap,
  activeFill = palette.teal,
  inactiveFill = palette.greySoft,
  activeStroke = activeFill,
  inactiveStroke = palette.border,
}) {
  const cells = [];
  for (let index = 0; index < count; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    cells.push(
      rect(
        x + column * (cellSize + gap),
        y + row * (cellSize + gap),
        cellSize,
        cellSize,
        index < active ? activeFill : inactiveFill,
        index < active ? activeStroke : inactiveStroke,
        4,
      ),
    );
  }
  return cells.join("");
}

function renderImplementationGrid(source) {
  const implementedApplications = source.implementedApplications.length;
  const implementedWorkflows = source.implementedWorkflows.length;
  const applicationCount = source.applications.length;
  const workflowCount = source.applications.reduce(
    (sum, application) => sum + application.workflows.length,
    0,
  );
  const definitionCount = source.definitions.length;
  const executableCount = source.executablePointerDefinitions.length;
  const body = [
    text(64, 68, "Pilot v0.1 implementation grid", "title"),
    text(
      64,
      101,
      "Implemented authoring is separated from catalogued plans and official corpus execution.",
      "subtitle",
    ),
    rect(64, 158, 632, 274, palette.surface, palette.border, 22),
    pill(92, 184, 112, "AUTHORING", palette.tealSoft, palette.teal),
    text(92, 250, `${implementedApplications}/${applicationCount}`, "metric"),
    text(92, 280, "applications implemented", "metric-label"),
    gridCells({
      x: 276,
      y: 202,
      columns: 10,
      count: applicationCount,
      active: implementedApplications,
      cellSize: 25,
      gap: 10,
    }),
    text(276, 300, "Implemented: incident_command · market_basket", "small"),
    text(92, 350, `${implementedWorkflows}/${workflowCount}`, "metric"),
    text(92, 380, "workflows implemented", "metric-label"),
    gridCells({
      x: 276,
      y: 332,
      columns: 20,
      count: workflowCount,
      active: implementedWorkflows,
      cellSize: 14,
      gap: 5,
    }),
    text(276, 392, "Three captured checkpoints per implemented workflow", "small"),
    rect(744, 158, 632, 274, palette.surface, palette.border, 22),
    pill(772, 184, 122, "OPERATORS", palette.blueSoft, palette.blue),
    text(772, 250, `${definitionCount}`, "metric"),
    text(772, 280, "catalogued definitions", "metric-label"),
    text(974, 250, `${executableCount}/${definitionCount}`, "metric"),
    text(974, 280, "executable pointer definitions", "metric-label"),
    gridCells({
      x: 772,
      y: 325,
      columns: 16,
      count: definitionCount,
      active: executableCount,
      cellSize: 25,
      gap: 8,
      activeFill: palette.blue,
    }),
    text(
      772,
      390,
      "Filled = browser-executable slice · outlined = catalogued definition",
      "small",
    ),
    rect(64, 480, 1312, 282, palette.surface, palette.border, 22),
    pill(92, 506, 134, "OFFICIAL MATRIX", palette.amberSoft, palette.amber),
    text(92, 579, "0 / 640", "metric"),
    text(92, 610, "official pairs captured", "metric-label"),
    gridCells({
      x: 334,
      y: 525,
      columns: 32,
      count: 64,
      active: 0,
      cellSize: 21,
      gap: 7,
      inactiveFill: palette.surface,
      inactiveStroke: palette.amber,
    }),
    text(
      334,
      612,
      "Each outlined cell represents 10 planned pairs · no cell is filled",
      "small",
    ),
    line(92, 659, 1348, 659, palette.border),
    pill(92, 685, 168, "CURRENT NON-CLAIMS", palette.redSoft, palette.red),
    text(
      282,
      706,
      "0 official dataset releases · 0 trained models · 0 benchmark or accuracy results",
      "small",
    ),
    text(
      92,
      738,
      "The 12 committed checkpoints are local authoring evidence, not official before/after corpus pairs.",
      "small",
    ),
    pill(64, 802, 118, "FILLED", palette.tealSoft, palette.teal),
    text(198, 824, "implemented or executable", "small"),
    pill(420, 802, 132, "OUTLINED", palette.greySoft, palette.muted),
    text(568, 824, "planned or catalogued only", "small"),
  ].join("");
  return svgDocument({
    id: "pilot-implementation-grid",
    width: 1440,
    height: 870,
    title: "Pilot v0.1 implementation coverage",
    description:
      "Source-derived grids show two of twenty applications, four of forty workflows, sixteen catalogued definitions with two executable pointer definitions, and zero of 640 planned official pairs.",
    body,
  });
}

function renderCheckpointModalities(evidence) {
  const rows = evidence.rows;
  const chartX = 104;
  const chartY = 214;
  const chartHeight = 410;
  const chartBottom = chartY + chartHeight;
  const maximum = 200;
  if (
    rows.some(
      ({ accessibilityNodes, layoutNodes }) =>
        accessibilityNodes > maximum || layoutNodes > maximum,
    )
  ) {
    fail("checkpoint node count exceeds the declared chart domain");
  }
  const groupWidth = 101;
  const groupGap = 8;
  const barWidth = 27;
  const sumAccessibility = rows.reduce((sum, row) => sum + row.accessibilityNodes, 0);
  const sumLayout = rows.reduce((sum, row) => sum + row.layoutNodes, 0);
  const workflowLabels = [
    ["Incident command", "acknowledge alert"],
    ["Incident command", "assign responder"],
    ["Market basket", "add bundle"],
    ["Market basket", "choose pickup"],
  ];
  const elements = [
    text(64, 68, "Checkpoint modality node counts", "title"),
    text(
      64,
      101,
      "Exact node-array lengths from 12 checkpoint pairs (24 committed JSON artifacts).",
      "subtitle",
    ),
    pill(
      64,
      128,
      196,
      `${formatInteger(sumAccessibility)} AX NODES`,
      palette.blueSoft,
      palette.blue,
    ),
    pill(
      278,
      128,
      220,
      `${formatInteger(sumLayout)} LAYOUT NODES`,
      palette.tealSoft,
      palette.teal,
    ),
    pill(516, 128, 92, "n = 12", palette.greySoft, palette.muted),
  ];

  for (const tick of [0, 50, 100, 150, 200]) {
    const y = chartBottom - (tick / maximum) * chartHeight;
    elements.push(
      line(
        chartX,
        y,
        1370,
        y,
        tick === 0 ? palette.line : palette.border,
        "",
        tick === 0 ? 3 : 1,
      ),
      text(chartX - 16, y + 4, String(tick), "axis", 'text-anchor="end"'),
    );
  }
  elements.push(
    text(
      31,
      chartY + chartHeight / 2,
      "Nodes",
      "axis",
      `text-anchor="middle" transform="rotate(-90 31 ${chartY + chartHeight / 2})"`,
    ),
  );

  for (const [index, row] of rows.entries()) {
    const x = chartX + 17 + index * groupWidth;
    const accessibilityHeight = (row.accessibilityNodes / maximum) * chartHeight;
    const layoutHeight = (row.layoutNodes / maximum) * chartHeight;
    elements.push(
      rect(
        x,
        chartBottom - accessibilityHeight,
        barWidth,
        accessibilityHeight,
        palette.blue,
        palette.blue,
        4,
      ),
      rect(
        x + barWidth + 5,
        chartBottom - layoutHeight,
        barWidth,
        layoutHeight,
        palette.teal,
        palette.teal,
        4,
      ),
      text(
        x + barWidth / 2,
        chartBottom - accessibilityHeight - 9,
        String(row.accessibilityNodes),
        "bar-value",
        'text-anchor="middle"',
      ),
      text(
        x + barWidth + 5 + barWidth / 2,
        chartBottom - layoutHeight - 9,
        String(row.layoutNodes),
        "bar-value",
        'text-anchor="middle"',
      ),
      text(
        x + barWidth + 2,
        chartBottom + 28,
        checkpointCatalog[index % 3].short,
        "axis",
        'text-anchor="middle"',
      ),
    );
    if (index % 3 === 2 && index < rows.length - 1) {
      const separatorX = chartX + (index + 1) * groupWidth + groupGap / 2;
      elements.push(
        line(
          separatorX,
          chartY,
          separatorX,
          chartBottom + 94,
          palette.border,
          'stroke-dasharray="5 6"',
          1,
        ),
      );
    }
  }

  for (const [workflowIndex, [application, workflow]] of workflowLabels.entries()) {
    const centerX = chartX + 17 + (workflowIndex * 3 + 1) * groupWidth + barWidth + 2;
    elements.push(
      text(centerX, chartBottom + 64, application, "small", 'text-anchor="middle"'),
      text(centerX, chartBottom + 85, workflow, "tiny", 'text-anchor="middle"'),
    );
  }
  elements.push(
    rect(1020, 132, 18, 18, palette.blue, palette.blue, 4),
    text(1048, 147, "Accessibility nodes", "small"),
    rect(1195, 132, 18, 18, palette.teal, palette.teal, 4),
    text(1223, 147, "Layout nodes", "small"),
    rect(64, 752, 1312, 94, palette.surface, palette.border, 18),
    text(88, 784, "Reading the chart", "node-title"),
    text(
      88,
      813,
      "Counts are per canonical JSON nodes array. Totals sum repeated checkpoint snapshots; they are structural evidence volume, not model quality.",
      "small",
    ),
  );
  return svgDocument({
    id: "checkpoint-modalities",
    width: 1440,
    height: 880,
    title: "Accessibility and layout nodes by checkpoint",
    description:
      "Grouped bars compare exact accessibility and layout node counts for initial, pre-action, and post-action checkpoints across four Pilot authoring workflows.",
    body: elements.join(""),
  });
}

function renderBundleOverview(evidence) {
  const counts = [
    { label: "PNG", count: 12, color: palette.blue },
    { label: "AX JSON", count: 12, color: palette.teal },
    { label: "Layout JSON", count: 12, color: palette.violet },
    { label: "Workflow audits", count: 4, color: palette.amber },
    { label: "Action plans", count: 4, color: palette.red },
    { label: "Fixture/source", count: 4, color: "#64748B" },
    { label: "Spec + manifest", count: 2, color: "#334155" },
  ];
  const barX = 92;
  const barY = 288;
  const barWidth = 1256;
  let offset = 0;
  const body = [
    text(64, 68, "Pilot portfolio evidence bundle", "title"),
    text(
      64,
      101,
      "A closed, reproducible receipt for local authoring checkpoints — not an official corpus release.",
      "subtitle",
    ),
    rect(64, 148, 1312, 112, palette.surface, palette.border, 22),
    text(92, 199, "50", "metric"),
    text(92, 229, "exact files", "metric-label"),
    text(270, 199, "2", "metric"),
    text(270, 229, "fixtures", "metric-label"),
    text(422, 199, "4", "metric"),
    text(422, 229, "workflows", "metric-label"),
    text(598, 199, "12", "metric"),
    text(598, 229, "checkpoints", "metric-label"),
    text(792, 199, "800 × 600", "metric"),
    text(792, 229, "canonical PNG viewport", "metric-label"),
    pill(1150, 181, 168, "OFFICIAL: FALSE", palette.redSoft, palette.red),
  ];
  for (const entry of counts) {
    const width = (entry.count / 50) * barWidth;
    body.push(
      `<rect x="${barX + offset}" y="${barY}" width="${width}" height="54" fill="${entry.color}"/>`,
    );
    if (width > 70) {
      body.push(
        text(
          barX + offset + width / 2,
          barY + 34,
          String(entry.count),
          "pill inverse",
          'text-anchor="middle"',
        ),
      );
    }
    offset += width;
  }
  counts.forEach((entry, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const x = 92 + column * 314;
    const y = 380 + row * 42;
    body.push(
      rect(x, y, 16, 16, entry.color, entry.color, 3),
      text(x + 28, y + 13, `${entry.count} ${entry.label}`, "small"),
    );
  });
  body.push(
    rect(64, 500, 760, 252, palette.surface, palette.blue, 22),
    pill(92, 526, 152, "RECEIPT IDENTITY", palette.blueSoft, palette.blue),
    text(92, 582, "MANIFEST SHA-256", "eyebrow"),
    text(92, 613, evidence.manifestSha256, "body"),
    text(92, 661, "Pinned runtime", "node-title"),
    text(
      92,
      691,
      `Node ${evidence.manifest.runtime.node_version} · Playwright ${evidence.manifest.runtime.playwright.version} · Chromium ${evidence.manifest.runtime.browser.version}`,
      "small",
    ),
    text(
      92,
      721,
      `${formatInteger(evidence.totalBytes)} bytes total · ${formatInteger(
        evidence.resourceRequests,
      )} resource requests · 0 blocked external requests`,
      "small",
    ),
    rect(856, 500, 520, 252, palette.surface, palette.teal, 22),
    pill(884, 526, 152, "VERIFIED SCOPE", palette.tealSoft, palette.teal),
    multiline(
      884,
      584,
      [
        "✓ deterministic local authoring replay",
        "✓ screenshot and modality byte identities",
        "✓ fixture, task and environment bindings",
        "✓ exact closed 50-file topology",
      ],
      "body",
      31,
    ),
    pill(64, 790, 170, "EXPLICIT NON-CLAIMS", palette.redSoft, palette.red),
    text(
      254,
      811,
      "no official dataset · no model/benchmark result · no production-browser compatibility claim",
      "small",
    ),
  );
  return svgDocument({
    id: "evidence-bundle-overview",
    width: 1440,
    height: 850,
    title: "Pilot portfolio evidence bundle receipt",
    description:
      "A mixed receipt shows the exact 50-file bundle composition, two fixtures, four workflows, twelve checkpoints, runtime identity, verified scope, and explicit non-claims.",
    body: body.join(""),
  });
}

function renderQualityVerification(quality) {
  const { record } = quality;
  const test = record.runs.test;
  const coverage = record.runs.coverage;
  const metrics = [
    {
      label: "Lines",
      value: coverage.line_percent,
      color: palette.blue,
    },
    {
      label: "Branches",
      value: coverage.branch_percent,
      color: palette.teal,
    },
    {
      label: "Functions",
      value: coverage.function_percent,
      color: palette.violet,
    },
  ];
  const trackX = 324;
  const trackWidth = 960;
  const body = [
    text(64, 68, "Verified tests and loaded-JavaScript coverage", "title"),
    text(
      64,
      101,
      "One complete test run and one coverage-instrumented run, bound to raw TAP logs.",
      "subtitle",
    ),
    pill(
      64,
      126,
      192,
      `SOURCE ${record.source.git_revision.slice(0, 12)}…`,
      palette.blueSoft,
      palette.blue,
    ),
    pill(
      274,
      126,
      218,
      `NODE ${record.runtime.node} · NPM ${record.runtime.npm}`,
      palette.greySoft,
      palette.muted,
    ),
    pill(510, 126, 188, "OFFICIAL: FALSE", palette.redSoft, palette.red),
    rect(64, 182, 628, 166, palette.surface, palette.blue, 22),
    pill(92, 208, 118, "npm test", palette.blueSoft, palette.blue),
    text(92, 276, `${test.passed}/${test.tests}`, "metric"),
    text(92, 307, "tests passed", "metric-label"),
    text(282, 267, "0 failed · 0 skipped", "body"),
    text(282, 295, "0 cancelled · 0 todo", "small"),
    text(282, 324, `${formatDecimal(test.duration_ms)} ms`, "small"),
    text(92, 336, `log ${test.log.sha256}`, "tiny"),
    rect(748, 182, 628, 166, palette.surface, palette.teal, 22),
    pill(776, 208, 164, "npm run coverage", palette.tealSoft, palette.teal),
    text(776, 276, `${coverage.passed}/${coverage.tests}`, "metric"),
    text(776, 307, "tests passed", "metric-label"),
    text(966, 267, "0 failed · 0 skipped", "body"),
    text(966, 295, "0 cancelled · 0 todo", "small"),
    text(966, 324, `${formatDecimal(coverage.duration_ms)} ms`, "small"),
    text(776, 336, `log ${coverage.log.sha256}`, "tiny"),
    rect(64, 384, 1312, 294, palette.surface, palette.border, 22),
    text(92, 426, "Loaded JavaScript coverage totals", "section"),
    pill(
      1022,
      401,
      326,
      "NO MINIMUM THRESHOLD CONFIGURED",
      palette.amberSoft,
      palette.amber,
    ),
    text(trackX, 458, "0%", "axis"),
    text(trackX + trackWidth, 458, "100%", "axis", 'text-anchor="end"'),
    ...metrics.flatMap((metric, index) => {
      const y = 486 + index * 62;
      const width = (metric.value / 100) * trackWidth;
      return [
        text(92, y + 22, metric.label, "node-title"),
        rect(trackX, y, trackWidth, 28, palette.greySoft, palette.greySoft, 8),
        rect(trackX, y, width, 28, metric.color, metric.color, 8),
        text(
          1328,
          y + 21,
          `${metric.value.toFixed(2)}%`,
          "bar-value",
          'text-anchor="end"',
        ),
      ];
    }),
    text(
      92,
      654,
      "Scope: all loaded emitted JavaScript under dist, including dist/src + dist/test.",
      "small",
    ),
    rect(64, 716, 1312, 142, palette.surface, palette.border, 22),
    pill(92, 742, 138, "SCOPE NOTE", palette.greySoft, palette.muted),
    multiline(
      92,
      798,
      [
        "Includes dist/src and dist/test modules loaded by this run; this is not production-source-only coverage.",
        "Excludes JavaScript inside Chromium pages, non-JavaScript assets, and modules not loaded by the run.",
      ],
      "small",
      28,
    ),
    pill(944, 742, 174, "DOES NOT ESTABLISH", palette.redSoft, palette.red),
    multiline(
      944,
      798,
      [
        "coverage enforcement · production browser compatibility",
        "model quality · benchmark performance",
      ],
      "small",
      28,
    ),
  ].join("");
  return svgDocument({
    id: "quality-verification",
    width: 1440,
    height: 900,
    title: "Verified tests and loaded-JavaScript coverage",
    description:
      "A source-backed verification figure shows 388 of 388 passing tests in two runs, exact loaded-JavaScript line, branch, and function coverage percentages, declared scope, exclusions, and absence of minimum thresholds.",
    body,
  });
}

function sourceSet(paths, source) {
  return source.identitiesFor(paths);
}

async function buildManifest(outputs, artifactSources, evidence, quality) {
  const artifacts = outputCatalog.map((entry) => {
    const bytes = outputs.get(entry.file);
    if (bytes === undefined) fail(`renderer omitted ${entry.file}`);
    const sources = artifactSources.get(entry.file);
    if (sources === undefined || sources.length === 0) {
      fail(`renderer omitted provenance for ${entry.file}`);
    }
    return Object.freeze({
      file: entry.file,
      type: entry.type,
      title: entry.title,
      sha256: sha256(bytes),
      byte_length: bytes.byteLength,
      sources,
    });
  });
  const value = {
    contract: "impactdiff.readme-visuals",
    version: 1,
    generated_by: "tools/render-readme-visuals.mjs",
    deterministic: true,
    network_access: false,
    evidence: {
      directory: evidenceRelative,
      manifest_sha256: evidence.manifestSha256,
      official: false,
      file_count: 50,
      checkpoint_count: 12,
    },
    quality: {
      manifest: `${qualityRelative}/verified-run.json`,
      manifest_sha256: quality.manifestSha256,
      source_revision: quality.record.source.git_revision,
      official: false,
      test_count: quality.record.runs.test.tests,
      raw_log_count: 2,
    },
    artifact_types: ["captured", "source-derived", "mixed"],
    artifacts,
  };
  return Buffer.from(
    await formatWithPrettier(JSON.stringify(value), {
      parser: "json",
      endOfLine: "lf",
      printWidth: 80,
      tabWidth: 2,
      useTabs: false,
    }),
    "utf8",
  );
}

async function renderAll() {
  const [evidence, source, quality] = await Promise.all([
    loadEvidence(),
    loadSources(),
    loadQuality(),
  ]);
  const strings = new Map([
    ["architecture-contours.svg", renderArchitecture()],
    ["evidence-trust-chain.svg", renderTrustChain()],
    ["atomic-publication.svg", renderPublication()],
    ["pilot-implementation-grid.svg", renderImplementationGrid(source)],
    ["checkpoint-modalities.svg", renderCheckpointModalities(evidence)],
    ["evidence-bundle-overview.svg", renderBundleOverview(evidence)],
    ["quality-verification.svg", renderQualityVerification(quality)],
  ]);
  const outputs = new Map(
    [...strings].map(([name, value]) => [name, Buffer.from(value, "utf8")]),
  );
  const artifactSources = new Map([
    ["architecture-contours.svg", sourceSet(sourceCatalog.architecture, source)],
    ["evidence-trust-chain.svg", sourceSet(sourceCatalog.trust, source)],
    ["atomic-publication.svg", sourceSet(sourceCatalog.publication, source)],
    ["pilot-implementation-grid.svg", sourceSet(sourceCatalog.implementation, source)],
    [
      "checkpoint-modalities.svg",
      evidence.sources.filter(
        ({ path }) =>
          path.endsWith("--accessibility.json") ||
          path.endsWith("--layout.json") ||
          path.endsWith("/MANIFEST.json"),
      ),
    ],
    ["evidence-bundle-overview.svg", evidence.sources],
    [
      "quality-verification.svg",
      [...quality.sources, ...sourceSet(sourceCatalog.quality, source)],
    ],
  ]);
  outputs.set(
    manifestName,
    await buildManifest(outputs, artifactSources, evidence, quality),
  );
  return outputs;
}

function expectedOutputNames() {
  return [...outputCatalog.map(({ file }) => file), manifestName].sort(
    compareCodeUnits,
  );
}

async function inspectOutputDirectory({ allowAbsent }) {
  let stats;
  try {
    stats = await lstat(outputRoot);
  } catch (error) {
    if (allowAbsent && error?.code === "ENOENT") return [];
    throw error;
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    fail(`${outputRelative} must be one real directory`);
  }
  const names = (await readdir(outputRoot)).sort(compareCodeUnits);
  const expected = expectedOutputNames();
  if (
    names.some((name) => !expected.includes(name)) ||
    (!allowAbsent &&
      (names.length !== expected.length ||
        names.some((name, index) => name !== expected[index])))
  ) {
    fail(`${outputRelative} has unknown or missing generated outputs`);
  }
  return names;
}

async function readOutputBounded(name) {
  if (!expectedOutputNames().includes(name)) {
    fail(`refused unknown generated output ${name}`);
  }
  const path = join(outputRoot, name);
  const stats = await lstat(path);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size < 1 ||
    stats.size > 4 * 1024 * 1024
  ) {
    fail(`${outputRelative}/${name} is absent, linked, empty, or oversized`);
  }
  const bytes = await readFile(path);
  if (bytes.byteLength !== stats.size) {
    fail(`${outputRelative}/${name} changed while it was read`);
  }
  return bytes;
}

async function writeOutputs(outputs) {
  await inspectOutputDirectory({ allowAbsent: true });
  await mkdir(outputRoot, { recursive: true, mode: 0o755 });
  for (const name of expectedOutputNames()) {
    const bytes = outputs.get(name);
    if (bytes === undefined) fail(`missing generated bytes for ${name}`);
    const temporary = join(outputRoot, `.${name}.tmp`);
    try {
      await writeFile(temporary, bytes, { mode: 0o644 });
      await rename(temporary, join(outputRoot, name));
    } finally {
      await rm(temporary, { force: true });
    }
  }
  await inspectOutputDirectory({ allowAbsent: false });
  process.stdout.write(
    `wrote ${outputs.size} deterministic files to ${relative(
      repositoryRoot,
      outputRoot,
    )}\n`,
  );
}

async function checkOutputs(outputs) {
  await inspectOutputDirectory({ allowAbsent: false });
  for (const name of expectedOutputNames()) {
    const expected = outputs.get(name);
    const actual = await readOutputBounded(name);
    if (expected === undefined || !actual.equals(expected)) {
      fail(`${outputRelative}/${name} is stale; run write`);
    }
  }
  process.stdout.write(
    `verified ${outputs.size} deterministic files in ${outputRelative}\n`,
  );
}

async function main() {
  const mode = process.argv[2];
  if ((mode !== "write" && mode !== "check") || process.argv.length !== 3) {
    fail("usage: node tools/render-readme-visuals.mjs <write|check>");
  }
  const outputs = await renderAll();
  if (mode === "write") {
    await writeOutputs(outputs);
  } else {
    await checkOutputs(outputs);
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
