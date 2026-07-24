import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFile,
  chmod,
  cp,
  lstat,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalizePng } from "../../src/artifacts/png.js";
import { canonicalJson } from "../../src/contracts/canonical.js";
import { PilotPortfolioEvidenceError } from "../../src/portfolio-evidence/errors.js";
import {
  capturePilotPortfolioEvidence,
  publishPilotPortfolioEvidence,
  verifyPilotPortfolioEvidenceForRepository,
} from "../../src/portfolio-evidence/index.js";
import {
  pilotPortfolioEvidenceManifestFile,
  type CapturedPilotPortfolioEvidence,
} from "../../src/portfolio-evidence/schema.js";
import { verifyPilotPortfolioEvidence } from "../../src/portfolio-evidence/publication.js";
import { parsePilotPortfolioEvidenceManifest } from "../../src/portfolio-evidence/validate.js";

const repositoryRoot = resolve(".");
const workspaceTemporaryRoot = resolve("..", ".t");
const cliPath = fileURLToPath(
  new URL("../../src/cli/pilot-portfolio-evidence.js", import.meta.url),
);

function manifestScreenshotNames(
  capture: CapturedPilotPortfolioEvidence,
): readonly string[] {
  return capture.manifest.fixtures.flatMap((fixture) =>
    fixture.workflows.flatMap((workflow) =>
      workflow.checkpoints.map(({ screenshot }) => screenshot.file),
    ),
  );
}

function expectPortfolioCode(action: () => unknown, expectedCode: string): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof PilotPortfolioEvidenceError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

function runGit(repository: string, arguments_: readonly string[]): void {
  const result = spawnSync("git", ["-C", repository, ...arguments_], {
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Omar Ibrahim",
      GIT_AUTHOR_EMAIL: "31526072+omar07ibrahim@users.noreply.github.com",
      GIT_COMMITTER_NAME: "Omar Ibrahim",
      GIT_COMMITTER_EMAIL: "31526072+omar07ibrahim@users.noreply.github.com",
    },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
}

test(
  "Pilot portfolio evidence is deterministic, repository-portable, fresh, and fail closed",
  { concurrency: false, timeout: 300_000 },
  async (t) => {
    const publicationParent = await mkdtemp(
      join(workspaceTemporaryRoot, "impactdiff-portfolio-evidence-"),
    );
    t.after(async () => rm(publicationParent, { force: true, recursive: true }));

    const first = await capturePilotPortfolioEvidence(repositoryRoot);
    const second = await capturePilotPortfolioEvidence(repositoryRoot);

    assert.equal(first.official, false);
    assert.equal(first.manifest.official, false);
    assert.equal(first.manifest.scope, "local-authoring-checkpoint-evidence");
    assert.equal(first.manifest.fixtures.length, 2);
    assert.equal(
      first.manifest.fixtures.flatMap(({ workflows }) => workflows).length,
      4,
    );
    assert.equal(manifestScreenshotNames(first).length, 12);
    assert.equal(first.files.length, 13);
    assert.deepEqual(first.manifest_bytes, second.manifest_bytes);
    assert.deepEqual(
      first.files.map(({ name, bytes }) => [name, bytes]),
      second.files.map(({ name, bytes }) => [name, bytes]),
    );

    const serializedManifest = first.manifest_bytes.toString("utf8");
    assert.equal(serializedManifest.includes(repositoryRoot), false);
    assert.equal(serializedManifest.includes(workspaceTemporaryRoot), false);
    assert.equal(serializedManifest.includes("official_dataset_release"), true);
    assert.equal(
      serializedManifest.includes("model_quality_or_benchmark_performance"),
      true,
    );
    assert.deepEqual(Object.keys(first.manifest.source.root_files).sort(), [
      "node_version_file",
      "package_lock",
      "package_manifest",
      "typescript_config",
    ]);
    for (const fixture of first.manifest.fixtures) {
      for (const workflow of fixture.workflows) {
        assert.equal(workflow.official, false);
        assert.equal(workflow.blocked_external_requests, 0);
        assert.equal(workflow.unexpected_fixture_requests, 0);
        assert.equal(workflow.checkpoints.length, 3);
      }
    }
    for (const file of first.files.filter(({ name }) => name.endsWith(".png"))) {
      assert.deepEqual(
        canonicalizePng(file.bytes, { width: 800, height: 600 }).bytes,
        file.bytes,
      );
    }

    const invalidOfficial = structuredClone(first.manifest) as unknown as Record<
      string,
      unknown
    >;
    invalidOfficial.official = true;
    expectPortfolioCode(
      () =>
        parsePilotPortfolioEvidenceManifest(
          Buffer.from(canonicalJson(invalidOfficial), "utf8"),
        ),
      "portfolio_evidence.schema",
    );
    const unexpectedField = structuredClone(first.manifest) as unknown as Record<
      string,
      unknown
    >;
    unexpectedField.host_path = repositoryRoot;
    expectPortfolioCode(
      () =>
        parsePilotPortfolioEvidenceManifest(
          Buffer.from(canonicalJson(unexpectedField), "utf8"),
        ),
      "portfolio_evidence.schema",
    );

    const corruptedFiles = first.files.map(({ name, bytes }, index) => ({
      name,
      bytes:
        index === 0
          ? Buffer.concat([Buffer.from(bytes), Buffer.from([0])])
          : Buffer.from(bytes),
    }));
    const corruptedCapture = {
      ...first,
      files: corruptedFiles,
    } satisfies CapturedPilotPortfolioEvidence;
    const rejectedOutput = join(publicationParent, "rejected-input");
    await assert.rejects(
      publishPilotPortfolioEvidence(rejectedOutput, corruptedCapture),
      (error: unknown) => {
        assert.ok(error instanceof PilotPortfolioEvidenceError);
        assert.equal(error.code, "portfolio_evidence.capture_file_binding");
        return true;
      },
    );
    await assert.rejects(lstat(rejectedOutput), { code: "ENOENT" });

    const output = join(publicationParent, "pilot-evidence");
    const receipt = await publishPilotPortfolioEvidence(output, first);
    assert.equal(receipt.official, false);
    assert.equal(receipt.fixture_count, 2);
    assert.equal(receipt.workflow_count, 4);
    assert.equal(receipt.checkpoint_count, 12);
    assert.deepEqual(await verifyPilotPortfolioEvidence(output), receipt);
    assert.deepEqual(
      await verifyPilotPortfolioEvidenceForRepository(repositoryRoot, output),
      receipt,
    );
    assert.equal((await lstat(output)).mode & 0o777, 0o755);
    for (const name of [
      pilotPortfolioEvidenceManifestFile,
      "capture-spec.json",
      ...manifestScreenshotNames(first),
    ]) {
      assert.equal((await lstat(join(output, name))).mode & 0o777, 0o644);
    }

    const cloneRoot = join(publicationParent, "repository-with-evidence");
    runGit(repositoryRoot, [
      "clone",
      "--quiet",
      "--no-hardlinks",
      repositoryRoot,
      cloneRoot,
    ]);
    await cp(resolve("dist"), join(cloneRoot, "dist"), { recursive: true });
    const committedBundle = join(cloneRoot, "docs", "pilot-portfolio-evidence");
    await cp(output, committedBundle, { recursive: true });
    runGit(cloneRoot, ["add", "docs/pilot-portfolio-evidence"]);
    runGit(cloneRoot, ["commit", "--quiet", "-m", "Record Pilot portfolio evidence"]);
    assert.deepEqual(
      await verifyPilotPortfolioEvidenceForRepository(cloneRoot, committedBundle),
      receipt,
    );

    const freshCloneRoot = join(publicationParent, "fresh-checkout");
    runGit(cloneRoot, [
      "clone",
      "--quiet",
      "--no-hardlinks",
      cloneRoot,
      freshCloneRoot,
    ]);
    await cp(resolve("dist"), join(freshCloneRoot, "dist"), { recursive: true });
    const freshBundle = join(freshCloneRoot, "docs", "pilot-portfolio-evidence");
    assert.equal((await lstat(freshBundle)).mode & 0o777, 0o755);
    for (const name of [
      pilotPortfolioEvidenceManifestFile,
      "capture-spec.json",
      ...manifestScreenshotNames(first),
    ]) {
      assert.equal((await lstat(join(freshBundle, name))).mode & 0o777, 0o644);
    }
    assert.deepEqual(
      await verifyPilotPortfolioEvidenceForRepository(freshCloneRoot, freshBundle),
      receipt,
    );

    const cliCheck = spawnSync(
      process.execPath,
      [cliPath, "check", "--repository", cloneRoot, "--output", committedBundle],
      {
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    assert.equal(cliCheck.error, undefined);
    assert.equal(cliCheck.signal, null);
    assert.equal(cliCheck.status, 0);
    assert.equal(cliCheck.stderr, "");
    assert.equal(cliCheck.stdout.includes(committedBundle), false);
    assert.equal(cliCheck.stdout.includes(repositoryRoot), false);
    assert.deepEqual(JSON.parse(cliCheck.stdout), {
      official: false,
      manifest_sha256: receipt.manifest_sha256,
      fixture_count: 2,
      workflow_count: 4,
      checkpoint_count: 12,
    });

    const authoredPath = join(freshCloneRoot, "src", "portfolio-evidence", "errors.ts");
    const authoredBytes = await readFile(authoredPath);
    await appendFile(authoredPath, "\n");
    await assert.rejects(
      verifyPilotPortfolioEvidenceForRepository(freshCloneRoot, freshBundle),
      (error: unknown) => {
        assert.ok(error instanceof PilotPortfolioEvidenceError);
        assert.equal(error.code, "portfolio_evidence.source_worktree");
        return true;
      },
    );
    await writeFile(authoredPath, authoredBytes);
    assert.deepEqual(
      await verifyPilotPortfolioEvidenceForRepository(freshCloneRoot, freshBundle),
      receipt,
    );
    const compiledPath = join(
      freshCloneRoot,
      "dist",
      "src",
      "portfolio-evidence",
      "errors.js",
    );
    await appendFile(compiledPath, "\n");
    await assert.rejects(
      verifyPilotPortfolioEvidenceForRepository(freshCloneRoot, freshBundle),
      (error: unknown) => {
        assert.ok(error instanceof PilotPortfolioEvidenceError);
        assert.equal(error.code, "portfolio_evidence.source_freshness");
        return true;
      },
    );

    const tamperedScreenshot = manifestScreenshotNames(first)[0]!;
    const tamperedPath = join(output, tamperedScreenshot);
    const original = await readFile(tamperedPath);
    const tampered = Buffer.from(original);
    const finalByteIndex = tampered.length - 1;
    tampered[finalByteIndex] = tampered[finalByteIndex]! ^ 1;
    await chmod(tamperedPath, 0o600);
    await writeFile(tamperedPath, tampered);
    await chmod(tamperedPath, 0o644);
    await assert.rejects(verifyPilotPortfolioEvidence(output), (error: unknown) => {
      assert.ok(error instanceof PilotPortfolioEvidenceError);
      assert.equal(error.code, "portfolio_evidence.screenshot_binding");
      return true;
    });
  },
);
