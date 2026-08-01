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

async function expectPortfolioCode(
  operation: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof PilotPortfolioEvidenceError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

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

  for (const unsafeName of [
    "",
    ".",
    "..",
    "nested/file.json",
    "back\\slash.json",
    "nul\0.json",
    "delete\u007f.json",
    "e\u0301.json",
    "x".repeat(256),
  ]) {
    await expectPortfolioCode(
      writeRepositoryFile(
        directory,
        unsafeName,
        Buffer.from("bounded", "utf8"),
        directoryIdentity,
      ),
      "portfolio_evidence.file_input",
    );
  }
  for (const unsafeBytes of [Buffer.alloc(0), Buffer.alloc(16_777_217)]) {
    await expectPortfolioCode(
      writeRepositoryFile(directory, "bounded.json", unsafeBytes, directoryIdentity),
      "portfolio_evidence.file_input",
    );
  }
  for (const unsafeBudget of [-1, Number.MAX_SAFE_INTEGER + 1]) {
    await expectPortfolioCode(
      listRepositoryDirectory(directory, unsafeBudget, directoryIdentity),
      "portfolio_evidence.directory_budget",
    );
    await expectPortfolioCode(
      readStableRepositoryFile(original, unsafeBudget),
      "portfolio_evidence.file_budget",
    );
  }
  for (const unsafeStage of [
    join(directory, "not-a-stage"),
    join(directory, "nested", ".impactdiff-stage-0123456789abcdef0123456789abcdef.tmp"),
  ]) {
    await expectPortfolioCode(
      createRepositoryStage(unsafeStage, directory, directoryIdentity),
      "portfolio_evidence.stage_name",
    );
    await expectPortfolioCode(
      removeRepositoryStage(
        unsafeStage,
        directory,
        directoryIdentity,
        directoryIdentity,
      ),
      "portfolio_evidence.stage_name",
    );
  }
});
