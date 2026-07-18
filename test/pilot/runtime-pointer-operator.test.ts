import assert from "node:assert/strict";
import test from "node:test";

import {
  pilotMutationInstalledProbeCodes,
  pilotMutationLocalPredicateKeys,
  pilotMutationRoundtripProbeCodes,
  pilotV01MutationOperatorArtifacts,
  pilotV01MutationOperatorCatalog,
} from "../../src/mutations/catalog/index.js";
import { PilotFixtureAuthoringRuntimeError } from "../../src/pilot/runtime/errors.js";
import {
  assertPilotPointerInstalledPredicates,
  assertPilotPointerSourcePredicates,
  assertSelectedPilotPointerOperator,
  createPilotPointerCleanupProbeObservations,
  createPilotPointerInstalledProbeObservations,
  createPilotPointerRoundtripProbeObservations,
  createPilotPointerSourceProbeObservations,
  selectPilotPointerOperator,
} from "../../src/pilot/runtime/pointer-operator.js";

function expectRuntimeError(action: () => unknown, expectedCode: string): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof PilotFixtureAuthoringRuntimeError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

function predicateRows(states: readonly ("fail" | "pass")[]) {
  return pilotMutationLocalPredicateKeys.map((predicate, index) => ({
    predicate,
    state: states[index],
  }));
}

function passingPredicateRows() {
  return predicateRows(pilotMutationLocalPredicateKeys.map(() => "pass"));
}

function passingProbeRows(probes: readonly string[]) {
  return probes.map((probe) => ({ probe, state: "pass" as const }));
}

function assertDeeplyFrozen(rows: readonly object[]): void {
  assert.equal(Object.isFrozen(rows), true);
  for (const row of rows) {
    assert.equal(Object.isFrozen(row), true);
  }
}

test("pointer selection binds the exact code-owned pair before runtime use", () => {
  const intercept = selectPilotPointerOperator("intercept");
  const pass = selectPilotPointerOperator("pass");

  assert.equal(selectPilotPointerOperator("intercept"), intercept);
  assert.equal(selectPilotPointerOperator("pass"), pass);
  assert.equal(assertSelectedPilotPointerOperator(intercept), intercept);
  assert.equal(assertSelectedPilotPointerOperator(pass), pass);
  assert.equal(Object.isFrozen(intercept), true);
  assert.equal(Object.isFrozen(pass), true);
  assert.deepEqual(Reflect.ownKeys(intercept).sort(), [
    "artifact",
    "binding",
    "catalog_id",
    "definition",
    "key",
    "operator_id",
    "pointer_mode",
  ]);

  for (const [selection, definitionKey, relation, pointerMode] of [
    [
      intercept,
      "pointer_hit_testing.intercept_source_point.v1",
      "declared_breaking",
      "intercept",
    ],
    [
      pass,
      "pointer_hit_testing.pass_source_point.v1",
      "task_preserving_control",
      "pass_through",
    ],
  ] as const) {
    const artifact = pilotV01MutationOperatorArtifacts.find(
      ({ definition }) => definition.definition_key === definitionKey,
    );
    assert.ok(artifact !== undefined);
    const binding = pilotV01MutationOperatorCatalog.operators.find(
      ({ operator_id }) => operator_id === artifact.operator_id,
    );
    assert.ok(binding !== undefined);
    assert.equal(selection.catalog_id, pilotV01MutationOperatorCatalog.catalog_id);
    assert.equal(selection.operator_id, artifact.operator_id);
    assert.equal(selection.artifact, artifact);
    assert.equal(selection.binding, binding);
    assert.equal(selection.definition, artifact.definition);
    assert.equal(selection.definition.definition_key, definitionKey);
    assert.equal(selection.definition.family_key, "pointer_hit_testing");
    assert.equal(selection.definition.declared_relation_variant, relation);
    assert.equal(selection.definition.effect.kind, "pointer_hit_testing");
    assert.equal(selection.definition.effect.pointer_mode, pointerMode);
    assert.equal(selection.pointer_mode, pointerMode);
  }

  assert.equal(intercept.definition.pairing.pair_id, pass.definition.pairing.pair_id);
  assert.notEqual(intercept.operator_id, pass.operator_id);
});

test("pointer selection rejects aliases, non-pointer values, objects, and forgeries", () => {
  for (const value of [
    "unknown",
    "pass_through",
    "pointer_hit_testing.intercept_source_point.v1",
    "overflow_clipping.exclude_source_point.v1",
    "INTERCEPT",
    "",
    null,
    undefined,
    0,
    { key: "intercept" },
    new String("intercept"),
  ]) {
    expectRuntimeError(
      () => selectPilotPointerOperator(value),
      "pilot_runtime.pointer_operator_key",
    );
  }

  const selected = selectPilotPointerOperator("intercept");
  const forged = { ...selected };
  expectRuntimeError(
    () => assertSelectedPilotPointerOperator(forged),
    "pilot_runtime.pointer_operator_authentication",
  );
  expectRuntimeError(
    () => assertPilotPointerInstalledPredicates(forged, passingPredicateRows()),
    "pilot_runtime.pointer_operator_authentication",
  );
});

test("pointer predicate tuples are exact, defensive, and policy-bound", () => {
  const intercept = selectPilotPointerOperator("intercept");
  const pass = selectPilotPointerOperator("pass");
  const sourceInput = passingPredicateRows();
  const source = assertPilotPointerSourcePredicates(intercept, sourceInput);

  assert.deepEqual(source, passingPredicateRows());
  assertDeeplyFrozen(source);
  assert.notEqual(source, sourceInput);
  assert.notEqual(source[0], sourceInput[0]);
  sourceInput[0] = {
    predicate: pilotMutationLocalPredicateKeys[0],
    state: "fail",
  };
  assert.equal(source[0].state, "pass");

  const interceptStates = intercept.definition.installed_predicate_policy.vector.map(
    ({ expected_state: state }) => state,
  );
  assert.deepEqual(interceptStates, [
    "fail",
    "fail",
    "fail",
    "pass",
    "pass",
    "pass",
    "pass",
    "pass",
  ]);
  const installedIntercept = assertPilotPointerInstalledPredicates(
    intercept,
    predicateRows(interceptStates),
  );
  const installedPass = assertPilotPointerInstalledPredicates(
    pass,
    passingPredicateRows(),
  );
  assert.deepEqual(installedIntercept, predicateRows(interceptStates));
  assert.deepEqual(installedPass, passingPredicateRows());
  assertDeeplyFrozen(installedIntercept);
  assertDeeplyFrozen(installedPass);

  expectRuntimeError(
    () => assertPilotPointerSourcePredicates(pass, predicateRows(interceptStates)),
    "pilot_runtime.pointer_predicate_policy",
  );
  expectRuntimeError(
    () => assertPilotPointerInstalledPredicates(intercept, passingPredicateRows()),
    "pilot_runtime.pointer_predicate_policy",
  );
  expectRuntimeError(
    () =>
      assertPilotPointerInstalledPredicates(pass, passingPredicateRows().slice(0, 7)),
    "pilot_runtime.pointer_observation",
  );

  const reordered = passingPredicateRows();
  [reordered[0], reordered[1]] = [reordered[1]!, reordered[0]!];
  expectRuntimeError(
    () => assertPilotPointerInstalledPredicates(pass, reordered),
    "pilot_runtime.pointer_predicate_policy",
  );

  const extraField = passingPredicateRows();
  Object.assign(extraField[0]!, { role: "preserved" });
  expectRuntimeError(
    () => assertPilotPointerInstalledPredicates(pass, extraField),
    "pilot_runtime.pointer_observation",
  );

  const getterRow = passingPredicateRows();
  Object.defineProperty(getterRow[0], "state", {
    enumerable: true,
    get: () => "pass",
  });
  expectRuntimeError(
    () => assertPilotPointerInstalledPredicates(pass, getterRow),
    "pilot_runtime.pointer_observation",
  );

  const getterArray = passingPredicateRows();
  let arrayGetterInvoked = false;
  Object.defineProperty(getterArray, "0", {
    configurable: true,
    enumerable: true,
    get: () => {
      arrayGetterInvoked = true;
      return { predicate: pilotMutationLocalPredicateKeys[0], state: "pass" };
    },
  });
  expectRuntimeError(
    () => assertPilotPointerInstalledPredicates(pass, getterArray),
    "pilot_runtime.pointer_observation",
  );
  assert.equal(arrayGetterInvoked, false);
});

test("pointer probe tuples retain exact source, installed, inverse, and cleanup order", () => {
  for (const key of ["intercept", "pass"] as const) {
    const selected = selectPilotPointerOperator(key);
    const sourceInput = passingProbeRows(selected.definition.required_probes.source);
    const installedInput = passingProbeRows(
      selected.definition.required_probes.installed,
    );
    const inverseInput = passingProbeRows(
      selected.definition.required_probes.inverse_roundtrip,
    );
    const cleanupInput = passingProbeRows(selected.definition.cleanup_audit.required);

    const source = createPilotPointerSourceProbeObservations(selected, sourceInput);
    const installed = createPilotPointerInstalledProbeObservations(
      selected,
      installedInput,
    );
    const inverse = createPilotPointerRoundtripProbeObservations(
      selected,
      inverseInput,
    );
    const cleanup = createPilotPointerCleanupProbeObservations(selected, cleanupInput);

    assert.deepEqual(
      source.map(({ probe }) => probe),
      selected.definition.required_probes.source,
    );
    assert.equal(source.length, 7);
    assert.deepEqual(
      installed.map(({ probe }) => probe),
      pilotMutationInstalledProbeCodes,
    );
    assert.deepEqual(
      inverse.map(({ probe }) => probe),
      pilotMutationRoundtripProbeCodes,
    );
    assert.deepEqual(
      cleanup.map(({ probe }) => probe),
      pilotMutationRoundtripProbeCodes,
    );
    assert.equal(installed.length, 5);
    assert.equal(inverse.length, 11);
    assert.equal(cleanup.length, 11);
    assertDeeplyFrozen(source);
    assertDeeplyFrozen(installed);
    assertDeeplyFrozen(inverse);
    assertDeeplyFrozen(cleanup);
    assert.notEqual(source, sourceInput);
    assert.notEqual(source[0], sourceInput[0]);

    sourceInput[0] = { probe: "substituted", state: "pass" };
    assert.equal(source[0].probe, "runtime_clean");
  }
});

test("pointer probe tuples reject failed, reordered, extended, and forged evidence", () => {
  const selected = selectPilotPointerOperator("intercept");
  const source = passingProbeRows(selected.definition.required_probes.source);
  const installed = passingProbeRows(selected.definition.required_probes.installed);
  const inverse = passingProbeRows(
    selected.definition.required_probes.inverse_roundtrip,
  );

  source[0] = { probe: source[0]!.probe, state: "fail" as "pass" };
  expectRuntimeError(
    () => createPilotPointerSourceProbeObservations(selected, source),
    "pilot_runtime.pointer_probe_policy",
  );

  [installed[0], installed[1]] = [installed[1]!, installed[0]!];
  expectRuntimeError(
    () => createPilotPointerInstalledProbeObservations(selected, installed),
    "pilot_runtime.pointer_probe_policy",
  );

  inverse.push({ probe: "runtime_clean", state: "pass" });
  expectRuntimeError(
    () => createPilotPointerRoundtripProbeObservations(selected, inverse),
    "pilot_runtime.pointer_observation",
  );

  const cleanup = passingProbeRows(selected.definition.cleanup_audit.required);
  Object.assign(cleanup[0]!, { detail: "caller-authored" });
  expectRuntimeError(
    () => createPilotPointerCleanupProbeObservations(selected, cleanup),
    "pilot_runtime.pointer_observation",
  );

  expectRuntimeError(
    () =>
      createPilotPointerSourceProbeObservations(
        { ...selected },
        passingProbeRows(selected.definition.required_probes.source),
      ),
    "pilot_runtime.pointer_operator_authentication",
  );
});
