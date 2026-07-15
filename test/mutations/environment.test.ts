import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { parseCaptureSpec } from "../../src/capture/index.js";
import {
  computeEnvironmentId,
  computeFeatureProfileId,
} from "../../src/contracts/canonical.js";
import {
  acquireMutationFixtureEnvironment,
  launchMutationFixtureEnvironment,
  MutationFixtureEnvironment,
} from "../../src/mutations/environment.js";
import { MutationRuntimeError } from "../../src/mutations/errors.js";

const fixtureDirectory = resolve("fixtures/checkout-card-v1");

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

test("owned capture environment seals exact package, browser, launch, and font bytes", async () => {
  const environment = await launchMutationFixtureEnvironment(fixtureDirectory);
  const first = environment.capture_spec;
  const second = environment.capture_spec;
  try {
    assert.ok(Object.isFrozen(environment));
    assert.ok(Object.isFrozen(first));
    assert.ok(Object.isFrozen(first.reference));
    assert.notEqual(first.bytes, second.bytes);
    assert.deepEqual(first.bytes, second.bytes);

    const spec = parseCaptureSpec(first.bytes);
    assert.equal(spec.execution.kind, "host");
    assert.equal(
      spec.software.playwright.installed_file_tree_sha256,
      "97ce9a039e4d78d696c6ec11f0c2ee57f53ccdbedcee5620908d56a065f32484",
    );
    assert.equal(
      spec.software.browser.installation_file_tree_sha256,
      "68c05e7c809dbcec86ce5289bb2f4220e9f498596bda49e99825c459d40dd542",
    );
    assert.equal(
      spec.software.browser.executable_sha256,
      "670ba079b75107746ba41abad131180a31a7c7219aa1bd4061fb471f4535d541",
    );
    assert.equal(
      spec.software.browser.launch_profile_sha256,
      "524f0af81e6af704ae4fa67c96b9df3ae3cb63749b5802d8f4604f985d332907",
    );
    assert.equal(
      spec.software.browser.source_revision,
      "3188f8a607ae7e067593be8aab7f02d2451fec07",
    );
    assert.deepEqual(spec.fonts.files, [
      {
        logical_name: "noto-sans-latin-standard-normal",
        format: "woff2",
        sha256: "df8c8215937ab2a4270c0cd997101b3fb8cdd444c9903d342200d6179ebcc097",
        byte_length: 59_928,
      },
    ]);
    assert.deepEqual(first.reference, {
      sha256: "1bd8a2851bbae8b39776ba141c796e3262ff5da8bfdd222adf965a7838301547",
      byte_length: 2_035,
      media_type: "application/vnd.impactdiff.capture-spec+json",
      format_version: 1,
    });
    assert.equal(
      computeEnvironmentId(first.reference),
      "iden1_9635a43f6d78427c651b0a8b3085def1fcfd3f2cf1f0f9f9d7a8cc59584fa9d4",
    );
    assert.equal(
      computeFeatureProfileId(first.reference),
      "idfp1_ebc0629907fe2e45e8fbbbbce970052ff0b0bdee17f436d683076628155a2e98",
    );

    const mutable = first.bytes as Uint8Array;
    mutable[0] = 0;
    parseCaptureSpec(environment.capture_spec.bytes);

    const lease = acquireMutationFixtureEnvironment(environment, second.reference);
    await expectRuntimeError(environment.close(), "mutation.environment_in_use");
    assert.throws(
      () => acquireMutationFixtureEnvironment(environment, second.reference),
      (error: unknown) => {
        assert.ok(error instanceof MutationRuntimeError);
        assert.equal(error.code, "mutation.environment_in_use");
        return true;
      },
    );
    lease.release();
    assert.throws(lease.release, (error: unknown) => {
      assert.ok(error instanceof MutationRuntimeError);
      assert.equal(error.code, "mutation.environment_lease");
      return true;
    });

    const cleanupLease = acquireMutationFixtureEnvironment(
      environment,
      second.reference,
    );
    const ownedBrowser = cleanupLease.browser;
    cleanupLease.release();
    const originalClose = ownedBrowser.close;
    Object.defineProperty(ownedBrowser, "close", {
      configurable: true,
      value: async () => {
        throw new Error("injected browser close failure");
      },
    });
    try {
      await expectRuntimeError(environment.close(), "mutation.environment_close");
      assert.throws(
        () => acquireMutationFixtureEnvironment(environment, second.reference),
        (error: unknown) => {
          assert.ok(error instanceof MutationRuntimeError);
          assert.equal(error.code, "mutation.environment_poisoned");
          return true;
        },
      );
    } finally {
      Object.defineProperty(ownedBrowser, "close", {
        configurable: true,
        value: originalClose,
      });
    }
  } finally {
    await environment.close();
  }
  await expectRuntimeError(environment.close(), "mutation.environment_closed");
});

test("capture environment rejects forged capabilities and changed font bytes", async () => {
  assert.throws(
    () => Reflect.construct(MutationFixtureEnvironment, [Symbol("forged"), {}]),
    (error: unknown) => {
      assert.ok(error instanceof MutationRuntimeError);
      assert.equal(error.code, "mutation.untrusted_environment");
      return true;
    },
  );
  assert.throws(
    () =>
      acquireMutationFixtureEnvironment(
        Object.create(MutationFixtureEnvironment.prototype) as unknown,
        {
          sha256: "0".repeat(64),
          byte_length: 1,
          media_type: "application/vnd.impactdiff.capture-spec+json",
          format_version: 1,
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof MutationRuntimeError);
      assert.equal(error.code, "mutation.untrusted_environment");
      return true;
    },
  );

  const temporaryRoot = await mkdtemp(join(tmpdir(), "impactdiff-environment-"));
  const copied = join(temporaryRoot, "fixture");
  try {
    await cp(fixtureDirectory, copied, { recursive: true });
    const fontPath = join(copied, "fonts/noto-sans-latin-standard-normal.woff2");
    const font = await readFile(fontPath);
    font[0] = font[0] === 0 ? 1 : 0;
    await writeFile(fontPath, font);
    await expectRuntimeError(
      launchMutationFixtureEnvironment(copied),
      "mutation.environment_font",
    );

    await rm(fontPath);
    await symlink(
      join(fixtureDirectory, "fonts/noto-sans-latin-standard-normal.woff2"),
      fontPath,
    );
    await expectRuntimeError(
      launchMutationFixtureEnvironment(copied),
      "mutation.environment_font",
    );

    await rm(join(copied, "fonts"), { recursive: true, force: true });
    await symlink(join(fixtureDirectory, "fonts"), join(copied, "fonts"), "dir");
    await expectRuntimeError(
      launchMutationFixtureEnvironment(copied),
      "mutation.environment_font",
    );

    const alias = join(temporaryRoot, "fixture-alias");
    await symlink(fixtureDirectory, alias, "dir");
    await expectRuntimeError(
      launchMutationFixtureEnvironment(alias),
      "mutation.environment_fixture",
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
