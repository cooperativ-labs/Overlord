// The generated operation table (`@overlord/contract/api`, ADR 0050) indexed for
// the REST boundary: by `METHOD /openapi/{path}` key, and by request path for
// responses that are written before a route matched (authentication, the
// project-automation guard, the body parser).
import { type ApiOperationDescriptor, apiOperations } from '@overlord/contract/api';

export type ApiOperation = ApiOperationDescriptor;

const operations: readonly ApiOperation[] = Object.values(apiOperations);

const byKey = new Map<string, ApiOperation>(
  operations.map(operation => [`${operation.method} ${operation.path}`, operation])
);

/** The operation registered for an OpenAPI path template, if any. */
export function operationFor(method: string, openapiPath: string): ApiOperation | null {
  return byKey.get(`${method.toUpperCase()} ${openapiPath}`) ?? null;
}

type Template = { operation: ApiOperation; segments: string[]; literals: number };

function templateSegments(path: string): string[] {
  return path.split('/').slice(1);
}

const templates: Template[] = operations
  .map(operation => {
    const segments = templateSegments(operation.path);
    return {
      operation,
      segments,
      literals: segments.filter(segment => !segment.startsWith('{')).length
    };
  })
  // Literal segments win over parameters, as Express registers them first wherever both
  // could match (`/api/missions/search` before `/api/missions/{id}`).
  .sort((left, right) => right.literals - left.literals);

/** The operation whose path template matches a concrete request path, if any. */
export function matchOperation(method: string, requestPath: string): ApiOperation | null {
  const upper = method.toUpperCase();
  const segments = templateSegments(requestPath.length > 1 ? requestPath.replace(/\/$/, '') : '/');
  for (const template of templates) {
    if (template.operation.method !== upper) continue;
    if (template.segments.length !== segments.length) continue;
    if (
      template.segments.every(
        (segment, index) => segment.startsWith('{') || segment === segments[index]
      )
    ) {
      return template.operation;
    }
  }
  return null;
}

export function allOperations(): readonly ApiOperation[] {
  return operations;
}
