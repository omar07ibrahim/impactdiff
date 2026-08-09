#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const sourceRepositoryRoot = resolve(dirname(scriptPath), "..");
let repositoryRoot = sourceRepositoryRoot;
const gitExecutable = "/usr/bin/git";
const dependencyCatalog = Object.freeze([
  Object.freeze({
    name: "canonicalize",
    entry: "lib/canonicalize.js",
    version: "3.0.0",
    resolved: "https://registry.npmjs.org/canonicalize/-/canonicalize-3.0.0.tgz",
    integrity:
      "sha512-yYLfHyDMIXRyRqsKBRLX023riFLpXY2YOfdtqKXZRZy9qsfOJ9U+4F9YZL7MEzL5+ziN2x2nlBvY/Voi3EBljA==",
    installed_file_count: 6,
    installed_byte_length: 16_314,
    installed_file_tree_sha256:
      "094ce2020ddd09226f7e63dc33ae15efb7381c771edaa7e352dd133c24530591",
  }),
  Object.freeze({
    name: "pngjs",
    entry: "lib/png.js",
    version: "7.0.0",
    resolved: "https://registry.npmjs.org/pngjs/-/pngjs-7.0.0.tgz",
    integrity:
      "sha512-LKWqWJRhstyYo9pGvgor/ivk2w94eSjE3RGVuzLGlr3NmD8bf7RcYGze1mNdEHRP6TRP6rMuDHk5t44hnTRyow==",
    installed_file_count: 27,
    installed_byte_length: 650_101,
    installed_file_tree_sha256:
      "72d093e54d29a53eae863e337ae5df0e20a1460b8ac878109da9c9a48f174f6c",
  }),
]);
const exactRuntime = Object.freeze({
  node: "22.23.1",
  node_module_abi: "127",
  platform: "linux",
  architecture: "x64",
  install_contract: "clean npm ci from the committed package-lock.json",
  dependencies: dependencyCatalog,
});
const evidenceRelative = "docs/images/pilot-portfolio-evidence";
const evidenceManifestRelative = `${evidenceRelative}/MANIFEST.json`;
const evidenceManifestSha256 =
  "c9d915595c54f2bb16817ebaebce00336b618d1fabacf53909b077a20058f012";
const outputRelative = "docs/images/pilot-workflow-demo";
const outputName = "incident-command--acknowledge-alert.gif";
const outputManifestName = "MANIFEST.json";
const previewPrefix = "artifacts/generated/";
const maximumSourceBytes = 16 * 1024 * 1024;
const maximumGifBytes = 2 * 1024 * 1024;
const maximumDependencyFiles = 64;
const maximumDependencyFileBytes = 1024 * 1024;
const maximumDependencyTreeBytes = 2 * 1024 * 1024;
const width = 800;
const height = 600;
const loopCount = 0;
const literalRunLength = 200;
const clearCode = 256;
const endCode = 257;
const lzwMinimumCodeSize = 8;
const lzwCodeSize = 9;
const globalPaletteEntries = 256;

const frameCatalog = Object.freeze([
  Object.freeze({
    key: "initial_state",
    ordinal: 0,
    after_action_ordinal: -1,
    checkpoint_id:
      "idck1_2dfb1a690d3705c9081fa96eca06c64009f6a2c758b80c58197624e16fc37513",
    file: "incident-command--acknowledge-alert--initial-state.png",
    sha256: "3d1055dc241d248c0ebc2f7977e230660477a2513e9e18dac4afcd9fa189be48",
    byte_length: 109_464,
    delay_centiseconds: 120,
    phase: "unacknowledged queue",
  }),
  Object.freeze({
    key: "pre_primary_action",
    ordinal: 1,
    after_action_ordinal: 2,
    checkpoint_id:
      "idck1_4a4890510de597f3dd2f6f1ed9cb50bde0ccffb0948eeee8175d57c040963010",
    file: "incident-command--acknowledge-alert--pre-primary-action.png",
    sha256: "22d9c8130baaf3cb2493b46cc1112113a1510a48c9af506ae5d4ddd07c763715",
    byte_length: 109_805,
    delay_centiseconds: 90,
    phase: "critical alert selected and primary action focused",
  }),
  Object.freeze({
    key: "post_primary_action",
    ordinal: 2,
    after_action_ordinal: 3,
    checkpoint_id:
      "idck1_0438509f78dc11486710ccd0c490ad7112c6af6911ccddb800d2f72887a819d8",
    file: "incident-command--acknowledge-alert--post-primary-action.png",
    sha256: "354dddadd5f87931801dfda1197a690b67a7fd32bfd269a67bb3a5e5d6cbcbdf",
    byte_length: 111_507,
    delay_centiseconds: 220,
    phase: "acknowledgement receipt visible",
  }),
]);

const committedSourcePaths = Object.freeze([
  ".node-version",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tools/render-pilot-workflow-gif.mjs",
  "test/portfolio-evidence/workflow-gif.test.ts",
  evidenceManifestRelative,
  ...frameCatalog.map(({ file }) => `${evidenceRelative}/${file}`),
]);

let canonicalizeRuntime;
let pngRuntime;

class PilotWorkflowGifError extends Error {
  constructor(code) {
    super(code);
    this.name = "PilotWorkflowGifError";
    this.code = code;
  }
}

function fail(code) {
  throw new PilotWorkflowGifError(code);
}

async function selectRepositoryRoot() {
  const override = process.env.IMPACTDIFF_PILOT_GIF_TEST_REPOSITORY_ROOT;
  if (override === undefined) return;
  const testParent = join(
    sourceRepositoryRoot,
    "artifacts/generated/workflow-gif-tests",
  );
  const selected = resolve(override);
  const fixtureName = relative(testParent, selected);
  if (
    override !== selected ||
    resolve(process.cwd()) !== selected ||
    !selected.startsWith(`${testParent}${sep}`) ||
    !/^repo-[A-Za-z0-9._-]+$/u.test(fixtureName)
  ) {
    fail("pilot_gif.test_root");
  }
  await assertPlainDirectory(selected);
  const [sourceGenerator, selectedGenerator] = await Promise.all([
    readStableFile(scriptPath),
    readStableFile(join(selected, "tools/render-pilot-workflow-gif.mjs")),
  ]);
  if (!sourceGenerator.equals(selectedGenerator)) {
    fail("pilot_gif.test_generator");
  }
  repositoryRoot = selected;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalBytes(value) {
  if (typeof canonicalizeRuntime !== "function") fail("pilot_gif.runtime");
  const serialized = canonicalizeRuntime(value);
  if (serialized === undefined) fail("pilot_gif.manifest_canonical");
  return Buffer.from(serialized, "utf8");
}

function relativePath(absolutePath) {
  const value = relative(repositoryRoot, absolutePath).split(sep).join("/");
  if (value === "" || value === ".." || value.startsWith("../")) {
    fail("pilot_gif.path_boundary");
  }
  return value;
}

async function inspectInstalledDependency(expected) {
  const packageRoot = join(repositoryRoot, "node_modules", expected.name);
  const packageJsonPath = join(packageRoot, "package.json");
  await assertPlainDirectory(packageRoot);

  const pending = [packageRoot];
  const records = [];
  let totalBytes = 0;
  while (pending.length > 0) {
    const directory = pending.pop();
    let entries;
    try {
      entries = (await readdir(directory)).sort();
    } catch {
      fail("pilot_gif.dependency_identity");
    }
    for (const entry of entries) {
      if (
        typeof entry !== "string" ||
        entry.length === 0 ||
        entry === "." ||
        entry === ".." ||
        entry.includes("/") ||
        entry.includes("\\") ||
        entry.includes("\0") ||
        entry.includes("\n") ||
        entry.includes("\r")
      ) {
        fail("pilot_gif.dependency_identity");
      }
      const path = join(directory, entry);
      let stats;
      try {
        stats = await lstat(path);
      } catch {
        fail("pilot_gif.dependency_identity");
      }
      if (stats.isSymbolicLink()) fail("pilot_gif.dependency_identity");
      if (stats.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (
        !stats.isFile() ||
        stats.nlink !== 1 ||
        stats.size < 1 ||
        stats.size > maximumDependencyFileBytes
      ) {
        fail("pilot_gif.dependency_identity");
      }
      const bytes = await readStableFile(path, maximumDependencyFileBytes);
      const pathWithinPackage = relative(packageRoot, path).split(sep).join("/");
      if (
        pathWithinPackage.length === 0 ||
        pathWithinPackage === ".." ||
        pathWithinPackage.startsWith("../")
      ) {
        fail("pilot_gif.dependency_identity");
      }
      records.push([pathWithinPackage, bytes.byteLength, sha256(bytes)]);
      totalBytes += bytes.byteLength;
      if (
        records.length > maximumDependencyFiles ||
        totalBytes > maximumDependencyTreeBytes
      ) {
        fail("pilot_gif.dependency_identity");
      }
    }
  }
  records.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const treeDigest = sha256(Buffer.from(JSON.stringify(records), "utf8"));
  if (
    records.length !== expected.installed_file_count ||
    totalBytes !== expected.installed_byte_length ||
    treeDigest !== expected.installed_file_tree_sha256 ||
    !records.some(([path]) => path === expected.entry)
  ) {
    fail("pilot_gif.dependency_identity");
  }

  const packageJson = parseJson(
    await readStableFile(packageJsonPath, maximumDependencyFileBytes),
    "pilot_gif.dependency_identity",
  );
  if (!isRecord(packageJson) || packageJson.version !== expected.version) {
    fail("pilot_gif.dependency_identity");
  }
}

async function assertExactRuntime() {
  if (canonicalizeRuntime !== undefined || pngRuntime !== undefined) {
    if (
      typeof canonicalizeRuntime !== "function" ||
      typeof pngRuntime !== "function" ||
      !isRecord(pngRuntime.sync) ||
      typeof pngRuntime.sync.read !== "function"
    ) {
      fail("pilot_gif.runtime");
    }
    return;
  }
  if (
    process.versions.node !== exactRuntime.node ||
    process.versions.modules !== exactRuntime.node_module_abi ||
    process.platform !== exactRuntime.platform ||
    process.arch !== exactRuntime.architecture
  ) {
    fail("pilot_gif.runtime");
  }

  const lock = parseJson(
    await readStableFile(join(repositoryRoot, "package-lock.json"), 2 * 1024 * 1024),
    "pilot_gif.dependency_identity",
  );
  if (!isRecord(lock) || lock.lockfileVersion !== 3 || !isRecord(lock.packages)) {
    fail("pilot_gif.dependency_identity");
  }
  for (const expected of dependencyCatalog) {
    const locked = lock.packages[`node_modules/${expected.name}`];
    if (
      !isRecord(locked) ||
      locked.version !== expected.version ||
      locked.resolved !== expected.resolved ||
      locked.integrity !== expected.integrity
    ) {
      fail("pilot_gif.dependency_identity");
    }
    await inspectInstalledDependency(expected);
  }

  let canonicalizeModule;
  let pngModule;
  try {
    [canonicalizeModule, pngModule] = await Promise.all(
      dependencyCatalog.map(
        (expected) =>
          import(
            pathToFileURL(
              join(repositoryRoot, "node_modules", expected.name, expected.entry),
            ).href
          ),
      ),
    );
  } catch {
    fail("pilot_gif.dependency_identity");
  }
  if (
    typeof canonicalizeModule.default !== "function" ||
    typeof pngModule.PNG !== "function" ||
    !isRecord(pngModule.PNG.sync) ||
    typeof pngModule.PNG.sync.read !== "function"
  ) {
    fail("pilot_gif.dependency_identity");
  }
  canonicalizeRuntime = canonicalizeModule.default;
  pngRuntime = pngModule.PNG;
}

async function assertPlainDirectory(absolutePath) {
  const rootWithSeparator = `${repositoryRoot}${sep}`;
  if (absolutePath !== repositoryRoot && !absolutePath.startsWith(rootWithSeparator)) {
    fail("pilot_gif.path_boundary");
  }
  const relativeDirectory = relative(repositoryRoot, absolutePath);
  let current = repositoryRoot;
  const segments =
    relativeDirectory === "" ? [] : relativeDirectory.split(sep).filter(Boolean);
  for (const segment of segments) {
    current = join(current, segment);
    let stats;
    try {
      stats = await lstat(current);
    } catch {
      fail("pilot_gif.directory");
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      fail("pilot_gif.directory");
    }
  }
}

async function ensurePlainDirectory(absolutePath) {
  const rootWithSeparator = `${repositoryRoot}${sep}`;
  if (absolutePath !== repositoryRoot && !absolutePath.startsWith(rootWithSeparator)) {
    fail("pilot_gif.path_boundary");
  }
  let rootStats;
  try {
    rootStats = await lstat(repositoryRoot);
  } catch {
    fail("pilot_gif.directory");
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    fail("pilot_gif.directory");
  }

  const relativeDirectory = relative(repositoryRoot, absolutePath);
  const segments =
    relativeDirectory === "" ? [] : relativeDirectory.split(sep).filter(Boolean);
  let current = repositoryRoot;
  for (const segment of segments) {
    current = join(current, segment);
    let stats;
    try {
      stats = await lstat(current);
    } catch (error) {
      if (error?.code !== "ENOENT") fail("pilot_gif.directory");
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError?.code !== "EEXIST") fail("pilot_gif.directory");
      }
      try {
        stats = await lstat(current);
      } catch {
        fail("pilot_gif.directory");
      }
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      fail("pilot_gif.directory");
    }
  }
}

function sameFilesystemObject(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameFileIdentity(left, right) {
  return (
    sameFilesystemObject(left, right) &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

async function readStableFile(absolutePath, maximumBytes = maximumSourceBytes) {
  await assertPlainDirectory(dirname(absolutePath));
  let before;
  try {
    before = await lstat(absolutePath);
  } catch {
    fail("pilot_gif.source_file");
  }
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size < 1 ||
    before.size > maximumBytes
  ) {
    fail("pilot_gif.source_file");
  }
  let bytes;
  let after;
  try {
    bytes = await readFile(absolutePath);
    after = await lstat(absolutePath);
  } catch {
    fail("pilot_gif.source_file");
  }
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    after.nlink !== 1 ||
    !sameFileIdentity(before, after) ||
    bytes.byteLength !== after.size
  ) {
    fail("pilot_gif.source_changed");
  }
  return bytes;
}

function parseJson(bytes, code) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(code);
  }
}

function exactStrings(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function selectWorkflow(manifest) {
  if (
    !isRecord(manifest) ||
    manifest.official !== false ||
    !Array.isArray(manifest.fixtures)
  ) {
    fail("pilot_gif.evidence_manifest");
  }
  const fixtures = manifest.fixtures.filter(
    (fixture) => isRecord(fixture) && fixture.application_key === "incident_command",
  );
  if (fixtures.length !== 1) fail("pilot_gif.evidence_manifest");
  const fixture = fixtures[0];
  if (
    fixture.fixture_key !== "pilot-incident-command-v1" ||
    fixture.fixture_revision !== "pilot-incident-command-v1.0.0-authoring.1" ||
    !Array.isArray(fixture.workflows)
  ) {
    fail("pilot_gif.evidence_manifest");
  }
  const workflows = fixture.workflows.filter(
    (workflow) => isRecord(workflow) && workflow.workflow_key === "acknowledge_alert",
  );
  if (workflows.length !== 1) fail("pilot_gif.evidence_manifest");
  const workflow = workflows[0];
  if (
    workflow.official !== false ||
    workflow.actions_executed !== 4 ||
    workflow.task_id !==
      "idtk1_f30e42e674b6429551d797fb11dad55cb0ddaec07d80ccc8dbba8c352d2542e2" ||
    !Array.isArray(workflow.checkpoints) ||
    workflow.checkpoints.length !== frameCatalog.length
  ) {
    fail("pilot_gif.evidence_manifest");
  }
  return { fixture, workflow };
}

function assertCheckpointReference(actual, expected) {
  if (
    !isRecord(actual) ||
    !isRecord(actual.screenshot) ||
    actual.key !== expected.key ||
    actual.ordinal !== expected.ordinal ||
    actual.after_action_ordinal !== expected.after_action_ordinal ||
    actual.checkpoint_id !== expected.checkpoint_id ||
    actual.screenshot.file !== expected.file ||
    actual.screenshot.sha256 !== expected.sha256 ||
    actual.screenshot.byte_length !== expected.byte_length ||
    actual.screenshot.media_type !== "image/png" ||
    actual.screenshot.format_version !== 1 ||
    actual.screenshot.width !== width ||
    actual.screenshot.height !== height
  ) {
    fail("pilot_gif.checkpoint_binding");
  }
}

function buildPalette() {
  const palette = Buffer.alloc(globalPaletteEntries * 3);
  for (let index = 0; index < globalPaletteEntries; index += 1) {
    const red = index >>> 5;
    const green = (index >>> 2) & 0x07;
    const blue = index & 0x03;
    palette[index * 3] = Math.floor((red * 255 + 3) / 7);
    palette[index * 3 + 1] = Math.floor((green * 255 + 3) / 7);
    palette[index * 3 + 2] = Math.floor((blue * 255 + 1) / 3);
  }
  return palette;
}

function quantizeRgb332(data) {
  if (data.byteLength !== width * height * 4) fail("pilot_gif.png_shape");
  const indices = Buffer.alloc(width * height);
  for (let pixel = 0; pixel < indices.length; pixel += 1) {
    const offset = pixel * 4;
    if (data[offset + 3] !== 255) fail("pilot_gif.png_alpha");
    const red = Math.floor((data[offset] * 7 + 127) / 255);
    const green = Math.floor((data[offset + 1] * 7 + 127) / 255);
    const blue = Math.floor((data[offset + 2] * 3 + 127) / 255);
    indices[pixel] = (red << 5) | (green << 2) | blue;
  }
  return indices;
}

function decodePng(bytes) {
  if (
    typeof pngRuntime !== "function" ||
    !isRecord(pngRuntime.sync) ||
    typeof pngRuntime.sync.read !== "function"
  ) {
    fail("pilot_gif.runtime");
  }
  let decoded;
  try {
    decoded = pngRuntime.sync.read(bytes, {
      checkCRC: true,
      skipRescale: false,
    });
  } catch {
    fail("pilot_gif.png_codec");
  }
  if (
    decoded.width !== width ||
    decoded.height !== height ||
    decoded.data.byteLength !== width * height * 4
  ) {
    fail("pilot_gif.png_shape");
  }
  return quantizeRgb332(decoded.data);
}

function littleEndian16(value) {
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    fail("pilot_gif.integer");
  }
  return Buffer.from([value & 0xff, value >>> 8]);
}

function literalCodes(indices) {
  const codes = [];
  for (let offset = 0; offset < indices.length; offset += literalRunLength) {
    codes.push(clearCode);
    const end = Math.min(offset + literalRunLength, indices.length);
    for (let index = offset; index < end; index += 1) {
      codes.push(indices[index]);
    }
  }
  codes.push(endCode);
  return codes;
}

function packNineBitCodes(codes) {
  const bytes = [];
  let accumulator = 0;
  let bitCount = 0;
  for (const code of codes) {
    if (!Number.isInteger(code) || code < 0 || code >= 1 << lzwCodeSize) {
      fail("pilot_gif.lzw_code");
    }
    accumulator |= code << bitCount;
    bitCount += lzwCodeSize;
    while (bitCount >= 8) {
      bytes.push(accumulator & 0xff);
      accumulator >>>= 8;
      bitCount -= 8;
    }
  }
  if (bitCount > 0) bytes.push(accumulator & 0xff);
  return Buffer.from(bytes);
}

function gifSubBlocks(bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 255) {
    const end = Math.min(offset + 255, bytes.length);
    chunks.push(Buffer.from([end - offset]), bytes.subarray(offset, end));
  }
  chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

function imageData(indices) {
  return Buffer.concat([
    Buffer.from([lzwMinimumCodeSize]),
    gifSubBlocks(packNineBitCodes(literalCodes(indices))),
  ]);
}

function graphicsControlExtension(delayCentiseconds) {
  return Buffer.concat([
    Buffer.from([0x21, 0xf9, 0x04, 0x04]),
    littleEndian16(delayCentiseconds),
    Buffer.from([0x00, 0x00]),
  ]);
}

function imageDescriptor() {
  return Buffer.concat([
    Buffer.from([0x2c]),
    littleEndian16(0),
    littleEndian16(0),
    littleEndian16(width),
    littleEndian16(height),
    Buffer.from([0x00]),
  ]);
}

function loopExtension() {
  return Buffer.concat([
    Buffer.from([0x21, 0xff, 0x0b]),
    Buffer.from("NETSCAPE2.0", "ascii"),
    Buffer.from([0x03, 0x01]),
    littleEndian16(loopCount),
    Buffer.from([0x00]),
  ]);
}

function encodeGif(frames) {
  const chunks = [
    Buffer.from("GIF89a", "ascii"),
    littleEndian16(width),
    littleEndian16(height),
    Buffer.from([0xf7, 0x00, 0x00]),
    buildPalette(),
    loopExtension(),
  ];
  for (const frame of frames) {
    chunks.push(
      graphicsControlExtension(frame.delay_centiseconds),
      imageDescriptor(),
      imageData(frame.indices),
    );
  }
  chunks.push(Buffer.from([0x3b]));
  const bytes = Buffer.concat(chunks);
  if (bytes.byteLength < 1 || bytes.byteLength > maximumGifBytes) {
    fail("pilot_gif.output_budget");
  }
  return bytes;
}

function consumeExact(bytes, cursor, expected, code) {
  const end = cursor + expected.length;
  if (end > bytes.length || !bytes.subarray(cursor, end).equals(expected)) {
    fail(code);
  }
  return end;
}

function readSubBlocks(bytes, start) {
  const chunks = [];
  let cursor = start;
  while (true) {
    if (cursor >= bytes.length) fail("pilot_gif.gif_structure");
    const length = bytes[cursor];
    cursor += 1;
    if (length === 0) break;
    const end = cursor + length;
    if (end > bytes.length) fail("pilot_gif.gif_structure");
    chunks.push(bytes.subarray(cursor, end));
    cursor = end;
  }
  return { bytes: Buffer.concat(chunks), cursor };
}

function inspectGif(bytes, frames) {
  let cursor = 0;
  cursor = consumeExact(
    bytes,
    cursor,
    Buffer.from("GIF89a", "ascii"),
    "pilot_gif.gif_header",
  );
  cursor = consumeExact(
    bytes,
    cursor,
    Buffer.concat([
      littleEndian16(width),
      littleEndian16(height),
      Buffer.from([0xf7, 0x00, 0x00]),
    ]),
    "pilot_gif.gif_screen",
  );
  cursor = consumeExact(bytes, cursor, buildPalette(), "pilot_gif.gif_palette");
  cursor = consumeExact(bytes, cursor, loopExtension(), "pilot_gif.gif_loop");
  for (const frame of frames) {
    cursor = consumeExact(
      bytes,
      cursor,
      graphicsControlExtension(frame.delay_centiseconds),
      "pilot_gif.gif_control",
    );
    cursor = consumeExact(bytes, cursor, imageDescriptor(), "pilot_gif.gif_descriptor");
    if (bytes[cursor] !== lzwMinimumCodeSize) fail("pilot_gif.gif_lzw_minimum");
    cursor += 1;
    const blocks = readSubBlocks(bytes, cursor);
    cursor = blocks.cursor;
    const expected = packNineBitCodes(literalCodes(frame.indices));
    if (!blocks.bytes.equals(expected)) fail("pilot_gif.gif_pixels");
  }
  cursor = consumeExact(bytes, cursor, Buffer.from([0x3b]), "pilot_gif.gif_trailer");
  if (cursor !== bytes.length) fail("pilot_gif.gif_trailing_bytes");
}

async function loadFrames() {
  const manifestBytes = await readStableFile(
    join(repositoryRoot, evidenceManifestRelative),
    256 * 1024,
  );
  if (sha256(manifestBytes) !== evidenceManifestSha256) {
    fail("pilot_gif.evidence_identity");
  }
  const manifest = parseJson(manifestBytes, "pilot_gif.evidence_manifest");
  const { fixture, workflow } = selectWorkflow(manifest);
  const frames = [];
  for (let index = 0; index < frameCatalog.length; index += 1) {
    const expected = frameCatalog[index];
    const checkpoint = workflow.checkpoints[index];
    assertCheckpointReference(checkpoint, expected);
    const path = `${evidenceRelative}/${expected.file}`;
    const bytes = await readStableFile(join(repositoryRoot, path), 512 * 1024);
    if (
      bytes.byteLength !== expected.byte_length ||
      sha256(bytes) !== expected.sha256
    ) {
      fail("pilot_gif.source_identity");
    }
    frames.push(
      Object.freeze({
        ...expected,
        path,
        indices: decodePng(bytes),
      }),
    );
  }
  if (
    !exactStrings(
      frames.map(({ key }) => key),
      frameCatalog.map(({ key }) => key),
    )
  ) {
    fail("pilot_gif.frame_order");
  }
  return Object.freeze({
    source_manifest: Object.freeze({
      path: evidenceManifestRelative,
      sha256: evidenceManifestSha256,
      byte_length: manifestBytes.byteLength,
    }),
    fixture: Object.freeze({
      application_key: fixture.application_key,
      fixture_key: fixture.fixture_key,
      fixture_revision: fixture.fixture_revision,
    }),
    workflow: Object.freeze({
      workflow_key: workflow.workflow_key,
      task_id: workflow.task_id,
      actions_executed: workflow.actions_executed,
    }),
    frames: Object.freeze(frames),
  });
}

function runGit(arguments_, options = {}) {
  const result = spawnSync(gitExecutable, arguments_, {
    cwd: repositoryRoot,
    encoding: options.binary === true ? null : "utf8",
    timeout: 15_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (
    result.error !== undefined ||
    result.signal !== null ||
    result.status !== (options.expectedStatus ?? 0)
  ) {
    fail(options.code ?? "pilot_gif.git");
  }
  return result.stdout;
}

function gitLine(arguments_, code = "pilot_gif.git") {
  const stdout = runGit(arguments_, { code });
  const lines = stdout.trimEnd().split(/\r?\n/u);
  if (lines.length !== 1 || lines[0].length === 0) fail(code);
  return lines[0];
}

function assertSha1(value, code) {
  if (!/^[0-9a-f]{40}$/u.test(value)) fail(code);
  return value;
}

function committedFileIdentity(revision, path) {
  const line = gitLine(["ls-tree", revision, "--", path], "pilot_gif.git_source");
  const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/u.exec(line);
  if (match === null || match[3] !== path) fail("pilot_gif.git_source");
  const gitBlobOid = match[2];
  const committedBytes = runGit(["cat-file", "blob", gitBlobOid], {
    binary: true,
    code: "pilot_gif.git_source",
  });
  return {
    path,
    git_mode: match[1],
    git_blob_oid: gitBlobOid,
    sha256: sha256(committedBytes),
    byte_length: committedBytes.byteLength,
    bytes: committedBytes,
  };
}

async function inspectCommittedProvenance() {
  const commit = assertSha1(
    gitLine(["rev-parse", "--verify", "HEAD^{commit}"]),
    "pilot_gif.git_revision",
  );
  const tree = assertSha1(
    gitLine(["rev-parse", "--verify", `${commit}^{tree}`]),
    "pilot_gif.git_tree",
  );
  const status = runGit(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.length !== 0) fail("pilot_gif.worktree_dirty");

  const files = [];
  for (const path of committedSourcePaths) {
    const committed = committedFileIdentity(commit, path);
    const current = await readStableFile(
      join(repositoryRoot, path),
      path.endsWith(".png") ? 512 * 1024 : maximumSourceBytes,
    );
    if (!current.equals(committed.bytes)) fail("pilot_gif.source_uncommitted");
    files.push(
      Object.freeze({
        path: committed.path,
        git_mode: committed.git_mode,
        git_blob_oid: committed.git_blob_oid,
        sha256: committed.sha256,
        byte_length: committed.byte_length,
      }),
    );
  }
  return Object.freeze({
    git_revision: commit,
    git_tree: tree,
    files: Object.freeze(files),
  });
}

async function inspectRecordedProvenance(source) {
  if (
    !isRecord(source) ||
    !Array.isArray(source.committed_files) ||
    source.committed_files.length !== committedSourcePaths.length
  ) {
    fail("pilot_gif.manifest_schema");
  }
  const revision = assertSha1(source.git_revision, "pilot_gif.manifest_schema");
  const tree = assertSha1(source.git_tree, "pilot_gif.manifest_schema");
  const head = assertSha1(
    gitLine(["rev-parse", "--verify", "HEAD^{commit}"]),
    "pilot_gif.git_head",
  );

  const files = [];
  for (let index = 0; index < committedSourcePaths.length; index += 1) {
    const path = committedSourcePaths[index];
    const recorded = source.committed_files[index];
    if (
      !isRecord(recorded) ||
      !exactStrings(Object.keys(recorded).sort(), [
        "byte_length",
        "git_blob_oid",
        "git_mode",
        "path",
        "sha256",
      ]) ||
      recorded.path !== path ||
      (recorded.git_mode !== "100644" && recorded.git_mode !== "100755") ||
      typeof recorded.git_blob_oid !== "string" ||
      !/^[0-9a-f]{40}$/u.test(recorded.git_blob_oid) ||
      typeof recorded.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(recorded.sha256) ||
      !Number.isInteger(recorded.byte_length) ||
      recorded.byte_length < 1 ||
      recorded.byte_length > maximumSourceBytes
    ) {
      fail("pilot_gif.manifest_schema");
    }

    const current = committedFileIdentity(head, path);
    const working = await readStableFile(
      join(repositoryRoot, path),
      path.endsWith(".png") ? 512 * 1024 : maximumSourceBytes,
    );
    if (
      !working.equals(current.bytes) ||
      recorded.git_mode !== current.git_mode ||
      recorded.git_blob_oid !== current.git_blob_oid ||
      recorded.sha256 !== current.sha256 ||
      recorded.byte_length !== current.byte_length
    ) {
      fail("pilot_gif.source_uncommitted");
    }
    files.push(
      Object.freeze({
        path: recorded.path,
        git_mode: recorded.git_mode,
        git_blob_oid: recorded.git_blob_oid,
        sha256: recorded.sha256,
        byte_length: recorded.byte_length,
      }),
    );
  }
  return Object.freeze({
    git_revision: revision,
    git_tree: tree,
    files: Object.freeze(files),
  });
}

function manifestFor(gifBytes, source, provenance) {
  const frames = source.frames.map(
    ({
      key,
      ordinal,
      after_action_ordinal: afterActionOrdinal,
      checkpoint_id: checkpointId,
      path,
      sha256: digest,
      byte_length: byteLength,
      delay_centiseconds: delayCentiseconds,
      phase,
    }) =>
      Object.freeze({
        key,
        ordinal,
        after_action_ordinal: afterActionOrdinal,
        checkpoint_id: checkpointId,
        source: Object.freeze({
          path,
          media_type: "image/png",
          sha256: digest,
          byte_length: byteLength,
          width,
          height,
        }),
        delay_centiseconds: delayCentiseconds,
        phase,
      }),
  );
  return Object.freeze({
    contract: "impactdiff.pilot-workflow-gif",
    version: 1,
    official: false,
    generated_by: "tools/render-pilot-workflow-gif.mjs",
    source: Object.freeze({
      git_revision: provenance.git_revision,
      git_tree: provenance.git_tree,
      committed_files: provenance.files,
      evidence_manifest: source.source_manifest,
      fixture: source.fixture,
      workflow: source.workflow,
      frames: Object.freeze(frames),
    }),
    encoding: Object.freeze({
      format: "GIF89a",
      canvas: Object.freeze({ width, height }),
      frame_count: frames.length,
      loop_count: loopCount,
      scaling: "none",
      caption_overlay: "none",
      palette: Object.freeze({
        kind: "fixed_rgb332_nearest_integer",
        entries: globalPaletteEntries,
        dithering: "none",
      }),
      lzw: Object.freeze({
        minimum_code_size: lzwMinimumCodeSize,
        emitted_code_size: lzwCodeSize,
        strategy: "literal_only_with_bounded_clear_intervals",
        maximum_literals_between_clear_codes: literalRunLength,
      }),
      disposal_method: "do_not_dispose",
      transparency: "none",
    }),
    runtime: exactRuntime,
    output: Object.freeze({
      file: outputName,
      media_type: "image/gif",
      sha256: sha256(gifBytes),
      byte_length: gifBytes.byteLength,
      width,
      height,
      frame_count: frames.length,
    }),
    privacy: Object.freeze({
      visible_content: "synthetic_local_fixture_content",
      source_kind: "committed_local_authoring_checkpoints",
      host_paths_embedded: false,
      timestamps_embedded: false,
    }),
    evidence_boundary: Object.freeze({
      establishes: Object.freeze([
        "the three committed acknowledge-alert checkpoint PNGs are sequenced in manifest order",
        "the source checkpoint paths, byte identities, checkpoint identities, and frame delays are bound",
        "the committed generator, verification sources, and bounded installed dependency trees reproduce the declared GIF byte identity",
      ]),
      does_not_establish: Object.freeze([
        "fresh browser capture or real-time screen recording",
        "official dataset release",
        "model quality or benchmark performance",
        "production-browser compatibility",
        "network behavior or network isolation",
        "independent authentication of the committed source evidence",
        "continued ancestry or availability of the capture commit after history rewriting",
      ]),
    }),
  });
}

async function buildGif() {
  await assertExactRuntime();
  const source = await loadFrames();
  const gifBytes = encodeGif(source.frames);
  inspectGif(gifBytes, source.frames);
  return Object.freeze({ source, gifBytes });
}

function receipt(mode, gifBytes, manifestBytes) {
  const value = {
    mode,
    official: false,
    workflow: "incident_command/acknowledge_alert",
    width,
    height,
    frame_count: frameCatalog.length,
    loop_count: loopCount,
    gif_sha256: sha256(gifBytes),
    gif_byte_length: gifBytes.byteLength,
  };
  if (manifestBytes !== undefined) {
    value.manifest_sha256 = sha256(manifestBytes);
    value.manifest_byte_length = manifestBytes.byteLength;
  }
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function writeSyncedFile(path, bytes) {
  let handle;
  try {
    handle = await open(path, "wx", 0o644);
    await handle.writeFile(bytes);
    await handle.sync();
  } catch {
    fail("pilot_gif.output_write");
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        fail("pilot_gif.output_close");
      }
    }
  }
}

async function syncDirectory(path) {
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch {
    fail("pilot_gif.output_sync");
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        fail("pilot_gif.output_close");
      }
    }
  }
}

async function assertMissing(path, code) {
  try {
    await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    fail(code);
  }
  fail(code);
}

async function verifyOutputDirectory(directory, expectedGif, expectedManifest) {
  await assertPlainDirectory(directory);
  const entries = (await readdir(directory)).sort();
  if (!exactStrings(entries, [outputManifestName, outputName])) {
    fail("pilot_gif.output_membership");
  }
  const [actualGif, actualManifest] = await Promise.all([
    readStableFile(join(directory, outputName), maximumGifBytes),
    readStableFile(join(directory, outputManifestName), 256 * 1024),
  ]);
  if (!actualGif.equals(expectedGif) || !actualManifest.equals(expectedManifest)) {
    fail("pilot_gif.output_mismatch");
  }
}

async function inspectReplaceableOutputDirectory(directory, revision) {
  await assertPlainDirectory(directory);
  const before = await lstat(directory);
  const entries = (await readdir(directory)).sort();
  if (!exactStrings(entries, [outputManifestName, outputName])) {
    fail("pilot_gif.output_membership");
  }
  for (const name of entries) {
    const path = join(directory, name);
    const current = await readStableFile(
      path,
      name === outputName ? maximumGifBytes : 256 * 1024,
    );
    const committed = committedFileIdentity(revision, relativePath(path));
    if (committed.git_mode !== "100644" || !current.equals(committed.bytes)) {
      fail("pilot_gif.output_uncommitted");
    }
  }
  const after = await lstat(directory);
  if (!sameFileIdentity(before, after)) {
    fail("pilot_gif.output_changed");
  }
  return before;
}

async function readDirectoryIdentity(path, code) {
  let actual;
  try {
    actual = await lstat(path);
  } catch {
    fail(code);
  }
  if (!actual.isDirectory() || actual.isSymbolicLink()) fail(code);
  return actual;
}

async function assertDirectoryIdentity(path, expected, code) {
  const actual = await readDirectoryIdentity(path, code);
  if (!sameFileIdentity(actual, expected)) fail(code);
}

async function removeKnownDirectory(path, expected, code) {
  await assertDirectoryIdentity(path, expected, code);
  await rm(path, { recursive: true, force: false });
  let remains = true;
  try {
    await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      remains = false;
    } else {
      fail(code);
    }
  }
  if (remains) fail(code);
}

async function openPublicationLock(parent) {
  const path = join(parent, ".pilot-workflow-demo.lock");
  let handle;
  try {
    handle = await open(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        (constants.O_CLOEXEC ?? 0),
      0o600,
    );
    const identity = await handle.stat();
    if (!identity.isFile() || identity.nlink !== 1) {
      fail("pilot_gif.locked");
    }
    return { path, handle, identity };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof PilotWorkflowGifError) throw error;
    fail("pilot_gif.locked");
  }
}

async function closePublicationLock(lock) {
  let failure;
  try {
    const current = await lstat(lock.path);
    if (
      !current.isFile() ||
      current.isSymbolicLink() ||
      !sameFileIdentity(current, lock.identity)
    ) {
      fail("pilot_gif.publication_cleanup");
    }
    await unlink(lock.path);
  } catch (error) {
    failure = error;
  }
  try {
    await lock.handle.close();
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) fail("pilot_gif.publication_cleanup");
}

function previewPath(argument) {
  if (
    typeof argument !== "string" ||
    !/^artifacts\/generated\/[a-z0-9][a-z0-9.-]*\.gif$/u.test(argument)
  ) {
    fail("pilot_gif.arguments");
  }
  const absolute = resolve(repositoryRoot, argument);
  if (relativePath(absolute) !== argument) fail("pilot_gif.arguments");
  return absolute;
}

async function preview(argument) {
  const { gifBytes, source } = await buildGif();
  const path = previewPath(argument);
  await ensurePlainDirectory(dirname(path));
  await assertMissing(path, "pilot_gif.preview_exists");
  await writeSyncedFile(path, gifBytes);
  const written = await readStableFile(path, maximumGifBytes);
  if (!written.equals(gifBytes)) fail("pilot_gif.preview_mismatch");
  inspectGif(written, source.frames);
  receipt("preview", gifBytes);
}

async function writeProduction() {
  const provenance = await inspectCommittedProvenance();
  const { source, gifBytes } = await buildGif();
  const manifestBytes = canonicalBytes(manifestFor(gifBytes, source, provenance));
  const parent = join(repositoryRoot, dirname(outputRelative));
  const output = join(repositoryRoot, outputRelative);
  await assertPlainDirectory(parent);
  await assertMissing(output, "pilot_gif.output_exists");
  const stage = join(
    parent,
    `.pilot-workflow-demo-stage-${randomBytes(16).toString("hex")}`,
  );
  let committed = false;
  let created = false;
  try {
    await mkdir(stage, { mode: 0o700 });
    created = true;
    await writeSyncedFile(join(stage, outputName), gifBytes);
    await writeSyncedFile(join(stage, outputManifestName), manifestBytes);
    await verifyOutputDirectory(stage, gifBytes, manifestBytes);
    await syncDirectory(stage);
    await chmod(stage, 0o755);
    await assertMissing(output, "pilot_gif.output_exists");
    await rename(stage, output);
    committed = true;
    await syncDirectory(parent);
    await verifyOutputDirectory(output, gifBytes, manifestBytes);
    receipt("write", gifBytes, manifestBytes);
  } finally {
    if (created && !committed) {
      try {
        await rm(stage, { recursive: true, force: true });
      } catch {
        fail("pilot_gif.stage_cleanup");
      }
    }
  }
}

async function refreshProduction() {
  const provenance = await inspectCommittedProvenance();
  const { source, gifBytes } = await buildGif();
  const manifestBytes = canonicalBytes(manifestFor(gifBytes, source, provenance));
  const parent = join(repositoryRoot, dirname(outputRelative));
  const output = join(repositoryRoot, outputRelative);
  await assertPlainDirectory(parent);

  const nonce = randomBytes(16).toString("hex");
  const stage = join(parent, `.pilot-workflow-demo-stage-${nonce}`);
  const backup = join(parent, `.pilot-workflow-demo-backup-${nonce}`);
  let lock;
  let stageIdentity;
  let previousIdentity;
  let stageCreated = false;
  let previousMoved = false;
  let published = false;
  let finalized = false;
  let primaryError;
  const cleanupErrors = [];

  try {
    lock = await openPublicationLock(parent);
    previousIdentity = await inspectReplaceableOutputDirectory(
      output,
      provenance.git_revision,
    );
    await assertMissing(stage, "pilot_gif.stage_exists");
    await assertMissing(backup, "pilot_gif.backup_exists");
    await mkdir(stage, { mode: 0o700 });
    stageCreated = true;
    stageIdentity = await readDirectoryIdentity(stage, "pilot_gif.stage_changed");
    if (process.env.IMPACTDIFF_PILOT_GIF_TEST_FAIL_AFTER_STAGE_CREATION === "1") {
      fail("pilot_gif.test_failure_after_stage_creation");
    }
    await writeSyncedFile(join(stage, outputName), gifBytes);
    await writeSyncedFile(join(stage, outputManifestName), manifestBytes);
    await verifyOutputDirectory(stage, gifBytes, manifestBytes);
    await chmod(stage, 0o755);
    await syncDirectory(stage);
    const preparedStageIdentity = await readDirectoryIdentity(
      stage,
      "pilot_gif.stage_changed",
    );
    if (!sameFilesystemObject(preparedStageIdentity, stageIdentity)) {
      fail("pilot_gif.stage_changed");
    }
    stageIdentity = preparedStageIdentity;
    const currentIdentity = await inspectReplaceableOutputDirectory(
      output,
      provenance.git_revision,
    );
    if (!sameFileIdentity(currentIdentity, previousIdentity)) {
      fail("pilot_gif.output_changed");
    }
    await rename(output, backup);
    previousMoved = true;
    await assertDirectoryIdentity(backup, previousIdentity, "pilot_gif.output_changed");
    if (process.env.IMPACTDIFF_PILOT_GIF_TEST_FAIL_AFTER_BACKUP === "1") {
      fail("pilot_gif.test_failure_after_backup");
    }
    await rename(stage, output);
    stageCreated = false;
    published = true;
    await assertDirectoryIdentity(
      output,
      stageIdentity,
      "pilot_gif.publication_uncertain",
    );
    await syncDirectory(parent);
    await verifyOutputDirectory(output, gifBytes, manifestBytes);
    await removeKnownDirectory(
      backup,
      previousIdentity,
      "pilot_gif.publication_cleanup",
    );
    previousMoved = false;
    finalized = true;
    await syncDirectory(parent);
  } catch (error) {
    primaryError = error;
    let backupReadyForRestore = false;
    if (!finalized && previousMoved && previousIdentity !== undefined) {
      try {
        await assertDirectoryIdentity(
          backup,
          previousIdentity,
          "pilot_gif.publication_restore",
        );
        backupReadyForRestore = true;
      } catch (restoreError) {
        cleanupErrors.push(restoreError);
      }
    }
    if (backupReadyForRestore && published && stageIdentity !== undefined) {
      try {
        await assertMissing(stage, "pilot_gif.publication_restore");
        await assertDirectoryIdentity(
          output,
          stageIdentity,
          "pilot_gif.publication_restore",
        );
        await rename(output, stage);
        published = false;
        stageCreated = true;
      } catch (restoreError) {
        cleanupErrors.push(restoreError);
      }
    }
    if (
      backupReadyForRestore &&
      !published &&
      previousMoved &&
      previousIdentity !== undefined
    ) {
      try {
        await rename(backup, output);
        const restored = await inspectReplaceableOutputDirectory(
          output,
          provenance.git_revision,
        );
        if (!sameFileIdentity(restored, previousIdentity)) {
          fail("pilot_gif.publication_restore");
        }
        await syncDirectory(parent);
        previousMoved = false;
      } catch (restoreError) {
        cleanupErrors.push(restoreError);
      }
    }
  }

  if (stageCreated) {
    if (stageIdentity === undefined || previousMoved) {
      cleanupErrors.push(new PilotWorkflowGifError("pilot_gif.publication_uncertain"));
    } else {
      try {
        await removeKnownDirectory(
          stage,
          stageIdentity,
          "pilot_gif.publication_cleanup",
        );
        stageCreated = false;
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
  }
  if (published && primaryError !== undefined) {
    cleanupErrors.push(new PilotWorkflowGifError("pilot_gif.publication_uncertain"));
  }
  if (previousMoved) {
    cleanupErrors.push(new PilotWorkflowGifError("pilot_gif.publication_restore"));
  }
  if (lock !== undefined) {
    try {
      await closePublicationLock(lock);
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
  }

  if (primaryError !== undefined) {
    if (cleanupErrors.length > 0) {
      fail("pilot_gif.publication_uncertain");
    }
    throw primaryError;
  }
  if (cleanupErrors.length > 0) {
    fail("pilot_gif.publication_cleanup");
  }
  receipt("refresh", gifBytes, manifestBytes);
}

async function checkProduction() {
  const output = join(repositoryRoot, outputRelative);
  const actualManifestBytes = await readStableFile(
    join(output, outputManifestName),
    256 * 1024,
  );
  const actualManifest = parseJson(actualManifestBytes, "pilot_gif.manifest_json");
  if (
    !isRecord(actualManifest) ||
    !isRecord(actualManifest.source) ||
    typeof actualManifest.source.git_revision !== "string"
  ) {
    fail("pilot_gif.manifest_schema");
  }
  const provenance = await inspectRecordedProvenance(actualManifest.source);
  const { source, gifBytes } = await buildGif();
  const expectedManifestBytes = canonicalBytes(
    manifestFor(gifBytes, source, provenance),
  );
  if (!actualManifestBytes.equals(expectedManifestBytes)) {
    fail("pilot_gif.manifest_mismatch");
  }
  await verifyOutputDirectory(output, gifBytes, expectedManifestBytes);
  receipt("check", gifBytes, expectedManifestBytes);
}

async function main() {
  await selectRepositoryRoot();
  const arguments_ = process.argv.slice(2);
  if (
    arguments_.length === 3 &&
    arguments_[0] === "preview" &&
    arguments_[1] === "--output"
  ) {
    await preview(arguments_[2]);
    return;
  }
  if (arguments_.length === 1 && arguments_[0] === "write") {
    await writeProduction();
    return;
  }
  if (arguments_.length === 1 && arguments_[0] === "refresh") {
    await refreshProduction();
    return;
  }
  if (arguments_.length === 1 && arguments_[0] === "check") {
    await checkProduction();
    return;
  }
  fail("pilot_gif.arguments");
}

try {
  await main();
} catch (error) {
  const code = error instanceof PilotWorkflowGifError ? error.code : "pilot_gif.failed";
  process.stderr.write(`${JSON.stringify({ code })}\n`);
  process.exitCode = 1;
}
