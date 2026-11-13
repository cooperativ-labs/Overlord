// Request validation at the REST boundary (ADR 0051).
//
// Every route that has an operation in contract/api/openapi.yaml gets one
// validation layer, inserted immediately before its handler, after the route's
// authentication and body-parsing middleware. The layer checks the path, query
// and header parameters and the request body against the generated schemas
// (`@overlord/contract/api`). It never answers by itself except for a malformed
// JSON body; otherwise the handler runs and keeps every answer it gives:
//
// - a valid request is untouched;
// - an invalid request the handler answers with its own 4xx keeps that answer
//   (status, code and message), because the handler's checks are the more specific;
// - an invalid request the handler fails on with 500 answers 400 with the
//   validation issues instead (`enforce`), because the input caused the failure;
// - an invalid request the handler accepts is logged, since the description is
//   narrower than the code that ships (the backend tests fail on it).
//
// `OVERLORD_API_REQUEST_VALIDATION` selects `enforce` (default), `warn` (log what
// enforce would have changed, change nothing) or `off` (no validation layer work).
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';

import { type ApiOperation, operationFor } from './api-operations.ts';
import { recordConformance } from './conformance-report.ts';
import { type ExpressLayer, registeredRoutes, toOpenapiPath } from './express-routes.ts';

export const REQUEST_VALIDATION_ENV = 'OVERLORD_API_REQUEST_VALIDATION';

export type RequestValidationMode = 'enforce' | 'warn' | 'off';

let warnedAboutMode = false;

/** The configured mode; an unrecognised value keeps the default and is reported once. */
export function requestValidationMode(env: NodeJS.ProcessEnv = process.env): RequestValidationMode {
  const value = env[REQUEST_VALIDATION_ENV]?.trim().toLowerCase() ?? '';
  if (value === '' || value === 'enforce') return 'enforce';
  if (value === 'warn' || value === 'off') return value;
  if (!warnedAboutMode) {
    warnedAboutMode = true;
    console.warn(`[api] ${REQUEST_VALIDATION_ENV} must be enforce, warn or off; using enforce`);
  }
  return 'enforce';
}

/** One way a request differs from its operation. Never carries the submitted value. */
export interface RequestIssue {
  /** Where the value was: `path`, `query`, `header` or `body`. */
  in: 'path' | 'query' | 'header' | 'body';
  /** Dotted member path inside that location (`objectives[0].title`); empty for the whole value. */
  path: string;
  /** The schema rule that failed (Zod issue code). */
  code: string;
  message: string;
}

const MALFORMED_BODY = Symbol('overlord.malformedBody');
const MAX_ISSUES = 20;

type Locals = Record<string | symbol, unknown>;

function isMalformedJson(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { type?: unknown }).type === 'entity.parse.failed'
  );
}

/**
 * Wraps a JSON body parser so a body that is not valid JSON is answered by the
 * validation layer, after the route's authentication, instead of before it. With
 * validation `off` the parser error goes to the error handler as before.
 */
export function deferMalformedBody(parser: RequestHandler): RequestHandler {
  return function deferredJsonBody(req, res, next) {
    parser(req, res, (error?: unknown) => {
      if (error && isMalformedJson(error) && requestValidationMode() !== 'off') {
        (res.locals as Locals)[MALFORMED_BODY] = true;
        req.body = {};
        next();
        return;
      }
      next(error as Error | undefined);
    });
  };
}

function memberPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else out += out ? `.${String(segment)}` : String(segment);
  }
  return out;
}

function check(
  schema: z.ZodType | null | undefined,
  value: unknown,
  location: RequestIssue['in'],
  issues: RequestIssue[]
): void {
  if (!schema) return;
  const result = schema.safeParse(value);
  if (result.success) return;
  for (const issue of result.error.issues) {
    issues.push({
      in: location,
      path: memberPath(issue.path),
      code: issue.code,
      message: issue.message
    });
  }
}

function pathParameters(operation: ApiOperation, requestPath: string): Record<string, string> {
  const template = operation.path.split('/');
  const actual = requestPath.split('/');
  const params: Record<string, string> = {};
  template.forEach((segment, index) => {
    const match = /^\{(.+)\}$/.exec(segment);
    if (!match || actual[index] === undefined) return;
    try {
      params[match[1]!] = decodeURIComponent(actual[index]!);
    } catch {
      params[match[1]!] = actual[index]!;
    }
  });
  return params;
}

function requestPathname(req: Request): string {
  return (req.originalUrl.split('?')[0] ?? '').replace(/\/+$/, '') || '/';
}

/** Validates one request against its operation; empty when it conforms. */
function validateRequest(operation: ApiOperation, req: Request): RequestIssue[] {
  const issues: RequestIssue[] = [];
  check(operation.parameters.path, pathParameters(operation, requestPathname(req)), 'path', issues);
  check(operation.parameters.query, req.query, 'query', issues);
  check(operation.parameters.header, req.headers, 'header', issues);
  const body = operation.requestBody;
  if (body) {
    const content = body.content;
    if (Buffer.isBuffer(req.body)) {
      const descriptor = content['*/*'] ?? content['application/octet-stream'];
      if (!descriptor) {
        issues.push({
          in: 'body',
          path: '',
          code: 'unsupported_media_type',
          message: 'Unexpected raw body'
        });
      } else if (descriptor.kind !== 'event-stream') {
        check(descriptor.schema, req.body, 'body', issues);
      }
    } else if (
      req.is('application/x-www-form-urlencoded') &&
      content['application/x-www-form-urlencoded']
    ) {
      const descriptor = content['application/x-www-form-urlencoded'];
      if (descriptor.kind !== 'event-stream') check(descriptor.schema, req.body, 'body', issues);
    } else if (content['application/json']) {
      // Without a JSON body Express hands the handler `{}`, so that is what is checked.
      const descriptor = content['application/json'];
      if (descriptor.kind !== 'event-stream')
        check(descriptor.schema, req.body ?? {}, 'body', issues);
    } else if (body.required && (content['*/*'] || content['application/octet-stream'])) {
      issues.push({
        in: 'body',
        path: '',
        code: 'invalid_type',
        message: 'A request body is required'
      });
    }
  }
  return issues.slice(0, MAX_ISSUES);
}

function located(issue: RequestIssue): string {
  return issue.path ? `${issue.in}.${issue.path}` : issue.in;
}

/** The ErrorEnvelope a rejected request answers with. */
function validationErrorBody(issues: readonly RequestIssue[]) {
  const first = issues[0];
  return {
    error: first ? `Invalid request: ${located(first)}: ${first.message}` : 'Invalid request',
    code: 'invalid_request',
    detail: issues
      .slice(0, 5)
      .map(issue => `${located(issue)}: ${issue.message}`)
      .join('; '),
    details: { issues }
  };
}

const MALFORMED_JSON_ERROR = {
  error: 'Request body is not valid JSON.',
  code: 'invalid_json'
} as const;

type Outcome = 'accepted' | 'rejected' | 'would_reject' | 'answered_by_handler';

function report(
  mode: RequestValidationMode,
  outcome: Outcome,
  operation: ApiOperation,
  req: Request,
  status: number,
  issues: readonly RequestIssue[]
): void {
  const summary = issues.map(issue => ({ in: issue.in, path: issue.path, code: issue.code }));
  recordConformance({
    kind: 'request',
    operationId: operation.operationId,
    method: req.method,
    outcome,
    status,
    issues: summary
  });
  if (outcome === 'answered_by_handler') return;
  console.warn(
    JSON.stringify({
      event: 'api_request_validation',
      mode,
      outcome,
      operationId: operation.operationId,
      method: req.method,
      status,
      issues: summary
    })
  );
}

function watch(
  mode: RequestValidationMode,
  operation: ApiOperation,
  issues: readonly RequestIssue[],
  req: Request,
  res: Response
): void {
  let rejected = false;
  if (mode === 'enforce') {
    const send = res.send;
    res.send = function sendValidated(this: Response, body?: unknown) {
      if (!rejected && this.statusCode === 500 && !this.headersSent) {
        rejected = true;
        this.status(400);
        this.set('Content-Type', 'application/json; charset=utf-8');
        return send.call(this, JSON.stringify(validationErrorBody(issues)));
      }
      return send.call(this, body);
    } as Response['send'];
  }
  res.once('finish', () => {
    const status = res.statusCode;
    if (rejected) report(mode, 'rejected', operation, req, status, issues);
    else if (status === 500) report(mode, 'would_reject', operation, req, status, issues);
    else if (status < 400) report(mode, 'accepted', operation, req, status, issues);
    else report(mode, 'answered_by_handler', operation, req, status, issues);
  });
}

/** `res.locals` key holding the operationId once the validation layer matched a route. */
export const OPERATION_ID_LOCAL = 'apiOperationId';

function validationLayer(byMethod: ReadonlyMap<string, ApiOperation>): RequestHandler {
  return function apiRequestValidation(req: Request, res: Response, next: NextFunction) {
    const operation = byMethod.get(req.method);
    if (!operation) return next();
    res.locals[OPERATION_ID_LOCAL] = operation.operationId;
    if ((res.locals as Locals)[MALFORMED_BODY]) {
      res.status(400).json(MALFORMED_JSON_ERROR);
      return;
    }
    const mode = requestValidationMode();
    if (mode === 'off') return next();
    const issues = validateRequest(operation, req);
    if (issues.length > 0) watch(mode, operation, issues, req, res);
    next();
  };
}

type LayerConstructor = new (
  path: string,
  options: Record<string, unknown>,
  fn: RequestHandler
) => ExpressLayer;

/**
 * Inserts the validation layer before the handler of every route that has an
 * operation. Call once, after every route is registered. Returns the number of
 * routes covered.
 */
export function installRequestValidation(app: { _router?: { stack: ExpressLayer[] } }): number {
  const stack = app._router?.stack;
  if (!stack) return 0;
  let installed = 0;
  for (const route of registeredRoutes(stack)) {
    if (route.stack.some(layer => layer.name === 'apiRequestValidation')) continue;
    const template = toOpenapiPath(route.path);
    const byMethod = new Map<string, ApiOperation>();
    for (const method of route.methods) {
      const operation = operationFor(method, template);
      if (operation) byMethod.set(method, operation);
    }
    if (byMethod.size === 0) continue;
    if (byMethod.has('GET') && !byMethod.has('HEAD')) byMethod.set('HEAD', byMethod.get('GET')!);
    const handler = route.stack[route.stack.length - 1];
    if (!handler) continue;
    const Layer = handler.constructor as LayerConstructor;
    const layer = new Layer('/', {}, validationLayer(byMethod));
    layer.method = undefined;
    route.stack.splice(route.stack.length - 1, 0, layer);
    installed += 1;
  }
  return installed;
}
