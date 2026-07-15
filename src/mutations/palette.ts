import { canonicalSha256 } from "../contracts/canonical.js";

export type Rgb = readonly [number, number, number];

export interface PaletteContrastPair {
  readonly pair_id: "body" | "primary_action";
  readonly foreground_rgb: Rgb;
  readonly background_rgb: Rgb;
  readonly ratio_milli: number;
}

const bodyContrast = Object.freeze({
  pair_id: "body" as const,
  foreground_rgb: Object.freeze([10, 38, 52]) as Rgb,
  background_rgb: Object.freeze([232, 248, 255]) as Rgb,
  ratio_milli: 14_407,
});

const primaryActionContrast = Object.freeze({
  pair_id: "primary_action" as const,
  foreground_rgb: Object.freeze([255, 255, 255]) as Rgb,
  background_rgb: Object.freeze([0, 83, 122]) as Rgb,
  ratio_milli: 8_339,
});

export const oceanPaletteDefinition = Object.freeze({
  contract: "impactdiff.palette-definition" as const,
  version: 1 as const,
  key: "ocean" as const,
  tokens: Object.freeze({
    canvas: "#e8f8ff",
    panel: "#ffffff",
    text: "#0a2634",
    border: "#d0effa",
    primary: "#00537a",
    primary_text: "#ffffff",
  }),
  contrast_pairs: Object.freeze([bodyContrast, primaryActionContrast]),
});

export const oceanPaletteSha256 = canonicalSha256(oceanPaletteDefinition);

function linearChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * linearChannel(rgb[0]) +
    0.7152 * linearChannel(rgb[1]) +
    0.0722 * linearChannel(rgb[2])
  );
}

export function contrastRatioMilli(foreground: Rgb, background: Rgb): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return Math.round(
    ((Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)) * 1_000,
  );
}
