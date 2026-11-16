import express, { type Express, type RequestHandler } from 'express';
import { once } from 'node:events';
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { apiErrorHandler } from '../errors.ts';

import { installRequestValidation } from './request-validation.ts';
import { apiResponseConformance } from './response-conformance.ts';
import type { RouteHandler } from './route-handler.ts';

/**
 * The production route wrapper without the poll-loop nudge. route-handler.ts
 * imports rbac.ts, and so db.ts, which opens the configured database at module
 * load; resolving it on the first request keeps importing this fixture free of
 * that side effect for suites that never use `handle`.
 */
const testRouteHandler: RouteHandler = (fn, options) => {
  let wrapped: Promise<RequestHandler> | undefined;
  return (req, res, next) => {
    wrapped ??= import('./route-handler.ts').then(({ createRouteHandler }) =>
      createRouteHandler({ onMutation: () => {} })(fn, options)
    );
    void wrapped.then(handler => handler(req, res, next), next);
  };
};

/**
 * Build a test app around routers, in the order production uses (ADR 0051 and
 * backend/AGENTS.md): response conformance first, then the JSON body parser,
 * then whatever `mount` adds, then request validation for every described
 * route, then the app's error handler.
 *
 * `mount` receives the route wrapper production injects into routers, built
 * without the poll-loop nudge. Pass `json: false` when the mounted routers parse
 * their own bodies.
 */
export function routerTestApp(
  mount: (app: Express, handle: RouteHandler) => void,
  { json = true }: { json?: boolean } = {}
): Express {
  const app = express();
  app.use(apiResponseConformance());
  if (json) app.use(express.json());
  mount(app, testRouteHandler);
  installRequestValidation(app);
  app.use(apiErrorHandler);
  return app;
}

export type TestServer = {
  /** `http://127.0.0.1:<port>`, with no trailing slash. */
  baseUrl: string;
  server: Server;
  /** Drop open connections (SSE streams included) and wait for the server to close. */
  close: () => Promise<void>;
};

/** Listen on an ephemeral loopback port. */
export async function listenForTest(app: RequestListener): Promise<TestServer> {
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    server,
    close: async () => {
      if (!server.listening) return;
      const closed = once(server, 'close');
      server.closeAllConnections();
      server.close();
      await closed;
    }
  };
}
