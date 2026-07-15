export type FixturePairGenerationErrorCode =
  | "generation.artifact"
  | "generation.artifact_overlap"
  | "generation.binding"
  | "generation.checkpoint"
  | "generation.compilation"
  | "generation.input"
  | "generation.oracle_contradiction"
  | "generation.outcome"
  | "generation.validation";

export class FixturePairGenerationError extends Error {
  readonly code: FixturePairGenerationErrorCode;

  constructor(
    code: FixturePairGenerationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FixturePairGenerationError";
    this.code = code;
  }
}
