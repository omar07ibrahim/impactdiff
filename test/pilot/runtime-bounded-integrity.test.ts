import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { canonicalJson, sha256Hex } from "../../src/contracts/canonical.js";
import { launchPilotFixtureAuthoringEnvironment } from "../../src/pilot/runtime/environment.js";
import { PilotFixtureAuthoringRuntimeError } from "../../src/pilot/runtime/errors.js";
import { replayPilotFixtureAuthoringWorkflow } from "../../src/pilot/runtime/replay.js";

const fixtureDirectory = resolve("fixtures/pilot-market-basket-v1");

interface MutableFixtureManifest {
  resources: {
    path: string;
    sha256: string;
    byte_length: number;
  }[];
}

async function addDomNodeOverflow(fixtureRoot: string): Promise<void> {
  const applicationPath = join(fixtureRoot, "app.js");
  const manifestPath = join(fixtureRoot, "fixture.json");
  const application = await readFile(applicationPath, "utf8");
  const marker =
    "void Promise.all([document.fonts.ready, wovenTagReady]).then(() => {\n";
  assert.equal(application.split(marker).length, 2, "readiness marker must be unique");
  const tamperedApplication = application.replace(
    marker,
    `${marker}  const overflowNodes = document.createDocumentFragment();\n` +
      `  for (let index = 0; index < 4_097; index += 1) {\n` +
      `    overflowNodes.append(document.createElement("i"));\n` +
      `  }\n` +
      `  root.append(overflowNodes);\n`,
  );
  await writeFile(applicationPath, tamperedApplication, "utf8");

  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as MutableFixtureManifest;
  const applicationResource = manifest.resources.find(({ path }) => path === "app.js");
  assert.ok(applicationResource !== undefined, "manifest must declare app.js");
  const applicationBytes = Buffer.from(tamperedApplication, "utf8");
  applicationResource.byte_length = applicationBytes.byteLength;
  applicationResource.sha256 = sha256Hex(applicationBytes);
  await writeFile(manifestPath, `${canonicalJson(manifest)}\n`, "utf8");
}

test(
  "Pilot replay rejects a self-consistent fixture above the CaptureSpec DOM-node budget",
  { concurrency: false, timeout: 60_000 },
  async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "impactdiff-pilot-runtime-node-budget-"),
    );
    const fixtureRoot = join(temporaryRoot, "fixture");
    try {
      await cp(fixtureDirectory, fixtureRoot, { recursive: true });
      await addDomNodeOverflow(fixtureRoot);
      const environment = await launchPilotFixtureAuthoringEnvironment(fixtureRoot);
      try {
        await assert.rejects(
          replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
          (error: unknown) => {
            assert.ok(error instanceof PilotFixtureAuthoringRuntimeError);
            assert.equal(error.code, "pilot_runtime.fixture_readiness");
            return true;
          },
        );
      } finally {
        await environment.close();
      }
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  },
);
