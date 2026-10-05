import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { ChatError, type ChatOwner } from '../../packages/core/service/chat/store.ts';
import { ServiceError } from '../../packages/core/service/errors.ts';
import { ApiError } from '../errors.ts';

/**
 * The owner of a chat or Cloud account-connection request (contract v152):
 * `chat_unavailable` off Cloud, `not_found` without an authenticated owner.
 */
export function chatOwnerGate(options: {
  cloud: () => boolean;
  owner: () => ChatOwner | null;
}): () => ChatOwner {
  return () => {
    if (!options.cloud()) throw new ChatError('chat_unavailable');
    const value = options.owner();
    if (!value) throw new ChatError('not_found');
    return value;
  };
}

/**
 * A JSON route for the chat and connections routers. The value `fn` resolves is
 * the response body; a `ChatError` (or any `ServiceError`/`ApiError`) reaches
 * the app error handler unchanged, which renders `{ error, code }`. Any other
 * failure becomes a generic 500 so a provider or credential message never
 * reaches the response body.
 */
export function chatRoute(
  fn: (req: Request) => Promise<unknown>,
  options: { failure: string; noStore?: boolean }
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (options.noStore) res.set('Cache-Control', 'no-store');
    void Promise.resolve()
      .then(() => fn(req))
      .then(value => res.json(value))
      .catch(error =>
        next(
          error instanceof ServiceError || error instanceof ApiError
            ? error
            : new ApiError(500, options.failure)
        )
      );
  };
}
