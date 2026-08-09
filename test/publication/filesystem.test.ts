import assert from "node:assert/strict";
import { chmod, link, mkdir, mkdtemp, rm, symlink, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import { PairedPublicationError } from "../../src/publication/errors.js";
import {
  ensurePrivateDirectory,
  inspectPrivateDirectory,
  readStableImmutableFile,
  writeImmutableFile,
} from "../../src/publication/filesystem.js";

const workspaceTemporaryRoot = resolve(
  "artifacts/generated/publication-filesystem-tests",
);

async function createPrivateTemporaryDirectory(prefix: string): Promise<string> {
  await mkdir(workspaceTemporaryRoot, { mode: 0o700, recursive: true });
  await chmod(workspaceTemporaryRoot, 0o700);
  const directory = await mkdtemp(join(workspaceTemporaryRoot, prefix));
  await chmod(directory, 0o700);
  return directory;
}

async function expectPublicationCode(
  operation: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof PairedPublicationError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

test("descriptor-bound publication files round-trip through exact identities", async (t) => {
  const root = await createPrivateTemporaryDirectory("impactdiff-publication-files-");
  t.after(async () => rm(root, { force: true, recursive: true }));

  const rootIdentity = await inspectPrivateDirectory(root);
  const records = join(root, "records");
  const recordsResult = await ensurePrivateDirectory(records, root, rootIdentity);
  const bytes = Buffer.from('{"contract":"descriptor-bound"}', "utf8");

  await writeImmutableFile(records, "record.json", bytes, recordsResult.identity);

  assert.deepEqual(
    await readStableImmutableFile(join(records, "record.json"), 128),
    bytes,
  );
  await inspectPrivateDirectory(records, recordsResult.identity);
});

test("descriptor-bound publication reads reject aliases and non-regular leaves", async (t) => {
  const root = await createPrivateTemporaryDirectory(
    "impactdiff-publication-defenses-",
  );
  t.after(async () => rm(root, { force: true, recursive: true }));

  const rootIdentity = await inspectPrivateDirectory(root);
  const records = join(root, "records");
  const recordsResult = await ensurePrivateDirectory(records, root, rootIdentity);
  const record = join(records, "record.json");
  await writeImmutableFile(
    records,
    "record.json",
    Buffer.from('{"value":1}', "utf8"),
    recordsResult.identity,
  );

  const nested = join(records, "nested");
  await ensurePrivateDirectory(nested, records, recordsResult.identity);
  const alias = join(root, "records-alias");
  await symlink("records", alias, "dir");
  await expectPublicationCode(
    inspectPrivateDirectory(alias),
    "publication.directory_type",
  );
  await expectPublicationCode(
    inspectPrivateDirectory(join(alias, "nested")),
    "publication.directory_alias",
  );

  const symbolicLeaf = join(records, "symbolic.json");
  await symlink("record.json", symbolicLeaf);
  await expectPublicationCode(
    readStableImmutableFile(symbolicLeaf, 128),
    "publication.file_type",
  );

  const hardLink = join(records, "hard-link.json");
  await link(record, hardLink);
  await expectPublicationCode(
    readStableImmutableFile(record, 128),
    "publication.file_links",
  );
  await unlink(hardLink);

  await expectPublicationCode(
    readStableImmutableFile(records, 128),
    "publication.file_type",
  );
  await expectPublicationCode(
    readStableImmutableFile(join(records, "missing.json"), 128),
    "publication.file_read",
  );
  await expectPublicationCode(
    readStableImmutableFile(record, 1),
    "publication.file_size",
  );
  await expectPublicationCode(
    readStableImmutableFile(record, 0),
    "publication.file_budget",
  );
});
