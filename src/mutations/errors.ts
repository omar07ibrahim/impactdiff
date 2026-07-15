export class MutationRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MutationRuntimeError";
    this.code = code;
  }
}
