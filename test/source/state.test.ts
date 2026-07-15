import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { sourceStateCodec } from "../../src/artifacts/codecs.js";
import {
  canonicalJson,
  CanonicalJsonError,
  sha256Hex,
} from "../../src/contracts/canonical.js";
import { ContractValidationError } from "../../src/contracts/errors.js";
import { parseSourceState, validateSourceState } from "../../src/source/validate.js";

const state = {
  contract: "impactdiff.source-state",
  version: 1,
  source: {
    kind: "closed_fixture",
    fixture_id: "example-v1",
    revision: "example-v1.2.3",
    license: "Apache-2.0",
    entrypoint: "index.html",
    raw_manifest: {
      sha256: "1".repeat(64),
      byte_length: 512,
    },
    resources: [
      {
        path: "app.js",
        media_type: "text/javascript; charset=utf-8",
        sha256: "2".repeat(64),
        byte_length: 256,
        license: "Apache-2.0",
      },
      {
        path: "index.html",
        media_type: "text/html; charset=utf-8",
        sha256: "3".repeat(64),
        byte_length: 128,
        license: "Apache-2.0",
      },
    ],
  },
  initial_state: {
    kind: "fixture_default",
    route: "/",
    storage: "empty",
  },
} as const;

function expectIssue(value: unknown, code: string): void {
  assert.throws(
    () => validateSourceState(value),
    (error: unknown) => {
      assert.ok(error instanceof ContractValidationError);
      assert.ok(
        error.issues.some((candidate) => candidate.code === code),
        `expected ${code}, received ${error.issues.map((item) => item.code).join(", ")}`,
      );
      return true;
    },
  );
}

test("source-state provenance is closed, canonical, and immutable", async () => {
  const validated = validateSourceState(state);
  const bytes = Buffer.from(canonicalJson(state), "utf8");

  assert.deepEqual(validated, state);
  assert.notEqual(validated, state);
  assert.ok(Object.isFrozen(validated));
  assert.ok(Object.isFrozen(validated.source));
  assert.ok(Object.isFrozen(validated.source.resources));
  assert.deepEqual(parseSourceState(bytes), state);
  assert.deepEqual(await sourceStateCodec.canonicalize(bytes), bytes);
  assert.deepEqual(await sourceStateCodec.validate(bytes), state);

  const pretty = Buffer.from(JSON.stringify(state, null, 2), "utf8");
  await assert.rejects(
    async () => sourceStateCodec.canonicalize(pretty),
    (error: unknown) =>
      error instanceof CanonicalJsonError && error.code === "json.noncanonical",
  );
});

test("source packages reject ambiguous membership and unsafe paths", () => {
  expectIssue(
    {
      ...state,
      source: {
        ...state.source,
        resources: [...state.source.resources].reverse(),
      },
    },
    "source_state.resource_order",
  );
  expectIssue(
    {
      ...state,
      source: {
        ...state.source,
        resources: [state.source.resources[0], state.source.resources[0]],
      },
    },
    "source_state.duplicate_resource",
  );
  expectIssue(
    {
      ...state,
      source: {
        ...state.source,
        resources: [
          { ...state.source.resources[0], path: "app/../app.js" },
          state.source.resources[1],
        ],
      },
    },
    "source_state.resource_path",
  );
  expectIssue(
    { ...state, source: { ...state.source, entrypoint: "missing.html" } },
    "source_state.entrypoint_missing",
  );
  expectIssue(
    {
      ...state,
      initial_state: { ...state.initial_state, route: "/checkout/../admin" },
    },
    "source_state.initial_route",
  );
  expectIssue({ ...state, outcome: "success" }, "schema.additionalProperties");
  expectIssue(
    {
      ...state,
      source: {
        ...state.source,
        resources: [
          { ...state.source.resources[0], media_type: "text/javascript   " },
          state.source.resources[1],
        ],
      },
    },
    "schema.pattern",
  );
  expectIssue(
    {
      ...state,
      source: {
        ...state.source,
        resources: [
          {
            ...state.source.resources[0],
            media_type: "text/javascript; z=1; a=2",
          },
          state.source.resources[1],
        ],
      },
    },
    "source_state.media_type_parameter_order",
  );
});

test("raw fixture-manifest identity cannot be confused with canonical JSON", async () => {
  const raw = await readFile("fixtures/checkout-card-v1/fixture.json");
  const canonical = Buffer.from(
    canonicalJson(JSON.parse(raw.toString("utf8"))),
    "utf8",
  );

  assert.equal(raw.byteLength, 1_819);
  assert.equal(
    sha256Hex(raw),
    "3b8a3f79a15969e575e0d4ace4a98b7a89704840cb1b2a818c06e03e5cc4e9ea",
  );
  assert.equal(canonical.byteLength, 1_487);
  assert.equal(
    sha256Hex(canonical),
    "3b5a79464ba90162c9ebe62e7abc07c1fad503f22e6cad17cb4cc1d77726e3ad",
  );
  assert.notEqual(sha256Hex(raw), sha256Hex(canonical));
});
