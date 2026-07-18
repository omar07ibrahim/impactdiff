import type { ElementHandle, JSHandle } from "@playwright/test";

import { PilotFixtureAuthoringRuntimeError } from "./errors.js";
import {
  assertSelectedPilotPointerOperator,
  type SelectedPilotPointerOperator,
} from "./pointer-operator.js";

export type PilotPointerMode = "intercept" | "pass_through";

export interface PilotPointerLayerProbe {
  readonly applicationOrdinal: 0 | 1;
  readonly pointerMode: PilotPointerMode;
  readonly connected: boolean;
  readonly parentIsBody: boolean;
  readonly structureExact: boolean;
  readonly attributesExact: boolean;
  readonly stylesheetExact: boolean;
  readonly geometryExact: boolean;
  readonly transparentPaint: boolean;
  readonly accessibilityHidden: boolean;
  readonly nonFocusable: boolean;
  readonly sourceHit: "owned_layer" | "primary" | "other";
  readonly mutationRecordExact: boolean;
}

export interface PilotPointerRemovalProbe {
  readonly applicationOrdinal: 0 | 1;
  readonly mutationRecordExact: boolean;
  readonly ownedHandlesAbsent: boolean;
  readonly mutationPreimagesEqual: boolean;
  readonly listenerRegistryEqual: boolean;
  readonly runtimeClean: boolean;
}

export interface PilotPointerLifecycleProbe {
  readonly state: "unstarted" | "clean" | "installed" | "closed" | "poisoned";
  readonly installCount: 0 | 1 | 2;
  readonly removalCount: 0 | 1 | 2;
  readonly activeOwnedHandleCount: 0 | 1;
  readonly listenerRegistryEqual: boolean;
  readonly listenerRegistryOverflow: boolean;
  readonly mutationAdmissionClean: boolean;
}

/** @internal Retained only as a page-world capability by an owning Pilot session. */
export interface PilotPointerMutationAuditApi {
  readonly beginOwnedPointerLifecycle: (
    primary: Element,
    sourcePoint: Readonly<{ x: number; y: number }>,
    pointerMode: PilotPointerMode,
  ) => PilotPointerLifecycleProbe;
  readonly installOwnedPointerLayer: () => PilotPointerLayerProbe;
  readonly probeOwnedPointerLayer: () => PilotPointerLayerProbe;
  readonly removeOwnedPointerLayer: () => PilotPointerRemovalProbe;
  readonly finishOwnedPointerLifecycle: () => PilotPointerLifecycleProbe;
}

interface PilotPointerSourcePoint {
  readonly x: number;
  readonly y: number;
}

function fail(code: string, message: string, options?: ErrorOptions): never {
  throw new PilotFixtureAuthoringRuntimeError(code, message, options);
}

function exactDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail("pilot_runtime.pointer_intervention_evidence", `${label} is not plain data`);
  }
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
  ) {
    fail(
      "pilot_runtime.pointer_intervention_evidence",
      `${label} does not contain its exact evidence fields`,
    );
  }
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !("value" in descriptor)
    ) {
      fail(
        "pilot_runtime.pointer_intervention_evidence",
        `${label} field ${key} is not an enumerable data property`,
      );
    }
  }
  return record;
}

const lifecycleKeys = Object.freeze([
  "state",
  "installCount",
  "removalCount",
  "activeOwnedHandleCount",
  "listenerRegistryEqual",
  "listenerRegistryOverflow",
  "mutationAdmissionClean",
] as const);

function assertLifecycleProbe(
  value: unknown,
  expected: Readonly<{
    state: "clean" | "closed";
    installCount: 0 | 2;
    removalCount: 0 | 2;
  }>,
): PilotPointerLifecycleProbe {
  const record = exactDataRecord(value, lifecycleKeys, "pointer lifecycle probe");
  if (
    record.state !== expected.state ||
    record.installCount !== expected.installCount ||
    record.removalCount !== expected.removalCount ||
    record.activeOwnedHandleCount !== 0 ||
    record.listenerRegistryEqual !== true ||
    record.listenerRegistryOverflow !== false ||
    record.mutationAdmissionClean !== true
  ) {
    fail(
      "pilot_runtime.pointer_intervention_probe",
      `pointer lifecycle did not reach exact ${expected.state} state`,
    );
  }
  return Object.freeze({
    state: expected.state,
    installCount: expected.installCount,
    removalCount: expected.removalCount,
    activeOwnedHandleCount: 0,
    listenerRegistryEqual: true,
    listenerRegistryOverflow: false,
    mutationAdmissionClean: true,
  });
}

const layerKeys = Object.freeze([
  "applicationOrdinal",
  "pointerMode",
  "connected",
  "parentIsBody",
  "structureExact",
  "attributesExact",
  "stylesheetExact",
  "geometryExact",
  "transparentPaint",
  "accessibilityHidden",
  "nonFocusable",
  "sourceHit",
  "mutationRecordExact",
] as const);

function assertLayerProbe(
  value: unknown,
  selected: SelectedPilotPointerOperator,
  applicationOrdinal: 0 | 1,
): PilotPointerLayerProbe {
  const record = exactDataRecord(value, layerKeys, "pointer installed probe");
  const expectedHit = selected.pointer_mode === "intercept" ? "owned_layer" : "primary";
  if (
    record.applicationOrdinal !== applicationOrdinal ||
    record.pointerMode !== selected.pointer_mode ||
    record.connected !== true ||
    record.parentIsBody !== true ||
    record.structureExact !== true ||
    record.attributesExact !== true ||
    record.stylesheetExact !== true ||
    record.geometryExact !== true ||
    record.transparentPaint !== true ||
    record.accessibilityHidden !== true ||
    record.nonFocusable !== true ||
    record.sourceHit !== expectedHit ||
    record.mutationRecordExact !== true
  ) {
    fail(
      "pilot_runtime.pointer_intervention_probe",
      `pointer application ${applicationOrdinal} does not match its exact installed mechanism`,
    );
  }
  return Object.freeze({
    applicationOrdinal,
    pointerMode: selected.pointer_mode,
    connected: true,
    parentIsBody: true,
    structureExact: true,
    attributesExact: true,
    stylesheetExact: true,
    geometryExact: true,
    transparentPaint: true,
    accessibilityHidden: true,
    nonFocusable: true,
    sourceHit: expectedHit,
    mutationRecordExact: true,
  });
}

const removalKeys = Object.freeze([
  "applicationOrdinal",
  "mutationRecordExact",
  "ownedHandlesAbsent",
  "mutationPreimagesEqual",
  "listenerRegistryEqual",
  "runtimeClean",
] as const);

function assertRemovalProbe(
  value: unknown,
  applicationOrdinal: 0 | 1,
): PilotPointerRemovalProbe {
  const record = exactDataRecord(value, removalKeys, "pointer removal probe");
  if (
    record.applicationOrdinal !== applicationOrdinal ||
    record.mutationRecordExact !== true ||
    record.ownedHandlesAbsent !== true ||
    record.mutationPreimagesEqual !== true ||
    record.listenerRegistryEqual !== true ||
    record.runtimeClean !== true
  ) {
    fail(
      "pilot_runtime.pointer_intervention_cleanup",
      `pointer application ${applicationOrdinal} did not restore its owned runtime state`,
    );
  }
  return Object.freeze({
    applicationOrdinal,
    mutationRecordExact: true,
    ownedHandlesAbsent: true,
    mutationPreimagesEqual: true,
    listenerRegistryEqual: true,
    runtimeClean: true,
  });
}

function exactSourcePoint(value: PilotPointerSourcePoint): PilotPointerSourcePoint {
  if (
    value === null ||
    typeof value !== "object" ||
    !Object.isFrozen(value) ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y)
  ) {
    fail(
      "pilot_runtime.pointer_intervention_input",
      "pointer intervention requires one frozen finite source point",
    );
  }
  return value;
}

/** @internal */
export async function beginPilotPointerIntervention(
  mutationAudit: JSHandle<PilotPointerMutationAuditApi>,
  primary: ElementHandle<Element>,
  sourcePointValue: PilotPointerSourcePoint,
  selectedValue: unknown,
): Promise<PilotPointerLifecycleProbe> {
  const selected = assertSelectedPilotPointerOperator(selectedValue);
  const sourcePoint = exactSourcePoint(sourcePointValue);
  let probe: unknown;
  try {
    probe = await primary.evaluate(
      (
        element,
        {
          audit,
          point,
          pointerMode,
        }: {
          readonly audit: PilotPointerMutationAuditApi;
          readonly point: PilotPointerSourcePoint;
          readonly pointerMode: PilotPointerMode;
        },
      ) => audit.beginOwnedPointerLifecycle(element, point, pointerMode),
      { audit: mutationAudit, point: sourcePoint, pointerMode: selected.pointer_mode },
    );
  } catch (error) {
    fail(
      "pilot_runtime.pointer_intervention_apply",
      "pointer intervention lifecycle could not begin",
      { cause: error },
    );
  }
  return assertLifecycleProbe(probe, {
    state: "clean",
    installCount: 0,
    removalCount: 0,
  });
}

async function collectLayerProbe(
  mutationAudit: JSHandle<PilotPointerMutationAuditApi>,
  method: "installOwnedPointerLayer" | "probeOwnedPointerLayer",
  selectedValue: unknown,
  applicationOrdinal: 0 | 1,
): Promise<PilotPointerLayerProbe> {
  const selected = assertSelectedPilotPointerOperator(selectedValue);
  let probe: unknown;
  try {
    probe = await mutationAudit.evaluate((audit, methodName) => {
      const operation = audit[methodName];
      return operation();
    }, method);
  } catch (error) {
    fail(
      "pilot_runtime.pointer_intervention_apply",
      `pointer application ${applicationOrdinal} could not be ${method === "installOwnedPointerLayer" ? "installed" : "probed"}`,
      { cause: error },
    );
  }
  return assertLayerProbe(probe, selected, applicationOrdinal);
}

/** @internal */
export async function installPilotPointerIntervention(
  mutationAudit: JSHandle<PilotPointerMutationAuditApi>,
  selected: unknown,
  applicationOrdinal: 0 | 1,
): Promise<PilotPointerLayerProbe> {
  return collectLayerProbe(
    mutationAudit,
    "installOwnedPointerLayer",
    selected,
    applicationOrdinal,
  );
}

/** @internal */
export async function probePilotPointerIntervention(
  mutationAudit: JSHandle<PilotPointerMutationAuditApi>,
  selected: unknown,
  applicationOrdinal: 0 | 1,
): Promise<PilotPointerLayerProbe> {
  return collectLayerProbe(
    mutationAudit,
    "probeOwnedPointerLayer",
    selected,
    applicationOrdinal,
  );
}

/** @internal */
export async function removePilotPointerIntervention(
  mutationAudit: JSHandle<PilotPointerMutationAuditApi>,
  applicationOrdinal: 0 | 1,
): Promise<PilotPointerRemovalProbe> {
  let probe: unknown;
  try {
    probe = await mutationAudit.evaluate((audit) => audit.removeOwnedPointerLayer());
  } catch (error) {
    fail(
      "pilot_runtime.pointer_intervention_cleanup",
      `pointer application ${applicationOrdinal} could not be removed`,
      { cause: error },
    );
  }
  return assertRemovalProbe(probe, applicationOrdinal);
}

/** @internal */
export async function finishPilotPointerIntervention(
  mutationAudit: JSHandle<PilotPointerMutationAuditApi>,
): Promise<PilotPointerLifecycleProbe> {
  let probe: unknown;
  try {
    probe = await mutationAudit.evaluate((audit) =>
      audit.finishOwnedPointerLifecycle(),
    );
  } catch (error) {
    fail(
      "pilot_runtime.pointer_intervention_cleanup",
      "pointer intervention lifecycle could not be closed",
      { cause: error },
    );
  }
  return assertLifecycleProbe(probe, {
    state: "closed",
    installCount: 2,
    removalCount: 2,
  });
}
