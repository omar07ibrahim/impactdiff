import {
  accessibilityCodec,
  actionPlanCodec,
  captureSpecCodec,
  changedSurfaceCodec,
  layoutCodec,
  localizationCodec,
  mutationPlanCodec,
  oracleResultCodec,
  pngCodec,
  preconditionReportCodec,
  rawTraceCodec,
  sourceStateCodec,
} from "../artifacts/codecs.js";
import type { ArtifactCodec } from "../artifacts/cas.js";
import { ImmutableMapView } from "../contracts/immutable-map.js";

export interface PublicationCodecSet {
  readonly codecs: readonly ArtifactCodec<unknown>[];
  readonly byMediaType: ReadonlyMap<string, ArtifactCodec<unknown>>;
}

/**
 * Creates the closed v1 codec authority used by paired publication. Callers
 * receive fresh immutable containers, but cannot add a decoder for an
 * unrecognized media type or replace a project-owned decoder.
 */
export function createPublicationCodecSet(): PublicationCodecSet {
  const codecs: readonly ArtifactCodec<unknown>[] = Object.freeze([
    actionPlanCodec,
    captureSpecCodec,
    pngCodec(),
    accessibilityCodec,
    layoutCodec,
    sourceStateCodec,
    mutationPlanCodec,
    preconditionReportCodec,
    changedSurfaceCodec,
    oracleResultCodec,
    rawTraceCodec,
    localizationCodec,
  ]);
  const entries = codecs.map((codec) => [codec.mediaType, codec] as const);
  const byMediaType = new ImmutableMapView(entries);
  if (byMediaType.size !== codecs.length) {
    throw new Error("publication codecs must have unique media types");
  }
  return Object.freeze({ codecs, byMediaType });
}
