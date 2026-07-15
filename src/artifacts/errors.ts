export class ArtifactPayloadError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ArtifactPayloadError";
    this.code = code;
  }
}

export class ArtifactStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ArtifactStoreError";
    this.code = code;
  }
}
