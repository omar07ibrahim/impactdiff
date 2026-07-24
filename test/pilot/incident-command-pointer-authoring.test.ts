import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import type { Browser } from "@playwright/test";

import {
  authorPilotFixturePointerHitTestingPair,
  launchPilotFixtureAuthoringEnvironment,
  type PilotFixtureAuthoringEnvironment,
  type PilotFixturePointerHitTestingPairAuthoringResult,
  type PilotFixtureWorkflowAuthoringAudit,
} from "../../src/index.js";
import { acquirePilotFixtureAuthoringEnvironment } from "../../src/pilot/runtime/environment.js";

const fixtureDirectory = resolve("fixtures/pilot-incident-command-v1");

const workflows = Object.freeze([
  Object.freeze({
    key: "acknowledge_alert",
    taskId: "idtk1_f30e42e674b6429551d797fb11dad55cb0ddaec07d80ccc8dbba8c352d2542e2",
  }),
  Object.freeze({
    key: "assign_responder",
    taskId: "idtk1_24cee5532e154c630c54aa376ff95fb8507179fb18c57dd2182ceb263743e747",
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
    assert.equal(descriptor.enumerable, true);
    assert.equal(descriptor.get, undefined);
    assert.equal(descriptor.set, undefined);
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
  assert.equal(audit.fixture_key, "pilot-incident-command-v1");
  assert.equal(audit.fixture_revision, "pilot-incident-command-v1.0.0-authoring.1");
  assert.equal(
    audit.source_state_id,
    "idss1_5de36eaaeb9774c8ff5d68f2e48ffa9eedc2b5043f480286197011a63dca49f6",
  );
  assert.equal(audit.workflow_key, workflow.key);
  assert.equal(audit.task_id, workflow.taskId);
  assert.match(audit.environment_id, /^iden1_[0-9a-f]{64}$/u);
  assert.equal(audit.actions_executed, 4);
  assert.deepEqual(audit.checkpoint_after_action_ordinals, [-1, 2, 3]);
  assert.deepEqual(audit.blocked_external_requests, []);
  assert.deepEqual(audit.unexpected_fixture_requests, []);
  assert.deepEqual(audit.resource_requests, [
    { path: "app.js", request_count: 1 },
    {
      path: "fonts/noto-sans-latin-standard-normal.woff2",
      request_count: 1,
    },
    { path: "glyphs/severity.svg", request_count: 1 },
    { path: "index.html", request_count: 1 },
    { path: "styles.css", request_count: 1 },
  ]);
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

  assertDeeplyFrozenJson(result);
  const serialized = JSON.stringify(result);
  assert.deepEqual(JSON.parse(serialized) as unknown, result);
  for (const key of privateEvidenceKeys) {
    assert.equal(
      new RegExp(`"${key}"\\s*:`, "u").test(serialized),
      false,
      `serialized result leaks ${key}`,
    );
  }
}

test(
  "Incident Command pointer authoring is exact across workflows and fresh attempts",
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
            else assert.equal(serialized, first);
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
