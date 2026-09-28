import type { NextFunction, Request, Response } from 'express';

import { getActiveTokenProjectIds } from './db.ts';

/** Contract v151 route inventory. A newly added route remains closed by default. */
const ALLOWED: readonly [string, RegExp][] = [
  ['GET', /^\/api\/authorized-workspaces$/],
  ['GET', /^\/api\/projects$/],
  ['GET', /^\/api\/projects\/[^/]+$/],
  ['GET', /^\/api\/projects\/[^/]+\/(?:statuses|tags|missions)$/],
  ['POST', /^\/api\/missions$/],
  [
    'GET',
    /^\/api\/missions\/(?!search(?:\/|$))[^/]+(?:\/(?:objectives|events|deliveries|artifacts|context|file-changes))?$/
  ],
  ['GET', /^\/api\/search\/v3$/],
  ['GET', /^\/api\/objectives\/[^/]+\/attachments$/],
  ['GET', /^\/api\/storage\/attachments\/[^/]+$/],
  ['GET', /^\/(?:api\/stream|realtime|sync\/changes|mcp)$/],
  ['POST', /^\/mcp$/],
  [
    'POST',
    /^\/api\/protocol\/(?:create|load-context|search-missions|search|discover-project|statuses|list-deliveries|attachment-list|attachment-download-url|auth-status)$/
  ]
];

export function projectAutomationRouteGuard(req: Request, res: Response, next: NextFunction): void {
  if (getActiveTokenProjectIds() === null) return next();
  const path = req.originalUrl.split('?')[0] ?? '';
  if (ALLOWED.some(([method, pattern]) => req.method === method && pattern.test(path)))
    return next();
  res.status(404).json({ error: 'Not found' });
}
