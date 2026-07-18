import { canonicalJson, sha256Hex } from "../../contracts/canonical.js";
import {
  computePilotMutationOperatorCatalogId,
  computePilotMutationOperatorId,
  pilotMutationInstalledProbeCodes,
  pilotMutationLocalPredicateKeys,
  pilotMutationRoundtripProbeCodes,
  pilotMutationSourceProbeCodes,
  pilotV01MutationOperatorArtifacts,
  pilotV01MutationOperatorCatalog,
} from "../../mutations/catalog/index.js";
import type {
  PilotMutationOperatorBinding,
  PilotMutationOperatorDefinition,
} from "../../mutations/catalog/index.js";
import type { PilotMutationPredicateObservationTuple } from "./predicates.js";
import { PilotFixtureAuthoringRuntimeError } from "./errors.js";

const pointerOperatorKeys = Object.freeze(["intercept", "pass"] as const);
const pointerDefinitionKeys = Object.freeze({
  intercept: "pointer_hit_testing.intercept_source_point.v1",
  pass: "pointer_hit_testing.pass_source_point.v1",
} as const);
const pointerRelations = Object.freeze({
  intercept: "declared_breaking",
  pass: "task_preserving_control",
} as const);
const pointerModes = Object.freeze({
  intercept: "intercept",
  pass: "pass_through",
} as const);
const pointerExpectedStates = Object.freeze({
  intercept: "fail",
  pass: "pass",
} as const);
const pointerSourceProbeCodes = Object.freeze(
  pilotMutationSourceProbeCodes.slice(0, 7),
);

export type PilotPointerOperatorKey = (typeof pointerOperatorKeys)[number];

type PilotPointerOperatorArtifact = (typeof pilotV01MutationOperatorArtifacts)[number];
type PilotPointerMode = (typeof pointerModes)[PilotPointerOperatorKey];

declare const selectedPilotPointerOperatorBrand: unique symbol;

/**
 * A module-authenticated selection of one exact code-owned Pilot pointer definition.
 * A structurally identical caller-created object is not an operator capability.
 *
 * @internal
 */
export interface SelectedPilotPointerOperator {
  readonly [selectedPilotPointerOperatorBrand]: true;
  readonly key: PilotPointerOperatorKey;
  readonly pointer_mode: PilotPointerMode;
  readonly catalog_id: string;
  readonly operator_id: string;
  readonly artifact: PilotPointerOperatorArtifact;
  readonly binding: PilotMutationOperatorBinding;
  readonly definition: PilotMutationOperatorDefinition;
}

type PredicateState = "fail" | "pass";

export interface PilotPointerProbeObservation<Probe extends string = string> {
  readonly probe: Probe;
  readonly state: "pass";
}

type ProbeObservation<Probe extends string> = PilotPointerProbeObservation<Probe>;

export type PilotPointerSourceProbeObservationTuple = readonly [
  ProbeObservation<"runtime_clean">,
  ProbeObservation<"bindings_resolve_once">,
  ProbeObservation<"primary_native_enabled_visible">,
  ProbeObservation<"primary_source_center_hit">,
  ProbeObservation<"local_task_predicate_passes">,
  ProbeObservation<"owned_handle_absent">,
  ProbeObservation<"preimage_hashes_bound">,
];

export type PilotPointerInstalledProbeObservationTuple = readonly [
  ProbeObservation<"owned_surface_exact">,
  ProbeObservation<"family_effect_exact">,
  ProbeObservation<"changed_surface_bounded">,
  ProbeObservation<"local_predicate_expected">,
  ProbeObservation<"orthogonal_predicates_preserved">,
];

export type PilotPointerRoundtripProbeObservationTuple = readonly [
  ProbeObservation<"owned_handles_absent">,
  ProbeObservation<"mutation_preimages_equal">,
  ProbeObservation<"listener_registry_equal">,
  ProbeObservation<"dom_roundtrip_equal">,
  ProbeObservation<"computed_style_roundtrip_equal">,
  ProbeObservation<"pixel_roundtrip_equal">,
  ProbeObservation<"accessibility_roundtrip_equal">,
  ProbeObservation<"layout_roundtrip_equal">,
  ProbeObservation<"hit_test_roundtrip_equal">,
  ProbeObservation<"focus_and_scroll_roundtrip_equal">,
  ProbeObservation<"runtime_clean">,
];

export type PilotPointerCleanupProbeObservationTuple =
  PilotPointerRoundtripProbeObservationTuple;

const authenticatedSelections = new WeakSet<object>();
const selections = new Map<PilotPointerOperatorKey, SelectedPilotPointerOperator>();

function fail(code: string, message: string, options?: ErrorOptions): never {
  throw new PilotFixtureAuthoringRuntimeError(code, message, options);
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function exactArtifactFor(key: PilotPointerOperatorKey): PilotPointerOperatorArtifact {
  const definitionKey = pointerDefinitionKeys[key];
  const matches = pilotV01MutationOperatorArtifacts.filter(
    ({ definition }) => definition.definition_key === definitionKey,
  );
  if (matches.length !== 1 || matches[0] === undefined) {
    fail(
      "pilot_runtime.pointer_operator_catalog",
      `the code-owned catalog must contain one exact ${definitionKey} artifact`,
    );
  }
  return matches[0];
}

function exactCatalogBindingFor(
  artifact: PilotPointerOperatorArtifact,
): PilotMutationOperatorBinding {
  const matches = pilotV01MutationOperatorCatalog.operators.filter(
    ({ operator_id }) => operator_id === artifact.operator_id,
  );
  if (matches.length !== 1 || matches[0] === undefined) {
    fail(
      "pilot_runtime.pointer_operator_catalog",
      "the selected pointer artifact must have one exact code-owned catalog binding",
    );
  }
  return matches[0];
}

function assertCatalogSelectionBinding(
  key: PilotPointerOperatorKey,
  artifact: PilotPointerOperatorArtifact,
  binding: PilotMutationOperatorBinding,
): void {
  const definition = artifact.definition;
  const expectedDefinitionKey = pointerDefinitionKeys[key];
  const canonicalDefinition = canonicalJson(definition);
  const expectedReference = {
    sha256: sha256Hex(canonicalDefinition),
    byte_length: Buffer.byteLength(canonicalDefinition, "utf8"),
    media_type: "application/vnd.impactdiff.mutation-operator+json",
    format_version: 1,
  } as const;
  const expectedBinding = {
    mutation_family_id: definition.mutation_family_id,
    declared_relation_variant: definition.declared_relation_variant,
    operator_version: definition.operator_version,
    operator_definition: artifact.reference,
    operator_id: artifact.operator_id,
  } as const;
  const expectedOperatorId = computePilotMutationOperatorId(expectedBinding);

  if (
    definition.definition_key !== expectedDefinitionKey ||
    definition.family_key !== "pointer_hit_testing" ||
    definition.declared_relation_variant !== pointerRelations[key] ||
    definition.effect.kind !== "pointer_hit_testing" ||
    definition.effect.pointer_mode !== pointerModes[key] ||
    definition.expected_local_task_predicate.predicate !==
      pilotMutationLocalPredicateKeys[0] ||
    definition.expected_local_task_predicate.state !== pointerExpectedStates[key] ||
    artifact.canonical_json !== canonicalDefinition ||
    !sameJson(artifact.reference, expectedReference) ||
    artifact.operator_id !== expectedOperatorId ||
    !sameJson(binding, expectedBinding)
  ) {
    fail(
      "pilot_runtime.pointer_operator_catalog",
      `the ${key} selection is not bound across its definition, artifact, operator, and catalog row`,
    );
  }

  if (
    pilotV01MutationOperatorCatalog.catalog_id !==
    computePilotMutationOperatorCatalogId(pilotV01MutationOperatorCatalog)
  ) {
    fail(
      "pilot_runtime.pointer_operator_catalog",
      "the code-owned Pilot operator catalog identity is not self-consistent",
    );
  }

  if (
    !sameJson(definition.required_probes.source, pointerSourceProbeCodes) ||
    !sameJson(definition.required_probes.installed, pilotMutationInstalledProbeCodes) ||
    !sameJson(
      definition.required_probes.inverse_roundtrip,
      pilotMutationRoundtripProbeCodes,
    ) ||
    !sameJson(definition.cleanup_audit.required, pilotMutationRoundtripProbeCodes) ||
    definition.installed_predicate_policy.policy_version !== 1 ||
    definition.installed_predicate_policy.vector.some(
      ({ predicate }, index) => predicate !== pilotMutationLocalPredicateKeys[index],
    )
  ) {
    fail(
      "pilot_runtime.pointer_operator_catalog",
      `the ${key} definition does not carry the exact code-owned predicate and probe order`,
    );
  }
}

function createSelection(key: PilotPointerOperatorKey): SelectedPilotPointerOperator {
  const artifact = exactArtifactFor(key);
  const binding = exactCatalogBindingFor(artifact);
  assertCatalogSelectionBinding(key, artifact, binding);
  const selection = Object.freeze({
    key,
    pointer_mode: pointerModes[key],
    catalog_id: pilotV01MutationOperatorCatalog.catalog_id,
    operator_id: artifact.operator_id,
    artifact,
    binding,
    definition: artifact.definition,
  }) as SelectedPilotPointerOperator;
  authenticatedSelections.add(selection);
  return selection;
}

for (const key of pointerOperatorKeys) {
  selections.set(key, createSelection(key));
}

/** @internal Selects only the exact pointer pair from the code-owned Pilot catalog. */
export function selectPilotPointerOperator(key: unknown): SelectedPilotPointerOperator {
  if (typeof key !== "string" || !pointerOperatorKeys.includes(key as never)) {
    fail(
      "pilot_runtime.pointer_operator_key",
      "Pilot pointer operator key must be exactly intercept or pass",
    );
  }
  const selection = selections.get(key as PilotPointerOperatorKey);
  if (selection === undefined) {
    fail(
      "pilot_runtime.pointer_operator_catalog",
      "the exact code-owned pointer operator selection is unavailable",
    );
  }
  return selection;
}

/** @internal Rejects structural or cloned substitutes for a selected capability. */
export function assertSelectedPilotPointerOperator(
  value: unknown,
): SelectedPilotPointerOperator {
  if (
    value === null ||
    typeof value !== "object" ||
    !authenticatedSelections.has(value)
  ) {
    fail(
      "pilot_runtime.pointer_operator_authentication",
      "pointer operator use requires the exact module-authenticated selection capability",
    );
  }
  return value as SelectedPilotPointerOperator;
}

function exactDataRow(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail("pilot_runtime.pointer_observation", `${label} must be a plain data object`);
  }
  const record = value as Record<string, unknown>;
  const ownKeys = Reflect.ownKeys(record);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) {
    fail(
      "pilot_runtime.pointer_observation",
      `${label} must contain only its exact required fields`,
    );
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !("value" in descriptor)
    ) {
      fail(
        "pilot_runtime.pointer_observation",
        `${label} field ${key} must be an enumerable data property`,
      );
    }
  }
  return record;
}

function exactArray(value: unknown, length: number, label: string): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length !== length
  ) {
    fail(
      "pilot_runtime.pointer_observation",
      `${label} must contain exactly ${length} rows`,
    );
  }
  const expectedKeys = new Set(["length"]);
  for (let index = 0; index < length; index += 1) {
    expectedKeys.add(String(index));
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.size ||
    ownKeys.some((key) => typeof key !== "string" || !expectedKeys.has(key))
  ) {
    fail(
      "pilot_runtime.pointer_observation",
      `${label} cannot contain sparse, named, or symbol fields`,
    );
  }
  const rows: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !("value" in descriptor)
    ) {
      fail(
        "pilot_runtime.pointer_observation",
        `${label} row ${index} must be an enumerable data property`,
      );
    }
    rows.push(descriptor.value);
  }
  return rows;
}

function exactPredicateObservations(
  value: unknown,
  expectedStates: readonly PredicateState[],
  label: string,
): PilotMutationPredicateObservationTuple {
  const rows = exactArray(value, pilotMutationLocalPredicateKeys.length, label);
  const result = rows.map((row, index) => {
    const record = exactDataRow(row, ["predicate", "state"], `${label} row ${index}`);
    const expectedPredicate = pilotMutationLocalPredicateKeys[index];
    const expectedState = expectedStates[index];
    if (
      record.predicate !== expectedPredicate ||
      record.state !== expectedState ||
      (record.state !== "pass" && record.state !== "fail")
    ) {
      fail(
        "pilot_runtime.pointer_predicate_policy",
        `${label} row ${index} must equal the exact code-owned ${expectedPredicate}=${expectedState} policy`,
      );
    }
    return Object.freeze({ predicate: expectedPredicate, state: expectedState });
  });
  return Object.freeze(result) as unknown as PilotMutationPredicateObservationTuple;
}

/**
 * Validates and defensively freezes the exact all-pass source predicate vector.
 *
 * @internal
 */
export function assertPilotPointerSourcePredicates(
  selected: unknown,
  observations: unknown,
): PilotMutationPredicateObservationTuple {
  assertSelectedPilotPointerOperator(selected);
  return exactPredicateObservations(
    observations,
    pilotMutationLocalPredicateKeys.map(() => "pass"),
    "pointer source predicate observations",
  );
}

/**
 * Validates and defensively freezes the complete installed vector against the exact
 * selected definition policy, including designated and correlated pointer failures.
 *
 * @internal
 */
export function assertPilotPointerInstalledPredicates(
  selected: unknown,
  observations: unknown,
): PilotMutationPredicateObservationTuple {
  const selection = assertSelectedPilotPointerOperator(selected);
  return exactPredicateObservations(
    observations,
    selection.definition.installed_predicate_policy.vector.map(
      ({ expected_state: state }) => state,
    ),
    "pointer installed predicate observations",
  );
}

function exactProbeObservations(
  value: unknown,
  expectedProbes: readonly string[],
  label: string,
): readonly PilotPointerProbeObservation[] {
  const rows = exactArray(value, expectedProbes.length, label);
  return Object.freeze(
    rows.map((row, index) => {
      const record = exactDataRow(row, ["probe", "state"], `${label} row ${index}`);
      const expectedProbe = expectedProbes[index];
      if (expectedProbe === undefined) {
        fail(
          "pilot_runtime.pointer_probe_policy",
          `${label} contains a row outside its code-owned probe sequence`,
        );
      }
      if (record.probe !== expectedProbe || record.state !== "pass") {
        fail(
          "pilot_runtime.pointer_probe_policy",
          `${label} row ${index} must be the exact passing ${expectedProbe} probe`,
        );
      }
      return Object.freeze({ probe: expectedProbe, state: "pass" as const });
    }),
  );
}

/** @internal */
export function createPilotPointerSourceProbeObservations(
  selected: unknown,
  observations: unknown,
): PilotPointerSourceProbeObservationTuple {
  const selection = assertSelectedPilotPointerOperator(selected);
  return exactProbeObservations(
    observations,
    selection.definition.required_probes.source,
    "pointer source probe observations",
  ) as PilotPointerSourceProbeObservationTuple;
}

/** @internal */
export function createPilotPointerInstalledProbeObservations(
  selected: unknown,
  observations: unknown,
): PilotPointerInstalledProbeObservationTuple {
  const selection = assertSelectedPilotPointerOperator(selected);
  return exactProbeObservations(
    observations,
    selection.definition.required_probes.installed,
    "pointer installed probe observations",
  ) as PilotPointerInstalledProbeObservationTuple;
}

/** @internal */
export function createPilotPointerRoundtripProbeObservations(
  selected: unknown,
  observations: unknown,
): PilotPointerRoundtripProbeObservationTuple {
  const selection = assertSelectedPilotPointerOperator(selected);
  return exactProbeObservations(
    observations,
    selection.definition.required_probes.inverse_roundtrip,
    "pointer inverse-roundtrip probe observations",
  ) as PilotPointerRoundtripProbeObservationTuple;
}

/** @internal */
export function createPilotPointerCleanupProbeObservations(
  selected: unknown,
  observations: unknown,
): PilotPointerCleanupProbeObservationTuple {
  const selection = assertSelectedPilotPointerOperator(selected);
  return exactProbeObservations(
    observations,
    selection.definition.cleanup_audit.required,
    "pointer cleanup probe observations",
  ) as PilotPointerCleanupProbeObservationTuple;
}
