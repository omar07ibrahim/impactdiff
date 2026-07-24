import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFile,
  chmod,
  cp,
  lstat,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalizePng } from "../../src/artifacts/png.js";
import { parseActionPlan, parseLayoutSnapshot } from "../../src/capture/validate.js";
import { canonicalJson, sha256Hex } from "../../src/contracts/canonical.js";
import { PilotPortfolioEvidenceError } from "../../src/portfolio-evidence/errors.js";
import {
  capturePilotPortfolioEvidence,
  publishPilotPortfolioEvidence,
  verifyPilotPortfolioEvidenceForRepository,
} from "../../src/portfolio-evidence/index.js";
import {
  pilotPortfolioEvidenceManifestFile,
  type CapturedPilotPortfolioEvidence,
  type PilotPortfolioEvidenceManifest,
} from "../../src/portfolio-evidence/schema.js";
import { verifyPilotPortfolioEvidence } from "../../src/portfolio-evidence/publication.js";
import { parsePilotPortfolioEvidenceManifest } from "../../src/portfolio-evidence/validate.js";

const repositoryRoot = resolve(".");
const workspaceTemporaryRoot = resolve("..", ".t");
const cliPath = fileURLToPath(
  new URL("../../src/cli/pilot-portfolio-evidence.js", import.meta.url),
);
const pinnedCaptureRuntime =
  process.versions.node === "22.23.1" &&
  process.platform === "linux" &&
  process.arch === "x64";

type Writable<T> = T extends readonly (infer Item)[]
  ? Writable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Writable<T[Key]> }
    : T;

function manifestScreenshotNames(
  capture: CapturedPilotPortfolioEvidence,
): readonly string[] {
  return capture.manifest.fixtures.flatMap((fixture) =>
    fixture.workflows.flatMap((workflow) =>
      workflow.checkpoints.map(({ screenshot }) => screenshot.file),
    ),
  );
}

function mutateHexIdentity(identity: string): string {
  const final = identity.at(-1);
  assert.notEqual(final, undefined);
  return `${identity.slice(0, -1)}${final === "0" ? "1" : "0"}`;
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

function runGitWithUmask(
  repository: string,
  arguments_: readonly string[],
  mask: number,
): void {
  const previousMask = process.umask(mask);
  try {
    runGit(repository, arguments_);
  } finally {
    process.umask(previousMask);
  }
}

test(
  "Pilot portfolio evidence is deterministic, repository-portable, fresh, and fail closed",
  { concurrency: false, timeout: 300_000, skip: !pinnedCaptureRuntime },
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
    assert.equal(first.files.length, 49);
    assert.deepEqual(first.manifest_bytes, second.manifest_bytes);
    assert.deepEqual(
      first.files.map(({ name, bytes }) => [name, bytes]),
      second.files.map(({ name, bytes }) => [name, bytes]),
    );

    const serializedManifest = first.manifest_bytes.toString("utf8");
    assert.equal(serializedManifest.includes(repositoryRoot), false);
    assert.equal(serializedManifest.includes(workspaceTemporaryRoot), false);
    for (const file of first.files.filter(({ name }) => name.endsWith(".json"))) {
      const serialized = file.bytes.toString("utf8");
      assert.equal(serialized.includes(repositoryRoot), false);
      assert.equal(serialized.includes(workspaceTemporaryRoot), false);
    }
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

    const invalidPng = Buffer.from("not-a-canonical-png", "utf8");
    const lateManifest = structuredClone(
      first.manifest,
    ) as unknown as Writable<PilotPortfolioEvidenceManifest>;
    const lateScreenshot =
      lateManifest.fixtures[0]!.workflows[0]!.checkpoints[0]!.screenshot;
    lateScreenshot.sha256 = sha256Hex(invalidPng);
    lateScreenshot.byte_length = invalidPng.byteLength;
    const lateManifestBytes = Buffer.from(canonicalJson(lateManifest), "utf8");
    const lateCapture = {
      ...first,
      manifest: parsePilotPortfolioEvidenceManifest(lateManifestBytes),
      manifest_bytes: lateManifestBytes,
      files: first.files.map(({ name, bytes }) =>
        name === lateScreenshot.file
          ? Object.freeze({ name, bytes: Buffer.from(invalidPng) })
          : Object.freeze({ name, bytes: Buffer.from(bytes) }),
      ),
    } satisfies CapturedPilotPortfolioEvidence;
    const lateRejectedOutput = join(publicationParent, "late-rejected");
    await assert.rejects(
      publishPilotPortfolioEvidence(lateRejectedOutput, lateCapture),
      (error: unknown) => {
        assert.ok(error instanceof PilotPortfolioEvidenceError);
        assert.equal(error.code, "portfolio_evidence.screenshot_codec");
        return true;
      },
    );
    await assert.rejects(lstat(lateRejectedOutput), { code: "ENOENT" });
    assert.equal(
      (await readdir(publicationParent)).some((name) =>
        name.startsWith(".impactdiff-stage-"),
      ),
      false,
    );

    const graphManifest = structuredClone(
      first.manifest,
    ) as unknown as Writable<PilotPortfolioEvidenceManifest>;
    const graphLayoutReference =
      graphManifest.fixtures[0]!.workflows[0]!.checkpoints[0]!.layout_graph;
    const originalLayoutFile = first.files.find(
      ({ name }) => name === graphLayoutReference.file,
    );
    assert.notEqual(originalLayoutFile, undefined);
    const graphLayout = structuredClone(
      parseLayoutSnapshot(originalLayoutFile!.bytes),
    ) as Writable<ReturnType<typeof parseLayoutSnapshot>>;
    const graphActionPlanReference =
      graphManifest.fixtures[0]!.workflows[0]!.action_plan;
    const graphActionPlanFile = first.files.find(
      ({ name }) => name === graphActionPlanReference.file,
    );
    assert.notEqual(graphActionPlanFile, undefined);
    const declaredTargets = new Set(
      parseActionPlan(graphActionPlanFile!.bytes).actions.flatMap(({ target_id }) =>
        target_id === null ? [] : [target_id],
      ),
    );
    const actionTargetNode = graphLayout.nodes.find(
      ({ action_target_id: actionTargetId }) => actionTargetId !== null,
    );
    assert.notEqual(actionTargetNode, undefined);
    assert.notEqual(actionTargetNode!.action_target_id, null);
    const actionTargetPrefix = actionTargetNode!.action_target_id!.slice(0, -1);
    const unexpectedTarget = [..."0123456789abcdef"]
      .map((suffix) => `${actionTargetPrefix}${suffix}`)
      .find((candidate) => !declaredTargets.has(candidate));
    assert.notEqual(unexpectedTarget, undefined);
    actionTargetNode!.action_target_id = unexpectedTarget!;
    const graphLayoutBytes = Buffer.from(canonicalJson(graphLayout), "utf8");
    graphLayoutReference.sha256 = sha256Hex(graphLayoutBytes);
    graphLayoutReference.byte_length = graphLayoutBytes.byteLength;
    const graphManifestBytes = Buffer.from(canonicalJson(graphManifest), "utf8");
    const graphCapture = {
      ...first,
      manifest: parsePilotPortfolioEvidenceManifest(graphManifestBytes),
      manifest_bytes: graphManifestBytes,
      files: first.files.map(({ name, bytes }) =>
        name === graphLayoutReference.file
          ? Object.freeze({ name, bytes: Buffer.from(graphLayoutBytes) })
          : Object.freeze({ name, bytes: Buffer.from(bytes) }),
      ),
    } satisfies CapturedPilotPortfolioEvidence;
    const graphRejectedOutput = join(publicationParent, "graph-rejected");
    await assert.rejects(
      publishPilotPortfolioEvidence(graphRejectedOutput, graphCapture),
      (error: unknown) => {
        assert.ok(error instanceof PilotPortfolioEvidenceError);
        assert.equal(error.code, "portfolio_evidence.checkpoint_graph_binding");
        return true;
      },
    );
    await assert.rejects(lstat(graphRejectedOutput), { code: "ENOENT" });
    assert.equal(
      (await readdir(publicationParent)).some((name) =>
        name.startsWith(".impactdiff-stage-"),
      ),
      false,
    );

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
      ...first.files.map(({ name }) => name),
    ]) {
      assert.equal((await lstat(join(output, name))).mode & 0o777, 0o644);
    }

    const publishedManifestPath = join(output, pilotPortfolioEvidenceManifestFile);
    const publishedManifestBytes = await readFile(publishedManifestPath);
    const expectManifestTamperRejected = async (
      mutate: (manifest: Writable<PilotPortfolioEvidenceManifest>) => void,
      expectedCode: string,
    ): Promise<void> => {
      const candidate = structuredClone(
        first.manifest,
      ) as unknown as Writable<PilotPortfolioEvidenceManifest>;
      mutate(candidate);
      await chmod(publishedManifestPath, 0o600);
      await writeFile(
        publishedManifestPath,
        Buffer.from(canonicalJson(candidate), "utf8"),
      );
      await chmod(publishedManifestPath, 0o644);
      try {
        await assert.rejects(verifyPilotPortfolioEvidence(output), (error: unknown) => {
          assert.ok(error instanceof PilotPortfolioEvidenceError);
          assert.equal(error.code, expectedCode);
          return true;
        });
      } finally {
        await chmod(publishedManifestPath, 0o600);
        await writeFile(publishedManifestPath, publishedManifestBytes);
        await chmod(publishedManifestPath, 0o644);
      }
    };
    await expectManifestTamperRejected((manifest) => {
      const fixture = manifest.fixtures[0]!;
      fixture.source_state_id = mutateHexIdentity(fixture.source_state_id);
    }, "portfolio_evidence.source_state_binding");
    await expectManifestTamperRejected((manifest) => {
      const workflow = manifest.fixtures[0]!.workflows[0]!;
      workflow.task_id = mutateHexIdentity(workflow.task_id);
    }, "portfolio_evidence.action_plan_binding");
    await expectManifestTamperRejected((manifest) => {
      const checkpoint = manifest.fixtures[0]!.workflows[0]!.checkpoints[0]!;
      checkpoint.checkpoint_id = mutateHexIdentity(checkpoint.checkpoint_id);
    }, "portfolio_evidence.checkpoint_identity");
    await expectManifestTamperRejected((manifest) => {
      manifest.fixtures[0]!.workflows[0]!.resource_request_count += 1;
    }, "portfolio_evidence.workflow_audit_count");
    await expectManifestTamperRejected((manifest) => {
      const accessibility =
        manifest.fixtures[0]!.workflows[0]!.checkpoints[0]!.accessibility_tree;
      accessibility.sha256 = mutateHexIdentity(accessibility.sha256);
    }, "portfolio_evidence.artifact_binding");
    await expectManifestTamperRejected((manifest) => {
      const fixtureManifest = manifest.fixtures[0]!.fixture_manifest;
      fixtureManifest.sha256 = mutateHexIdentity(fixtureManifest.sha256);
    }, "portfolio_evidence.artifact_binding");
    assert.deepEqual(await verifyPilotPortfolioEvidence(output), receipt);

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
    runGitWithUmask(
      cloneRoot,
      ["clone", "--quiet", "--no-hardlinks", cloneRoot, freshCloneRoot],
      0o077,
    );
    await cp(resolve("dist"), join(freshCloneRoot, "dist"), { recursive: true });
    const freshBundle = join(freshCloneRoot, "docs", "pilot-portfolio-evidence");
    assert.equal((await lstat(freshBundle)).mode & 0o777, 0o700);
    for (const name of [
      pilotPortfolioEvidenceManifestFile,
      ...first.files.map(({ name }) => name),
    ]) {
      assert.equal((await lstat(join(freshBundle, name))).mode & 0o777, 0o600);
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
      assert.equal(error.code, "portfolio_evidence.artifact_binding");
      return true;
    });
  },
);
