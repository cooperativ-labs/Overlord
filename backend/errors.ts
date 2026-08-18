/** A user-facing validation / not-found error that maps to a 4xx response. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: string,
    /** Optional machine-readable code so clients can branch without parsing the message. */
    public code?: string
  ) {
    super(message);
  }
}

type SqliteErrorLike = {
  code?: string;
  message?: string;
};

type BodyParserErrorLike = {
  type?: string;
};

/**
 * Map Express/body-parser `PayloadTooLargeError` onto the same JSON error
 * envelope as `ApiError`. Without this, the generic handler returns 500 with
 * `{ error, detail }` both set to "request entity too large", which the web
 * client renders as the duplicated "request entity too large — request entity
 * too large" string on the Latch mission widget.
 */
export function apiErrorFromBodyParser(error: unknown): ApiError | null {
  if (!error || typeof error !== 'object') return null;
  const { type } = error as BodyParserErrorLike;
  if (type !== 'entity.too.large') return null;
  return new ApiError(413, 'Request body is too large.', undefined, 'body_too_large');
}

/** Map better-sqlite3 constraint failures to actionable API errors. */
export function apiErrorFromDatabaseError(error: unknown): ApiError | null {
  if (!error || typeof error !== 'object') return null;
  const { code, message = '' } = error as SqliteErrorLike;
  if (!code?.startsWith('SQLITE_CONSTRAINT')) return null;

  if (code === 'SQLITE_CONSTRAINT_UNIQUE' && message.includes('project_resources')) {
    if (message.includes('resource_key') || message.includes('target_key')) {
      return new ApiError(
        409,
        'This resource key is already linked to the project on this execution target.',
        message
      );
    }
    return new ApiError(
      409,
      'This directory is already linked to the project on this device.',
      message
    );
  }

  if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return new ApiError(400, 'A related record is missing or invalid.', message);
  }

  return new ApiError(409, 'Database constraint violation.', message);
}
