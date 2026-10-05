import type { NextFunction, Request, Response } from 'express';

import { ServiceError } from '../packages/core/service/errors.ts';

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

/**
 * The app's error envelope, mounted last on the Express app. Every route that
 * forwards an error with `next(error)` (`handle()`, the chat and connections
 * routers) gets the same body for the same error.
 */
export function apiErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message, detail: err.detail, code: err.code });
    return;
  }
  // Service-layer validation (invalid session, no active objective, missing
  // rationale, …) carries its own HTTP status and machine-readable code.
  if (err instanceof ServiceError) {
    res.status(err.status).json({
      error: err.message,
      code: err.code,
      ...(err.details !== undefined ? { details: err.details } : {})
    });
    return;
  }
  const bodyParserError = apiErrorFromBodyParser(err);
  if (bodyParserError) {
    res.status(bodyParserError.status).json({
      error: bodyParserError.message,
      code: bodyParserError.code
    });
    return;
  }
  const databaseError = apiErrorFromDatabaseError(err);
  if (databaseError) {
    res.status(databaseError.status).json({
      error: databaseError.message,
      detail: databaseError.detail
    });
    return;
  }

  // Unexpected failures — include the underlying message so CLI/UI surfaces can
  // show something actionable instead of a bare "Internal error".
  const message = err instanceof Error ? err.message : 'Internal error';
  console.error('[webapp] request failed:', message);
  res.status(500).json({ error: message, detail: message });
}
