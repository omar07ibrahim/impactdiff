import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(
  new URL("../../src/cli/pilot-portfolio-evidence.js", import.meta.url),
);
const helpText =
  "Usage: pilot-portfolio-evidence capture --repository <repository-root> --output <new-bundle-directory>\n" +
  "       pilot-portfolio-evidence check --repository <repository-root> --output <bundle-directory>\n";

function runCli(arguments_: readonly string[]) {
  return spawnSync(process.execPath, [cliPath, ...arguments_], {
    encoding: "utf8",
    timeout: 10_000,
  });
}

test("Pilot portfolio evidence CLI exposes path-free help", () => {
  const result = runCli(["--help"]);

  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, helpText);
  assert.equal(result.stderr, "");
});

test("Pilot portfolio evidence CLI fails closed on malformed arguments", async (t) => {
  const invalidArguments = [
    [],
    ["capture"],
    ["check"],
    ["--unknown"],
    ["capture", "--repository", ".", "--output"],
    ["capture", "--repository", ".", "--repository", ".", "--output", "bundle"],
    ["capture", "--repository", ".", "--output", "bundle", "--help"],
    ["check", "--output", "bundle"],
    ["check", "--repository", ".", "--repository", ".", "--output", "bundle"],
    ["check", "--output", "first", "--output", "second"],
  ] as const;

  for (const arguments_ of invalidArguments) {
    await t.test(JSON.stringify(arguments_), () => {
      const result = runCli(arguments_);

      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, '{"code":"portfolio_evidence.arguments"}\n');
    });
  }
});
