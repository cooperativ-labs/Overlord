import type { Permission } from '@overlord/auth';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { requireAnyWorkspacePermission } from '../rbac.ts';

/** Per-route declarations a {@link RouteHandler} enforces around its handler. */
export type RouteOptions = {
  /** Run the factory's `onMutation` hook after the handler succeeds. */
  mutates?: boolean;
  /**
   * The RBAC permission the route needs. It is enforced (role grants ∩ token
   * scope) before the handler runs, so a scoped USER_TOKEN, or any
   * under-privileged actor, is rejected uniformly with a 403.
   */
  requires?: Permission;
};

/**
 * The `handle()` wrapper `app.ts` builds and injects into routers that need it.
 * The handler may throw `ApiError` / `ServiceError` / `Error`, and the app's
 * error handler renders it. A returned value is written as JSON (`{ ok: true }`
 * when it is nullish) unless the handler already answered.
 */
export type RouteHandler = (
  fn: (req: Request, res: Response) => unknown,
  options?: RouteOptions
) => RequestHandler;

/**
 * Run an async Express handler and forward anything it throws or rejects with
 * to `next(err)`, so it reaches the app's error handler. Express 4 does not do
 * this for a rejected promise.
 */
export function asyncRoute(
  fn: (req: Request, res: Response, next: NextFunction) => unknown
): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      try {
        await fn(req, res, next);
      } catch (err) {
        next(err);
      }
    })();
  };
}

/**
 * Build the route wrapper. `onMutation` runs once after a `mutates` route
 * succeeds; production nudges its poll loops there so echoes go out without
 * waiting for the next interval.
 */
export function createRouteHandler({ onMutation }: { onMutation: () => void }): RouteHandler {
  return (fn, options = {}) =>
    asyncRoute(async (req, res) => {
      if (options.requires) await requireAnyWorkspacePermission(options.requires);
      const result = await fn(req, res);
      if (options.mutates) onMutation();
      if (!res.headersSent) res.json(result ?? { ok: true });
    });
}
