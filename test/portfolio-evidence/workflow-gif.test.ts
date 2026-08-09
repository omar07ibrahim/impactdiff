import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PNG } from "pngjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(testDirectory, "../..");
const compiledRoot = resolve(testDirectory, "../../..");
const repositoryRoot = existsSync(join(sourceRoot, "package.json"))
  ? sourceRoot
  : compiledRoot;
const toolRelative = "tools/render-pilot-workflow-gif.mjs";
const testRelative = "test/portfolio-evidence/workflow-gif.test.ts";
const evidenceRelative = "docs/images/pilot-portfolio-evidence";
const generatedTestRoot = join(
  repositoryRoot,
  "artifacts/generated/workflow-gif-tests",
);
const width = 800;
const height = 600;
const clearCode = 256;
const endCode = 257;
const maximumLiteralRun = 200;
const expectedDelays = [120, 90, 220] as const;
const frameFiles = [
  "incident-command--acknowledge-alert--initial-state.png",
  "incident-command--acknowledge-alert--pre-primary-action.png",
  "incident-command--acknowledge-alert--post-primary-action.png",
] as const;
const expectedFrameDigests = [
  "3d1055dc241d248c0ebc2f7977e230660477a2513e9e18dac4afcd9fa189be48",
  "22d9c8130baaf3cb2493b46cc1112113a1510a48c9af506ae5d4ddd07c763715",
  "354dddadd5f87931801dfda1197a690b67a7fd32bfd269a67bb3a5e5d6cbcbdf",
] as const;
const productionSourcePaths = [
  ".node-version",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  toolRelative,
  testRelative,
  `${evidenceRelative}/MANIFEST.json`,
  ...frameFiles.map((file) => `${evidenceRelative}/${file}`),
] as const;
const runtimePackages = ["canonicalize", "pngjs"] as const;
const pinnedWorkflowRuntime =
  process.versions.node === "22.23.1" &&
  process.versions.modules === "127" &&
  process.platform === "linux" &&
  process.arch === "x64";

interface ToolResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
}

interface ParsedFrame {
  readonly delayCentiseconds: number;
  readonly indices: Buffer;
  readonly maximumLiteralRun: number;
}

interface ParsedGif {
  readonly width: number;
  readonly height: number;
  readonly loopCount: number;
  readonly palette: Buffer;
  readonly frames: readonly ParsedFrame[];
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function runTool(
  root: string,
  arguments_: readonly string[],
  environment: Readonly<Record<string, string>> = {},
): ToolResult {
  return spawnSync(process.execPath, [join(root, toolRelative), ...arguments_], {
    cwd: root,
    env: { ...process.env, ...environment },
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

function runGit(root: string, arguments_: readonly string[]): string {
  const result = spawnSync("/usr/bin/git", arguments_, {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trimEnd();
}

function uint16(bytes: Buffer, offset: number): number {
  assert.ok(offset >= 0 && offset + 2 <= bytes.length);
  return bytes.readUInt16LE(offset);
}

function expectBytes(bytes: Buffer, offset: number, expected: Buffer): number {
  const end = offset + expected.length;
  assert.ok(end <= bytes.length);
  assert.deepEqual(bytes.subarray(offset, end), expected);
  return end;
}

function readSubBlocks(
  bytes: Buffer,
  start: number,
): { readonly data: Buffer; readonly cursor: number } {
  const chunks: Buffer[] = [];
  let cursor = start;
  while (true) {
    assert.ok(cursor < bytes.length);
    const length = bytes.readUInt8(cursor);
    cursor += 1;
    if (length === 0) break;
    const end = cursor + length;
    assert.ok(end <= bytes.length);
    chunks.push(bytes.subarray(cursor, end));
    cursor = end;
  }
  return { data: Buffer.concat(chunks), cursor };
}

function unpackNineBitCodes(bytes: Buffer): readonly number[] {
  const codes: number[] = [];
  let accumulator = 0;
  let bitCount = 0;
  for (const byte of bytes) {
    accumulator |= byte << bitCount;
    bitCount += 8;
    while (bitCount >= 9) {
      codes.push(accumulator & 0x1ff);
      accumulator >>>= 9;
      bitCount -= 9;
    }
  }
  if (bitCount > 0) {
    assert.equal(accumulator, 0, "GIF LZW pad bits must be zero");
  }
  return codes;
}

function decodeLiteralStream(bytes: Buffer): {
  readonly indices: Buffer;
  readonly maximumLiteralRun: number;
} {
  const output: number[] = [];
  let run = 0;
  let maximumRun = 0;
  let ended = false;
  for (const code of unpackNineBitCodes(bytes)) {
    assert.equal(ended, false, "no code may follow the GIF end code");
    if (code === clearCode) {
      maximumRun = Math.max(maximumRun, run);
      assert.ok(run <= maximumLiteralRun);
      run = 0;
      continue;
    }
    if (code === endCode) {
      maximumRun = Math.max(maximumRun, run);
      assert.ok(run <= maximumLiteralRun);
      ended = true;
      continue;
    }
    assert.ok(code >= 0 && code <= 255, "literal-only LZW emitted a dictionary code");
    output.push(code);
    run += 1;
  }
  assert.equal(ended, true);
  return {
    indices: Buffer.from(output),
    maximumLiteralRun: maximumRun,
  };
}

function parseGif(bytes: Buffer): ParsedGif {
  let cursor = 0;
  cursor = expectBytes(bytes, cursor, Buffer.from("GIF89a", "ascii"));
  const parsedWidth = uint16(bytes, cursor);
  const parsedHeight = uint16(bytes, cursor + 2);
  cursor += 4;
  assert.equal(bytes[cursor], 0xf7);
  assert.equal(bytes[cursor + 1], 0);
  assert.equal(bytes[cursor + 2], 0);
  cursor += 3;
  const palette = bytes.subarray(cursor, cursor + 256 * 3);
  assert.equal(palette.length, 256 * 3);
  cursor += palette.length;

  cursor = expectBytes(
    bytes,
    cursor,
    Buffer.concat([
      Buffer.from([0x21, 0xff, 0x0b]),
      Buffer.from("NETSCAPE2.0", "ascii"),
      Buffer.from([0x03, 0x01]),
    ]),
  );
  const loopCount = uint16(bytes, cursor);
  cursor += 2;
  assert.equal(bytes[cursor], 0);
  cursor += 1;

  const frames: ParsedFrame[] = [];
  while (bytes[cursor] !== 0x3b) {
    cursor = expectBytes(bytes, cursor, Buffer.from([0x21, 0xf9, 0x04, 0x04]));
    const delayCentiseconds = uint16(bytes, cursor);
    cursor += 2;
    cursor = expectBytes(bytes, cursor, Buffer.from([0x00, 0x00]));
    cursor = expectBytes(bytes, cursor, Buffer.from([0x2c]));
    assert.equal(uint16(bytes, cursor), 0);
    assert.equal(uint16(bytes, cursor + 2), 0);
    assert.equal(uint16(bytes, cursor + 4), parsedWidth);
    assert.equal(uint16(bytes, cursor + 6), parsedHeight);
    assert.equal(bytes[cursor + 8], 0);
    cursor += 9;
    assert.equal(bytes[cursor], 8);
    cursor += 1;
    const blocks = readSubBlocks(bytes, cursor);
    cursor = blocks.cursor;
    const decoded = decodeLiteralStream(blocks.data);
    frames.push({
      delayCentiseconds,
      indices: decoded.indices,
      maximumLiteralRun: decoded.maximumLiteralRun,
    });
  }
  cursor += 1;
  assert.equal(cursor, bytes.length);
  return {
    width: parsedWidth,
    height: parsedHeight,
    loopCount,
    palette: Buffer.from(palette),
    frames,
  };
}

function expectedPalette(): Buffer {
  const palette = Buffer.alloc(256 * 3);
  for (let index = 0; index < 256; index += 1) {
    const red = index >>> 5;
    const green = (index >>> 2) & 0x07;
    const blue = index & 0x03;
    palette[index * 3] = Math.floor((red * 255 + 3) / 7);
    palette[index * 3 + 1] = Math.floor((green * 255 + 3) / 7);
    palette[index * 3 + 2] = Math.floor((blue * 255 + 1) / 3);
  }
  return palette;
}

function expectedIndices(pngBytes: Buffer): Buffer {
  const decoded = PNG.sync.read(pngBytes, {
    checkCRC: true,
    skipRescale: false,
  });
  assert.equal(decoded.width, width);
  assert.equal(decoded.height, height);
  const indices = Buffer.alloc(width * height);
  for (let pixel = 0; pixel < indices.length; pixel += 1) {
    const offset = pixel * 4;
    assert.equal(decoded.data.readUInt8(offset + 3), 255);
    const red = Math.floor((decoded.data.readUInt8(offset) * 7 + 127) / 255);
    const green = Math.floor((decoded.data.readUInt8(offset + 1) * 7 + 127) / 255);
    const blue = Math.floor((decoded.data.readUInt8(offset + 2) * 3 + 127) / 255);
    indices[pixel] = (red << 5) | (green << 2) | blue;
  }
  return indices;
}

async function copyFileIntoFixture(root: string, relativePath: string): Promise<void> {
  const destination = join(root, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(repositoryRoot, relativePath), destination);
}

async function copyRuntimePackagesIntoFixture(root: string): Promise<void> {
  for (const packageName of runtimePackages) {
    await cp(
      join(repositoryRoot, "node_modules", packageName),
      join(root, "node_modules", packageName),
      {
        errorOnExist: true,
        force: false,
        recursive: true,
      },
    );
  }
}

async function createProductionFixture(t: test.TestContext): Promise<string> {
  await mkdir(generatedTestRoot, { recursive: true });
  const root = await mkdtemp(join(generatedTestRoot, "repo-"));
  t.after(async () => {
    await rm(root, { force: true, recursive: true });
  });
  for (const path of productionSourcePaths) {
    await copyFileIntoFixture(root, path);
  }
  await copyRuntimePackagesIntoFixture(root);
  runGit(root, ["init", "--quiet"]);
  await writeFile(join(root, ".git/info/exclude"), "\nnode_modules/\n", {
    encoding: "utf8",
    flag: "a",
  });
  runGit(root, ["add", "."]);
  runGit(root, [
    "-c",
    "user.name=Omar Ibrahim",
    "-c",
    "user.email=31526072+omar07ibrahim@users.noreply.github.com",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
  return root;
}

test("preview is deterministic on the pinned runtime and fails closed otherwise", async (t) => {
  await mkdir(generatedTestRoot, { recursive: true });
  const nonce = `${process.pid}-${Date.now()}`;
  const firstRelative = `artifacts/generated/workflow-gif-${nonce}-a.gif`;
  const secondRelative = `artifacts/generated/workflow-gif-${nonce}-b.gif`;
  const firstPath = join(repositoryRoot, firstRelative);
  const secondPath = join(repositoryRoot, secondRelative);
  t.after(async () => {
    await Promise.all([
      rm(firstPath, { force: true }),
      rm(secondPath, { force: true }),
    ]);
  });

  const first = runTool(repositoryRoot, ["preview", "--output", firstRelative]);
  if (!pinnedWorkflowRuntime) {
    assert.equal(first.error, undefined);
    assert.equal(first.signal, null);
    assert.equal(first.status, 1);
    assert.equal(first.stdout, "");
    assert.equal(first.stderr, '{"code":"pilot_gif.runtime"}\n');
    assert.equal(existsSync(firstPath), false);
    return;
  }

  const second = runTool(repositoryRoot, ["preview", "--output", secondRelative]);
  assert.equal(first.error, undefined);
  assert.equal(first.signal, null);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stderr, "");
  assert.equal(second.error, undefined);
  assert.equal(second.signal, null);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stderr, "");

  const [firstBytes, secondBytes] = await Promise.all([
    readFile(firstPath),
    readFile(secondPath),
  ]);
  assert.deepEqual(firstBytes, secondBytes);
  assert.ok(firstBytes.byteLength < 2 * 1024 * 1024);
  const firstReceipt = JSON.parse(first.stdout) as {
    readonly gif_sha256: string;
    readonly gif_byte_length: number;
  };
  assert.equal(firstReceipt.gif_sha256, sha256(firstBytes));
  assert.equal(firstReceipt.gif_byte_length, firstBytes.byteLength);

  const parsed = parseGif(firstBytes);
  assert.equal(parsed.width, width);
  assert.equal(parsed.height, height);
  assert.equal(parsed.loopCount, 0);
  assert.deepEqual(parsed.palette, expectedPalette());
  assert.equal(parsed.frames.length, frameFiles.length);
  assert.deepEqual(
    parsed.frames.map(({ delayCentiseconds }) => delayCentiseconds),
    expectedDelays,
  );
  for (const [index, file] of frameFiles.entries()) {
    const frame = parsed.frames[index];
    const expectedDigest = expectedFrameDigests[index];
    assert.ok(frame !== undefined);
    assert.ok(expectedDigest !== undefined);
    assert.equal(frame.maximumLiteralRun, maximumLiteralRun);
    assert.equal(frame.indices.byteLength, width * height);
    const source = await readFile(join(repositoryRoot, evidenceRelative, file));
    assert.equal(sha256(source), expectedDigest);
    assert.deepEqual(frame.indices, expectedIndices(source));
  }
});

test("preview refuses a symlinked output parent before creating descendants", async (t) => {
  if (!pinnedWorkflowRuntime) {
    t.skip("requires exact Node.js 22.23.1 on Linux x64");
    return;
  }
  const root = await createProductionFixture(t);
  const outside = await mkdtemp(join(generatedTestRoot, "outside-"));
  t.after(async () => {
    await rm(outside, { force: true, recursive: true });
  });
  await symlink(outside, join(root, "artifacts"), "dir");

  const rejected = runTool(root, [
    "preview",
    "--output",
    "artifacts/generated/escape.gif",
  ]);
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout, "");
  assert.equal(rejected.stderr, '{"code":"pilot_gif.directory"}\n');
  assert.equal(existsSync(join(outside, "generated")), false);
});

test("production binds committed provenance and rejects dirty or mutated sources", async (t) => {
  if (!pinnedWorkflowRuntime) {
    t.skip("requires exact Node.js 22.23.1 on Linux x64");
    return;
  }
  const root = await createProductionFixture(t);
  await writeFile(join(root, "dirty.txt"), "uncommitted\n", "utf8");
  const dirty = runTool(root, ["write"]);
  assert.equal(dirty.status, 1);
  assert.equal(dirty.stdout, "");
  assert.equal(dirty.stderr, '{"code":"pilot_gif.worktree_dirty"}\n');
  await unlink(join(root, "dirty.txt"));

  const write = runTool(root, ["write"]);
  assert.equal(write.error, undefined);
  assert.equal(write.signal, null);
  assert.equal(write.status, 0, write.stderr);
  assert.equal(write.stderr, "");
  const outputRoot = join(root, "docs/images/pilot-workflow-demo");
  const manifestBytes = await readFile(join(outputRoot, "MANIFEST.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
    readonly official: boolean;
    readonly runtime: {
      readonly dependencies: readonly {
        readonly name: string;
        readonly installed_file_tree_sha256: string;
      }[];
    };
    readonly source: {
      readonly git_revision: string;
      readonly git_tree: string;
      readonly committed_files: readonly {
        readonly path: string;
        readonly git_blob_oid: string;
        readonly sha256: string;
      }[];
    };
    readonly output: {
      readonly file: string;
      readonly sha256: string;
      readonly byte_length: number;
    };
  };
  const head = runGit(root, ["rev-parse", "HEAD"]);
  assert.equal(manifest.official, false);
  assert.deepEqual(
    manifest.runtime.dependencies.map(({ name }) => name),
    runtimePackages,
  );
  for (const dependency of manifest.runtime.dependencies) {
    assert.match(dependency.installed_file_tree_sha256, /^[0-9a-f]{64}$/u);
  }
  assert.equal(manifest.source.git_revision, head);
  assert.equal(manifest.source.git_tree, runGit(root, ["rev-parse", "HEAD^{tree}"]));
  assert.deepEqual(
    manifest.source.committed_files.map(({ path }) => path),
    productionSourcePaths,
  );
  const generator = manifest.source.committed_files.find(
    ({ path }) => path === toolRelative,
  );
  assert.ok(generator !== undefined);
  assert.equal(
    generator.git_blob_oid,
    runGit(root, ["rev-parse", `HEAD:${toolRelative}`]),
  );
  assert.match(generator.sha256, /^[0-9a-f]{64}$/u);
  const gifBytes = await readFile(join(outputRoot, manifest.output.file));
  assert.equal(gifBytes.byteLength, manifest.output.byte_length);
  assert.equal(sha256(gifBytes), manifest.output.sha256);
  assert.equal(parseGif(gifBytes).frames.length, 3);

  const check = runTool(root, ["check"]);
  assert.equal(check.error, undefined);
  assert.equal(check.signal, null);
  assert.equal(check.status, 0, check.stderr);
  assert.equal(check.stderr, "");

  for (const relativePath of [
    "node_modules/canonicalize/lib/canonicalize.js",
    "node_modules/pngjs/lib/png-sync.js",
  ]) {
    const path = join(root, relativePath);
    const original = await readFile(path);
    await writeFile(path, Buffer.concat([original, Buffer.from("\n")]));
    const dependencyRejected = runTool(root, ["check"]);
    assert.equal(dependencyRejected.status, 1);
    assert.equal(dependencyRejected.stdout, "");
    assert.equal(
      dependencyRejected.stderr,
      '{"code":"pilot_gif.dependency_identity"}\n',
    );
    await writeFile(path, original);
  }

  const addedDependencyFile = join(root, "node_modules/pngjs/unexpected.txt");
  await writeFile(addedDependencyFile, "unexpected\n", "utf8");
  const addedDependencyRejected = runTool(root, ["check"]);
  assert.equal(addedDependencyRejected.status, 1);
  assert.equal(
    addedDependencyRejected.stderr,
    '{"code":"pilot_gif.dependency_identity"}\n',
  );
  await unlink(addedDependencyFile);

  const dependencySymlink = join(root, "node_modules/pngjs/unexpected-link");
  await symlink("package.json", dependencySymlink);
  const symlinkRejected = runTool(root, ["check"]);
  assert.equal(symlinkRejected.status, 1);
  assert.equal(symlinkRejected.stderr, '{"code":"pilot_gif.dependency_identity"}\n');
  await unlink(dependencySymlink);

  runGit(root, ["add", "docs/images/pilot-workflow-demo"]);
  runGit(root, [
    "-c",
    "user.name=Omar Ibrahim",
    "-c",
    "user.email=31526072+omar07ibrahim@users.noreply.github.com",
    "commit",
    "--quiet",
    "-m",
    "publish fixture",
  ]);
  const publishedRevision = runGit(root, ["rev-parse", "HEAD"]);
  const originalManifestBytes = await readFile(join(outputRoot, "MANIFEST.json"));
  const originalGifBytes = await readFile(
    join(outputRoot, "incident-command--acknowledge-alert.gif"),
  );
  const ignoredExtra = join(outputRoot, "unexpected.txt");
  await writeFile(
    join(root, ".git/info/exclude"),
    "docs/images/pilot-workflow-demo/unexpected.txt\n",
    { encoding: "utf8", flag: "a" },
  );
  await writeFile(ignoredExtra, "ignored but unsafe\n", "utf8");
  const refusedRefresh = runTool(root, ["refresh"]);
  assert.equal(refusedRefresh.status, 1);
  assert.equal(refusedRefresh.stdout, "");
  assert.equal(refusedRefresh.stderr, '{"code":"pilot_gif.output_membership"}\n');
  assert.deepEqual(
    await readFile(join(outputRoot, "MANIFEST.json")),
    originalManifestBytes,
  );
  assert.deepEqual(
    await readFile(join(outputRoot, "incident-command--acknowledge-alert.gif")),
    originalGifBytes,
  );
  await unlink(ignoredExtra);

  const rollbackFailure = runTool(root, ["refresh"], {
    IMPACTDIFF_PILOT_GIF_TEST_FAIL_AFTER_BACKUP: "1",
  });
  assert.equal(rollbackFailure.status, 1);
  assert.equal(rollbackFailure.stdout, "");
  assert.equal(
    rollbackFailure.stderr,
    '{"code":"pilot_gif.test_failure_after_backup"}\n',
  );
  assert.deepEqual(
    await readFile(join(outputRoot, "MANIFEST.json")),
    originalManifestBytes,
  );
  assert.deepEqual(
    await readFile(join(outputRoot, "incident-command--acknowledge-alert.gif")),
    originalGifBytes,
  );
  assert.deepEqual((await readdir(outputRoot)).sort(), [
    "MANIFEST.json",
    "incident-command--acknowledge-alert.gif",
  ]);
  assert.deepEqual(
    (await readdir(dirname(outputRoot))).filter((name) =>
      name.startsWith(".pilot-workflow-demo-"),
    ),
    [],
  );

  const refresh = runTool(root, ["refresh"]);
  assert.equal(refresh.error, undefined);
  assert.equal(refresh.signal, null);
  assert.equal(refresh.status, 0, refresh.stderr);
  assert.equal(refresh.stderr, "");
  const refreshedManifest = JSON.parse(
    await readFile(join(outputRoot, "MANIFEST.json"), "utf8"),
  ) as {
    readonly source: {
      readonly git_revision: string;
      readonly git_tree: string;
    };
  };
  assert.equal(refreshedManifest.source.git_revision, publishedRevision);
  assert.equal(
    refreshedManifest.source.git_tree,
    runGit(root, ["rev-parse", "HEAD^{tree}"]),
  );
  assert.notEqual(refreshedManifest.source.git_revision, manifest.source.git_revision);
  const refreshedCheck = runTool(root, ["check"]);
  assert.equal(refreshedCheck.status, 0, refreshedCheck.stderr);
  assert.equal(refreshedCheck.stderr, "");

  runGit(root, ["checkout", "--quiet", "--orphan", "squashed"]);
  runGit(root, ["add", "."]);
  runGit(root, [
    "-c",
    "user.name=Omar Ibrahim",
    "-c",
    "user.email=31526072+omar07ibrahim@users.noreply.github.com",
    "commit",
    "--quiet",
    "-m",
    "squashed fixture",
  ]);
  assert.notEqual(runGit(root, ["rev-parse", "HEAD"]), manifest.source.git_revision);
  const postSquashCheck = runTool(root, ["check"]);
  assert.equal(postSquashCheck.error, undefined);
  assert.equal(postSquashCheck.signal, null);
  assert.equal(postSquashCheck.status, 0, postSquashCheck.stderr);
  assert.equal(postSquashCheck.stderr, "");

  const mutatedPath = join(root, evidenceRelative, frameFiles[0]);
  const mutated = await readFile(mutatedPath);
  const finalOffset = mutated.length - 1;
  mutated.writeUInt8(mutated.readUInt8(finalOffset) ^ 0x01, finalOffset);
  await writeFile(mutatedPath, mutated);
  const rejected = runTool(root, ["check"]);
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout, "");
  assert.equal(rejected.stderr, '{"code":"pilot_gif.source_uncommitted"}\n');
});
