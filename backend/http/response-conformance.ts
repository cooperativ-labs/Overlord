// Response conformance for the backend test suite (ADR 0051). With
// `OVERLORD_API_CONFORMANCE_REPORT` set, every response an Overlord route writes is
// checked against its operation in contract/api/openapi.yaml: the status must be
// declared, the media type must be one the status declares, and a JSON body must
// match the generated schema with every object closed, so a member the description
// does not document fails. Event streams and binary bodies are checked for status
// and media type only, and are never buffered. Unset (production), the middleware
// does nothing.
import { apiOperations } from '@overlord/contract/api';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';

import { type ApiOperation, matchOperation } from './api-operations.ts';
import { conformanceReportPath, recordConformance } from './conformance-report.ts';
import { OPERATION_ID_LOCAL } from './request-validation.ts';

type AnyZod = z.ZodType;
type Def = Record<string, unknown> & { type: string };

const closedCache = new WeakMap<AnyZod, AnyZod>();

function defOf(schema: AnyZod): Def {
  return (schema as unknown as { _zod: { def: Def } })._zod.def;
}

function cloneWith(schema: AnyZod, def: Def): AnyZod {
  return (schema as unknown as { clone(def: Def): AnyZod }).clone(def);
}

/**
 * The schema with every object that does not say what additional members it
 * accepts closed (`additionalProperties: false`), recursively. Objects with an
 * explicit catch-all (`additionalProperties: true` or a schema) keep it.
 */
export function closedSchema(schema: AnyZod): AnyZod {
  const cached = closedCache.get(schema);
  if (cached) return cached;
  const def = defOf(schema);
  let result: AnyZod;
  switch (def.type) {
    case 'object': {
      const shape = def.shape as Record<string, AnyZod>;
      const closedShape = Object.fromEntries(
        Object.entries(shape).map(([key, value]) => [key, closedSchema(value)])
      );
      const catchall = def.catchall as AnyZod | undefined;
      result = cloneWith(schema, {
        ...def,
        shape: closedShape,
        catchall: catchall === undefined ? z.never() : closedSchema(catchall)
      });
      break;
    }
    case 'array':
      result = cloneWith(schema, { ...def, element: closedSchema(def.element as AnyZod) });
      break;
    case 'union':
      result = cloneWith(schema, {
        ...def,
        options: (def.options as AnyZod[]).map(option => closedSchema(option))
      });
      break;
    case 'optional':
    case 'nullable':
      result = cloneWith(schema, { ...def, innerType: closedSchema(def.innerType as AnyZod) });
      break;
    case 'record':
      result = cloneWith(schema, { ...def, valueType: closedSchema(def.valueType as AnyZod) });
      break;
    case 'lazy': {
      const getter = def.getter as () => AnyZod;
      let resolved: AnyZod | null = null;
      result = z.lazy(() => (resolved ??= closedSchema(getter())));
      break;
    }
    default:
      result = schema;
  }
  closedCache.set(schema, result);
  return result;
}

function memberPath(path: readonly PropertyKey[]): string {
  let out = 'body';
  for (const segment of path) {
    out += typeof segment === 'number' ? `[${segment}]` : `.${String(segment)}`;
  }
  return out;
}

export function mediaTypeOf(header: unknown): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.split(';')[0]!.trim().toLowerCase();
}

/**
 * Problems with one response, empty when it conforms. `body` is the raw body text,
 * or null when it was not captured (event streams, binary, HEAD).
 */
export function checkResponse(
  operation: ApiOperation,
  status: number,
  contentType: string | null,
  body: string | null
): string[] {
  const response = operation.responses[String(status)];
  if (!response) return [`status ${status} is not declared`];
  const declared = Object.keys(response.content);
  if (declared.length === 0) return [];
  if (!contentType) {
    return body ? [`status ${status} has a body without a Content-Type`] : [];
  }
  const descriptor = response.content[contentType] ?? response.content['*/*'];
  if (!descriptor) {
    return [
      `media type ${contentType} is not declared for status ${status} (${declared.join(', ')})`
    ];
  }
  if (body === null || descriptor.kind === 'binary' || descriptor.kind === 'event-stream') {
    return [];
  }
  let value: unknown = body;
  if (descriptor.kind === 'json') {
    try {
      value = JSON.parse(body);
    } catch {
      return [`status ${status} body is not JSON`];
    }
  }
  const result = closedSchema(descriptor.schema).safeParse(value);
  if (result.success) return [];
  return result.error.issues
    .slice(0, 20)
    .map(issue => `${memberPath(issue.path)}: ${issue.message}`);
}

const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

function chunkBuffer(chunk: unknown, encoding: unknown): Buffer | null {
  if (chunk === undefined || chunk === null || typeof chunk === 'function') return null;
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  if (typeof chunk === 'string') {
    return Buffer.from(chunk, typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8');
  }
  return null;
}

function operationOf(req: Request, res: Response): ApiOperation | null {
  const operationId = res.locals[OPERATION_ID_LOCAL];
  if (typeof operationId === 'string' && operationId in apiOperations) {
    return apiOperations[operationId as keyof typeof apiOperations];
  }
  const pathname = req.originalUrl.split('?')[0] ?? '';
  return matchOperation(req.method === 'HEAD' ? 'GET' : req.method, pathname);
}

/**
 * Mount first on an app that serves Overlord routes. Without a conformance report
 * configured it passes every request through untouched.
 */
export function apiResponseConformance(): RequestHandler {
  return function apiResponseConformance(req: Request, res: Response, next: NextFunction) {
    if (!conformanceReportPath()) return next();
    const chunks: Buffer[] = [];
    let size = 0;
    let capture: boolean | null = null;
    const capturing = () => {
      if (capture === null) {
        const media = mediaTypeOf(res.getHeader('content-type'));
        capture = req.method !== 'HEAD' && media !== 'text/event-stream';
      }
      return capture;
    };
    const keep = (chunk: unknown, encoding: unknown) => {
      if (!capturing()) return;
      const buffer = chunkBuffer(chunk, encoding);
      if (!buffer) return;
      size += buffer.length;
      if (size > MAX_CAPTURE_BYTES) capture = false;
      else chunks.push(buffer);
    };
    const write = res.write;
    const end = res.end;
    res.write = function writeObserved(this: Response, chunk: unknown, ...rest: unknown[]) {
      keep(chunk, rest[0]);
      return (write as (...args: unknown[]) => boolean).call(this, chunk, ...rest);
    } as Response['write'];
    res.end = function endObserved(this: Response, chunk?: unknown, ...rest: unknown[]) {
      keep(chunk, rest[0]);
      return (end as (...args: unknown[]) => Response).call(this, chunk, ...rest);
    } as Response['end'];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const operation = operationOf(req, res);
      if (!operation) return;
      const contentType = mediaTypeOf(res.getHeader('content-type'));
      // A response cut short (client gone) is checked for status and media type only.
      const body =
        capturing() && res.writableFinished ? Buffer.concat(chunks).toString('utf8') : null;
      recordConformance({
        kind: 'response',
        operationId: operation.operationId,
        method: req.method,
        status: res.statusCode,
        mediaType: contentType,
        problems: checkResponse(operation, res.statusCode, contentType, body)
      });
    };
    res.once('finish', finish);
    res.once('close', finish);
    next();
  };
}
