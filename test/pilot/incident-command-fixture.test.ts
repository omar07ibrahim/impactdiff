import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import { parseActionPlan } from "../../src/capture/validate.js";
import {
  canonicalJson,
  computeSourceStateId,
  computeTaskId,
  sha256Hex,
} from "../../src/contracts/canonical.js";
import {
  loadPilotFixtureAuthoringPackage,
  loadPilotFixtureAuthoringSnapshot,
  pilotFixtureNotoSansSha256,
  pilotFixtureOflLicenseSha256,
} from "../../src/pilot/fixture/package.js";
import { parsePilotFixtureManifest } from "../../src/pilot/fixture/validate.js";
import { parseSourceState } from "../../src/source/validate.js";

const fixtureDirectory = resolve("fixtures/pilot-incident-command-v1");
const fixtureManifestPath = join(fixtureDirectory, "fixture.json");
const comparisonFixtureDirectories = Object.freeze([
  resolve("fixtures/pilot-market-basket-v1"),
  resolve("fixtures/checkout-card-v1"),
]);

const expectedContentSecurityPolicy =
  "default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'self'; form-action 'none'; frame-src 'none'; img-src 'self'; manifest-src 'none'; media-src 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'nonce-aW1wYWN0ZGlmZi1pbmNpZGVudC1jb21tYW5kLXYx'; webrtc 'block'; worker-src 'none'";

const expectedResourcePaths = Object.freeze([
  "app.js",
  "events/alerts.json",
  "fonts/noto-sans-latin-standard-normal.woff2",
  "fonts/ofl-1.1.txt",
  "glyphs/severity.svg",
  "index.html",
  "styles.css",
]);

const expectedActions = Object.freeze([
  Object.freeze({
    intent: "focus",
    pointer_source_point: null,
    target: "focus_entry",
    value: Object.freeze({ kind: "none" }),
  }),
  Object.freeze({
    intent: "press_key",
    pointer_source_point: null,
    target: null,
    value: Object.freeze({ key: "ArrowDown", kind: "key" }),
  }),
  Object.freeze({
    intent: "press_key",
    pointer_source_point: null,
    target: null,
    value: Object.freeze({ key: "Tab", kind: "key" }),
  }),
  Object.freeze({
    intent: "pointer_click",
    pointer_source_point: "source_primary_border_box_center",
    target: "primary",
    value: Object.freeze({ button: "primary", kind: "pointer" }),
  }),
]);

const expectedCheckpoints = Object.freeze([
  Object.freeze({ after_action_ordinal: -1, key: "initial_state" }),
  Object.freeze({ after_action_ordinal: 2, key: "pre_primary_action" }),
  Object.freeze({ after_action_ordinal: 3, key: "post_primary_action" }),
]);

const goldenSourceReference = Object.freeze({
  sha256: "d3286a6dd8bf12f5e11a9af2b97029694da2a0ec77e996a01a0a294aae4e9f23",
  byte_length: 1_739,
  media_type: "application/vnd.impactdiff.source-state+json",
  format_version: 1,
});

const goldenWorkflows = Object.freeze([
  Object.freeze({
    workflow_key: "acknowledge_alert",
    reference: Object.freeze({
      sha256: "15c1be30ee6bfe383875c6c04558b3d424b5ba5c83e93fe58189b37ca06db169",
      byte_length: 1_025,
      media_type: "application/vnd.impactdiff.action-plan+json",
      format_version: 1,
    }),
    task_id: "idtk1_f30e42e674b6429551d797fb11dad55cb0ddaec07d80ccc8dbba8c352d2542e2",
  }),
  Object.freeze({
    workflow_key: "assign_responder",
    reference: Object.freeze({
      sha256: "6a7684322dd8cbc2345989f00a3a30aa8b15a74b1f587a3c098c5648de739eed",
      byte_length: 1_025,
      media_type: "application/vnd.impactdiff.action-plan+json",
      format_version: 1,
    }),
    task_id: "idtk1_24cee5532e154c630c54aa376ff95fb8507179fb18c57dd2182ceb263743e747",
  }),
]);

interface IncidentCatalog {
  readonly contract: string;
  readonly version: number;
  readonly command: string;
  readonly alerts: readonly {
    readonly id: string;
    readonly label: string;
    readonly service: string;
    readonly severity: string;
    readonly age: string;
    readonly detail: string;
  }[];
  readonly responders: readonly {
    readonly id: string;
    readonly label: string;
    readonly rotation: string;
  }[];
}

interface FixtureManifestProjection {
  readonly resources: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
}

function assertStandaloneDefensiveBytes(read: () => Uint8Array): void {
  const first = read();
  const second = read();
  assert.equal(Buffer.isBuffer(first), false);
  assert.equal(first.byteOffset, 0);
  assert.equal(first.buffer.byteLength, first.byteLength);
  assert.equal(second.byteOffset, 0);
  assert.equal(second.buffer.byteLength, second.byteLength);
  assert.notEqual(first, second);
  assert.notEqual(first.buffer, second.buffer);
  assert.deepEqual(first, second);

  new Uint8Array(first.buffer).fill(0);
  const protectedBytes = read();
  assert.notEqual(protectedBytes.buffer, first.buffer);
  assert.deepEqual(protectedBytes, second);
}

function fiveTokenShingles(value: string): ReadonlySet<string> {
  const tokens = value.toLowerCase().match(/[a-z0-9_-]+|[^\s\w]/gu) ?? [];
  const shingles = new Set<string>();
  for (let index = 0; index + 5 <= tokens.length; index += 1) {
    shingles.add(tokens.slice(index, index + 5).join(" "));
  }
  return shingles;
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

test("Incident Command manifest is canonical and binds its frozen catalog slot", async () => {
  const rawManifest = await readFile(fixtureManifestPath);
  assert.equal(rawManifest.byteLength, 6_677);
  assert.equal(
    sha256Hex(rawManifest),
    "5455f0881475c4a9db92a364f7aea7e5dfe2ae670ff819b97b50a3c1f21ecce5",
  );
  assert.equal(rawManifest.at(-1), 0x0a);
  assert.notEqual(rawManifest.at(-2), 0x0a);
  assert.notEqual(rawManifest.at(-2), 0x0d);

  const canonicalManifestBytes = rawManifest.subarray(0, rawManifest.byteLength - 1);
  const manifest = parsePilotFixtureManifest(canonicalManifestBytes);
  assert.equal(canonicalManifestBytes.toString("utf8"), canonicalJson(manifest));
  assert.equal(manifest.application_key, "incident_command");
  assert.equal(manifest.fixture_key, "pilot-incident-command-v1");
  assert.equal(manifest.revision, "pilot-incident-command-v1.0.0-authoring.1");
  assert.equal(manifest.title, "Nightwatch Relay incident command");
  assert.equal(manifest.content_security_policy, expectedContentSecurityPolicy);
  assert.equal(manifest.mutation_policy.style_nonce, "impactdiff-incident-command-v1");
  assert.deepEqual(
    manifest.resources.map(({ path }) => path),
    expectedResourcePaths,
  );
  assert.deepEqual(
    manifest.workflows.map(({ workflow_key }) => workflow_key),
    ["acknowledge_alert", "assign_responder"],
  );
  for (const workflow of manifest.workflows) {
    assert.deepEqual(workflow.actions, expectedActions);
    assert.deepEqual(workflow.checkpoints, expectedCheckpoints);
    assert.equal(workflow.abi.setup.value, workflow.abi.focus_entry.value);
    assert.equal(workflow.expectations.pre_primary_focus, "primary");
    assert.equal(workflow.expectations.final.focus, "success");
  }
  assert.ok(Object.isFrozen(manifest));
  assert.ok(Object.isFrozen(manifest.resources));
  assert.ok(Object.isFrozen(manifest.workflows));
});

test("Incident Command package derives closed source and task identities", async () => {
  const first = await loadPilotFixtureAuthoringPackage(fixtureDirectory);
  const second = await loadPilotFixtureAuthoringPackage(fixtureDirectory);
  assert.equal(first.kind, "pilot_fixture_authoring_package");
  assert.equal(first.official, false);
  assert.deepEqual(Reflect.ownKeys(first), [
    "kind",
    "official",
    "manifest",
    "source_state",
    "source_state_id",
    "workflows",
  ]);
  for (const forbidden of [
    "capture_id",
    "operator_id",
    "outcome",
    "label",
    "sealed_record",
    "result",
  ]) {
    assert.equal(forbidden in first, false);
  }

  const sourceState = parseSourceState(first.source_state.bytes);
  assert.deepEqual(first.source_state.reference, goldenSourceReference);
  assert.equal(
    first.source_state.reference.sha256,
    sha256Hex(first.source_state.bytes),
  );
  assert.equal(
    first.source_state.reference.byte_length,
    first.source_state.bytes.byteLength,
  );
  assert.equal(first.source_state_id, computeSourceStateId(goldenSourceReference));
  assert.equal(
    first.source_state_id,
    "idss1_5de36eaaeb9774c8ff5d68f2e48ffa9eedc2b5043f480286197011a63dca49f6",
  );
  assert.equal(
    Buffer.from(first.source_state.bytes).toString("utf8"),
    canonicalJson(sourceState),
  );
  assert.deepEqual(sourceState.source.raw_manifest, {
    sha256: "5455f0881475c4a9db92a364f7aea7e5dfe2ae670ff819b97b50a3c1f21ecce5",
    byte_length: 6_677,
  });
  assert.deepEqual(
    sourceState.source.resources.map(({ path }) => path),
    expectedResourcePaths,
  );

  assert.deepEqual(
    first.workflows.map(({ workflow_key }) => workflow_key),
    goldenWorkflows.map(({ workflow_key }) => workflow_key),
  );
  for (const [index, workflow] of first.workflows.entries()) {
    const golden = goldenWorkflows[index];
    assert.ok(golden !== undefined);
    assert.deepEqual(workflow.action_plan.reference, golden.reference);
    assert.equal(workflow.task_id, golden.task_id);
    assert.equal(workflow.task_id, computeTaskId(golden.reference));
    assert.equal(
      workflow.action_plan.reference.sha256,
      sha256Hex(workflow.action_plan.bytes),
    );
    const actionPlan = parseActionPlan(workflow.action_plan.bytes);
    assert.deepEqual(
      actionPlan.actions.map(({ intent }) => intent),
      ["focus", "press_key", "press_key", "pointer_click"],
    );
    assert.deepEqual(
      actionPlan.checkpoints.map(({ after_action_ordinal }) => after_action_ordinal),
      [-1, 2, 3],
    );
    assertStandaloneDefensiveBytes(() => workflow.action_plan.bytes);
  }
  assertStandaloneDefensiveBytes(() => first.source_state.bytes);

  assert.notEqual(first, second);
  assert.notEqual(first.manifest, second.manifest);
  assert.deepEqual(first.manifest, second.manifest);
  assert.deepEqual(first.source_state.reference, second.source_state.reference);
  assert.deepEqual(first.workflows, second.workflows);
});

test("Incident Command resource snapshot is exact and defensively copied", async () => {
  const snapshot = await loadPilotFixtureAuthoringSnapshot(fixtureDirectory);
  assert.deepEqual(snapshot.resources.paths, expectedResourcePaths);
  assert.equal("resources" in snapshot.authoring_package, false);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.resources));
  assert.ok(Object.isFrozen(snapshot.resources.paths));

  for (const resource of snapshot.authoring_package.manifest.resources) {
    const first = snapshot.resources.read(resource.path);
    const second = snapshot.resources.read(resource.path);
    assert.ok(first !== undefined && second !== undefined);
    assert.notEqual(first, second);
    assert.deepEqual(first, await readFile(join(fixtureDirectory, resource.path)));
    first[0] = first[0] === 0 ? 1 : 0;
    assert.deepEqual(snapshot.resources.read(resource.path), second);
  }
  assert.equal(snapshot.resources.read("fixture.json"), undefined);
  assert.equal(snapshot.resources.read("unlisted.txt"), undefined);
});

test("Incident Command data, application logic, and independent bytes stay closed", async () => {
  const fixturePackage = await loadPilotFixtureAuthoringPackage(fixtureDirectory);
  const manifest = fixturePackage.manifest;
  const html = await readFile(join(fixtureDirectory, "index.html"), "utf8");
  const application = await readFile(join(fixtureDirectory, "app.js"), "utf8");
  const catalog = JSON.parse(
    await readFile(join(fixtureDirectory, "events/alerts.json"), "utf8"),
  ) as IncidentCatalog;

  assert.equal(catalog.contract, "impactdiff.synthetic-incident-catalog");
  assert.equal(catalog.version, 1);
  assert.equal(catalog.command, "Nightwatch Relay");
  assert.equal(catalog.alerts.length, 3);
  assert.equal(catalog.responders.length, 2);
  for (const alert of catalog.alerts) {
    assert.ok(html.includes(alert.label));
    assert.ok(html.includes(alert.service));
    assert.ok(html.includes(alert.age));
  }
  for (const responder of catalog.responders) {
    assert.ok(html.includes(responder.label));
    assert.ok(html.includes(responder.rotation));
    assert.ok(application.includes(`"${responder.id}"`));
  }

  const acknowledgeWorkflow = manifest.workflows[0];
  const responderWorkflow = manifest.workflows[1];
  const selectedAlert = catalog.alerts[1];
  const selectedResponder = catalog.responders[1];
  assert.ok(
    acknowledgeWorkflow !== undefined &&
      responderWorkflow !== undefined &&
      selectedAlert !== undefined &&
      selectedResponder !== undefined,
  );
  assert.equal(
    acknowledgeWorkflow.expectations.setup_attribute.selected,
    selectedAlert.id,
  );
  assert.equal(
    acknowledgeWorkflow.expectations.final.root_attribute.value,
    `${selectedAlert.id}-acknowledged`,
  );
  assert.equal(
    acknowledgeWorkflow.expectations.final.success_text,
    `${selectedAlert.label} acknowledged for ${selectedAlert.service}.`,
  );
  assert.equal(
    responderWorkflow.expectations.setup_attribute.selected,
    selectedResponder.id,
  );
  assert.equal(
    responderWorkflow.expectations.final.root_attribute.value,
    `${selectedResponder.id}-assigned`,
  );
  assert.equal(
    responderWorkflow.expectations.final.success_text,
    `${selectedResponder.label} assigned from ${selectedResponder.rotation}.`,
  );
  assert.ok(application.includes(`const revision = "${manifest.revision}";`));
  assert.ok(
    application.includes('Object.defineProperty(window, "__impactdiffFixtureV1"'),
  );
  assert.ok(html.includes('data-alert-state="idle"'));
  assert.ok(html.includes('data-responder-state="idle"'));

  for (const forbidden of [
    "fetch(",
    "XMLHttpRequest",
    "localStorage",
    "sessionStorage",
    "Math.random",
    "setTimeout",
    "setInterval",
    "Date.now",
  ]) {
    assert.equal(application.includes(forbidden), false, forbidden);
  }

  const comparisonDigests = new Set<string>();
  for (const directory of comparisonFixtureDirectories) {
    const comparison = JSON.parse(
      await readFile(join(directory, "fixture.json"), "utf8"),
    ) as FixtureManifestProjection;
    for (const resource of comparison.resources) {
      comparisonDigests.add(resource.sha256);
      assert.equal(
        sha256Hex(await readFile(join(directory, resource.path))),
        resource.sha256,
      );
    }
  }
  const sharedDigests = manifest.resources
    .map(({ sha256 }) => sha256)
    .filter((sha256) => comparisonDigests.has(sha256))
    .sort();
  assert.deepEqual(
    sharedDigests,
    [pilotFixtureNotoSansSha256, pilotFixtureOflLicenseSha256].sort(),
  );

  const sourceFiles = ["index.html", "styles.css", "app.js"] as const;
  for (const directory of comparisonFixtureDirectories) {
    const incidentAggregate = new Set<string>();
    const comparisonAggregate = new Set<string>();
    for (const path of sourceFiles) {
      const incidentShingles = fiveTokenShingles(
        await readFile(join(fixtureDirectory, path), "utf8"),
      );
      const comparisonShingles = fiveTokenShingles(
        await readFile(join(directory, path), "utf8"),
      );
      assert.ok(jaccard(incidentShingles, comparisonShingles) < 0.7);
      for (const shingle of incidentShingles) {
        incidentAggregate.add(`${path}:${shingle}`);
      }
      for (const shingle of comparisonShingles) {
        comparisonAggregate.add(`${path}:${shingle}`);
      }
    }
    assert.ok(jaccard(incidentAggregate, comparisonAggregate) < 0.55);
  }
});
