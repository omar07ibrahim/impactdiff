import assert from "node:assert/strict";
import {
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
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
  PilotFixtureAuthoringError,
  pilotFixtureNotoSansSha256,
  pilotFixtureOflLicenseSha256,
} from "../../src/pilot/index.js";
import { parseSourceState } from "../../src/source/validate.js";

const fixtureDirectory = resolve("fixtures/pilot-market-basket-v1");
const checkoutFixtureDirectory = resolve("fixtures/checkout-card-v1");

const expectedContentSecurityPolicy =
  "default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'self'; form-action 'none'; frame-src 'none'; img-src 'self'; manifest-src 'none'; media-src 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'nonce-aW1wYWN0ZGlmZi1tYXJrZXQtYmFza2V0LXYx'; worker-src 'none'";

const expectedResourcePaths = Object.freeze([
  "app.js",
  "art/woven-tag.svg",
  "catalog/items.json",
  "fonts/noto-sans-latin-standard-normal.woff2",
  "fonts/ofl-1.1.txt",
  "index.html",
  "styles.css",
]);

const goldenSourceReference = Object.freeze({
  sha256: "91227eb12582617d885acb37ec05a4cdb791650393ac0c7010b5b6e5107d422a",
  byte_length: 1_731,
  media_type: "application/vnd.impactdiff.source-state+json",
  format_version: 1,
});

const goldenWorkflows = Object.freeze([
  Object.freeze({
    workflow_key: "add_bundle",
    reference: Object.freeze({
      sha256: "619153122740419f8fae9ea4ac1648bd8412ff8c7ecd379da76d1a9d29a6655e",
      byte_length: 1_025,
      media_type: "application/vnd.impactdiff.action-plan+json",
      format_version: 1,
    }),
    task_id: "idtk1_97e8143bb0ec2b7f326cfe02793182f25110f7834b05dcae29eba2f066bf61a2",
  }),
  Object.freeze({
    workflow_key: "choose_pickup",
    reference: Object.freeze({
      sha256: "9707420d01a113ead998a5b41508f91d5fb348b63d0a27aed44892623015b3ee",
      byte_length: 1_025,
      media_type: "application/vnd.impactdiff.action-plan+json",
      format_version: 1,
    }),
    task_id: "idtk1_36fa89ee2d7f696299242821dcb214c3b7b1577944b63ae12098dd2c41d72b8a",
  }),
]);

interface MarketCatalog {
  readonly contract: string;
  readonly version: number;
  readonly market: string;
  readonly bundles: readonly {
    readonly id: string;
    readonly label: string;
    readonly pieces: number;
    readonly items: readonly string[];
  }[];
  readonly pickup_points: readonly {
    readonly id: string;
    readonly label: string;
    readonly window: string;
  }[];
  readonly featured_pieces: readonly {
    readonly id: string;
    readonly label: string;
    readonly note: string;
  }[];
}

interface CheckoutManifest {
  readonly resources: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
}

const expectedCatalog = {
  contract: "impactdiff.synthetic-market-catalog",
  version: 1,
  market: "Thread & Tally",
  bundles: [
    {
      id: "dawn-pantry",
      label: "Dawn Pantry",
      pieces: 3,
      items: ["Linen wrap", "Herb tin", "Seeded rye round"],
    },
    {
      id: "harbor-picnic",
      label: "Harbor Picnic",
      pieces: 3,
      items: ["Harbor cloth", "Blue herb tin", "Seeded rye round"],
    },
  ],
  pickup_points: [
    {
      id: "north-arcade",
      label: "North Arcade",
      window: "Friday 4 PM to 6 PM",
    },
    {
      id: "river-steps",
      label: "River Steps",
      window: "Saturday 10 AM to noon",
    },
  ],
  featured_pieces: [
    {
      id: "harbor-cloth",
      label: "Harbor cloth",
      note: "Indigo cotton with a saffron selvedge.",
    },
    {
      id: "blue-herb-tin",
      label: "Blue herb tin",
      note: "Juniper, mint, and dried lemon.",
    },
    {
      id: "seeded-rye-round",
      label: "Seeded rye round",
      note: "Cut for a shared picnic.",
    },
  ],
} as const satisfies MarketCatalog;

async function expectAuthoringError(
  action: Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof PilotFixtureAuthoringError);
    assert.equal(error.code, code);
    return true;
  });
}

async function withFixtureCopy(
  discriminator: string,
  action: (fixtureRoot: string, temporaryRoot: string) => Promise<void>,
): Promise<void> {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), `impactdiff-pilot-${discriminator}-`),
  );
  const fixtureRoot = join(temporaryRoot, "fixture");
  try {
    await cp(fixtureDirectory, fixtureRoot, { recursive: true });
    await action(fixtureRoot, temporaryRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function normalizedOptionText(value: string): string {
  return value.replaceAll(/\s+/gu, " ").trim();
}

function selectBody(html: string, testId: string): string {
  const match = new RegExp(
    `<select[^>]*data-testid="${testId}"[^>]*>([\\s\\S]*?)</select>`,
    "u",
  ).exec(html);
  const body = match?.[1];
  assert.ok(body !== undefined, `missing ${testId} select`);
  return body;
}

function bundleOptions(html: string) {
  const result: {
    readonly id: string;
    readonly label: string;
    readonly pieces: number;
  }[] = [];
  for (const match of selectBody(html, "bundle-weave").matchAll(
    /<option value="([^"]+)" data-pieces="([0-9]+)">([\s\S]*?)<\/option>/gu,
  )) {
    const id = match[1];
    const pieces = match[2];
    const label = match[3];
    assert.ok(id !== undefined && pieces !== undefined && label !== undefined);
    result.push({ id, label: normalizedOptionText(label), pieces: Number(pieces) });
  }
  return result;
}

function pickupOptions(html: string) {
  const result: {
    readonly id: string;
    readonly label: string;
    readonly window: string;
  }[] = [];
  for (const match of selectBody(html, "pickup-point").matchAll(
    /<option value="([^"]+)" data-window="([^"]+)">([\s\S]*?)<\/option>/gu,
  )) {
    const id = match[1];
    const window = match[2];
    const label = match[3];
    assert.ok(id !== undefined && window !== undefined && label !== undefined);
    result.push({ id, label: normalizedOptionText(label), window });
  }
  return result;
}

function applicationBundleChoices(app: string) {
  const result: {
    readonly id: string;
    readonly label: string;
    readonly pieces: number;
  }[] = [];
  for (const match of app.matchAll(
    /"([^"]+)": Object\.freeze\(\{ label: "([^"]+)", pieces: ([0-9]+) \}\)/gu,
  )) {
    const id = match[1];
    const label = match[2];
    const pieces = match[3];
    assert.ok(id !== undefined && label !== undefined && pieces !== undefined);
    result.push({ id, label, pieces: Number(pieces) });
  }
  return result;
}

function applicationPickupChoices(app: string) {
  const result: {
    readonly id: string;
    readonly label: string;
    readonly window: string;
  }[] = [];
  for (const match of app.matchAll(
    /"([^"]+)": Object\.freeze\(\{\s*label: "([^"]+)",\s*window: "([^"]+)",\s*\}\)/gu,
  )) {
    const id = match[1];
    const label = match[2];
    const window = match[3];
    assert.ok(id !== undefined && label !== undefined && window !== undefined);
    result.push({ id, label, window });
  }
  return result;
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

test("authoring package emits only frozen, non-official source and task artifacts", async () => {
  const first = await loadPilotFixtureAuthoringPackage(fixtureDirectory);
  const second = await loadPilotFixtureAuthoringPackage(fixtureDirectory);

  assert.deepEqual(Reflect.ownKeys(first), [
    "kind",
    "official",
    "manifest",
    "source_state",
    "source_state_id",
    "workflows",
  ]);
  assert.equal(first.kind, "pilot_fixture_authoring_package");
  assert.equal(first.official, false);
  for (const forbidden of [
    "operator_id",
    "capture_id",
    "outcome",
    "task_success",
    "label",
    "labels",
    "sealed_record",
    "result",
  ]) {
    assert.equal(forbidden in first, false, `unexpected output surface ${forbidden}`);
  }
  assert.deepEqual(Reflect.ownKeys(first.source_state), ["reference", "bytes"]);
  assert.deepEqual(
    first.workflows.map((workflow) => Reflect.ownKeys(workflow)),
    [
      ["workflow_key", "action_plan", "task_id"],
      ["workflow_key", "action_plan", "task_id"],
    ],
  );
  for (const workflow of first.workflows) {
    assert.deepEqual(Reflect.ownKeys(workflow.action_plan), ["reference", "bytes"]);
  }

  const rawManifest = await readFile(join(fixtureDirectory, "fixture.json"));
  assert.equal(rawManifest.byteLength, 6_505);
  assert.equal(
    sha256Hex(rawManifest),
    "0d21e7336b74512b26a0d129d71834ae6a84c3953022c15d13ad33b1a0153391",
  );

  const sourceState = parseSourceState(first.source_state.bytes);
  assert.equal(
    Buffer.from(first.source_state.bytes).toString("utf8"),
    canonicalJson(sourceState),
  );
  assert.deepEqual(sourceState.source.raw_manifest, {
    sha256: sha256Hex(rawManifest),
    byte_length: rawManifest.byteLength,
  });
  assert.deepEqual(
    sourceState.source.resources.map(({ path }) => path),
    expectedResourcePaths,
  );
  assert.deepEqual(sourceState.source.resources, first.manifest.resources);
  assert.equal(sourceState.source.resources.length, 7);
  assert.deepEqual(first.source_state.reference, goldenSourceReference);
  assert.equal(
    first.source_state.reference.sha256,
    sha256Hex(first.source_state.bytes),
  );
  assert.equal(
    first.source_state.reference.byte_length,
    first.source_state.bytes.byteLength,
  );
  assert.equal(
    first.source_state_id,
    computeSourceStateId(first.source_state.reference),
  );
  assert.equal(
    first.source_state_id,
    "idss1_d8f296f4762166cb2dc13e9dbde4c755ba1a42eb37415757efee87379b6cd697",
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
    assert.equal(workflow.task_id, computeTaskId(workflow.action_plan.reference));
    assert.equal(
      workflow.action_plan.reference.sha256,
      sha256Hex(workflow.action_plan.bytes),
    );
    const plan = parseActionPlan(workflow.action_plan.bytes);
    assert.deepEqual(
      plan.actions.map(({ intent }) => intent),
      ["focus", "press_key", "press_key", "pointer_click"],
    );
    assert.deepEqual(
      plan.actions.map(({ target_id }) => target_id === null),
      [false, true, true, false],
    );
    assert.deepEqual(plan.checkpoints, [
      { ordinal: 0, after_action_ordinal: -1 },
      { ordinal: 1, after_action_ordinal: 2 },
      { ordinal: 2, after_action_ordinal: 3 },
    ]);
  }

  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.manifest));
  assert.ok(Object.isFrozen(first.manifest.resources));
  assert.ok(Object.isFrozen(first.manifest.workflows));
  assert.ok(Object.isFrozen(first.manifest.workflows[0]?.abi.primary));
  assert.ok(Object.isFrozen(first.source_state));
  assert.ok(Object.isFrozen(first.source_state.reference));
  assert.ok(Object.isFrozen(first.workflows));
  assert.ok(first.workflows.every(Object.isFrozen));
  assert.ok(first.workflows.every(({ action_plan }) => Object.isFrozen(action_plan)));

  assert.notEqual(first, second);
  assert.notEqual(first.manifest, second.manifest);
  assert.deepEqual(first.manifest, second.manifest);
  assert.deepEqual(first.source_state.reference, second.source_state.reference);
  assert.deepEqual(first.workflows, second.workflows);

  const pristineSourceBytes = first.source_state.bytes;
  const mutableSourceBytes = first.source_state.bytes;
  assert.notEqual(pristineSourceBytes, mutableSourceBytes);
  mutableSourceBytes[0] = 0;
  assert.deepEqual(first.source_state.bytes, pristineSourceBytes);

  const firstWorkflow = first.workflows[0];
  assert.ok(firstWorkflow !== undefined);
  const pristineActionBytes = firstWorkflow.action_plan.bytes;
  const mutableActionBytes = firstWorkflow.action_plan.bytes;
  assert.notEqual(pristineActionBytes, mutableActionBytes);
  mutableActionBytes[0] = 0;
  assert.deepEqual(firstWorkflow.action_plan.bytes, pristineActionBytes);
});

test("market source, catalog, CSP, shared bytes, and near-duplicate budget stay closed", async () => {
  const fixturePackage = await loadPilotFixtureAuthoringPackage(fixtureDirectory);
  const manifest = fixturePackage.manifest;
  const html = await readFile(join(fixtureDirectory, "index.html"), "utf8");
  const app = await readFile(join(fixtureDirectory, "app.js"), "utf8");
  const catalog = JSON.parse(
    await readFile(join(fixtureDirectory, "catalog/items.json"), "utf8"),
  ) as MarketCatalog;

  assert.deepEqual(catalog, expectedCatalog);
  assert.deepEqual(
    bundleOptions(html),
    catalog.bundles.map(({ id, label, pieces }) => ({ id, label, pieces })),
  );
  assert.deepEqual(pickupOptions(html), catalog.pickup_points);
  assert.deepEqual(
    applicationBundleChoices(app),
    catalog.bundles.map(({ id, label, pieces }) => ({ id, label, pieces })),
  );
  assert.deepEqual(applicationPickupChoices(app), catalog.pickup_points);
  for (const piece of catalog.featured_pieces) {
    assert.ok(html.includes(piece.label));
    assert.ok(html.includes(piece.note));
  }
  assert.ok(html.includes('data-bundle-state="idle"'));
  assert.ok(html.includes('data-pickup-state="idle"'));
  assert.ok(html.includes("Bundle line is ready."));
  assert.ok(html.includes("Pickup line is ready."));

  const addWorkflow = manifest.workflows[0];
  const pickupWorkflow = manifest.workflows[1];
  const selectedBundle = catalog.bundles[1];
  const selectedPickup = catalog.pickup_points[1];
  assert.ok(
    addWorkflow !== undefined &&
      pickupWorkflow !== undefined &&
      selectedBundle !== undefined &&
      selectedPickup !== undefined,
  );
  assert.equal(
    addWorkflow.expectations.setup_attribute.initial,
    catalog.bundles[0]?.id,
  );
  assert.equal(addWorkflow.expectations.setup_attribute.selected, selectedBundle.id);
  assert.equal(
    addWorkflow.expectations.final.root_attribute.value,
    `${selectedBundle.id}-added`,
  );
  assert.equal(
    addWorkflow.expectations.final.success_text,
    `${selectedBundle.label} bundle added, ${selectedBundle.pieces} pieces.`,
  );
  assert.equal(
    pickupWorkflow.expectations.setup_attribute.initial,
    catalog.pickup_points[0]?.id,
  );
  assert.equal(pickupWorkflow.expectations.setup_attribute.selected, selectedPickup.id);
  assert.equal(
    pickupWorkflow.expectations.final.root_attribute.value,
    `${selectedPickup.id}-set`,
  );
  assert.equal(
    pickupWorkflow.expectations.final.success_text,
    `Pickup set to ${selectedPickup.label}, ${selectedPickup.window}.`,
  );
  assert.ok(
    app.includes(
      "bundleStatus.textContent = `${choice.label} bundle added, ${choice.pieces} pieces.`;",
    ),
  );
  assert.ok(
    app.includes(
      "pickupStatus.textContent = `Pickup set to ${choice.label}, ${choice.window}.`;",
    ),
  );

  const cspMatch =
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*\/>/u.exec(
      html,
    );
  assert.equal(cspMatch?.[1], expectedContentSecurityPolicy);
  assert.equal(manifest.content_security_policy, expectedContentSecurityPolicy);
  assert.equal(manifest.mutation_policy.style_nonce, "impactdiff-market-basket-v1");
  assert.deepEqual(manifest.readiness, {
    global: "__impactdiffFixtureV1",
    ready: true,
    pending_requests: 0,
  });
  assert.equal(manifest.revision, "pilot-market-basket-v1.0.0-authoring.1");
  assert.ok(app.includes(`const revision = "${manifest.revision}";`));
  assert.ok(app.includes('Object.defineProperty(window, "__impactdiffFixtureV1"'));
  assert.ok(app.includes("ready: true"));
  assert.ok(app.includes("pendingRequests: 0"));
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
    assert.equal(
      app.includes(forbidden),
      false,
      `forbidden source primitive ${forbidden}`,
    );
  }

  const checkoutManifest = JSON.parse(
    await readFile(join(checkoutFixtureDirectory, "fixture.json"), "utf8"),
  ) as CheckoutManifest;
  for (const resource of checkoutManifest.resources) {
    assert.equal(
      sha256Hex(await readFile(join(checkoutFixtureDirectory, resource.path))),
      resource.sha256,
    );
  }
  const checkoutDigests = new Set(
    checkoutManifest.resources.map(({ sha256 }) => sha256),
  );
  const sharedDigests = manifest.resources
    .map(({ sha256 }) => sha256)
    .filter((sha256) => checkoutDigests.has(sha256))
    .sort();
  assert.deepEqual(
    sharedDigests,
    [pilotFixtureNotoSansSha256, pilotFixtureOflLicenseSha256].sort(),
  );

  const applicationOwnedBytes = manifest.resources
    .filter(
      ({ path }) => path !== manifest.font.path && path !== manifest.font.license_path,
    )
    .reduce((total, { byte_length: byteLength }) => total + byteLength, 0);
  assert.equal(applicationOwnedBytes, 18_300);
  assert.ok(applicationOwnedBytes <= 512 * 1_024);

  const sourceFiles = ["index.html", "styles.css", "app.js"] as const;
  const pilotAggregate = new Set<string>();
  const checkoutAggregate = new Set<string>();
  for (const path of sourceFiles) {
    const pilotShingles = fiveTokenShingles(
      await readFile(join(fixtureDirectory, path), "utf8"),
    );
    const checkoutShingles = fiveTokenShingles(
      await readFile(join(checkoutFixtureDirectory, path), "utf8"),
    );
    const score = jaccard(pilotShingles, checkoutShingles);
    assert.ok(score < 0.7, `${path} five-token Jaccard ${score} reached 0.70`);
    for (const shingle of pilotShingles) pilotAggregate.add(`${path}:${shingle}`);
    for (const shingle of checkoutShingles) {
      checkoutAggregate.add(`${path}:${shingle}`);
    }
  }
  const aggregateScore = jaccard(pilotAggregate, checkoutAggregate);
  assert.ok(
    aggregateScore < 0.55,
    `aggregate five-token Jaccard ${aggregateScore} reached 0.55`,
  );
});

test("authoring loader rejects changed resource bytes", async () => {
  await withFixtureCopy("resource-binding", async (root) => {
    const path = join(root, "app.js");
    const bytes = await readFile(path);
    await writeFile(path, Buffer.concat([bytes, Buffer.from("\n", "utf8")]));
    await expectAuthoringError(
      loadPilotFixtureAuthoringPackage(root),
      "pilot_fixture.resource_binding",
    );
  });
});

test("authoring loader rejects unlisted, missing, and empty-directory membership", async () => {
  const cases: readonly [
    discriminator: string,
    mutate: (root: string) => Promise<void>,
  ][] = [
    [
      "unlisted",
      async (root) => writeFile(join(root, "unlisted.txt"), "not declared", "utf8"),
    ],
    ["missing", async (root) => rm(join(root, "app.js"))],
    ["empty-directory", async (root) => mkdir(join(root, "empty"))],
  ];
  for (const [discriminator, mutate] of cases) {
    await withFixtureCopy(discriminator, async (root) => {
      await mutate(root);
      await expectAuthoringError(
        loadPilotFixtureAuthoringPackage(root),
        "pilot_fixture.membership",
      );
    });
  }
});

test("authoring loader rejects symbolic, hard-linked, and root aliases", async () => {
  await withFixtureCopy("symlink", async (root) => {
    await symlink("app.js", join(root, "alias.js"));
    await expectAuthoringError(
      loadPilotFixtureAuthoringPackage(root),
      "pilot_fixture.tree",
    );
  });

  await withFixtureCopy("hardlink", async (root) => {
    await link(join(root, "app.js"), join(root, "alias.js"));
    await expectAuthoringError(
      loadPilotFixtureAuthoringPackage(root),
      "pilot_fixture.tree",
    );
  });

  await withFixtureCopy("root-symlink", async (root, temporaryRoot) => {
    const alias = join(temporaryRoot, "fixture-alias");
    await symlink(root, alias, "dir");
    await expectAuthoringError(
      loadPilotFixtureAuthoringPackage(alias),
      "pilot_fixture.tree",
    );
  });
});
