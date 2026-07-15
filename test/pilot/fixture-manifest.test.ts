import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  pilotV01ApplicationCatalogId,
  pilotV01ProtocolId,
} from "../../src/benchmark/index.js";
import { CanonicalJsonError, canonicalJson } from "../../src/contracts/canonical.js";
import { ContractValidationError } from "../../src/contracts/errors.js";
import { pilotMutationLocalPredicateKeys } from "../../src/mutations/catalog/index.js";
import type { PilotFixtureManifest } from "../../src/pilot/fixture/schema.js";
import {
  parsePilotFixtureManifest,
  validatePilotFixtureManifest,
} from "../../src/pilot/fixture/validate.js";

type DeepMutable<Value> = Value extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: DeepMutable<Value[Key]> }
    : Value;

const manifestPath = resolve("fixtures/pilot-market-basket-v1/fixture.json");
const expectedContentSecurityPolicy =
  "default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'self'; form-action 'none'; frame-src 'none'; img-src 'self'; manifest-src 'none'; media-src 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'nonce-aW1wYWN0ZGlmZi1tYXJrZXQtYmFza2V0LXYx'; webrtc 'block'; worker-src 'none'";
const rawManifestBytes = await readFile(manifestPath);
assert.equal(rawManifestBytes.at(-1), 0x0a, "fixture manifest must end in one LF");
assert.notEqual(
  rawManifestBytes.at(-2),
  0x0a,
  "fixture manifest cannot end in more than one LF",
);
assert.notEqual(
  rawManifestBytes.at(-2),
  0x0d,
  "fixture manifest must use LF rather than CRLF",
);
const canonicalManifestBytes = rawManifestBytes.subarray(
  0,
  rawManifestBytes.byteLength - 1,
);
const manifest = parsePilotFixtureManifest(canonicalManifestBytes);

const expectedActions = [
  {
    intent: "focus",
    pointer_source_point: null,
    target: "focus_entry",
    value: { kind: "none" },
  },
  {
    intent: "press_key",
    pointer_source_point: null,
    target: null,
    value: { key: "ArrowDown", kind: "key" },
  },
  {
    intent: "press_key",
    pointer_source_point: null,
    target: null,
    value: { key: "Tab", kind: "key" },
  },
  {
    intent: "pointer_click",
    pointer_source_point: "source_primary_border_box_center",
    target: "primary",
    value: { button: "primary", kind: "pointer" },
  },
] as const;

const expectedCheckpoints = [
  { after_action_ordinal: -1, key: "initial_state" },
  { after_action_ordinal: 2, key: "pre_primary_action" },
  { after_action_ordinal: 3, key: "post_primary_action" },
] as const;

function mutableManifest(): DeepMutable<PilotFixtureManifest> {
  return structuredClone(manifest) as DeepMutable<PilotFixtureManifest>;
}

function expectIssue(value: unknown, expectedCode: string): void {
  assert.throws(
    () => validatePilotFixtureManifest(value),
    (error: unknown) => {
      assert.ok(error instanceof ContractValidationError);
      assert.ok(
        error.issues.some((candidate) => candidate.code === expectedCode),
        `expected ${expectedCode}, received ${error.issues
          .map((candidate) => candidate.code)
          .join(", ")}`,
      );
      return true;
    },
  );
}

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

test("the canonical market-basket manifest binds the exact Pilot authoring slice", () => {
  assert.equal(canonicalManifestBytes.toString("utf8"), canonicalJson(manifest));
  assert.equal(manifest.protocol_id, pilotV01ProtocolId);
  assert.equal(manifest.application_catalog_id, pilotV01ApplicationCatalogId);
  assert.equal(manifest.application_key, "market_basket");
  assert.equal(manifest.fixture_key, "pilot-market-basket-v1");
  assert.equal(manifest.revision, "pilot-market-basket-v1.0.0-authoring.2");
  assert.equal(manifest.content_security_policy, expectedContentSecurityPolicy);
  assert.deepEqual(
    manifest.workflows.map((workflow) => workflow.workflow_key),
    ["add_bundle", "choose_pickup"],
  );
  for (const workflow of manifest.workflows) {
    assert.deepEqual(workflow.actions, expectedActions);
    assert.deepEqual(workflow.checkpoints, expectedCheckpoints);
    assert.deepEqual(workflow.predicate_keys, pilotMutationLocalPredicateKeys);
  }
  assert.deepEqual(manifest.workflows[0]?.expectations, {
    final: {
      focus: "success",
      root_attribute: {
        name: "data-bundle-state",
        value: "harbor-picnic-added",
      },
      success_text: "Harbor Picnic bundle added, 3 pieces.",
    },
    pre_primary_focus: "primary",
    setup_attribute: {
      initial: "dawn-pantry",
      name: "value",
      selected: "harbor-picnic",
    },
  });
  assert.deepEqual(manifest.workflows[1]?.expectations, {
    final: {
      focus: "success",
      root_attribute: {
        name: "data-pickup-state",
        value: "river-steps-set",
      },
      success_text: "Pickup set to River Steps, Saturday 10 AM to noon.",
    },
    pre_primary_focus: "primary",
    setup_attribute: {
      initial: "north-arcade",
      name: "value",
      selected: "river-steps",
    },
  });
  assertDeepFrozen(manifest);
  assertDeepFrozen(validatePilotFixtureManifest(structuredClone(manifest)));
});

test("manifest parsing requires duplicate-free RFC 8785 bytes", () => {
  assert.throws(
    () => parsePilotFixtureManifest(rawManifestBytes),
    (error: unknown) =>
      error instanceof CanonicalJsonError && error.code === "json.noncanonical",
  );
  assert.throws(
    () => parsePilotFixtureManifest(JSON.stringify(manifest, null, 2)),
    (error: unknown) =>
      error instanceof CanonicalJsonError && error.code === "json.noncanonical",
  );
  const duplicateContract = `{"contract":"impactdiff.pilot-fixture-manifest",${canonicalManifestBytes
    .toString("utf8")
    .slice(1)}`;
  assert.throws(
    () => parsePilotFixtureManifest(duplicateContract),
    (error: unknown) =>
      error instanceof CanonicalJsonError && error.code === "json.duplicate_key",
  );
});

test("manifest root rejects missing, extra, outcome, identity, and reference fields", () => {
  const missing = mutableManifest();
  delete (missing as Partial<typeof missing>).title;
  expectIssue(missing, "schema.required");

  for (const [field, value] of [
    ["extra", true],
    ["outcome", { task_success: true }],
    ["source_state_id", `idss1_${"0".repeat(64)}`],
    ["task_id", `idtk1_${"0".repeat(64)}`],
    ["workflow_id", `idwf1_${"0".repeat(64)}`],
    ["application_group_id", `idag1_${"0".repeat(64)}`],
    ["action_plan", { sha256: "0".repeat(64) }],
  ] as const) {
    const injected = mutableManifest() as DeepMutable<PilotFixtureManifest> &
      Record<string, unknown>;
    injected[field] = value;
    expectIssue(injected, "schema.additionalProperties");
  }
});

test("manifest identities and catalog order are exact authoring bindings", () => {
  const finalRevision = mutableManifest();
  finalRevision.revision = "pilot-market-basket-v1.0.0";
  expectIssue(finalRevision, "pilot_fixture.authoring_revision");

  const protocol = mutableManifest();
  protocol.protocol_id = `idpp1_${"0".repeat(64)}`;
  expectIssue(protocol, "pilot_fixture.protocol_binding");

  const catalog = mutableManifest();
  catalog.application_catalog_id = `idpc1_${"0".repeat(64)}`;
  expectIssue(catalog, "pilot_fixture.application_catalog_binding");

  const fixture = mutableManifest();
  fixture.fixture_key = "pilot-market-basket-v2";
  expectIssue(fixture, "pilot_fixture.fixture_catalog");

  const workflowOrder = mutableManifest();
  workflowOrder.workflows.reverse();
  expectIssue(workflowOrder, "pilot_fixture.workflow_catalog");
});

test("resource membership is safe, complete, unique, and strictly ordered", () => {
  const traversal = mutableManifest();
  traversal.resources[1]!.path = "art/../woven-tag.svg";
  expectIssue(traversal, "pilot_fixture.resource_path");

  const duplicate = mutableManifest();
  duplicate.resources.splice(1, 0, structuredClone(duplicate.resources[0]!));
  expectIssue(duplicate, "pilot_fixture.resource_duplicate");

  const reordered = mutableManifest();
  [reordered.resources[0], reordered.resources[1]] = [
    reordered.resources[1]!,
    reordered.resources[0]!,
  ];
  expectIssue(reordered, "pilot_fixture.resource_order");

  const entrypoint = mutableManifest();
  entrypoint.entrypoint = "missing.html";
  expectIssue(entrypoint, "pilot_fixture.entrypoint_missing");

  const font = mutableManifest();
  font.resources = font.resources.filter(
    (resource) => resource.path !== font.font.path,
  );
  expectIssue(font, "pilot_fixture.font_resource");

  const license = mutableManifest();
  license.resources = license.resources.filter(
    (resource) => resource.path !== license.font.license_path,
  );
  expectIssue(license, "pilot_fixture.font_license_resource");
});

test("CSP, environment, and readiness are exact", () => {
  const missingWebRtc = mutableManifest();
  missingWebRtc.content_security_policy = missingWebRtc.content_security_policy.replace(
    "; webrtc 'block'",
    "",
  );
  expectIssue(missingWebRtc, "pilot_fixture.content_security_policy");

  const csp = mutableManifest();
  csp.content_security_policy += "; connect-src 'self'";
  expectIssue(csp, "pilot_fixture.content_security_policy");

  const environment = mutableManifest();
  environment.environment.viewport.width = 801;
  expectIssue(environment, "pilot_fixture.environment");

  const readiness = mutableManifest();
  readiness.readiness.pending_requests = 1;
  expectIssue(readiness, "pilot_fixture.readiness");
});

test("workflow ABI permits only its declared setup alias and shared root", () => {
  const alias = mutableManifest();
  alias.workflows[0]!.abi.focus_entry.value = "bundle-weave-focus";
  expectIssue(alias, "pilot_fixture.focus_entry_alias");

  const withinWorkflowCollision = mutableManifest();
  withinWorkflowCollision.workflows[0]!.abi.primary.value =
    withinWorkflowCollision.workflows[0]!.abi.setup.value;
  expectIssue(withinWorkflowCollision, "pilot_fixture.abi_distinctness");

  const crossWorkflowCollision = mutableManifest();
  crossWorkflowCollision.workflows[1]!.abi.primary.value =
    crossWorkflowCollision.workflows[0]!.abi.primary.value;
  expectIssue(crossWorkflowCollision, "pilot_fixture.cross_workflow_abi");

  const separateRoots = mutableManifest();
  separateRoots.workflows[1]!.abi.root.value = "second-market-root";
  expectIssue(separateRoots, "pilot_fixture.shared_root");
});

test("workflow actions, checkpoints, predicates, and expectations are closed", () => {
  const actions = mutableManifest();
  const firstKey = actions.workflows[0]!.actions[1];
  assert.equal(firstKey?.intent, "press_key");
  if (firstKey?.intent === "press_key") {
    firstKey.value.key = "Tab";
  }
  expectIssue(actions, "pilot_fixture.action_recipe");

  const checkpoints = mutableManifest();
  checkpoints.workflows[0]!.checkpoints[1]!.after_action_ordinal = 1;
  expectIssue(checkpoints, "pilot_fixture.checkpoint_schedule");

  const predicates = mutableManifest();
  predicates.workflows[0]!.predicate_keys.reverse();
  expectIssue(predicates, "schema.const");

  const setup = mutableManifest();
  setup.workflows[0]!.expectations.setup_attribute.selected =
    setup.workflows[0]!.expectations.setup_attribute.initial;
  expectIssue(setup, "pilot_fixture.setup_expectation");

  const prePrimary = mutableManifest();
  prePrimary.workflows[0]!.expectations.pre_primary_focus = "success";
  expectIssue(prePrimary, "pilot_fixture.pre_primary_focus");

  const finalFocus = mutableManifest();
  finalFocus.workflows[0]!.expectations.final.focus = "primary";
  expectIssue(finalFocus, "pilot_fixture.final_focus");
});
