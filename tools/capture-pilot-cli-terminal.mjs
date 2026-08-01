#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const toolRelative = "tools/capture-pilot-cli-terminal.mjs";
const outputRelative = "docs/images/terminal-evidence";
const outputParentRelative = dirname(outputRelative);
const outputLeaf = outputRelative.slice(outputParentRelative.length + 1);
const manifestName = "MANIFEST.json";
const transcriptName = "pilot-evidence-check.txt";
const terminalSvgName = "pilot-evidence-check.svg";
const boundarySvgName = "evidence-boundary.svg";
const commandArgv = Object.freeze(["npm", "run", "--silent", "evidence:pilot:check"]);
const expectedCliInputPaths = Object.freeze([
  ".node-version",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "src/cli/pilot-portfolio-evidence.ts",
  "src/portfolio-evidence/publication.ts",
  "docs/images/pilot-portfolio-evidence/MANIFEST.json",
]);
const recorderSourcePaths = Object.freeze([
  ...expectedCliInputPaths,
  "docs/quality/pilot-evidence-check-run.json",
  "docs/quality/pilot-evidence-check.stdout",
  toolRelative,
]);
const expectedEstablishes = Object.freeze([
  "one successful exact-runtime verification of the committed local-authoring Pilot evidence",
  "path-free stdout exactly matches the independently derived committed-manifest receipt",
  "the allowlisted source and manifest inputs have the recorded byte identities",
]);
const outputNames = Object.freeze(
  [manifestName, transcriptName, terminalSvgName, boundarySvgName].sort(
    compareCodeUnits,
  ),
);
const emptySha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const sha256Pattern = /^[0-9a-f]{64}$/u;
const gitObjectPattern = /^[0-9a-f]{40}$/u;
const safeVersionPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/u;
const maximumSourceBytes = 4 * 1024 * 1024;
const maximumOutputBytes = 512 * 1024;
const maximumStdoutBytes = 4 * 1024;
const maximumGitOutputBytes = 64 * 1024;
const prompt = "$ npm run --silent evidence:pilot:check";
const gitExecutable = "/usr/bin/git";
const procFileDescriptorRoot = "/proc/self/fd";

class TerminalEvidenceError extends Error {
  constructor(code) {
    super(code);
    this.name = "TerminalEvidenceError";
    this.code = code;
  }
}

function fail(code) {
  throw new TerminalEvidenceError(code);
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function lineCount(bytes) {
  let count = 0;
  for (const byte of bytes) {
    if (byte === 0x0a) count += 1;
  }
  return count + (bytes.at(-1) === 0x0a ? 0 : 1);
}

function exactKeys(value, expected, code) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(code);
  }
  const actual = Object.keys(value).sort(compareCodeUnits);
  const wanted = [...expected].sort(compareCodeUnits);
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(code);
  }
}

function exactArray(actual, expected, code) {
  if (
    !Array.isArray(actual) ||
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    fail(code);
  }
}

function positiveSafeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 1) fail(code);
  return value;
}

function safeString(value, maximumLength, code) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail(code);
  }
  return value;
}

function runRecordNonClaimsForRuntime(nodeVersion) {
  if (!safeVersionPattern.test(nodeVersion)) fail("terminal_evidence.runtime_contract");
  return Object.freeze([
    "official dataset release",
    "model quality or benchmark performance",
    "fresh browser capture or production-browser compatibility",
    `execution on any runtime other than the recorded Node.js ${nodeVersion}`,
  ]);
}

function terminalNonClaimsForRuntime(nodeVersion) {
  return Object.freeze([
    ...runRecordNonClaimsForRuntime(nodeVersion),
    "network behavior or network isolation",
  ]);
}

function assertRelativePath(path, code) {
  safeString(path, 256, code);
  if (
    path.startsWith("/") ||
    path.startsWith("\\") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    fail(code);
  }
  return path;
}

function resolvedRepositoryPath(root, path, code) {
  assertRelativePath(path, code);
  const absolute = resolve(root, path);
  if (!absolute.startsWith(`${resolve(root)}${sep}`)) fail(code);
  return absolute;
}

function directoryOpenFlags() {
  if (
    process.platform !== "linux" ||
    typeof constants.O_DIRECTORY !== "number" ||
    typeof constants.O_NOFOLLOW !== "number"
  ) {
    fail("terminal_evidence.descriptor_paths_unavailable");
  }
  return (
    constants.O_RDONLY |
    constants.O_DIRECTORY |
    constants.O_NOFOLLOW |
    (constants.O_CLOEXEC ?? 0)
  );
}

function descriptorDirectoryPath(handle, code) {
  if (
    process.platform !== "linux" ||
    !Number.isSafeInteger(handle.fd) ||
    handle.fd < 0
  ) {
    fail(code);
  }
  return `${procFileDescriptorRoot}/${handle.fd}`;
}

function descriptorChildPath(handle, name, code) {
  safeString(name, 256, code);
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    fail(code);
  }
  return `${descriptorDirectoryPath(handle, code)}/${name}`;
}

async function openDirectoryChain(root, relativeDirectory, code) {
  if (
    typeof root !== "string" ||
    root.length < 1 ||
    root.includes("\u0000") ||
    resolve(root) !== root
  ) {
    fail(code);
  }
  const flags = directoryOpenFlags();
  let current;
  try {
    current = await open(root, flags);
    const rootStats = await current.stat({ bigint: true });
    if (!rootStats.isDirectory()) fail(code);
    if (relativeDirectory === ".") return current;
    assertRelativePath(relativeDirectory, code);
    for (const part of relativeDirectory.split("/")) {
      let next;
      try {
        next = await open(descriptorChildPath(current, part, code), flags);
        const stats = await next.stat({ bigint: true });
        if (!stats.isDirectory()) fail(code);
      } catch (error) {
        await next?.close().catch(() => {});
        throw error;
      }
      await current.close();
      current = next;
    }
    return current;
  } catch (error) {
    await current?.close().catch(() => {});
    if (error instanceof TerminalEvidenceError) throw error;
    fail(code);
  }
}

async function readRegularFileAt(directory, name, maximumBytes, code) {
  if (
    typeof constants.O_NONBLOCK !== "number" ||
    typeof constants.O_NOFOLLOW !== "number"
  ) {
    fail("terminal_evidence.descriptor_paths_unavailable");
  }
  let handle;
  try {
    handle = await open(
      descriptorChildPath(directory, name, code),
      constants.O_RDONLY |
        constants.O_NONBLOCK |
        (constants.O_CLOEXEC ?? 0) |
        constants.O_NOFOLLOW,
    );
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > BigInt(maximumBytes)) {
      fail(code);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (
      bytes.byteLength !== Number(before.size) ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) {
      fail("terminal_evidence.source_changed");
    }
    return bytes;
  } catch (error) {
    if (error instanceof TerminalEvidenceError) throw error;
    fail(code);
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readRegularFile(
  root,
  path,
  maximumBytes = maximumSourceBytes,
  code = "terminal_evidence.source_unsafe",
) {
  resolvedRepositoryPath(root, path, code);
  const directory = await openDirectoryChain(root, dirname(path), code);
  try {
    return await readRegularFileAt(directory, basename(path), maximumBytes, code);
  } finally {
    await directory.close().catch(() => {});
  }
}

function parseJson(bytes, code) {
  let value;
  try {
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) fail(code);
    value = JSON.parse(text);
  } catch {
    fail(code);
  }
  return value;
}

function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function validateReceipt(stdout, expectedManifestSha256) {
  if (
    stdout.byteLength < 2 ||
    stdout.byteLength > maximumStdoutBytes ||
    stdout.at(-1) !== 0x0a ||
    stdout.subarray(0, -1).includes(0x0a) ||
    stdout.includes(0x0d) ||
    stdout.includes(0x00)
  ) {
    fail("terminal_evidence.stdout_shape");
  }
  const receipt = parseJson(stdout.subarray(0, -1), "terminal_evidence.stdout_json");
  exactKeys(
    receipt,
    [
      "official",
      "manifest_sha256",
      "fixture_count",
      "workflow_count",
      "checkpoint_count",
    ],
    "terminal_evidence.stdout_schema",
  );
  if (
    receipt.official !== false ||
    typeof receipt.manifest_sha256 !== "string" ||
    !sha256Pattern.test(receipt.manifest_sha256) ||
    receipt.manifest_sha256 !== expectedManifestSha256
  ) {
    fail("terminal_evidence.stdout_receipt");
  }
  positiveSafeInteger(receipt.fixture_count, "terminal_evidence.stdout_receipt");
  positiveSafeInteger(receipt.workflow_count, "terminal_evidence.stdout_receipt");
  positiveSafeInteger(receipt.checkpoint_count, "terminal_evidence.stdout_receipt");
  if (!Buffer.from(`${JSON.stringify(receipt)}\n`, "utf8").equals(stdout)) {
    fail("terminal_evidence.stdout_canonical");
  }
  return receipt;
}

function validateRuntime(runtime, nodeVersion, packageManager) {
  exactKeys(
    runtime,
    ["node", "node_module_abi", "npm", "platform", "architecture"],
    "terminal_evidence.run_record",
  );
  for (const key of ["node", "node_module_abi", "npm", "platform", "architecture"]) {
    safeString(runtime[key], 64, "terminal_evidence.run_record");
  }
  if (
    runtime.node !== nodeVersion ||
    runtime.npm !== packageManager ||
    !safeVersionPattern.test(runtime.node) ||
    !safeVersionPattern.test(runtime.npm)
  ) {
    fail("terminal_evidence.runtime_contract");
  }
}

async function loadSourceEvidence(root) {
  const sourceBytes = new Map();
  for (const path of recorderSourcePaths) {
    sourceBytes.set(path, await readRegularFile(root, path));
  }

  const runRecordBytes = sourceBytes.get("docs/quality/pilot-evidence-check-run.json");
  const stdout = sourceBytes.get("docs/quality/pilot-evidence-check.stdout");
  const nodeVersionBytes = sourceBytes.get(".node-version");
  const packageBytes = sourceBytes.get("package.json");
  const evidenceManifest = sourceBytes.get(
    "docs/images/pilot-portfolio-evidence/MANIFEST.json",
  );
  if (
    runRecordBytes === undefined ||
    stdout === undefined ||
    nodeVersionBytes === undefined ||
    packageBytes === undefined ||
    evidenceManifest === undefined
  ) {
    fail("terminal_evidence.internal");
  }

  const nodeVersion = nodeVersionBytes.toString("utf8").trim();
  if (
    nodeVersionBytes.toString("utf8") !== `${nodeVersion}\n` ||
    !safeVersionPattern.test(nodeVersion)
  ) {
    fail("terminal_evidence.runtime_contract");
  }
  const packageRecord = parseJson(packageBytes, "terminal_evidence.package_json");
  if (
    typeof packageRecord !== "object" ||
    packageRecord === null ||
    Array.isArray(packageRecord) ||
    typeof packageRecord.packageManager !== "string"
  ) {
    fail("terminal_evidence.package_json");
  }
  const packageMatch = /^npm@([0-9]+\.[0-9]+\.[0-9]+)$/u.exec(
    packageRecord.packageManager,
  );
  if (packageMatch === null) fail("terminal_evidence.runtime_contract");
  const packageManager = packageMatch[1];

  const runRecord = parseJson(runRecordBytes, "terminal_evidence.run_record_json");
  exactKeys(
    runRecord,
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
    "terminal_evidence.run_record",
  );
  if (
    runRecord.contract !== "impactdiff.pilot-evidence-cli-run" ||
    runRecord.version !== 1 ||
    runRecord.official !== false
  ) {
    fail("terminal_evidence.run_record");
  }
  exactKeys(
    runRecord.source,
    ["git_revision", "git_tree"],
    "terminal_evidence.run_record",
  );
  if (
    typeof runRecord.source.git_revision !== "string" ||
    !gitObjectPattern.test(runRecord.source.git_revision) ||
    typeof runRecord.source.git_tree !== "string" ||
    !gitObjectPattern.test(runRecord.source.git_tree)
  ) {
    fail("terminal_evidence.run_record");
  }
  exactKeys(runRecord.command, ["argv"], "terminal_evidence.run_record");
  exactArray(runRecord.command.argv, commandArgv, "terminal_evidence.run_record");
  validateRuntime(runRecord.runtime, nodeVersion, packageManager);
  const runRecordNonClaims = runRecordNonClaimsForRuntime(runRecord.runtime.node);

  exactKeys(
    runRecord.result,
    ["exit_code", "stdout", "stderr"],
    "terminal_evidence.run_record",
  );
  if (runRecord.result.exit_code !== 0) fail("terminal_evidence.run_record");
  exactKeys(
    runRecord.result.stdout,
    ["file", "media_type", "sha256", "byte_length", "line_count"],
    "terminal_evidence.run_record",
  );
  exactKeys(
    runRecord.result.stderr,
    ["sha256", "byte_length"],
    "terminal_evidence.run_record",
  );
  if (
    runRecord.result.stdout.file !== "pilot-evidence-check.stdout" ||
    runRecord.result.stdout.media_type !== "application/jsonl; charset=utf-8" ||
    runRecord.result.stdout.sha256 !== sha256(stdout) ||
    runRecord.result.stdout.byte_length !== stdout.byteLength ||
    runRecord.result.stdout.line_count !== 1 ||
    runRecord.result.stderr.sha256 !== emptySha256 ||
    runRecord.result.stderr.byte_length !== 0
  ) {
    fail("terminal_evidence.run_record");
  }

  exactKeys(
    runRecord.evidence_boundary,
    ["establishes", "does_not_establish"],
    "terminal_evidence.run_record",
  );
  exactArray(
    runRecord.evidence_boundary.establishes,
    expectedEstablishes,
    "terminal_evidence.run_record",
  );
  exactArray(
    runRecord.evidence_boundary.does_not_establish,
    runRecordNonClaims,
    "terminal_evidence.run_record",
  );

  if (
    !Array.isArray(runRecord.inputs) ||
    runRecord.inputs.length !== expectedCliInputPaths.length
  ) {
    fail("terminal_evidence.run_record");
  }
  for (const [index, expectedPath] of expectedCliInputPaths.entries()) {
    const input = runRecord.inputs[index];
    exactKeys(input, ["path", "sha256", "byte_length"], "terminal_evidence.run_record");
    const bytes = sourceBytes.get(expectedPath);
    if (
      bytes === undefined ||
      input.path !== expectedPath ||
      input.sha256 !== sha256(bytes) ||
      input.byte_length !== bytes.byteLength
    ) {
      fail("terminal_evidence.source_identity");
    }
  }

  const evidenceManifestSha256 = sha256(evidenceManifest);
  const receipt = validateReceipt(stdout, evidenceManifestSha256);
  const sources = recorderSourcePaths
    .map((path) => {
      const bytes = sourceBytes.get(path);
      if (bytes === undefined) fail("terminal_evidence.internal");
      return Object.freeze({
        path,
        sha256: sha256(bytes),
        byte_length: bytes.byteLength,
        line_count: lineCount(bytes),
      });
    })
    .sort(({ path: left }, { path: right }) => compareCodeUnits(left, right));

  return Object.freeze({
    runRecord,
    receipt,
    stdout,
    sources,
    nonClaims: terminalNonClaimsForRuntime(runRecord.runtime.node),
    runtime: Object.freeze({
      node: runRecord.runtime.node,
      node_module_abi: runRecord.runtime.node_module_abi,
      npm: runRecord.runtime.npm,
      platform: runRecord.runtime.platform,
      architecture: runRecord.runtime.architecture,
    }),
  });
}

function safeEnvironment() {
  const path = process.env.PATH;
  if (typeof path !== "string" || path.length < 1 || path.includes("\u0000")) {
    fail("terminal_evidence.environment");
  }
  return Object.freeze({
    PATH: path,
    CI: "1",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  });
}

function runBounded(root, executable, arguments_, maximumBytes, environment) {
  const result = spawnSync(executable, arguments_, {
    cwd: root,
    // Node's test coverage collector injects NODE_V8_COVERAGE before spawn.
    // Keep the validated template frozen, but give the runtime a mutable copy.
    env: { ...environment },
    shell: false,
    encoding: "buffer",
    maxBuffer: maximumBytes,
    timeout: 120_000,
    windowsHide: true,
  });
  if (
    result.error !== undefined ||
    result.signal !== null ||
    result.status === null ||
    !Buffer.isBuffer(result.stdout) ||
    !Buffer.isBuffer(result.stderr) ||
    result.stdout.byteLength > maximumBytes ||
    result.stderr.byteLength > maximumBytes
  ) {
    fail("terminal_evidence.process");
  }
  return result;
}

function runGit(root, arguments_, maximumBytes = maximumGitOutputBytes) {
  const result = runBounded(
    root,
    gitExecutable,
    arguments_,
    maximumBytes,
    safeEnvironment(),
  );
  if (result.status !== 0 || result.stderr.byteLength !== 0) {
    fail("terminal_evidence.git");
  }
  return result.stdout;
}

function gitLine(root, arguments_) {
  const bytes = runGit(root, arguments_);
  if (
    bytes.byteLength < 2 ||
    bytes.at(-1) !== 0x0a ||
    bytes.subarray(0, -1).includes(0x0a) ||
    bytes.includes(0x00)
  ) {
    fail("terminal_evidence.git");
  }
  return bytes.subarray(0, -1).toString("utf8");
}

function assertGitRepositoryBoundary(root) {
  const topLevel = gitLine(root, [
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
  ]);
  if (topLevel !== root) fail("terminal_evidence.repository_boundary");
}

function cleanGitProvenance(root) {
  assertGitRepositoryBoundary(root);
  const status = runGit(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignored=no",
  ]);
  if (status.byteLength !== 0) fail("terminal_evidence.git_dirty");
  for (const path of recorderSourcePaths) {
    const tracked = runGit(root, ["ls-files", "--error-unmatch", "--", path]);
    if (tracked.toString("utf8") !== `${path}\n`) {
      fail("terminal_evidence.source_uncommitted");
    }
  }
  const revision = gitLine(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const tree = gitLine(root, ["rev-parse", "--verify", "HEAD^{tree}"]);
  if (!gitObjectPattern.test(revision) || !gitObjectPattern.test(tree)) {
    fail("terminal_evidence.git");
  }
  return Object.freeze({ revision, tree });
}

function verifyCommittedSourceRecords(root, provenance, records) {
  assertGitRepositoryBoundary(root);
  if (
    typeof provenance !== "object" ||
    provenance === null ||
    typeof provenance.revision !== "string" ||
    !gitObjectPattern.test(provenance.revision) ||
    typeof provenance.tree !== "string" ||
    !gitObjectPattern.test(provenance.tree)
  ) {
    fail("terminal_evidence.source_provenance");
  }
  const resolvedCommit = gitLine(root, [
    "rev-parse",
    "--verify",
    `${provenance.revision}^{commit}`,
  ]);
  const resolvedTree = gitLine(root, [
    "rev-parse",
    "--verify",
    `${provenance.revision}^{tree}`,
  ]);
  if (resolvedCommit !== provenance.revision || resolvedTree !== provenance.tree) {
    fail("terminal_evidence.source_provenance");
  }
  const currentRevision = gitLine(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const ancestry = runBounded(
    root,
    gitExecutable,
    ["merge-base", "--is-ancestor", provenance.revision, currentRevision],
    maximumGitOutputBytes,
    safeEnvironment(),
  );
  if (
    ancestry.status !== 0 ||
    ancestry.stdout.byteLength !== 0 ||
    ancestry.stderr.byteLength !== 0
  ) {
    fail("terminal_evidence.source_provenance");
  }
  for (const record of records) {
    const path = assertRelativePath(record.path, "terminal_evidence.source_provenance");
    if (
      typeof record.sha256 !== "string" ||
      !sha256Pattern.test(record.sha256) ||
      !Number.isSafeInteger(record.byte_length) ||
      record.byte_length < 1 ||
      record.byte_length > maximumSourceBytes
    ) {
      fail("terminal_evidence.source_provenance");
    }
    const committed = runGit(
      root,
      ["show", `${provenance.revision}:${path}`],
      maximumSourceBytes,
    );
    if (
      committed.byteLength !== record.byte_length ||
      sha256(committed) !== record.sha256
    ) {
      fail("terminal_evidence.source_provenance");
    }
  }
}

function verifyEvidenceProvenance(root, provenance, evidence) {
  verifyCommittedSourceRecords(root, provenance, evidence.sources);
  verifyCommittedSourceRecords(
    root,
    {
      revision: evidence.runRecord.source.git_revision,
      tree: evidence.runRecord.source.git_tree,
    },
    evidence.runRecord.inputs,
  );
}

function recordStateIdentity(state) {
  return JSON.stringify({
    provenance: state.provenance,
    sources: state.evidence.sources,
    runtime: state.evidence.runtime,
    receipt: state.evidence.receipt,
    stdout_sha256: sha256(state.evidence.stdout),
  });
}

async function auditCommittedRecordState(root) {
  const before = cleanGitProvenance(root);
  const evidence = await loadSourceEvidence(root);
  const after = cleanGitProvenance(root);
  if (before.revision !== after.revision || before.tree !== after.tree) {
    fail("terminal_evidence.source_changed");
  }
  verifyEvidenceProvenance(root, after, evidence);
  return Object.freeze({ provenance: after, evidence });
}

function assertExactRuntime(root, evidence) {
  if (
    process.versions.node !== evidence.runtime.node ||
    process.versions.modules !== evidence.runtime.node_module_abi ||
    process.platform !== evidence.runtime.platform ||
    process.arch !== evidence.runtime.architecture
  ) {
    fail("terminal_evidence.runtime_mismatch");
  }
  const result = runBounded(root, "npm", ["--version"], 256, safeEnvironment());
  if (
    result.status !== 0 ||
    result.stderr.byteLength !== 0 ||
    result.stdout.toString("utf8") !== `${evidence.runtime.npm}\n`
  ) {
    fail("terminal_evidence.runtime_mismatch");
  }
}

function captureCliStdout(root, evidence) {
  const result = runBounded(
    root,
    commandArgv[0],
    commandArgv.slice(1),
    maximumStdoutBytes,
    safeEnvironment(),
  );
  if (
    result.status !== 0 ||
    result.stderr.byteLength !== 0 ||
    !result.stdout.equals(evidence.stdout)
  ) {
    fail("terminal_evidence.capture_mismatch");
  }
  return result.stdout;
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function svgDocument({ id, width, height, title, description, body }) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${id}-title ${id}-desc">\n` +
      `  <title id="${id}-title">${xml(title)}</title>\n` +
      `  <desc id="${id}-desc">${xml(description)}</desc>\n` +
      `  <style>\n` +
      `    .title{font:700 28px Inter,system-ui,sans-serif;fill:#f8fafc}.subtitle{font:400 15px Inter,system-ui,sans-serif;fill:#94a3b8}.mono{font:500 16px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;fill:#dbeafe}.prompt{fill:#6ee7b7}.label{font:700 12px Inter,system-ui,sans-serif;letter-spacing:1.2px;fill:#93c5fd}.metric{font:700 34px Inter,system-ui,sans-serif;fill:#f8fafc}.body{font:500 16px Inter,system-ui,sans-serif;fill:#cbd5e1}.small{font:500 13px Inter,system-ui,sans-serif;fill:#94a3b8}\n` +
      `  </style>\n` +
      `  ${body}\n` +
      `</svg>\n`,
    "utf8",
  );
}

function wrapCodeUnits(value, width) {
  const lines = [];
  for (let index = 0; index < value.length; index += width) {
    lines.push(value.slice(index, index + width));
  }
  return lines;
}

function renderTerminalSvg(stdout) {
  const receiptLine = stdout.toString("utf8").slice(0, -1);
  const wrapped = wrapCodeUnits(receiptLine, 92);
  const outputLines = [
    `<text x="72" y="190" class="mono prompt">${xml(prompt)}</text>`,
    ...wrapped.map(
      (line, index) =>
        `<text x="72" y="${234 + index * 30}" class="mono">${xml(line)}</text>`,
    ),
  ];
  const body =
    `<rect width="1440" height="520" rx="28" fill="#07111f"/>` +
    `<circle cx="72" cy="54" r="7" fill="#fb7185"/><circle cx="96" cy="54" r="7" fill="#fbbf24"/><circle cx="120" cy="54" r="7" fill="#34d399"/>` +
    `<text x="72" y="112" class="title">Read-only Pilot evidence verification</text>` +
    `<text x="72" y="142" class="subtitle">Exact child stdout; the long JSON line is display-wrapped only.</text>` +
    `<rect x="48" y="160" width="1344" height="190" rx="16" fill="#0f1d30" stroke="#243b5a"/>` +
    outputLines.join("") +
    `<rect x="48" y="382" width="1344" height="86" rx="16" fill="#0b1728" stroke="#1e3a5f"/>` +
    `<text x="72" y="416" class="label">CAPTURE BOUNDARY</text>` +
    `<text x="72" y="448" class="body">1 invocation · exit 0 · stderr 0 B · no host, cwd, timestamp, or secret · network behavior not observed</text>`;
  return svgDocument({
    id: "pilot-evidence-check-terminal",
    width: 1440,
    height: 520,
    title: "Read-only Pilot evidence verification terminal capture",
    description:
      "A byte-derived terminal rendering of the exact path-free stdout produced by one successful Pilot evidence verification command.",
    body,
  });
}

function renderBoundarySvg(evidence) {
  const receipt = evidence.receipt;
  const manifestShort = `${receipt.manifest_sha256.slice(0, 16)}…`;
  const body =
    `<rect width="1440" height="620" rx="28" fill="#07111f"/>` +
    `<text x="64" y="72" class="title">What the terminal receipt establishes</text>` +
    `<text x="64" y="104" class="subtitle">Values are parsed from the exact captured JSON and its committed run record.</text>` +
    `<rect x="64" y="140" width="300" height="128" rx="18" fill="#0f1d30" stroke="#2563eb"/>` +
    `<text x="88" y="177" class="label">FIXTURES</text><text x="88" y="228" class="metric">${receipt.fixture_count}</text>` +
    `<rect x="388" y="140" width="300" height="128" rx="18" fill="#0f1d30" stroke="#0d9488"/>` +
    `<text x="412" y="177" class="label">WORKFLOWS</text><text x="412" y="228" class="metric">${receipt.workflow_count}</text>` +
    `<rect x="712" y="140" width="300" height="128" rx="18" fill="#0f1d30" stroke="#7c3aed"/>` +
    `<text x="736" y="177" class="label">CHECKPOINTS</text><text x="736" y="228" class="metric">${receipt.checkpoint_count}</text>` +
    `<rect x="1036" y="140" width="340" height="128" rx="18" fill="#0f1d30" stroke="#e11d48"/>` +
    `<text x="1060" y="177" class="label">OFFICIAL DATASET</text><text x="1060" y="228" class="metric">false</text>` +
    `<rect x="64" y="300" width="1312" height="92" rx="18" fill="#0b1728" stroke="#1e3a5f"/>` +
    `<text x="88" y="336" class="label">MANIFEST SHA-256</text>` +
    `<text x="88" y="370" class="mono">${xml(receipt.manifest_sha256)}</text>` +
    `<rect x="64" y="424" width="1312" height="132" rx="18" fill="#0b1728" stroke="#7f1d1d"/>` +
    `<text x="88" y="460" class="label">EXPLICIT NON-CLAIMS</text>` +
    `<text x="88" y="495" class="body">No official dataset · no model quality or benchmark performance · no fresh browser capture</text>` +
    `<text x="88" y="527" class="body">No production-browser compatibility · no network claim · exact Node ${xml(evidence.runtime.node)} only · receipt ${xml(manifestShort)}</text>`;
  return svgDocument({
    id: "pilot-evidence-boundary",
    width: 1440,
    height: 620,
    title: "Pilot evidence receipt claim boundary",
    description:
      "A source-bound summary of fixture, workflow, and checkpoint counts together with the explicit official-false and non-benchmark boundary.",
    body,
  });
}

function buildTranscript(stdout) {
  return Buffer.concat([Buffer.from(`${prompt}\n`, "utf8"), stdout]);
}

function artifactRecord(file, mediaType, bytes, sourceBindings) {
  return Object.freeze({
    file,
    media_type: mediaType,
    sha256: sha256(bytes),
    byte_length: bytes.byteLength,
    source_bindings: sourceBindings,
  });
}

function sourceLineSpan(evidence, path) {
  const source = evidence.sources.find((candidate) => candidate.path === path);
  if (source === undefined) fail("terminal_evidence.internal");
  return source.line_count === 1 ? "1" : `1-${source.line_count}`;
}

function buildOutputs(evidence, provenance) {
  const transcript = buildTranscript(evidence.stdout);
  const terminalSvg = renderTerminalSvg(evidence.stdout);
  const boundarySvg = renderBoundarySvg(evidence);
  const artifacts = [
    artifactRecord(transcriptName, "text/plain; charset=utf-8", transcript, [
      Object.freeze({
        path: "docs/quality/pilot-evidence-check.stdout",
        lines: sourceLineSpan(evidence, "docs/quality/pilot-evidence-check.stdout"),
      }),
    ]),
    artifactRecord(terminalSvgName, "image/svg+xml", terminalSvg, [
      Object.freeze({ path: transcriptName, lines: "1-2" }),
      Object.freeze({
        path: "docs/quality/pilot-evidence-check-run.json",
        lines: sourceLineSpan(evidence, "docs/quality/pilot-evidence-check-run.json"),
      }),
    ]),
    artifactRecord(boundarySvgName, "image/svg+xml", boundarySvg, [
      Object.freeze({
        path: "docs/quality/pilot-evidence-check-run.json",
        lines: sourceLineSpan(evidence, "docs/quality/pilot-evidence-check-run.json"),
      }),
      Object.freeze({
        path: "docs/images/pilot-portfolio-evidence/MANIFEST.json",
        lines: sourceLineSpan(
          evidence,
          "docs/images/pilot-portfolio-evidence/MANIFEST.json",
        ),
      }),
    ]),
  ].sort(({ file: left }, { file: right }) => compareCodeUnits(left, right));
  const manifestValue = {
    contract: "impactdiff.pilot-cli-terminal-evidence",
    version: 1,
    official: false,
    generated_by: toolRelative,
    network_observation: "not_observed",
    source: {
      git_revision: provenance.revision,
      git_tree: provenance.tree,
    },
    command: {
      argv: commandArgv,
      shell: false,
      invocation_count: 1,
    },
    runtime: evidence.runtime,
    result: {
      exit_code: 0,
      stdout_sha256: sha256(evidence.stdout),
      stdout_byte_length: evidence.stdout.byteLength,
      stdout_line_count: 1,
      stderr_sha256: emptySha256,
      stderr_byte_length: 0,
    },
    evidence_boundary: {
      establishes: expectedEstablishes,
      does_not_establish: evidence.nonClaims,
    },
    sources: evidence.sources,
    artifacts,
  };
  return new Map([
    [transcriptName, transcript],
    [terminalSvgName, terminalSvg],
    [boundarySvgName, boundarySvg],
    [manifestName, canonicalJson(manifestValue)],
  ]);
}

function isErrorCode(error, code) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function fileIdentity(stats) {
  return Object.freeze({ dev: stats.dev, ino: stats.ino });
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function openChildDirectory(parent, name, allowAbsent, code) {
  let handle;
  try {
    handle = await open(descriptorChildPath(parent, name, code), directoryOpenFlags());
    const stats = await handle.stat({ bigint: true });
    if (!stats.isDirectory()) fail(code);
    return Object.freeze({ handle, identity: fileIdentity(stats) });
  } catch (error) {
    await handle?.close().catch(() => {});
    if (allowAbsent && isErrorCode(error, "ENOENT")) return undefined;
    if (error instanceof TerminalEvidenceError) throw error;
    fail(code);
  }
}

async function inspectOutputDirectoryAt(parent, allowAbsent) {
  const opened = await openChildDirectory(
    parent,
    outputLeaf,
    allowAbsent,
    "terminal_evidence.output_unsafe",
  );
  if (opened === undefined) return undefined;
  try {
    const actual = (
      await readdir(
        descriptorDirectoryPath(opened.handle, "terminal_evidence.output_unsafe"),
      )
    ).sort(compareCodeUnits);
    if (
      actual.length !== outputNames.length ||
      actual.some((name, index) => name !== outputNames[index])
    ) {
      fail("terminal_evidence.output_topology");
    }
    return opened;
  } catch (error) {
    await opened.handle.close().catch(() => {});
    if (error instanceof TerminalEvidenceError) throw error;
    fail("terminal_evidence.output_unsafe");
  }
}

async function readOutputAt(outputDirectory, name) {
  if (!outputNames.includes(name)) fail("terminal_evidence.output_topology");
  return readRegularFileAt(
    outputDirectory,
    name,
    maximumOutputBytes,
    "terminal_evidence.output_unsafe",
  );
}

async function pathIdentityAt(parent, name, expectedKind, allowAbsent = false) {
  try {
    const stats = await lstat(
      descriptorChildPath(parent, name, "terminal_evidence.output_unsafe"),
      { bigint: true },
    );
    const rightKind =
      !stats.isSymbolicLink() &&
      (expectedKind === "directory" ? stats.isDirectory() : stats.isFile());
    if (!rightKind) fail("terminal_evidence.output_unsafe");
    return fileIdentity(stats);
  } catch (error) {
    if (allowAbsent && isErrorCode(error, "ENOENT")) return undefined;
    if (error instanceof TerminalEvidenceError) throw error;
    fail("terminal_evidence.output_unsafe");
  }
}

async function assertPathAbsent(parent, name) {
  const identity = await pathIdentityAt(parent, name, "directory", true);
  if (identity !== undefined) fail("terminal_evidence.output_unsafe");
}

async function openLock(parent) {
  const name = `.${outputLeaf}.lock`;
  let handle;
  try {
    handle = await open(
      descriptorChildPath(parent, name, "terminal_evidence.output_unsafe"),
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        (constants.O_CLOEXEC ?? 0) |
        constants.O_NOFOLLOW,
      0o600,
    );
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile()) fail("terminal_evidence.locked");
    return Object.freeze({ name, handle, identity: fileIdentity(stats) });
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof TerminalEvidenceError) throw error;
    fail("terminal_evidence.locked");
  }
}

async function closeAndRemoveLock(parent, lock) {
  let failure;
  try {
    const current = await pathIdentityAt(parent, lock.name, "file");
    if (!sameFileIdentity(current, lock.identity)) {
      fail("terminal_evidence.publication_cleanup");
    }
    await unlink(
      descriptorChildPath(parent, lock.name, "terminal_evidence.output_unsafe"),
    );
  } catch (error) {
    failure = error;
  }
  try {
    await lock.handle.close();
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) fail("terminal_evidence.publication_cleanup");
}

async function writeExclusiveAt(directory, name, bytes) {
  let handle;
  let failure;
  try {
    handle = await open(
      descriptorChildPath(directory, name, "terminal_evidence.output_unsafe"),
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        (constants.O_CLOEXEC ?? 0) |
        constants.O_NOFOLLOW,
      0o644,
    );
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    failure = error;
  }
  try {
    await handle?.close();
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) fail("terminal_evidence.output_write");
}

async function removeKnownDirectory(parent, name, expectedIdentity) {
  const current = await pathIdentityAt(parent, name, "directory");
  if (!sameFileIdentity(current, expectedIdentity)) {
    fail("terminal_evidence.publication_cleanup");
  }
  await rm(descriptorChildPath(parent, name, "terminal_evidence.output_unsafe"), {
    recursive: true,
    force: false,
  });
  if ((await pathIdentityAt(parent, name, "directory", true)) !== undefined) {
    fail("terminal_evidence.publication_cleanup");
  }
}

async function publishOutputs(root, outputs) {
  resolvedRepositoryPath(root, outputParentRelative, "terminal_evidence.output_unsafe");
  const parent = await openDirectoryChain(
    root,
    outputParentRelative,
    "terminal_evidence.output_unsafe",
  );
  const parentPath = descriptorDirectoryPath(parent, "terminal_evidence.output_unsafe");
  const stageName = `.${outputLeaf}.stage-${process.pid}`;
  const backupName = `.${outputLeaf}.backup-${process.pid}`;
  const outputPath = join(parentPath, outputLeaf);
  const stagePath = join(parentPath, stageName);
  const backupPath = join(parentPath, backupName);
  let lock;
  let stageCreated = false;
  let stageIdentity;
  let previousIdentity;
  let movedPrevious = false;
  let published = false;
  let primaryError;
  const cleanupErrors = [];

  try {
    lock = await openLock(parent);
    const existing = await inspectOutputDirectoryAt(parent, true);
    if (existing !== undefined) {
      previousIdentity = existing.identity;
      for (const name of outputNames) {
        await readOutputAt(existing.handle, name);
      }
      await existing.handle.close();
    }
    await assertPathAbsent(parent, stageName);
    await assertPathAbsent(parent, backupName);
    await mkdir(stagePath, { mode: 0o755 });
    stageCreated = true;
    const stage = await openChildDirectory(
      parent,
      stageName,
      false,
      "terminal_evidence.output_unsafe",
    );
    if (stage === undefined) fail("terminal_evidence.internal");
    stageIdentity = stage.identity;
    try {
      for (const name of outputNames.filter((name) => name !== manifestName)) {
        const bytes = outputs.get(name);
        if (bytes === undefined) fail("terminal_evidence.internal");
        await writeExclusiveAt(stage.handle, name, bytes);
      }
      const manifest = outputs.get(manifestName);
      if (manifest === undefined) fail("terminal_evidence.internal");
      await writeExclusiveAt(stage.handle, manifestName, manifest);
      await stage.handle.sync();
    } finally {
      await stage.handle.close();
    }

    if (previousIdentity !== undefined) {
      const current = await pathIdentityAt(parent, outputLeaf, "directory");
      if (!sameFileIdentity(current, previousIdentity)) {
        fail("terminal_evidence.output_unsafe");
      }
      await rename(outputPath, backupPath);
      movedPrevious = true;
      const moved = await pathIdentityAt(parent, backupName, "directory");
      if (!sameFileIdentity(moved, previousIdentity)) {
        fail("terminal_evidence.output_unsafe");
      }
    }
    await rename(stagePath, outputPath);
    published = true;
    const current = await pathIdentityAt(parent, outputLeaf, "directory");
    if (!sameFileIdentity(current, stageIdentity)) {
      fail("terminal_evidence.output_unsafe");
    }
    if (movedPrevious) {
      await removeKnownDirectory(parent, backupName, previousIdentity);
      movedPrevious = false;
    }
  } catch (error) {
    primaryError = error;
    if (movedPrevious && !published && previousIdentity !== undefined) {
      try {
        if (
          (await pathIdentityAt(parent, outputLeaf, "directory", true)) !== undefined
        ) {
          fail("terminal_evidence.publication_restore");
        }
        const backupIdentity = await pathIdentityAt(parent, backupName, "directory");
        if (!sameFileIdentity(backupIdentity, previousIdentity)) {
          fail("terminal_evidence.publication_restore");
        }
        await rename(backupPath, outputPath);
        const restored = await pathIdentityAt(parent, outputLeaf, "directory");
        if (!sameFileIdentity(restored, previousIdentity)) {
          fail("terminal_evidence.publication_restore");
        }
        movedPrevious = false;
      } catch (restoreError) {
        cleanupErrors.push(restoreError);
      }
    }
  }

  if (!published && stageIdentity !== undefined) {
    try {
      if ((await pathIdentityAt(parent, stageName, "directory", true)) !== undefined) {
        await removeKnownDirectory(parent, stageName, stageIdentity);
      }
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
  } else if (!published && stageCreated) {
    cleanupErrors.push(
      new TerminalEvidenceError("terminal_evidence.publication_cleanup"),
    );
  }
  if (published && primaryError !== undefined) {
    cleanupErrors.push(
      new TerminalEvidenceError("terminal_evidence.publication_uncertain"),
    );
  }
  if (movedPrevious) {
    cleanupErrors.push(
      new TerminalEvidenceError("terminal_evidence.publication_restore"),
    );
  }
  if (lock !== undefined) {
    try {
      await closeAndRemoveLock(parent, lock);
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
  }
  try {
    await parent.close();
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError);
  }

  if (primaryError !== undefined) {
    if (cleanupErrors.length > 0) fail("terminal_evidence.publication_uncertain");
    throw primaryError;
  }
  if (cleanupErrors.length > 0) fail("terminal_evidence.publication_cleanup");
}

function validateManifestValue(manifest, evidence) {
  exactKeys(
    manifest,
    [
      "contract",
      "version",
      "official",
      "generated_by",
      "network_observation",
      "source",
      "command",
      "runtime",
      "result",
      "evidence_boundary",
      "sources",
      "artifacts",
    ],
    "terminal_evidence.manifest",
  );
  if (
    manifest.contract !== "impactdiff.pilot-cli-terminal-evidence" ||
    manifest.version !== 1 ||
    manifest.official !== false ||
    manifest.generated_by !== toolRelative ||
    manifest.network_observation !== "not_observed"
  ) {
    fail("terminal_evidence.manifest");
  }
  exactKeys(
    manifest.source,
    ["git_revision", "git_tree"],
    "terminal_evidence.manifest",
  );
  if (
    typeof manifest.source.git_revision !== "string" ||
    !gitObjectPattern.test(manifest.source.git_revision) ||
    typeof manifest.source.git_tree !== "string" ||
    !gitObjectPattern.test(manifest.source.git_tree)
  ) {
    fail("terminal_evidence.manifest");
  }
  exactKeys(
    manifest.command,
    ["argv", "shell", "invocation_count"],
    "terminal_evidence.manifest",
  );
  exactArray(manifest.command.argv, commandArgv, "terminal_evidence.manifest");
  if (manifest.command.shell !== false || manifest.command.invocation_count !== 1) {
    fail("terminal_evidence.manifest");
  }
  if (JSON.stringify(manifest.runtime) !== JSON.stringify(evidence.runtime)) {
    fail("terminal_evidence.manifest");
  }
  exactKeys(
    manifest.result,
    [
      "exit_code",
      "stdout_sha256",
      "stdout_byte_length",
      "stdout_line_count",
      "stderr_sha256",
      "stderr_byte_length",
    ],
    "terminal_evidence.manifest",
  );
  if (
    manifest.result.exit_code !== 0 ||
    manifest.result.stdout_sha256 !== sha256(evidence.stdout) ||
    manifest.result.stdout_byte_length !== evidence.stdout.byteLength ||
    manifest.result.stdout_line_count !== 1 ||
    manifest.result.stderr_sha256 !== emptySha256 ||
    manifest.result.stderr_byte_length !== 0
  ) {
    fail("terminal_evidence.manifest");
  }
  if (
    JSON.stringify(manifest.evidence_boundary) !==
      JSON.stringify({
        establishes: expectedEstablishes,
        does_not_establish: evidence.nonClaims,
      }) ||
    JSON.stringify(manifest.sources) !== JSON.stringify(evidence.sources)
  ) {
    fail("terminal_evidence.manifest");
  }
}

async function checkOutputs(root, evidence) {
  const actual = new Map();
  const parent = await openDirectoryChain(
    root,
    outputParentRelative,
    "terminal_evidence.output_unsafe",
  );
  let output;
  let readError;
  try {
    output = await inspectOutputDirectoryAt(parent, false);
    if (output === undefined) fail("terminal_evidence.output_unsafe");
    for (const name of outputNames) {
      actual.set(name, await readOutputAt(output.handle, name));
    }
  } catch (error) {
    readError = error;
  }
  const closeErrors = [];
  if (output !== undefined) {
    try {
      await output.handle.close();
    } catch (error) {
      closeErrors.push(error);
    }
  }
  try {
    await parent.close();
  } catch (error) {
    closeErrors.push(error);
  }
  if (readError !== undefined) throw readError;
  if (closeErrors.length > 0) fail("terminal_evidence.output_unsafe");

  const manifestBytes = actual.get(manifestName);
  if (manifestBytes === undefined) fail("terminal_evidence.internal");
  const manifest = parseJson(manifestBytes, "terminal_evidence.manifest_json");
  if (!canonicalJson(manifest).equals(manifestBytes)) {
    fail("terminal_evidence.manifest_canonical");
  }
  validateManifestValue(manifest, evidence);
  verifyEvidenceProvenance(
    root,
    {
      revision: manifest.source.git_revision,
      tree: manifest.source.git_tree,
    },
    evidence,
  );
  const expected = buildOutputs(evidence, {
    revision: manifest.source.git_revision,
    tree: manifest.source.git_tree,
  });
  for (const name of outputNames) {
    if (!actual.get(name)?.equals(expected.get(name))) {
      fail("terminal_evidence.output_mismatch");
    }
  }
}

async function record(root) {
  const before = await auditCommittedRecordState(root);
  assertExactRuntime(root, before.evidence);
  captureCliStdout(root, before.evidence);
  const after = await auditCommittedRecordState(root);
  if (recordStateIdentity(before) !== recordStateIdentity(after)) {
    fail("terminal_evidence.source_changed");
  }
  const outputs = buildOutputs(after.evidence, after.provenance);
  await publishOutputs(root, outputs);
  process.stdout.write(
    `recorded ${outputs.size} manifest-bound files in ${outputRelative}\n`,
  );
}

async function check(root) {
  const evidence = await loadSourceEvidence(root);
  await checkOutputs(root, evidence);
  process.stdout.write(
    `verified ${outputNames.length} manifest-bound files in ${outputRelative}\n`,
  );
}

async function main() {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || (mode !== "record" && mode !== "check")) {
    fail("terminal_evidence.arguments");
  }
  if (mode === "record") {
    await record(repositoryRoot);
  } else {
    await check(repositoryRoot);
  }
}

try {
  await main();
} catch (error) {
  const code =
    error instanceof TerminalEvidenceError ? error.code : "terminal_evidence.failed";
  process.stderr.write(`${JSON.stringify({ code })}\n`);
  process.exitCode = 1;
}
