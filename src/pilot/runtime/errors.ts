export class PilotFixtureAuthoringRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PilotFixtureAuthoringRuntimeError";
    this.code = code;
  }
}
