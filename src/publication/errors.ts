export class PairedPublicationError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PairedPublicationError";
    this.code = code;
  }
}
