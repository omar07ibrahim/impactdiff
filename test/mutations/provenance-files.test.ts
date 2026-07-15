import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { MutationRuntimeError } from "../../src/mutations/errors.js";
import { auditProvenanceFileTree } from "../../src/mutations/provenance-files.js";

const options = Object.freeze({
  maximumFileBytes: 1_024,
  maximumTreeBytes: 4_096,
  capturePaths: new Set(["a.txt"]),
  captureBytePaths: new Set(["a.txt"]),
});

async function expectRuntimeError(
  action: Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof MutationRuntimeError);
    assert.equal(error.code, code);
    return true;
  });
}

async function writeEquivalentTree(root: string, reverse: boolean): Promise<void> {
  await mkdir(join(root, "a"));
  const files = [
    ["z.txt", "z"],
    ["a/z.txt", "nested"],
    ["a.txt", "a"],
  ] as const;
  for (const [path, body] of reverse ? [...files].reverse() : files) {
    await writeFile(join(root, path), body, "utf8");
  }
}

test("provenance trees are globally sorted and independent of creation order", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "impactdiff-tree-order-"));
  const firstRoot = join(temporaryRoot, "first");
  const secondRoot = join(temporaryRoot, "second");
  try {
    await mkdir(firstRoot);
    await mkdir(secondRoot);
    await writeEquivalentTree(firstRoot, false);
    await writeEquivalentTree(secondRoot, true);
    const first = await auditProvenanceFileTree(firstRoot, options);
    const second = await auditProvenanceFileTree(secondRoot, options);

    assert.deepEqual(first.files, second.files);
    assert.deepEqual(first.directories, second.directories);
    assert.deepEqual(first.directories, ["a"]);
    assert.deepEqual(
      first.files.map((file) => file.path),
      ["a.txt", "a/z.txt", "z.txt"],
    );
    const firstCapture = first.captures.get("a.txt")?.bytes;
    const secondCapture = first.captures.get("a.txt")?.bytes;
    assert.ok(firstCapture);
    assert.ok(secondCapture);
    assert.notEqual(firstCapture, secondCapture);
    assert.deepEqual(firstCapture, Buffer.from("a"));
    firstCapture[0] = 0;
    assert.deepEqual(secondCapture, Buffer.from("a"));
    assert.deepEqual(first.captures.get("a.txt")?.bytes, Buffer.from("a"));
    assert.equal("set" in first.captures, false);
    assert.ok(Object.isFrozen(first.directories));

    await writeFile(join(secondRoot, "a.txt"), "changed", "utf8");
    const changed = await auditProvenanceFileTree(secondRoot, options);
    assert.notDeepEqual(first.files, changed.files);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("provenance trees bound empty-directory and entry traversal", async () => {
  const root = await mkdtemp(join(tmpdir(), "impactdiff-tree-budget-"));
  try {
    await writeFile(join(root, "a.txt"), "a", "utf8");
    for (let index = 0; index < 1_024; index += 1) {
      await mkdir(join(root, `directory-${index.toString().padStart(4, "0")}`));
    }
    await expectRuntimeError(
      auditProvenanceFileTree(root, options),
      "mutation.environment_tree",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("provenance trees enforce required paths, file bytes, and depth", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "impactdiff-tree-limits-"));
  const missingRoot = join(temporaryRoot, "missing");
  const oversizedRoot = join(temporaryRoot, "oversized");
  const deepRoot = join(temporaryRoot, "deep");
  try {
    await mkdir(missingRoot);
    await writeFile(join(missingRoot, "b.txt"), "b", "utf8");
    await expectRuntimeError(
      auditProvenanceFileTree(missingRoot, options),
      "mutation.environment_tree",
    );

    await mkdir(oversizedRoot);
    await writeFile(join(oversizedRoot, "a.txt"), Buffer.alloc(1_025));
    await expectRuntimeError(
      auditProvenanceFileTree(oversizedRoot, options),
      "mutation.environment_file",
    );

    await mkdir(deepRoot);
    await writeFile(join(deepRoot, "a.txt"), "a", "utf8");
    let directory = deepRoot;
    for (let depth = 0; depth < 33; depth += 1) {
      directory = join(directory, "d");
      await mkdir(directory);
    }
    await expectRuntimeError(
      auditProvenanceFileTree(deepRoot, options),
      "mutation.environment_tree",
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("provenance trees reject malformed and aggregate byte budgets", async () => {
  const root = await mkdtemp(join(tmpdir(), "impactdiff-tree-byte-budget-"));
  try {
    await writeFile(join(root, "a.txt"), "aa", "utf8");
    await writeFile(join(root, "b.txt"), "bb", "utf8");

    for (const malformedOptions of [
      { ...options, maximumFileBytes: Number.NaN },
      { ...options, maximumTreeBytes: Number.POSITIVE_INFINITY },
      { ...options, maximumTreeBytes: -1 },
    ]) {
      await expectRuntimeError(
        auditProvenanceFileTree(root, malformedOptions),
        "mutation.environment_tree",
      );
    }

    await expectRuntimeError(
      auditProvenanceFileTree(root, { ...options, maximumTreeBytes: 3 }),
      "mutation.environment_tree",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("provenance trees reject symbolic and hard-linked aliases", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "impactdiff-tree-alias-"));
  const symlinkRoot = join(temporaryRoot, "symlink-tree");
  const hardlinkRoot = join(temporaryRoot, "hardlink-tree");
  const externalHardlinkRoot = join(temporaryRoot, "external-hardlink-tree");
  try {
    await mkdir(symlinkRoot);
    await writeFile(join(symlinkRoot, "a.txt"), "a", "utf8");
    await symlink("a.txt", join(symlinkRoot, "alias.txt"));
    await expectRuntimeError(
      auditProvenanceFileTree(symlinkRoot, options),
      "mutation.environment_tree",
    );

    await mkdir(hardlinkRoot);
    await writeFile(join(hardlinkRoot, "a.txt"), "a", "utf8");
    await link(join(hardlinkRoot, "a.txt"), join(hardlinkRoot, "alias.txt"));
    await expectRuntimeError(
      auditProvenanceFileTree(hardlinkRoot, options),
      "mutation.environment_tree",
    );

    await mkdir(externalHardlinkRoot);
    const externalFile = join(temporaryRoot, "external.txt");
    await writeFile(externalFile, "a", "utf8");
    await link(externalFile, join(externalHardlinkRoot, "a.txt"));
    await expectRuntimeError(
      auditProvenanceFileTree(externalHardlinkRoot, options),
      "mutation.environment_tree",
    );

    const rootAlias = join(temporaryRoot, "root-alias");
    await symlink(symlinkRoot, rootAlias, "dir");
    await expectRuntimeError(
      auditProvenanceFileTree(rootAlias, options),
      "mutation.environment_tree",
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
