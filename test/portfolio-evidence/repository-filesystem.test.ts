import assert from "node:assert/strict";
import { chmod, link, lstat, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import { PilotPortfolioEvidenceError } from "../../src/portfolio-evidence/errors.js";
import {
  createRepositoryStage,
  inspectRepositoryDirectory,
  listRepositoryDirectory,
  readStableRepositoryFile,
  removeRepositoryStage,
  writeRepositoryFile,
} from "../../src/portfolio-evidence/repository-filesystem.js";

const workspaceTemporaryRoot = resolve("..", ".t");

test("repository evidence files round-trip with fresh-checkout modes", async (t) => {
  const parent = await mkdtemp(
    join(workspaceTemporaryRoot, "impactdiff-repository-files-"),
  );
  t.after(async () => rm(parent, { force: true, recursive: true }));
  const parentIdentity = await inspectRepositoryDirectory(parent);
  const stage = join(parent, ".impactdiff-stage-0123456789abcdef0123456789abcdef.tmp");
  const stageIdentity = await createRepositoryStage(stage, parent, parentIdentity);
  const bytes = Buffer.from('{"official":false}', "utf8");

  await writeRepositoryFile(stage, "evidence.json", bytes, stageIdentity);

  assert.deepEqual(
    await readStableRepositoryFile(join(stage, "evidence.json"), 64),
    bytes,
  );
  assert.equal((await lstat(stage)).mode & 0o777, 0o755);
  assert.equal((await lstat(join(stage, "evidence.json"))).mode & 0o777, 0o644);
  assert.deepEqual(await listRepositoryDirectory(stage, 2, stageIdentity), [
    {
      name: "evidence.json",
      isDirectory: false,
      isFile: true,
      isSymbolicLink: false,
    },
  ]);

  await removeRepositoryStage(stage, parent, stageIdentity, parentIdentity);
  await assert.rejects(lstat(stage), { code: "ENOENT" });
});

test("repository evidence reads reject links and unsafe checkout permissions", async (t) => {
  const parent = await mkdtemp(
    join(workspaceTemporaryRoot, "impactdiff-repository-defenses-"),
  );
  t.after(async () => rm(parent, { force: true, recursive: true }));
  const directory = join(parent, "checkout");
  await mkdir(directory, { mode: 0o755 });
  await chmod(directory, 0o755);
  const directoryIdentity = await inspectRepositoryDirectory(directory);
  const original = join(directory, "original.json");
  await writeRepositoryFile(
    directory,
    "original.json",
    Buffer.from('{"value":1}', "utf8"),
    directoryIdentity,
  );

  const hardLink = join(directory, "hard-link.json");
  await link(original, hardLink);
  await assert.rejects(readStableRepositoryFile(original, 64), (error: unknown) => {
    assert.ok(error instanceof PilotPortfolioEvidenceError);
    assert.equal(error.code, "portfolio_evidence.file");
    return true;
  });

  const symbolicLink = join(directory, "symbolic-link.json");
  await symlink("original.json", symbolicLink);
  await assert.rejects(readStableRepositoryFile(symbolicLink, 64), (error: unknown) => {
    assert.ok(error instanceof PilotPortfolioEvidenceError);
    assert.equal(error.code, "portfolio_evidence.file");
    return true;
  });

  const unsafeDirectory = join(parent, "unsafe");
  await mkdir(unsafeDirectory, { mode: 0o755 });
  await chmod(unsafeDirectory, 0o777);
  await assert.rejects(
    inspectRepositoryDirectory(unsafeDirectory),
    (error: unknown) => {
      assert.ok(error instanceof PilotPortfolioEvidenceError);
      assert.equal(error.code, "portfolio_evidence.directory");
      return true;
    },
  );
});
