import assert from "node:assert/strict";
import test from "node:test";

import { PilotFixtureAuthoringRuntimeError } from "../../src/pilot/runtime/errors.js";
import {
  measurePilotMutationPredicates,
  type PilotMutationPredicateMeasurementInput,
} from "../../src/pilot/runtime/predicates.js";

const primaryActionTargetId = `idat1_${"0".repeat(64)}`;

const validEvidence = Object.freeze({
  hitPrimary: true,
  primaryFullyVisible: true,
  sourcePointWithinPrimary: true,
  primaryEnabled: true,
  focusReachesPrimary: true,
  contentContained: true,
  foregroundColor: "rgb(255, 255, 255)",
  backgroundColor: "rgb(0, 0, 0)",
  backgroundImage: "none",
  opacity: "1",
});

function fakeInput(
  sourcePoint: unknown,
  evaluate: (...arguments_: unknown[]) => unknown = () => validEvidence,
): PilotMutationPredicateMeasurementInput {
  return {
    primary: { evaluate } as never,
    clipHost: {} as never,
    contentPressure: {} as never,
    pageGuard: {} as never,
    sourcePoint,
    prePrimaryCheckpoint: {} as never,
    primaryActionTargetId,
  } as PilotMutationPredicateMeasurementInput;
}

async function expectCode(
  action: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof PilotFixtureAuthoringRuntimeError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

test("Pilot predicate inputs reject active and ambiguous source-point objects", async () => {
  const accessorPoint = Object.freeze(
    Object.defineProperty({ y: 0 }, "x", {
      enumerable: true,
      get: () => 0,
    }),
  );
  const symbolicPoint = { x: 0, y: 0 } as Record<PropertyKey, unknown>;
  symbolicPoint[Symbol("extra")] = true;
  Object.freeze(symbolicPoint);
  const nullPrototypePoint = Object.assign(Object.create(null), { x: 0, y: 0 });
  Object.freeze(nullPrototypePoint);

  const cases = [
    { value: null, code: "pilot_runtime.predicate_evidence" },
    { value: [], code: "pilot_runtime.predicate_evidence" },
    {
      value: Object.freeze({ x: 0, y: 0, extra: true }),
      code: "pilot_runtime.predicate_evidence",
    },
    {
      value: Object.freeze({ x: 0 }),
      code: "pilot_runtime.predicate_evidence",
    },
    { value: accessorPoint, code: "pilot_runtime.predicate_evidence" },
    { value: symbolicPoint, code: "pilot_runtime.predicate_evidence" },
    { value: nullPrototypePoint, code: "pilot_runtime.predicate_evidence" },
    { value: { x: 0, y: 0 }, code: "pilot_runtime.predicate_input" },
    {
      value: Object.freeze({ x: Number.NaN, y: 0 }),
      code: "pilot_runtime.predicate_input",
    },
    {
      value: Object.freeze({ x: "0", y: 0 }),
      code: "pilot_runtime.predicate_input",
    },
  ] as const;

  for (const { value, code } of cases) {
    await expectCode(measurePilotMutationPredicates(fakeInput(value)), code);
  }
});

test("Pilot predicate evidence rejects malformed page projections", async () => {
  const sourcePoint = Object.freeze({ x: 32, y: 32 });
  const missingField = { ...validEvidence } as Record<string, unknown>;
  delete missingField.opacity;

  const cases = [
    null,
    missingField,
    { ...validEvidence, hitPrimary: 1 },
    { ...validEvidence, foregroundColor: "" },
    { ...validEvidence, foregroundColor: "x".repeat(257) },
  ];
  for (const evidence of cases) {
    await expectCode(
      measurePilotMutationPredicates(fakeInput(sourcePoint, () => evidence)),
      "pilot_runtime.predicate_evidence",
    );
  }

  await expectCode(
    measurePilotMutationPredicates(
      fakeInput(sourcePoint, () => {
        throw new Error("page realm unavailable");
      }),
    ),
    "pilot_runtime.predicate_probe",
  );
  await expectCode(
    measurePilotMutationPredicates(fakeInput(sourcePoint)),
    "pilot_runtime.predicate_checkpoint",
  );
});
