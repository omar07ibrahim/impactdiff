import assert from "node:assert/strict";
import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  publishFreshMutationFixturePair,
  type FreshMutationFixturePairOptions,
} from "../../src/generation/index.js";
import { PairedPublicationError } from "../../src/publication/errors.js";
import { verifyPairedRelease } from "../../src/publication/verify.js";

const fixtureDirectory = resolve("fixtures/checkout-card-v1");
const runtimePublish = publishFreshMutationFixturePair as (
  options: unknown,
) => Promise<unknown>;

function acceptsFreshOptions(_options: FreshMutationFixturePairOptions): void {}

void acceptsFreshOptions;

test("fresh-pair options reject accessors and unknown fields synchronously", () => {
  let getterCalls = 0;
  const accessor = {
    publicationRoot: "/tmp/unused-impactdiff-root",
    operatorKey: "pointer_interceptor",
  };
  Object.defineProperty(accessor, "fixtureDirectory", {
    enumerable: true,
    get: () => {
      getterCalls += 1;
      return fixtureDirectory;
    },
  });
  assert.throws(() => runtimePublish(accessor), /enumerable data property/u);
  assert.equal(getterCalls, 0);

  assert.throws(
    () =>
      runtimePublish({
        fixtureDirectory,
        publicationRoot: "/tmp/unused-impactdiff-root",
        operatorKey: "pointer_interceptor",
        extra: true,
      }),
    /unknown, hidden, or missing fields/u,
  );

  assert.throws(
    () =>
      runtimePublish({
        fixtureDirectory: `/${"x".repeat(4_097)}`,
        publicationRoot: "/tmp/unused-impactdiff-root",
        operatorKey: "pointer_interceptor",
      }),
    /bounded non-empty filesystem path/u,
  );
});

test("publication topology is checked before Chromium launch", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "impactdiff-generation-preflight-"));
  t.after(async () => rm(root, { force: true, recursive: true }));
  await chmod(root, 0o755);

  await assert.rejects(
    publishFreshMutationFixturePair({
      fixtureDirectory: join(root, "missing-fixture"),
      publicationRoot: root,
      operatorKey: "pointer_interceptor",
    }),
    (error: unknown) => {
      assert.ok(error instanceof PairedPublicationError);
      assert.equal(error.code, "publication.directory_permissions");
      return true;
    },
  );
});

test("one-shot generation publishes real pointer and palette pairs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "impactdiff-generation-"));
  await chmod(root, 0o700);
  t.after(async () => rm(root, { force: true, recursive: true }));

  const options: {
    fixtureDirectory: string;
    publicationRoot: string;
    operatorKey: "palette_swap" | "pointer_interceptor";
  } = {
    fixtureDirectory,
    publicationRoot: root,
    operatorKey: "pointer_interceptor",
  };
  const firstPromise = publishFreshMutationFixturePair(options);
  options.operatorKey = "palette_swap";
  const first = await firstPromise;

  assert.equal(first.sealedRecord.intervention.expected_task_relation, "break");
  assert.equal(first.sealedRecord.execution.baseline.task_success, true);
  assert.equal(first.sealedRecord.execution.candidate.task_success, false);
  assert.equal(first.sealedRecord.labels.sample_valid, true);
  assert.equal(first.sealedRecord.labels.invalid_reason, null);
  assert.equal(first.sealedRecord.labels.task_regression, true);
  assert.equal(first.sealedRecord.labels.severity_ordinal, 4);
  assert.notEqual(first.sealedRecord.labels.first_failed_step_id, null);
  assert.notEqual(first.sealedRecord.labels.localization, null);
  assert.notEqual(first.resolved.localization, null);

  const reopened = await verifyPairedRelease(first.paths.releasePath);
  assert.equal(reopened.commit.publication_id, first.commit.publication_id);
  assert.equal(reopened.evidence.evidence_id, first.evidence.evidence_id);
  assert.equal(
    reopened.sealedRecord.sealed_record_id,
    first.sealedRecord.sealed_record_id,
  );

  const second = await publishFreshMutationFixturePair({
    fixtureDirectory,
    publicationRoot: root,
    operatorKey: "pointer_interceptor",
  });
  assert.equal(second.commit.publication_id, first.commit.publication_id);
  assert.equal(second.paths.releasePath, first.paths.releasePath);

  const palette = await publishFreshMutationFixturePair({
    fixtureDirectory,
    publicationRoot: root,
    operatorKey: "palette_swap",
  });
  assert.notEqual(palette.evidence.evidence_id, first.evidence.evidence_id);
  assert.equal(palette.sealedRecord.intervention.expected_task_relation, "preserve");
  assert.equal(palette.sealedRecord.execution.baseline.task_success, true);
  assert.equal(palette.sealedRecord.execution.candidate.task_success, true);
  assert.equal(palette.sealedRecord.labels.sample_valid, true);
  assert.equal(palette.sealedRecord.labels.task_regression, false);
  assert.equal(palette.sealedRecord.labels.severity_ordinal, 0);
  assert.equal(palette.sealedRecord.labels.first_failed_step_id, null);
  assert.equal(palette.sealedRecord.labels.localization, null);
  assert.equal(palette.resolved.localization, null);

  assert.deepEqual(
    (await readdir(join(root, "releases"))).sort(),
    [first.evidence.evidence_id, palette.evidence.evidence_id].sort(),
  );
});
