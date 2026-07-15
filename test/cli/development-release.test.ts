import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifyPairedRelease } from "../../src/publication/verify.js";

const cliPath = fileURLToPath(
  new URL("../../src/cli/development-release.js", import.meta.url),
);
const helpText =
  "Usage: development-release --root <pre-existing-0700-publication-root>\n";

function runCli(arguments_: readonly string[], timeout = 10_000) {
  return spawnSync(process.execPath, [cliPath, ...arguments_], {
    encoding: "utf8",
    timeout,
  });
}

test("development release CLI prints help without starting generation", () => {
  const result = runCli(["--help"]);

  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, helpText);
  assert.equal(result.stderr, "");
});

test("development release CLI rejects unknown, duplicate, and missing arguments", async (t) => {
  const invalidArguments = [
    [],
    ["--unknown"],
    ["positional"],
    ["--root"],
    ["--root", "--help"],
    ["--root", "first", "--root", "second"],
    ["--help", "--help"],
    ["--root", "publication", "--help"],
  ] as const;

  for (const arguments_ of invalidArguments) {
    await t.test(JSON.stringify(arguments_), () => {
      const result = runCli(arguments_);

      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, '{"code":"generation.arguments"}\n');
    });
  }
});

test("development release CLI exposes only a safe publication preflight code", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "impactdiff-cli-preflight-"));
  t.after(async () => rm(root, { force: true, recursive: true }));
  await chmod(root, 0o755);

  const result = runCli(["--root", root]);

  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, '{"code":"publication.directory_permissions"}\n');
});

test(
  "development release CLI publishes and strictly reopens one real pair",
  { timeout: 120_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "impactdiff-cli-release-"));
    t.after(async () => rm(root, { force: true, recursive: true }));
    await chmod(root, 0o700);

    const result = runCli(["--root", root], 90_000);

    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /^\{[^\n]+\}\n$/u);

    const receipt = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.deepEqual(Object.keys(receipt), [
      "publication_id",
      "evidence_id",
      "sealed_record_id",
      "release_path",
    ]);
    assert.equal(typeof receipt.publication_id, "string");
    assert.equal(typeof receipt.evidence_id, "string");
    assert.equal(typeof receipt.sealed_record_id, "string");
    assert.equal(typeof receipt.release_path, "string");

    const reopened = await verifyPairedRelease(receipt.release_path as string);
    assert.equal(reopened.commit.publication_id, receipt.publication_id);
    assert.equal(reopened.evidence.evidence_id, receipt.evidence_id);
    assert.equal(reopened.sealedRecord.sealed_record_id, receipt.sealed_record_id);
  },
);
