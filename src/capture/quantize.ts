import { ContractValidationError, issue } from "../contracts/errors.js";

const quantizationContract = "impactdiff.geometry-quantization/v1";

export const minimumQ64Coordinate = -16_777_216;
export const maximumQ64Coordinate = 16_777_216;

function quantizationFailure(code: string, message: string): never {
  throw new ContractValidationError(quantizationContract, [
    issue(code, "/value", message),
  ]);
}

/**
 * Rounds a finite number to the nearest integer, resolving exact half-way
 * cases toward the even integer. Math.round cannot be used here because its
 * tie rule is asymmetric for negative values.
 */
export function roundNearestTiesToEven(value: number): number {
  if (!Number.isFinite(value)) {
    quantizationFailure(
      "geometry.non_finite",
      "geometry values must be finite numbers",
    );
  }

  const lower = Math.floor(value);
  const fraction = value - lower;
  let rounded: number;

  if (fraction < 0.5) {
    rounded = lower;
  } else if (fraction > 0.5) {
    rounded = lower + 1;
  } else {
    rounded = lower % 2 === 0 ? lower : lower + 1;
  }

  if (!Number.isSafeInteger(rounded)) {
    quantizationFailure(
      "geometry.unsafe_integer",
      "rounded geometry values must be safe integers",
    );
  }
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Converts CSS pixels to the schema's integer 1/64 CSS-pixel unit. */
export function quantizeCssPixelToQ64(value: number): number {
  if (!Number.isFinite(value)) {
    quantizationFailure(
      "geometry.non_finite",
      "CSS pixel values must be finite numbers",
    );
  }

  const scaled = value * 64;
  if (!Number.isFinite(scaled)) {
    quantizationFailure(
      "geometry.out_of_range",
      "CSS pixel values exceed the Q64 coordinate range",
    );
  }

  const quantized = roundNearestTiesToEven(scaled);
  if (quantized < minimumQ64Coordinate || quantized > maximumQ64Coordinate) {
    quantizationFailure(
      "geometry.out_of_range",
      "CSS pixel values exceed the Q64 coordinate range",
    );
  }
  return quantized;
}
