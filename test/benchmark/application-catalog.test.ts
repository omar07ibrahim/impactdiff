import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  computePilotApplicationCatalogId,
  pilotApplicationCatalogContract,
  pilotApplicationCatalogVersion,
  pilotV01ApplicationBlockByKey,
  pilotV01ApplicationBlockIds,
  pilotV01ApplicationCatalog,
  pilotV01ApplicationCatalogCanonicalJson,
  pilotV01ApplicationCatalogEntries,
  pilotV01ApplicationCatalogId,
  pilotV01ApplicationKeys,
  pilotV01ApplicationKeysByBlock,
  pilotV01CatalogEntryByApplicationKey,
  pilotV01WorkflowKeysByApplicationKey,
} from "../../src/benchmark/application-catalog.js";
import { canonicalJson, parseCanonicalJson } from "../../src/contracts/canonical.js";
import { pilotV01ProtocolId } from "../../src/benchmark/pilot-v01.js";

const goldenCatalogId =
  "idpc1_68d5f474ae0d9d90bf0744069beb5ed21c0d07c103befdb680c4b7f953903b5a";

function assertDeepFrozen(value: unknown, path = "$", seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return;
  }
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, `${path} must be frozen`);
  for (const key of Reflect.ownKeys(value)) {
    assertDeepFrozen(Reflect.get(value, key), `${path}/${String(key)}`, seen);
  }
}

test("Pilot v0.1 catalog freezes 20 applications, 40 workflows, and four balanced blocks", () => {
  assert.equal(pilotV01ApplicationCatalog.applications.length, 20);
  assert.equal(
    pilotV01ApplicationCatalog.applications.flatMap((entry) => entry.workflow_keys)
      .length,
    40,
  );
  assert.deepEqual(pilotV01ApplicationBlockIds, [
    "block_0",
    "block_1",
    "block_2",
    "block_3",
  ]);
  for (const blockId of pilotV01ApplicationBlockIds) {
    assert.equal(pilotV01ApplicationKeysByBlock[blockId].length, 5);
  }
});

test("catalog keys, fixture keys, and full workflow keys are unique and internally mapped", () => {
  const applicationKeys = pilotV01ApplicationCatalogEntries.map(
    (entry) => entry.application_key,
  );
  const fixtureKeys = pilotV01ApplicationCatalogEntries.map(
    (entry) => entry.fixture_key,
  );
  const fullWorkflowKeys = pilotV01ApplicationCatalogEntries.flatMap((entry) =>
    entry.workflow_keys.map(
      (workflowKey) => `${entry.application_key}.${workflowKey}.v1`,
    ),
  );

  assert.equal(new Set(applicationKeys).size, 20);
  assert.equal(new Set(fixtureKeys).size, 20);
  assert.equal(new Set(fullWorkflowKeys).size, 40);
  assert.deepEqual(pilotV01ApplicationKeys, applicationKeys);

  for (const entry of pilotV01ApplicationCatalogEntries) {
    assert.equal(pilotV01CatalogEntryByApplicationKey[entry.application_key], entry);
    assert.equal(
      pilotV01WorkflowKeysByApplicationKey[entry.application_key],
      entry.workflow_keys,
    );
    assert.equal(pilotV01ApplicationBlockByKey[entry.application_key], entry.block_id);
    assert.equal(
      entry.fixture_key,
      `pilot-${entry.application_key.replaceAll("_", "-")}-v1`,
    );
  }
});

test("the code-owned catalog has a stable canonical identity and is deeply frozen", () => {
  assert.equal(pilotV01ApplicationCatalog.contract, pilotApplicationCatalogContract);
  assert.equal(pilotV01ApplicationCatalog.version, pilotApplicationCatalogVersion);
  assert.equal(pilotV01ApplicationCatalog.protocol_id, pilotV01ProtocolId);
  assert.equal(pilotV01ApplicationCatalogId, goldenCatalogId);
  assert.equal(pilotV01ApplicationCatalog.catalog_id, goldenCatalogId);
  assert.equal(
    computePilotApplicationCatalogId(pilotV01ApplicationCatalog),
    goldenCatalogId,
  );
  assert.equal(
    pilotV01ApplicationCatalogCanonicalJson,
    canonicalJson(pilotV01ApplicationCatalog),
  );
  assert.deepEqual(
    parseCanonicalJson(pilotV01ApplicationCatalogCanonicalJson),
    pilotV01ApplicationCatalog,
  );

  assertDeepFrozen(pilotV01ApplicationCatalog);
  assertDeepFrozen(pilotV01ApplicationBlockIds);
  assertDeepFrozen(pilotV01ApplicationKeys);
  assertDeepFrozen(pilotV01ApplicationKeysByBlock);
  assertDeepFrozen(pilotV01CatalogEntryByApplicationKey);
  assertDeepFrozen(pilotV01WorkflowKeysByApplicationKey);
  assertDeepFrozen(pilotV01ApplicationBlockByKey);
});

test("the reviewer-facing Markdown table matches the code-owned catalog", async () => {
  const markdown = await readFile(
    resolve("docs/pilot-v0.1-application-catalog.md"),
    "utf8",
  );
  const rows = markdown
    .split("\n")
    .filter((line) => /^\| `block_[0-3]` \|/u.test(line))
    .map((line) => {
      const columns = line.split("|");
      const blockId = columns[1]?.match(/`(block_[0-3])`/u)?.[1];
      const applicationKey = columns[2]?.match(/`([a-z_]+)`/u)?.[1];
      const firstWorkflowKey = columns[4]?.match(/`([a-z_]+)`:/u)?.[1];
      const secondWorkflowKey = columns[5]?.match(/`([a-z_]+)`:/u)?.[1];
      assert.ok(blockId !== undefined);
      assert.ok(applicationKey !== undefined);
      assert.ok(firstWorkflowKey !== undefined);
      assert.ok(secondWorkflowKey !== undefined);
      return {
        application_key: applicationKey,
        block_id: blockId,
        workflow_keys: [firstWorkflowKey, secondWorkflowKey],
      };
    });

  assert.deepEqual(
    rows,
    pilotV01ApplicationCatalogEntries.map((entry) => ({
      application_key: entry.application_key,
      block_id: entry.block_id,
      workflow_keys: [...entry.workflow_keys],
    })),
  );
});
