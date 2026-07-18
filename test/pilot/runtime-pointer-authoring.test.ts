import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import type { Browser } from "@playwright/test";

import {
  authorPilotFixturePointerHitTestingPair,
  canonicalJson,
  launchPilotFixtureAuthoringEnvironment,
  PilotFixtureAuthoringRuntimeError,
  sha256Hex,
  type PilotFixtureAuthoringEnvironment,
  type PilotFixturePointerHitTestingPairAuthoringResult,
  type PilotFixtureWorkflowAuthoringAudit,
} from "../../src/index.js";
import { acquirePilotFixtureAuthoringEnvironment } from "../../src/pilot/runtime/environment.js";

const fixtureDirectory = resolve("fixtures/pilot-market-basket-v1");
const temporaryDirectory = resolve("test-results/pointer-authoring");

const workflows = Object.freeze([
  Object.freeze({
    key: "add_bundle",
    taskId: "idtk1_79c6534b21c46bfabcb881f01a2a51bf72ccaf3d3d4a1215deef3285f8e4453f",
  }),
  Object.freeze({
    key: "choose_pickup",
    taskId: "idtk1_ab2de7b7bfe7df885fbb0b8f7f4d6fe82828b2da578e14daace7cf146d23e8f9",
  }),
]);

const definitions = Object.freeze([
  Object.freeze({
    key: "pointer_hit_testing.intercept_source_point.v1" as const,
    expectedOutcome: "exact_unchanged" as const,
  }),
  Object.freeze({
    key: "pointer_hit_testing.pass_source_point.v1" as const,
    expectedOutcome: "exact_success" as const,
  }),
]);

const exactResultKeys = Object.freeze(
  ["baseline", "candidate", "definition_key", "kind", "official"].sort(),
);
const exactRunKeys = Object.freeze(["audit", "task_outcome"].sort());
const exactAuditKeys = Object.freeze(
  [
    "actions_executed",
    "blocked_external_requests",
    "checkpoint_after_action_ordinals",
    "environment_id",
    "fixture_key",
    "fixture_revision",
    "kind",
    "official",
    "resource_requests",
    "source_state_id",
    "task_id",
    "unexpected_fixture_requests",
    "workflow_key",
  ].sort(),
);
const privateEvidenceKeys = new Set([
  "capture",
  "capture_spec",
  "checkpoint",
  "checkpoint_id",
  "checkpoints",
  "corpus",
  "generation",
  "generation_plan",
  "label",
  "labels",
  "operator",
  "probe",
  "probes",
  "source_predicates",
  "installed_predicates",
  "token",
  "tokens",
]);

interface MutableFixtureManifest {
  resources: {
    path: string;
    sha256: string;
    byte_length: number;
  }[];
}

function stringOwnKeys(value: object, path: string): string[] {
  return Reflect.ownKeys(value).map((key) => {
    assert.equal(typeof key, "string", `${path} must not expose symbol capabilities`);
    return key as string;
  });
}

function assertDeeplyFrozenJson(value: unknown, path = "$result"): void {
  if (value === null || typeof value !== "object") {
    assert.ok(
      value === null ||
        typeof value === "string" ||
        (typeof value === "number" && Number.isFinite(value)) ||
        typeof value === "boolean",
      `${path} must contain only finite JSON data`,
    );
    return;
  }

  assert.equal(Buffer.isBuffer(value), false, `${path} must not expose bytes`);
  assert.equal(value instanceof Uint8Array, false, `${path} must not expose bytes`);
  assert.equal(Object.isFrozen(value), true, `${path} must be frozen`);
  assert.equal(
    Object.getPrototypeOf(value),
    Array.isArray(value) ? Array.prototype : Object.prototype,
    `${path} must use a plain JSON prototype`,
  );

  for (const key of stringOwnKeys(value, path)) {
    if (Array.isArray(value) && key === "length") continue;
    assert.equal(
      privateEvidenceKeys.has(key.toLowerCase()),
      false,
      `${path}.${key} leaks private authoring evidence`,
    );
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assert.ok(descriptor !== undefined && "value" in descriptor);
    assert.equal(descriptor.enumerable, true, `${path}.${key} must be enumerable`);
    assert.equal(descriptor.get, undefined, `${path}.${key} must not be an accessor`);
    assert.equal(descriptor.set, undefined, `${path}.${key} must not be an accessor`);
    assertDeeplyFrozenJson(descriptor.value, `${path}.${key}`);
  }
}

function inspectOwnedBrowser(environment: PilotFixtureAuthoringEnvironment): {
  readonly browser: Browser;
  readonly contextCount: number;
} {
  const lease = acquirePilotFixtureAuthoringEnvironment(environment);
  try {
    return Object.freeze({
      browser: lease.browser,
      contextCount: lease.browser.contexts().length,
    });
  } finally {
    lease.release();
  }
}

function assertAuditBindings(
  audit: PilotFixtureWorkflowAuthoringAudit,
  workflow: (typeof workflows)[number],
): void {
  assert.deepEqual(stringOwnKeys(audit, "$audit").sort(), exactAuditKeys);
  assert.equal(audit.kind, "pilot_fixture_workflow_authoring_audit");
  assert.equal(audit.official, false);
  assert.equal(audit.fixture_key, "pilot-market-basket-v1");
  assert.equal(audit.fixture_revision, "pilot-market-basket-v1.0.0-authoring.2");
  assert.match(audit.source_state_id, /^idss1_[0-9a-f]{64}$/u);
  assert.equal(audit.workflow_key, workflow.key);
  assert.equal(audit.task_id, workflow.taskId);
  assert.match(audit.environment_id, /^iden1_[0-9a-f]{64}$/u);
  assert.equal(audit.actions_executed, 4);
  assert.deepEqual(audit.checkpoint_after_action_ordinals, [-1, 2, 3]);
  assert.deepEqual(audit.blocked_external_requests, []);
  assert.deepEqual(audit.unexpected_fixture_requests, []);
  assert.deepEqual(audit.resource_requests, [
    { path: "app.js", request_count: 1 },
    { path: "art/woven-tag.svg", request_count: 1 },
    { path: "fonts/noto-sans-latin-standard-normal.woff2", request_count: 1 },
    { path: "index.html", request_count: 1 },
    { path: "styles.css", request_count: 1 },
  ]);
  for (const request of audit.resource_requests) {
    assert.deepEqual(stringOwnKeys(request, "$resource_request").sort(), [
      "path",
      "request_count",
    ]);
  }
}

function assertPointerPair(
  result: PilotFixturePointerHitTestingPairAuthoringResult,
  workflow: (typeof workflows)[number],
  definition: (typeof definitions)[number],
): void {
  assert.deepEqual(stringOwnKeys(result, "$result").sort(), exactResultKeys);
  assert.equal(result.kind, "pilot_fixture_pointer_hit_testing_pair_authoring_result");
  assert.equal(result.official, false);
  assert.equal(result.definition_key, definition.key);
  assert.deepEqual(stringOwnKeys(result.baseline, "$baseline").sort(), exactRunKeys);
  assert.deepEqual(stringOwnKeys(result.candidate, "$candidate").sort(), exactRunKeys);
  assert.equal(result.baseline.task_outcome, "exact_success");
  assert.equal(result.candidate.task_outcome, definition.expectedOutcome);
  assert.notEqual(result.baseline, result.candidate);
  assert.notEqual(result.baseline.audit, result.candidate.audit);

  assertAuditBindings(result.baseline.audit, workflow);
  assertAuditBindings(result.candidate.audit, workflow);
  assert.deepEqual(result.candidate.audit, result.baseline.audit);
  assert.equal(
    result.candidate.audit.environment_id,
    result.baseline.audit.environment_id,
  );
  assert.equal(
    result.candidate.audit.source_state_id,
    result.baseline.audit.source_state_id,
  );

  assertDeeplyFrozenJson(result);
  const serialized = JSON.stringify(result);
  assert.deepEqual(JSON.parse(serialized) as unknown, result);
  for (const exactPrivateKey of privateEvidenceKeys) {
    assert.equal(
      new RegExp(`"${exactPrivateKey}"\\s*:`, "u").test(serialized),
      false,
      `serialized result leaks ${exactPrivateKey}`,
    );
  }
}

async function rewriteFixtureTextResource(
  fixtureRoot: string,
  resourcePath: string,
  transform: (source: string) => string,
): Promise<void> {
  const absoluteResourcePath = join(fixtureRoot, resourcePath);
  const manifestPath = join(fixtureRoot, "fixture.json");
  const source = await readFile(absoluteResourcePath, "utf8");
  const rewritten = transform(source);
  assert.notEqual(rewritten, source, `${resourcePath} rewrite must change its bytes`);
  await writeFile(absoluteResourcePath, rewritten, "utf8");

  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as MutableFixtureManifest;
  const resource = manifest.resources.find(({ path }) => path === resourcePath);
  assert.ok(resource !== undefined, `manifest must declare ${resourcePath}`);
  const bytes = Buffer.from(rewritten, "utf8");
  resource.byte_length = bytes.byteLength;
  resource.sha256 = sha256Hex(bytes);
  await writeFile(manifestPath, `${canonicalJson(manifest)}\n`, "utf8");
}

async function withFixtureCopy(
  discriminator: string,
  action: (fixtureRoot: string) => Promise<void>,
): Promise<void> {
  await mkdir(temporaryDirectory, { recursive: true });
  const temporaryRoot = await mkdtemp(join(temporaryDirectory, `${discriminator}-`));
  const fixtureRoot = join(temporaryRoot, "fixture");
  try {
    await cp(fixtureDirectory, fixtureRoot, { recursive: true });
    await action(fixtureRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function collectRuntimeCodes(error: unknown, codes = new Set<string>()): Set<string> {
  if (error instanceof PilotFixtureAuthoringRuntimeError) codes.add(error.code);
  if (error instanceof AggregateError) {
    for (const nested of error.errors) collectRuntimeCodes(nested, codes);
  }
  if (error instanceof Error && error.cause !== undefined) {
    collectRuntimeCodes(error.cause, codes);
  }
  return codes;
}

async function assertAdversarialFixtureRejected(
  fixtureRoot: string,
  expectedNestedCode: string,
): Promise<void> {
  const environment = await launchPilotFixtureAuthoringEnvironment(fixtureRoot);
  const inspection = inspectOwnedBrowser(environment);
  let closed = false;
  try {
    assert.equal(inspection.contextCount, 0);
    await assert.rejects(
      authorPilotFixturePointerHitTestingPair(
        environment,
        "add_bundle",
        "pointer_hit_testing.intercept_source_point.v1",
      ),
      (error: unknown) => {
        assert.ok(error instanceof PilotFixtureAuthoringRuntimeError);
        assert.equal(
          collectRuntimeCodes(error).has(expectedNestedCode),
          true,
          `runtime error graph must contain ${expectedNestedCode}`,
        );
        return true;
      },
    );
    assert.equal(inspection.browser.contexts().length, 0);
    await assert.rejects(
      authorPilotFixturePointerHitTestingPair(
        environment,
        "add_bundle",
        "pointer_hit_testing.pass_source_point.v1",
      ),
      (error: unknown) => {
        assert.ok(error instanceof PilotFixtureAuthoringRuntimeError);
        assert.equal(error.code, "pilot_runtime.environment_poisoned");
        return true;
      },
    );
    await environment.close();
    closed = true;
  } finally {
    if (!closed) {
      try {
        await environment.close();
      } catch {
        // Preserve the adversarial assertion after best-effort browser cleanup.
      }
    }
  }
}

test(
  "pointer-hit authoring emits deterministic fresh pairs for the complete Pilot slice",
  { concurrency: false },
  async () => {
    const environment = await launchPilotFixtureAuthoringEnvironment(fixtureDirectory);
    const initialInspection = inspectOwnedBrowser(environment);
    const serializedByCase = new Map<string, string>();
    let closed = false;
    try {
      assert.equal(initialInspection.contextCount, 0);
      for (const workflow of workflows) {
        for (const definition of definitions) {
          for (let replicate = 0; replicate < 3; replicate += 1) {
            const result = await authorPilotFixturePointerHitTestingPair(
              environment,
              workflow.key,
              definition.key,
            );
            const afterAttempt = inspectOwnedBrowser(environment);
            assert.equal(afterAttempt.browser, initialInspection.browser);
            assert.equal(afterAttempt.contextCount, 0);
            assertPointerPair(result, workflow, definition);

            const caseKey = `${workflow.key}:${definition.key}`;
            const serialized = JSON.stringify(result);
            const first = serializedByCase.get(caseKey);
            if (first === undefined) serializedByCase.set(caseKey, serialized);
            else assert.equal(serialized, first, `${caseKey} replicate must be exact`);
          }
        }
      }
      assert.equal(serializedByCase.size, 4);
      await environment.close();
      closed = true;
    } finally {
      if (!closed) {
        try {
          await environment.close();
        } catch {
          // Preserve the matrix assertion after best-effort browser cleanup.
        }
      }
    }
  },
);

test(
  "pointer-hit definition keys are exact and rejected before a browser context exists",
  { concurrency: false },
  async () => {
    const environment = await launchPilotFixtureAuthoringEnvironment(fixtureDirectory);
    const initialInspection = inspectOwnedBrowser(environment);
    const invokeUntrustedDefinition =
      authorPilotFixturePointerHitTestingPair as unknown as (
        authoringEnvironment: PilotFixtureAuthoringEnvironment,
        workflowKey: string,
        definitionKey: unknown,
      ) => Promise<PilotFixturePointerHitTestingPairAuthoringResult>;
    const invalidDefinitions: readonly unknown[] = Object.freeze([
      "intercept",
      "pointer_hit_testing.intercept_source_point",
      "pointer_hit_testing.intercept_source_point.v1 ",
      "pointer_hit_testing.pass_source_point.v1/extra",
      Object.freeze({ definition_key: definitions[0]!.key }),
    ]);
    let closed = false;
    try {
      for (const definition of invalidDefinitions) {
        await assert.rejects(
          invokeUntrustedDefinition(environment, "not_declared", definition),
          (error: unknown) => {
            assert.ok(error instanceof PilotFixtureAuthoringRuntimeError);
            assert.equal(error.code, "pilot_runtime.pointer_definition_key");
            return true;
          },
        );
        const afterRejection = inspectOwnedBrowser(environment);
        assert.equal(afterRejection.browser, initialInspection.browser);
        assert.equal(afterRejection.contextCount, 0);
      }

      const validResult = await authorPilotFixturePointerHitTestingPair(
        environment,
        workflows[0]!.key,
        definitions[1]!.key,
      );
      assertPointerPair(validResult, workflows[0]!, definitions[1]!);
      assert.equal(inspectOwnedBrowser(environment).contextCount, 0);
      await environment.close();
      closed = true;
    } finally {
      if (!closed) {
        try {
          await environment.close();
        } catch {
          // Preserve the definition-key assertion after best-effort cleanup.
        }
      }
    }
  },
);

test(
  "pointer-hit authoring rejects fixture collisions with its reserved DOM namespace",
  { concurrency: false },
  async () => {
    await withFixtureCopy("reserved-dom", async (fixtureRoot) => {
      await rewriteFixtureTextResource(fixtureRoot, "index.html", (html) => {
        const marker = "  </body>";
        assert.equal(html.split(marker).length, 2);
        return html.replace(
          marker,
          [
            '    <div hidden data-impactdiff-pilot-owned="fixture-collision"></div>',
            marker,
          ].join("\n"),
        );
      });
      await assertAdversarialFixtureRejected(
        fixtureRoot,
        "pilot_runtime.pointer_intervention_apply",
      );
    });
  },
);

test(
  "pointer-hit authoring rejects source CSS that paints its reserved pseudo surface",
  { concurrency: false },
  async () => {
    await withFixtureCopy("reserved-pseudo", async (fixtureRoot) => {
      await rewriteFixtureTextResource(fixtureRoot, "styles.css", (css) =>
        [
          css,
          "",
          'html body [data-impactdiff-pilot-owned="pointer-h0"][aria-hidden="true"]::before {',
          '  content: "fixture-forgery" !important;',
          "  display: block !important;",
          "  background: #f00 !important;",
          "}",
        ].join("\n"),
      );
      await assertAdversarialFixtureRejected(
        fixtureRoot,
        "pilot_runtime.pointer_intervention_probe",
      );
    });
  },
);

test(
  "pointer-hit authoring detects temporary listener-registry drift during setup",
  { concurrency: false },
  async () => {
    await withFixtureCopy("listener-drift", async (fixtureRoot) => {
      await rewriteFixtureTextResource(fixtureRoot, "app.js", (application) => {
        const marker = 'addBundle.addEventListener("click", () => {';
        assert.equal(application.split(marker).length, 2);
        return application.replace(
          marker,
          [
            'bundleSelect.addEventListener("change", () => {',
            "  const transientListener = () => {};",
            '  window.addEventListener("impactdiff-transient", transientListener);',
            '  window.removeEventListener("impactdiff-transient", transientListener);',
            "});",
            "",
            marker,
          ].join("\n"),
        );
      });
      await assertAdversarialFixtureRejected(
        fixtureRoot,
        "pilot_runtime.pointer_intervention_cleanup",
      );
    });
  },
);
