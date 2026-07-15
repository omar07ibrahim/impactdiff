import { canonicalJson, parseCanonicalJson } from "../contracts/canonical.js";
import type { ParseLimits } from "../contracts/canonical.js";
import {
  parseAccessibilitySnapshot,
  parseActionPlan,
  parseCaptureSpec,
  parseLayoutSnapshot,
} from "../capture/validate.js";
import { maximumCapturePngBytes } from "../capture/limits.js";
import type {
  AccessibilitySnapshot,
  ActionPlan,
  CaptureSpec,
  LayoutSnapshot,
} from "../capture/schema.js";
import { parseSourceState } from "../source/validate.js";
import type { SourceState } from "../source/schema.js";
import {
  validateChangedSurface,
  validateLocalization,
  validateOracleResult,
  validateRawTrace,
} from "../sealed/validate.js";
import type {
  ChangedSurface,
  Localization,
  OracleResult,
  RawTrace,
} from "../sealed/schema.js";
import {
  validateMutationPlan,
  validatePreconditionReport,
} from "../mutations/compiler.js";
import type { MutationPlan, PreconditionReport } from "../mutations/schema.js";
import type { ArtifactCodec } from "./cas.js";
import { CanonicalPng, canonicalizePng } from "./png.js";

type ByteParser<T> = (input: Uint8Array) => T;

function strictJsonCodec<T>(
  mediaType: string,
  maximumBytes: number,
  parse: ByteParser<T>,
): ArtifactCodec<T> {
  return Object.freeze({
    mediaType,
    maximumBytes,
    canonicalize: (bytes: Buffer) => {
      const value = parse(bytes);
      return Buffer.from(canonicalJson(value), "utf8");
    },
    validate: (bytes: Buffer) => parse(bytes),
  });
}

export const actionPlanCodec = strictJsonCodec<ActionPlan>(
  "application/vnd.impactdiff.action-plan+json",
  131_072,
  parseActionPlan,
);

export const captureSpecCodec = strictJsonCodec<CaptureSpec>(
  "application/vnd.impactdiff.capture-spec+json",
  65_536,
  parseCaptureSpec,
);

export const accessibilityCodec = strictJsonCodec<AccessibilitySnapshot>(
  "application/vnd.impactdiff.accessibility+json",
  2_097_152,
  parseAccessibilitySnapshot,
);

export const layoutCodec = strictJsonCodec<LayoutSnapshot>(
  "application/vnd.impactdiff.layout+json",
  4_194_304,
  parseLayoutSnapshot,
);

export const sourceStateCodec = strictJsonCodec<SourceState>(
  "application/vnd.impactdiff.source-state+json",
  1_048_576,
  parseSourceState,
);

const mutationLimits = Object.freeze({
  maximumBytes: 131_072,
  maximumDepth: 16,
  maximumValues: 20_000,
}) satisfies ParseLimits;

const changedSurfaceLimits = Object.freeze({
  maximumBytes: 1_048_576,
  maximumDepth: 12,
  maximumValues: 2_048,
}) satisfies ParseLimits;
const oracleResultLimits = Object.freeze({
  maximumBytes: 131_072,
  maximumDepth: 8,
  maximumValues: 256,
}) satisfies ParseLimits;
const rawTraceLimits = Object.freeze({
  maximumBytes: 4_194_304,
  maximumDepth: 8,
  maximumValues: 50_000,
}) satisfies ParseLimits;
const localizationLimits = Object.freeze({
  maximumBytes: 1_048_576,
  maximumDepth: 12,
  maximumValues: 2_048,
}) satisfies ParseLimits;

export const mutationPlanCodec = strictJsonCodec<MutationPlan>(
  "application/vnd.impactdiff.intervention-parameters+json",
  131_072,
  (bytes) => validateMutationPlan(parseCanonicalJson(bytes, mutationLimits)),
);

export const preconditionReportCodec = strictJsonCodec<PreconditionReport>(
  "application/vnd.impactdiff.intervention-preconditions+json",
  131_072,
  (bytes) => validatePreconditionReport(parseCanonicalJson(bytes, mutationLimits)),
);

export const changedSurfaceCodec = strictJsonCodec<ChangedSurface>(
  "application/vnd.impactdiff.changed-surface+json",
  1_048_576,
  (bytes) => validateChangedSurface(parseCanonicalJson(bytes, changedSurfaceLimits)),
);

export const oracleResultCodec = strictJsonCodec<OracleResult>(
  "application/vnd.impactdiff.oracle-result+json",
  131_072,
  (bytes) => validateOracleResult(parseCanonicalJson(bytes, oracleResultLimits)),
);

export const rawTraceCodec = strictJsonCodec<RawTrace>(
  "application/vnd.impactdiff.raw-trace+json",
  4_194_304,
  (bytes) => validateRawTrace(parseCanonicalJson(bytes, rawTraceLimits)),
);

export const localizationCodec = strictJsonCodec<Localization>(
  "application/vnd.impactdiff.localization+json",
  1_048_576,
  (bytes) => validateLocalization(parseCanonicalJson(bytes, localizationLimits)),
);

export function pngCodec(expectedDimensions?: {
  readonly width: number;
  readonly height: number;
}): ArtifactCodec<CanonicalPng> {
  const dimensions =
    expectedDimensions === undefined
      ? undefined
      : Object.freeze({ ...expectedDimensions });
  return Object.freeze({
    mediaType: "image/png",
    maximumBytes: maximumCapturePngBytes,
    canonicalize: (bytes: Buffer) => canonicalizePng(bytes, dimensions).bytes,
    validate: (bytes: Buffer) => canonicalizePng(bytes, dimensions),
  });
}
