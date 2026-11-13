export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 400,
    /** Structured, machine-readable payload for self-servicing error recovery. */
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}
