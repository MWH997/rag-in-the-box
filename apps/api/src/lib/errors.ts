/** An error carrying the status and machine-readable code sent to the client. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function isHttpError(value: unknown): value is HttpError {
  return value instanceof HttpError;
}
