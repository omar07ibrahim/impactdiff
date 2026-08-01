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
  sourceRevision: "d1402f523e96646c743fbd2a67717a9925145655",
  sourceTree: "30020fe630d455178aab30d86371414c922a4fc9",
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
    tests: 415,
    passed: 415,
    durationMs: 256877.881513,
    logFile: "full-test.tap",
    logSha256: "37523bb108988c5611939d99401bf246298eb15b28b54814a54f4a7447af6168",
    logBytes: 81154,
  }),
  coverage: Object.freeze({
    command: "npm run coverage:check",
    tests: 415,
    passed: 415,
    durationMs: 660821.027748,
    linePercent: 90.17,
    branchPercent: 83.15,
    functionPercent: 95.26,
    logFile: "full-coverage.tap",
    logSha256: "941ca0e620fd3d8518349b844791b01864778d5c259c2be474daa338c62760dc",
    logBytes: 109266,
  }),
});

const currentCoverageGate = Object.freeze({
  command: "npm run coverage:check",
  runtime: "22.23.1",
  scope: "All loaded JavaScript emitted under dist, including dist/src and dist/test.",
  script:
    "npm run build && node --test --test-concurrency=1 --experimental-test-coverage --test-coverage-lines=90 --test-coverage-branches=83 --test-coverage-functions=95 'dist/test/**/*.test.js'",
  thresholds: Object.freeze({
    linePercent: 90,
    branchPercent: 83,
    functionPercent: 95,
  }),
});

const expectedCliRun = Object.freeze({
  sourceRevision: "6d8cd5d43b82a441a8e6e8c3df281aa73bdbf293",
  sourceTree: "5a045d788b418a0ec835ad45eaad6037f18d363f",
  argv: Object.freeze(["npm", "run", "--silent", "evidence:pilot:check"]),
  runtime: Object.freeze({
    node: "22.23.1",
    nodeModuleAbi: "127",
    npm: "10.9.8",
    platform: "linux",
    architecture: "x64",
  }),
  stdout: Object.freeze({
    file: "pilot-evidence-check.stdout",
    mediaType: "application/jsonl; charset=utf-8",
    sha256: "5002ded371aebf52796a1294623bcb1daabbc6fffdc104cd52e7930bec3e02e8",
    byteLength: 163,
    lineCount: 1,
  }),
  stderr: Object.freeze({
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    byteLength: 0,
  }),
  inputs: Object.freeze([
    Object.freeze({
      path: ".node-version",
      sha256: "7d2df647f25529bd87500319c41564e032e2be642e565350fa6136d7a1ec4d10",
      byteLength: 8,
    }),
    Object.freeze({
      path: "package.json",
      sha256: "b6dbea4be8a98e1aa74e2ff3e6b19ad8367c696af068876d98a7fb2e95307d0c",
      byteLength: 1877,
    }),
    Object.freeze({
      path: "package-lock.json",
      sha256: "372dcff1777c7d89060eb9c33c7fd664047265cd0ef5b01801964f8b3d5a1e5c",
      byteLength: 8191,
    }),
    Object.freeze({
      path: "tsconfig.json",
      sha256: "37fded8a7b1c2208a416748d11ab3d56351b4b40ab36b152c4bf4ad46faf121b",
      byteLength: 680,
    }),
    Object.freeze({
      path: "src/cli/pilot-portfolio-evidence.ts",
      sha256: "f33734eaa5aaba6d9a77fd5b48dc6861395df2ff51f8492156ef9850d61880a5",
      byteLength: 4140,
    }),
    Object.freeze({
      path: "src/portfolio-evidence/publication.ts",
      sha256: "4cad0be21944647a780e3428ee50968f644a991da287f5f069269e9db9a3c227",
      byteLength: 28198,
    }),
    Object.freeze({
      path: "docs/images/pilot-portfolio-evidence/MANIFEST.json",
      sha256: "9f275968958546a51d8d502bdc125ef67c66d8fef91517d259878e571e21db56",
      byteLength: 18508,
    }),
  ]),
  establishes: Object.freeze([
    "one successful exact-runtime verification of the committed local-authoring Pilot evidence",
    "path-free stdout exactly matches the independently derived committed-manifest receipt",
    "the allowlisted source and manifest inputs have the recorded byte identities",
  ]),
  doesNotEstablish: Object.freeze([
    "official dataset release",
    "model quality or benchmark performance",
    "fresh browser capture or production-browser compatibility",
    "execution on any runtime other than the recorded Node.js 22.23.1",
  ]),
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
  Object.freeze({
    file: "cli-evidence-verification.svg",
    type: "mixed",
    title: "Recorded CLI verification receipt",
  }),
]);

const sourceCatalog = Object.freeze({
  generator: Object.freeze(["tools/render-readme-visuals.mjs"]),
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
  quality: Object.freeze([".github/workflows/ci.yml", ".node-version", "package.json"]),
  cli: Object.freeze([".github/workflows/ci.yml"]),
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

function parseCoverageTotals(text, label) {
  if (typeof text !== "string") {
    fail(`${label} must be UTF-8 text`);
  }
  const starts = [...text.matchAll(/^# start of coverage report\s*$/gmu)];
  const ends = [...text.matchAll(/^# end of coverage report\s*$/gmu)];
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index >= ends[0].index) {
    fail(`${label} must contain one unambiguous coverage report`);
  }
  const report = text.slice(starts[0].index, ends[0].index + ends[0][0].length);
  if (
    !/^# file\s+\|\s+line %\s+\|\s+branch %\s+\|\s+funcs %\s+\|\s+uncovered lines\s*$/mu.test(
      report,
    )
  ) {
    fail(`${label} coverage columns changed`);
  }
  const rows = [
    ...report.matchAll(
      /^#\s+all files\s+\|\s+(\d+(?:\.\d+)?)\s+\|\s+(\d+(?:\.\d+)?)\s+\|\s+(\d+(?:\.\d+)?)\s+\|\s*$/gmu,
    ),
  ];
  if (rows.length !== 1) {
    fail(`${label} must contain exactly one aggregate coverage row`);
  }
  const [linePercent, branchPercent, functionPercent] = rows[0].slice(1).map(Number);
  if (
    [linePercent, branchPercent, functionPercent].some(
      (value) => !Number.isFinite(value) || value < 0 || value > 100,
    )
  ) {
    fail(`${label} contains an invalid coverage percentage`);
  }
  return Object.freeze({
    linePercent,
    branchPercent,
    functionPercent,
  });
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
  assertExactKeys(
    reference,
    ["file", "media_type", "sha256", "byte_length"],
    `${label} raw log reference`,
  );
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
  assertExactKeys(record.source, ["git_revision", "git_tree"], "quality source");
  assertExactKeys(
    record.runtime,
    [
      "node",
      "node_module_abi",
      "npm",
      "platform",
      "architecture",
      "playwright",
      "browser",
    ],
    "quality runtime",
  );
  assertExactKeys(record.runs, ["test", "coverage"], "quality runs");
  assertExactKeys(
    record.evidence_boundary,
    ["establishes", "does_not_establish"],
    "quality evidence boundary",
  );
  if (
    record.contract !== "impactdiff.quality-run-evidence" ||
    record.version !== 1 ||
    record.official !== false ||
    record.source?.git_revision !== expectedQuality.sourceRevision ||
    record.source?.git_tree !== expectedQuality.sourceTree
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
  assertExactKeys(
    test,
    [
      "command",
      "tests",
      "passed",
      "failed",
      "skipped",
      "cancelled",
      "todo",
      "duration_ms",
      "log",
    ],
    "quality test result",
  );
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
  assertExactKeys(
    coverage,
    [
      "command",
      "tests",
      "passed",
      "failed",
      "skipped",
      "cancelled",
      "todo",
      "duration_ms",
      "line_percent",
      "branch_percent",
      "function_percent",
      "scope",
      "excludes",
      "minimum_thresholds_configured",
      "minimum_thresholds",
      "log",
    ],
    "coverage test result",
  );
  assertExactKeys(
    coverage.minimum_thresholds,
    ["line_percent", "branch_percent", "function_percent"],
    "coverage minimum thresholds",
  );
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
    coverage?.minimum_thresholds_configured !== true ||
    coverage?.minimum_thresholds?.line_percent !==
      currentCoverageGate.thresholds.linePercent ||
    coverage?.minimum_thresholds?.branch_percent !==
      currentCoverageGate.thresholds.branchPercent ||
    coverage?.minimum_thresholds?.function_percent !==
      currentCoverageGate.thresholds.functionPercent
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
    JSON.stringify(record.evidence_boundary?.establishes) !==
    JSON.stringify([
      "one successful complete test run",
      "one successful complete coverage-instrumented test run",
      "captured Node coverage totals for the declared loaded-module scope",
      "the coverage run passed configured 90% line, 83% branch, and 95% function floors",
    ])
  ) {
    fail("quality evidence claim boundary differs from the verified run");
  }
  if (
    JSON.stringify(record.evidence_boundary?.does_not_establish) !==
    JSON.stringify([
      "production browser compatibility",
      "model quality or benchmark performance",
      "equal coverage totals across Node.js major versions",
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
  const testSummary = `${[
    `# tests ${expectedQuality.test.tests}`,
    "# suites 0",
    `# pass ${expectedQuality.test.passed}`,
    "# fail 0",
    "# cancelled 0",
    "# skipped 0",
    "# todo 0",
    `# duration_ms ${expectedQuality.test.durationMs}`,
  ].join("\n")}\n`;
  const coverageSummary = `${[
    `# tests ${expectedQuality.coverage.tests}`,
    "# suites 0",
    `# pass ${expectedQuality.coverage.passed}`,
    "# fail 0",
    "# cancelled 0",
    "# skipped 0",
    "# todo 0",
    `# duration_ms ${expectedQuality.coverage.durationMs}`,
  ].join("\n")}\n`;
  const testText = testLogBytes.toString("utf8");
  const coverageText = coverageLogBytes.toString("utf8");
  const coverageTotals = parseCoverageTotals(coverageText, coverageLogPath);
  if (
    !testText.endsWith(testSummary) ||
    !coverageText.includes(coverageSummary) ||
    coverageTotals.linePercent !== expectedQuality.coverage.linePercent ||
    coverageTotals.branchPercent !== expectedQuality.coverage.branchPercent ||
    coverageTotals.functionPercent !== expectedQuality.coverage.functionPercent
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

async function loadCliReceipt() {
  const runPath = `${qualityRelative}/pilot-evidence-check-run.json`;
  const stdoutPath = `${qualityRelative}/${expectedCliRun.stdout.file}`;
  const [runBytes, stdoutBytes] = await Promise.all([
    readBounded(runPath, 128 * 1024),
    readBounded(stdoutPath, 4 * 1024),
  ]);
  const runText = runBytes.toString("utf8");
  if (
    !Buffer.from(runText, "utf8").equals(runBytes) ||
    runText.includes("\r") ||
    !runText.endsWith("\n")
  ) {
    fail(`${runPath} must be LF-terminated UTF-8 without carriage returns`);
  }
  const record = parseJsonDocument(runBytes, runPath);
  assertExactKeys(
    record,
    [
      "contract",
      "version",
      "official",
      "source",
      "command",
      "runtime",
      "result",
      "inputs",
      "evidence_boundary",
    ],
    runPath,
  );
  assertExactKeys(record.source, ["git_revision", "git_tree"], "CLI run source");
  assertExactKeys(record.command, ["argv"], "CLI run command");
  assertExactKeys(
    record.runtime,
    ["node", "node_module_abi", "npm", "platform", "architecture"],
    "CLI run runtime",
  );
  assertExactKeys(record.result, ["exit_code", "stdout", "stderr"], "CLI run result");
  assertExactKeys(
    record.result?.stdout,
    ["file", "media_type", "sha256", "byte_length", "line_count"],
    "CLI run stdout",
  );
  assertExactKeys(record.result?.stderr, ["sha256", "byte_length"], "CLI run stderr");
  assertExactKeys(
    record.evidence_boundary,
    ["establishes", "does_not_establish"],
    "CLI run evidence boundary",
  );
  if (
    record.contract !== "impactdiff.pilot-evidence-cli-run" ||
    record.version !== 1 ||
    record.official !== false ||
    record.source?.git_revision !== expectedCliRun.sourceRevision ||
    record.source?.git_tree !== expectedCliRun.sourceTree ||
    JSON.stringify(record.command?.argv) !== JSON.stringify(expectedCliRun.argv) ||
    record.runtime?.node !== expectedCliRun.runtime.node ||
    record.runtime?.node_module_abi !== expectedCliRun.runtime.nodeModuleAbi ||
    record.runtime?.npm !== expectedCliRun.runtime.npm ||
    record.runtime?.platform !== expectedCliRun.runtime.platform ||
    record.runtime?.architecture !== expectedCliRun.runtime.architecture ||
    record.result?.exit_code !== 0 ||
    record.result?.stdout?.file !== expectedCliRun.stdout.file ||
    record.result?.stdout?.media_type !== expectedCliRun.stdout.mediaType ||
    record.result?.stdout?.sha256 !== expectedCliRun.stdout.sha256 ||
    record.result?.stdout?.byte_length !== expectedCliRun.stdout.byteLength ||
    record.result?.stdout?.line_count !== expectedCliRun.stdout.lineCount ||
    record.result?.stderr?.sha256 !== expectedCliRun.stderr.sha256 ||
    record.result?.stderr?.byte_length !== expectedCliRun.stderr.byteLength
  ) {
    fail("CLI run record differs from the reviewed exact-runtime execution");
  }
  if (
    JSON.stringify(record.evidence_boundary?.establishes) !==
      JSON.stringify(expectedCliRun.establishes) ||
    JSON.stringify(record.evidence_boundary?.does_not_establish) !==
      JSON.stringify(expectedCliRun.doesNotEstablish)
  ) {
    fail("CLI run claim boundary differs from the reviewed execution");
  }
  if (
    !Array.isArray(record.inputs) ||
    record.inputs.length !== expectedCliRun.inputs.length
  ) {
    fail("CLI run input allowlist differs from the reviewed execution");
  }

  const inputSources = [];
  const inputBytesByPath = new Map();
  for (const [index, expected] of expectedCliRun.inputs.entries()) {
    const input = record.inputs[index];
    assertExactKeys(input, ["path", "sha256", "byte_length"], `CLI input ${index}`);
    if (
      input.path !== expected.path ||
      input.sha256 !== expected.sha256 ||
      input.byte_length !== expected.byteLength
    ) {
      fail(`CLI input ${index} differs from the reviewed allowlist`);
    }
    const bytes = await readBounded(expected.path);
    if (bytes.byteLength !== expected.byteLength || sha256(bytes) !== expected.sha256) {
      fail(`${expected.path} differs from its recorded CLI input identity`);
    }
    inputBytesByPath.set(expected.path, bytes);
    inputSources.push(byteIdentity(expected.path, bytes));
  }

  if (
    stdoutBytes.byteLength !== expectedCliRun.stdout.byteLength ||
    sha256(stdoutBytes) !== expectedCliRun.stdout.sha256
  ) {
    fail("recorded CLI stdout differs from its reviewed byte identity");
  }
  const stdoutText = stdoutBytes.toString("utf8");
  const stdoutPayload = stdoutText.slice(0, -1);
  if (
    !Buffer.from(stdoutText, "utf8").equals(stdoutBytes) ||
    !stdoutText.endsWith("\n") ||
    stdoutText.indexOf("\n") !== stdoutText.length - 1 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(stdoutPayload) ||
    stdoutPayload.includes("/") ||
    stdoutPayload.includes("\\") ||
    stdoutPayload.includes("@") ||
    /[A-Za-z]:/u.test(stdoutPayload)
  ) {
    fail(
      "recorded CLI stdout must be one path-free, prompt-free, control-free JSON line",
    );
  }
  const stdoutReceipt = assertCanonicalJson(stdoutBytes, stdoutPath);
  assertExactKeys(
    stdoutReceipt,
    [
      "official",
      "manifest_sha256",
      "fixture_count",
      "workflow_count",
      "checkpoint_count",
    ],
    "CLI stdout receipt",
  );

  const manifestPath = `${evidenceRelative}/MANIFEST.json`;
  const manifestBytes = inputBytesByPath.get(manifestPath);
  if (manifestBytes === undefined) {
    fail("CLI input allowlist omitted the Pilot evidence manifest");
  }
  const manifest = assertCanonicalJson(manifestBytes, manifestPath);
  assertManifestShape(manifest);
  const derivedReceipt = Object.freeze({
    official: manifest.official,
    manifest_sha256: sha256(manifestBytes),
    fixture_count: manifest.fixtures.length,
    workflow_count: manifest.fixtures.reduce(
      (sum, fixture) => sum + fixture.workflows.length,
      0,
    ),
    checkpoint_count: manifest.fixtures.reduce(
      (sum, fixture) =>
        sum +
        fixture.workflows.reduce(
          (workflowSum, workflow) => workflowSum + workflow.checkpoints.length,
          0,
        ),
      0,
    ),
  });
  const derivedBytes = Buffer.from(`${JSON.stringify(derivedReceipt)}\n`, "utf8");
  if (!stdoutBytes.equals(derivedBytes)) {
    fail("recorded CLI stdout differs from the independently derived manifest receipt");
  }

  return Object.freeze({
    record,
    receipt: derivedReceipt,
    stdoutText: stdoutPayload,
    runRecordSha256: sha256(runBytes),
    sources: Object.freeze([
      byteIdentity(stdoutPath, stdoutBytes),
      byteIdentity(runPath, runBytes),
      ...inputSources,
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
  const continuousIntegration = bytesByPath
    .get(".github/workflows/ci.yml")
    .toString("utf8");
  const coverageCommands = [
    ...continuousIntegration.matchAll(
      /^\s*run:\s*(npm run coverage(?::check)?)\s*$/gmu,
    ),
  ].map((match) => match[1]);
  const coverageStep = `      - name: Enforce coverage floors
        if: matrix.node == '22.23.1'
        run: npm run coverage:check`;
  const currentNodeStep = `      - name: Test current Node.js
        if: matrix.node == '24'
        run: npm test`;
  const cliReceiptStep = `      - name: Reproduce recorded Pilot CLI receipt
        if: matrix.node == '22.23.1'
        shell: bash
        run: |
          set -euo pipefail
          stdout="\${RUNNER_TEMP}/pilot-evidence-check.stdout"
          stderr="\${RUNNER_TEMP}/pilot-evidence-check.stderr"
          npm run --silent evidence:pilot:check >"\${stdout}" 2>"\${stderr}"
          test ! -s "\${stderr}"
          cmp docs/quality/pilot-evidence-check.stdout "\${stdout}"`;
  if (
    nodeVersion !== expectedQuality.runtime.node ||
    packageManifest?.packageManager !== `npm@${expectedQuality.runtime.npm}` ||
    packageManifest?.scripts?.test !==
      "npm run build && node --test --test-concurrency=1 'dist/test/**/*.test.js'" ||
    packageManifest?.scripts?.coverage !==
      "npm run build && node --test --test-concurrency=1 --experimental-test-coverage 'dist/test/**/*.test.js'" ||
    packageManifest?.scripts?.["coverage:check"] !== currentCoverageGate.script ||
    JSON.stringify(coverageCommands) !==
      JSON.stringify([currentCoverageGate.command]) ||
    !continuousIntegration.includes(coverageStep) ||
    !continuousIntegration.includes(currentNodeStep) ||
    !continuousIntegration.includes(cliReceiptStep)
  ) {
    fail(
      "quality commands, coverage gate, CLI receipt replay, CI matrix, or pinned runtime changed",
    );
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

function renderCliVerification(cli) {
  const { record, receipt } = cli;
  const monospace =
    'style="font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"';
  const rawMonospace =
    'style="font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:11px"';
  const body = [
    text(64, 68, "Recorded CLI verification receipt", "title"),
    text(
      64,
      101,
      "Exact clean-run stdout rendered as a receipt — this is not a terminal screenshot.",
      "subtitle",
    ),
    pill(
      64,
      126,
      204,
      `SOURCE ${record.source.git_revision.slice(0, 12)}…`,
      palette.blueSoft,
      palette.blue,
    ),
    pill(
      286,
      126,
      226,
      `NODE ${record.runtime.node} · NPM ${record.runtime.npm}`,
      palette.greySoft,
      palette.muted,
    ),
    pill(530, 126, 86, "EXIT 0", palette.tealSoft, palette.teal),
    pill(634, 126, 112, "STDERR 0 B", palette.tealSoft, palette.teal),
    pill(764, 126, 178, "OFFICIAL: FALSE", palette.redSoft, palette.red),
    rect(64, 178, 1312, 94, palette.surface, palette.blue, 20),
    text(92, 209, "EXACT SILENT COMMAND", "eyebrow"),
    text(92, 246, record.command.argv.join(" "), "node-title", monospace),
    rect(64, 298, 1312, 136, palette.surface, palette.teal, 20),
    text(92, 329, "EXACT STDOUT · ONE LF-TERMINATED JSON LINE", "eyebrow"),
    text(92, 374, cli.stdoutText, "tiny", rawMonospace),
    text(
      92,
      408,
      `163 bytes · SHA-256 ${record.result.stdout.sha256}`,
      "tiny",
      monospace,
    ),
    rect(64, 460, 1312, 128, palette.surface, palette.border, 20),
    text(92, 493, "COMMITTED MANIFEST SHA-256", "eyebrow"),
    text(92, 532, receipt.manifest_sha256, "body", monospace),
    text(
      92,
      563,
      "Derived independently from current MANIFEST.json, then compared byte-for-byte with recorded stdout.",
      "small",
    ),
    rect(64, 614, 290, 116, palette.surface, palette.red, 18),
    text(88, 650, "official", "metric-label"),
    text(88, 696, String(receipt.official), "metric"),
    rect(382, 614, 290, 116, palette.surface, palette.blue, 18),
    text(406, 650, "fixtures", "metric-label"),
    text(406, 696, String(receipt.fixture_count), "metric"),
    rect(700, 614, 290, 116, palette.surface, palette.teal, 18),
    text(724, 650, "workflows", "metric-label"),
    text(724, 696, String(receipt.workflow_count), "metric"),
    rect(1018, 614, 358, 116, palette.surface, palette.violet, 18),
    text(1042, 650, "checkpoints", "metric-label"),
    text(1042, 696, String(receipt.checkpoint_count), "metric"),
    rect(64, 756, 1312, 116, palette.surface, palette.border, 20),
    pill(92, 782, 206, "7 ALLOWLISTED INPUTS", palette.blueSoft, palette.blue),
    pill(316, 782, 202, "LOCAL AUTHORING ONLY", palette.amberSoft, palette.amber),
    pill(536, 782, 226, "NOT A BENCHMARK RESULT", palette.redSoft, palette.red),
    text(
      92,
      844,
      `Run record SHA-256 ${cli.runRecordSha256} · no prompt, host, path, cwd, or timestamp captured`,
      "tiny",
      monospace,
    ),
  ].join("");
  return svgDocument({
    id: "cli-evidence-verification",
    width: 1440,
    height: 910,
    title: "Recorded CLI verification receipt",
    description:
      "A mixed evidence receipt shows the exact silent verification command, exact path-free stdout, successful recorded runtime, committed manifest identity, local-authoring counts, and explicit non-benchmark boundary.",
    body,
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
      minimum: currentCoverageGate.thresholds.linePercent,
      color: palette.blue,
    },
    {
      label: "Branches",
      value: coverage.branch_percent,
      minimum: currentCoverageGate.thresholds.branchPercent,
      color: palette.teal,
    },
    {
      label: "Functions",
      value: coverage.function_percent,
      minimum: currentCoverageGate.thresholds.functionPercent,
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
      "Recorded totals and enforced Node 22 coverage floors are byte- and source-bound.",
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
    text(92, 307, "TAP test points passed", "metric-label"),
    text(282, 267, "0 failed · 0 skipped", "body"),
    text(282, 295, "0 cancelled · 0 todo", "small"),
    text(282, 324, `${formatDecimal(test.duration_ms)} ms`, "small"),
    text(92, 336, `log ${test.log.sha256}`, "tiny"),
    rect(748, 182, 628, 166, palette.surface, palette.teal, 22),
    pill(776, 208, 210, "npm run coverage:check", palette.tealSoft, palette.teal),
    text(776, 276, `${coverage.passed}/${coverage.tests}`, "metric"),
    text(776, 307, "TAP test points passed", "metric-label"),
    text(966, 267, "0 failed · 0 skipped", "body"),
    text(966, 295, "0 cancelled · 0 todo", "small"),
    text(966, 324, `${formatDecimal(coverage.duration_ms)} ms`, "small"),
    text(776, 336, `log ${coverage.log.sha256}`, "tiny"),
    rect(64, 384, 1312, 294, palette.surface, palette.border, 22),
    text(92, 426, "Loaded JavaScript coverage totals", "section"),
    pill(
      1010,
      401,
      338,
      "CURRENT FLOOR · L90 / B83 / F95",
      palette.blueSoft,
      palette.blue,
    ),
    text(trackX, 458, "0%", "axis"),
    text(trackX + trackWidth, 458, "100%", "axis", 'text-anchor="end"'),
    ...metrics.flatMap((metric, index) => {
      const y = 486 + index * 62;
      const width = (metric.value / 100) * trackWidth;
      const minimumX = trackX + (metric.minimum / 100) * trackWidth;
      return [
        text(92, y + 22, metric.label, "node-title"),
        rect(trackX, y, trackWidth, 28, palette.greySoft, palette.greySoft, 8),
        rect(trackX, y, width, 28, metric.color, metric.color, 8),
        line(
          minimumX,
          y - 5,
          minimumX,
          y + 33,
          palette.ink,
          'stroke-dasharray="3 3"',
          2,
        ),
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
    pill(92, 742, 182, "SCOPE + RECEIPT", palette.greySoft, palette.muted),
    multiline(
      92,
      798,
      [
        "Bars: recorded Node 22.23.1 coverage:check totals; raw TAP is bound by SHA-256.",
        "Markers: enforced 90% line, 83% branch, and 95% function minimums.",
      ],
      "small",
      28,
    ),
    pill(944, 742, 174, "DOES NOT ESTABLISH", palette.redSoft, palette.red),
    multiline(
      944,
      798,
      [
        "production-browser compatibility · model quality",
        "benchmark performance · equal Node 24 coverage totals",
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
    description: `A source-backed verification figure shows one coverage-gated Node 22.23.1 receipt with ${coverage.passed} passing TAP test points, exact loaded-JavaScript coverage totals, and enforced minimums of 90 percent lines, 83 percent branches, and 95 percent functions.`,
    body,
  });
}

function sourceSet(paths, source) {
  return source.identitiesFor(paths);
}

async function buildManifest(outputs, artifactSources, evidence, quality, cli) {
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
      recorded_minimum_thresholds_configured:
        quality.record.runs.coverage.minimum_thresholds_configured,
      current_coverage_gate: {
        command: currentCoverageGate.command,
        runtime: currentCoverageGate.runtime,
        scope: currentCoverageGate.scope,
        line_percent_minimum: currentCoverageGate.thresholds.linePercent,
        branch_percent_minimum: currentCoverageGate.thresholds.branchPercent,
        function_percent_minimum: currentCoverageGate.thresholds.functionPercent,
      },
    },
    cli_verification: {
      run_record: `${qualityRelative}/pilot-evidence-check-run.json`,
      run_record_sha256: cli.runRecordSha256,
      stdout: `${qualityRelative}/${expectedCliRun.stdout.file}`,
      stdout_sha256: expectedCliRun.stdout.sha256,
      source_revision: cli.record.source.git_revision,
      command_argv: cli.record.command.argv,
      runtime: {
        node: cli.record.runtime.node,
        node_module_abi: cli.record.runtime.node_module_abi,
        npm: cli.record.runtime.npm,
        platform: cli.record.runtime.platform,
        architecture: cli.record.runtime.architecture,
      },
      exit_code: cli.record.result.exit_code,
      stderr_byte_length: cli.record.result.stderr.byte_length,
      manifest_sha256: cli.receipt.manifest_sha256,
      official: cli.receipt.official,
      input_count: cli.record.inputs.length,
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
  const [evidence, source, quality, cli] = await Promise.all([
    loadEvidence(),
    loadSources(),
    loadQuality(),
    loadCliReceipt(),
  ]);
  const strings = new Map([
    ["architecture-contours.svg", renderArchitecture()],
    ["evidence-trust-chain.svg", renderTrustChain()],
    ["atomic-publication.svg", renderPublication()],
    ["pilot-implementation-grid.svg", renderImplementationGrid(source)],
    ["checkpoint-modalities.svg", renderCheckpointModalities(evidence)],
    ["evidence-bundle-overview.svg", renderBundleOverview(evidence)],
    ["quality-verification.svg", renderQualityVerification(quality)],
    ["cli-evidence-verification.svg", renderCliVerification(cli)],
  ]);
  const outputs = new Map(
    [...strings].map(([name, value]) => [name, Buffer.from(value, "utf8")]),
  );
  const generatorSources = sourceSet(sourceCatalog.generator, source);
  const artifactSources = new Map([
    [
      "architecture-contours.svg",
      [...sourceSet(sourceCatalog.architecture, source), ...generatorSources],
    ],
    [
      "evidence-trust-chain.svg",
      [...sourceSet(sourceCatalog.trust, source), ...generatorSources],
    ],
    [
      "atomic-publication.svg",
      [...sourceSet(sourceCatalog.publication, source), ...generatorSources],
    ],
    [
      "pilot-implementation-grid.svg",
      [...sourceSet(sourceCatalog.implementation, source), ...generatorSources],
    ],
    [
      "checkpoint-modalities.svg",
      [
        ...evidence.sources.filter(
          ({ path }) =>
            path.endsWith("--accessibility.json") ||
            path.endsWith("--layout.json") ||
            path.endsWith("/MANIFEST.json"),
        ),
        ...generatorSources,
      ],
    ],
    ["evidence-bundle-overview.svg", [...evidence.sources, ...generatorSources]],
    [
      "quality-verification.svg",
      [
        ...quality.sources,
        ...sourceSet(sourceCatalog.quality, source),
        ...generatorSources,
      ],
    ],
    [
      "cli-evidence-verification.svg",
      [...cli.sources, ...sourceSet(sourceCatalog.cli, source), ...generatorSources],
    ],
  ]);
  outputs.set(
    manifestName,
    await buildManifest(outputs, artifactSources, evidence, quality, cli),
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
