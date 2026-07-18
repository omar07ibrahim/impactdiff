import type { ElementHandle, JSHandle } from "@playwright/test";

import {
  parseAccessibilitySnapshot,
  parseLayoutSnapshot,
} from "../../capture/validate.js";
import { contrastRatioMilli, type Rgb } from "../../mutations/palette.js";
import { pilotMutationLocalPredicateKeys } from "../../mutations/catalog/schema.js";
import { PilotFixtureAuthoringCheckpointBytes } from "./checkpoint.js";
import { PilotFixtureAuthoringRuntimeError } from "./errors.js";

const actionTargetIdPattern = /^idat1_[0-9a-f]{64}$/u;
const maximumCssValueLength = 256;

export interface PilotPredicateSourcePoint {
  readonly x: number;
  readonly y: number;
}

interface PilotPredicatePageEvidence {
  readonly hitPrimary: boolean;
  readonly primaryFullyVisible: boolean;
  readonly sourcePointWithinPrimary: boolean;
  readonly primaryEnabled: boolean;
  readonly focusReachesPrimary: boolean;
  readonly contentContained: boolean;
  readonly foregroundColor: string;
  readonly backgroundColor: string;
  readonly backgroundImage: string;
  readonly opacity: string;
}

/** @internal Retained only by the pre-navigation Pilot page guard. */
export interface PilotPredicatePageGuardApi {
  readonly predicateSnapshot: (
    primary: Element,
    clipHost: Element,
    contentPressure: Element,
    sourcePoint: PilotPredicateSourcePoint,
  ) => PilotPredicatePageEvidence;
}

type PilotMutationPredicateKey = (typeof pilotMutationLocalPredicateKeys)[number];
type PilotMutationPredicateState = "fail" | "pass";

export interface PilotMutationPredicateObservation {
  readonly predicate: PilotMutationPredicateKey;
  readonly state: PilotMutationPredicateState;
}

type ObservationAt<Index extends number> = Omit<
  PilotMutationPredicateObservation,
  "predicate"
> & {
  readonly predicate: (typeof pilotMutationLocalPredicateKeys)[Index];
};

export type PilotMutationPredicateObservationTuple = readonly [
  ObservationAt<0>,
  ObservationAt<1>,
  ObservationAt<2>,
  ObservationAt<3>,
  ObservationAt<4>,
  ObservationAt<5>,
  ObservationAt<6>,
  ObservationAt<7>,
];

export interface PilotMutationPredicateMeasurementInput {
  readonly primary: ElementHandle<Element>;
  readonly clipHost: ElementHandle<Element>;
  readonly contentPressure: ElementHandle<Element>;
  readonly pageGuard: JSHandle<PilotPredicatePageGuardApi>;
  readonly sourcePoint: PilotPredicateSourcePoint;
  readonly prePrimaryCheckpoint: PilotFixtureAuthoringCheckpointBytes;
  readonly primaryActionTargetId: string;
}

function fail(code: string, message: string, options?: ErrorOptions): never {
  throw new PilotFixtureAuthoringRuntimeError(code, message, options);
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
    fail("pilot_runtime.predicate_evidence", `${label} must be a plain data object`);
  }
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (keys.some((key) => typeof key !== "string")) {
    fail("pilot_runtime.predicate_evidence", `${label} cannot contain symbol fields`);
  }
  const actualKeys = (keys as string[]).sort(codeUnitCompare);
  const requiredKeys = [...expectedKeys].sort(codeUnitCompare);
  if (
    actualKeys.length !== requiredKeys.length ||
    actualKeys.some((key, index) => key !== requiredKeys[index])
  ) {
    fail(
      "pilot_runtime.predicate_evidence",
      `${label} must contain only its exact required fields`,
    );
  }
  for (const key of requiredKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !("value" in descriptor)
    ) {
      fail(
        "pilot_runtime.predicate_evidence",
        `${label} field ${key} must be an enumerable data property`,
      );
    }
  }
  return record;
}

function exactFrozenSourcePoint(value: unknown): PilotPredicateSourcePoint {
  const record = exactDataRecord(value, ["x", "y"], "source point");
  if (
    !Object.isFrozen(value) ||
    typeof record.x !== "number" ||
    typeof record.y !== "number" ||
    !Number.isFinite(record.x) ||
    !Number.isFinite(record.y) ||
    !Number.isSafeInteger(Math.trunc(record.x * 1_000)) ||
    !Number.isSafeInteger(Math.trunc(record.y * 1_000))
  ) {
    fail(
      "pilot_runtime.predicate_input",
      "source point must be frozen, finite, and bounded to milli-CSS-pixel precision",
    );
  }
  return value as PilotPredicateSourcePoint;
}

const evidenceKeys = Object.freeze([
  "hitPrimary",
  "primaryFullyVisible",
  "sourcePointWithinPrimary",
  "primaryEnabled",
  "focusReachesPrimary",
  "contentContained",
  "foregroundColor",
  "backgroundColor",
  "backgroundImage",
  "opacity",
] as const satisfies readonly (keyof PilotPredicatePageEvidence)[]);

function boundedCssValue(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumCssValueLength
  ) {
    fail(
      "pilot_runtime.predicate_evidence",
      `predicate ${field} must be a bounded non-empty computed CSS value`,
    );
  }
  return value;
}

function validatePageEvidence(value: unknown): PilotPredicatePageEvidence {
  const record = exactDataRecord(value, evidenceKeys, "page predicate evidence");
  for (const field of [
    "hitPrimary",
    "primaryFullyVisible",
    "sourcePointWithinPrimary",
    "primaryEnabled",
    "focusReachesPrimary",
    "contentContained",
  ] as const) {
    if (typeof record[field] !== "boolean") {
      fail(
        "pilot_runtime.predicate_evidence",
        `predicate ${field} must contain a native boolean`,
      );
    }
  }
  return Object.freeze({
    hitPrimary: record.hitPrimary as boolean,
    primaryFullyVisible: record.primaryFullyVisible as boolean,
    sourcePointWithinPrimary: record.sourcePointWithinPrimary as boolean,
    primaryEnabled: record.primaryEnabled as boolean,
    focusReachesPrimary: record.focusReachesPrimary as boolean,
    contentContained: record.contentContained as boolean,
    foregroundColor: boundedCssValue(record.foregroundColor, "foregroundColor"),
    backgroundColor: boundedCssValue(record.backgroundColor, "backgroundColor"),
    backgroundImage: boundedCssValue(record.backgroundImage, "backgroundImage"),
    opacity: boundedCssValue(record.opacity, "opacity"),
  });
}

async function pagePredicateEvidence(
  input: PilotMutationPredicateMeasurementInput,
  sourcePoint: PilotPredicateSourcePoint,
): Promise<PilotPredicatePageEvidence> {
  let evidence: unknown;
  try {
    const collect = (
      primary: Element,
      {
        clipHost,
        contentPressure,
        pageGuard,
        point,
      }: {
        readonly clipHost: Element;
        readonly contentPressure: Element;
        readonly pageGuard: PilotPredicatePageGuardApi;
        readonly point: PilotPredicateSourcePoint;
      },
    ): PilotPredicatePageEvidence =>
      pageGuard.predicateSnapshot(primary, clipHost, contentPressure, point);
    const evaluate = input.primary.evaluate.bind(input.primary) as unknown as (
      pageFunction: typeof collect,
      argument: unknown,
    ) => Promise<unknown>;
    evidence = await evaluate(collect, {
      clipHost: input.clipHost,
      contentPressure: input.contentPressure,
      pageGuard: input.pageGuard,
      point: sourcePoint,
    });
  } catch (error) {
    fail(
      "pilot_runtime.predicate_probe",
      "retained Pilot page predicate evidence could not be collected",
      { cause: error },
    );
  }
  return validatePageEvidence(evidence);
}

function primaryAccessibleName(
  checkpoint: PilotFixtureAuthoringCheckpointBytes,
  primaryActionTargetId: string,
): string {
  if (!(checkpoint instanceof PilotFixtureAuthoringCheckpointBytes)) {
    fail(
      "pilot_runtime.predicate_checkpoint",
      "predicate measurement requires an authenticated Pilot checkpoint capability",
    );
  }
  if (checkpoint.ordinal !== 1) {
    fail(
      "pilot_runtime.predicate_checkpoint",
      "predicate measurement requires the exact pre-primary checkpoint",
    );
  }
  if (!actionTargetIdPattern.test(primaryActionTargetId)) {
    fail(
      "pilot_runtime.predicate_input",
      "primary action target ID must use the exact idat1 SHA-256 form",
    );
  }

  let accessibility;
  let layout;
  try {
    accessibility = parseAccessibilitySnapshot(checkpoint.accessibility_tree);
    layout = parseLayoutSnapshot(checkpoint.layout_graph);
  } catch (error) {
    fail(
      "pilot_runtime.predicate_checkpoint",
      "pre-primary checkpoint modalities could not be validated",
      { cause: error },
    );
  }

  const targetRows = layout.nodes.filter(
    (node) => node.action_target_id === primaryActionTargetId,
  );
  if (targetRows.length !== 1 || targetRows[0]?.kind !== "element") {
    fail(
      "pilot_runtime.predicate_accessibility",
      "pre-primary layout must contain one exact primary-action element",
    );
  }
  const target = targetRows[0];
  const accessibilityRows = accessibility.nodes.filter(
    (node) => node.layout_node_index === target.index,
  );
  if (accessibilityRows.length !== 1 || accessibilityRows[0]?.role !== "button") {
    fail(
      "pilot_runtime.predicate_accessibility",
      "pre-primary accessibility must contain one button linked to the primary action",
    );
  }
  return accessibilityRows[0].name;
}

function opaqueRgb(value: string, label: string): Rgb {
  const match = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/u.exec(value);
  if (match === null) {
    fail(
      "pilot_runtime.predicate_contrast",
      `${label} must be one opaque computed sRGB color`,
    );
  }
  const channels = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  if (
    !channels.every(
      (channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255,
    )
  ) {
    fail(
      "pilot_runtime.predicate_contrast",
      `${label} contains an out-of-range sRGB channel`,
    );
  }
  return channels;
}

function primaryContrastPasses(evidence: PilotPredicatePageEvidence): boolean {
  if (evidence.backgroundImage !== "none" || evidence.opacity !== "1") {
    fail(
      "pilot_runtime.predicate_contrast",
      "primary contrast requires one fully opaque solid computed background",
    );
  }
  const foreground = opaqueRgb(evidence.foregroundColor, "primary foreground");
  const background = opaqueRgb(evidence.backgroundColor, "primary background");
  return contrastRatioMilli(foreground, background) >= 4_500;
}

function observation<Key extends PilotMutationPredicateKey>(
  predicate: Key,
  passed: boolean,
): PilotMutationPredicateObservation & { readonly predicate: Key } {
  return Object.freeze({ predicate, state: passed ? "pass" : "fail" });
}

/**
 * Measures the closed Pilot predicate vector at the pre-primary action boundary.
 * The browser guard supplies native DOM/style evidence; the authenticated checkpoint
 * supplies the browser-computed accessible name. No fixture-provided predicate value is
 * accepted, and malformed or ambiguous observations are technical runtime failures.
 *
 * @internal Called only while the owning Pilot session retains all supplied handles.
 */
export async function measurePilotMutationPredicates(
  input: PilotMutationPredicateMeasurementInput,
): Promise<PilotMutationPredicateObservationTuple> {
  const sourcePoint = exactFrozenSourcePoint(input.sourcePoint);
  const evidence = await pagePredicateEvidence(input, sourcePoint);
  const accessibleName = primaryAccessibleName(
    input.prePrimaryCheckpoint,
    input.primaryActionTargetId,
  );
  const contrastPasses = primaryContrastPasses(evidence);

  return Object.freeze([
    observation(pilotMutationLocalPredicateKeys[0], evidence.hitPrimary),
    observation(
      pilotMutationLocalPredicateKeys[1],
      evidence.primaryFullyVisible && evidence.hitPrimary,
    ),
    observation(
      pilotMutationLocalPredicateKeys[2],
      evidence.sourcePointWithinPrimary && evidence.hitPrimary,
    ),
    observation(pilotMutationLocalPredicateKeys[3], evidence.primaryEnabled),
    observation(pilotMutationLocalPredicateKeys[4], evidence.focusReachesPrimary),
    observation(pilotMutationLocalPredicateKeys[5], accessibleName.length > 0),
    observation(pilotMutationLocalPredicateKeys[6], evidence.contentContained),
    observation(pilotMutationLocalPredicateKeys[7], contrastPasses),
  ]);
}
