#!/usr/bin/env node
// REST route inventory (phase 4 of planning/feature-plans/contract-adr-openapi-migration.md).
//
// Produces the authoritative list of method + path pairs the backend registers,
// two independent ways:
//
// - runtime: imports `backend/app.ts` (which builds the Express app without
//   listening; `backend/index.ts` starts it) and walks the router stack,
//   recovering each sub-router's mount prefix from its layer;
// - static: parses the backend sources with the TypeScript compiler API and
//   finds every `app.<method>(...)`, `router.<method>(...)` and router mount.
//
// The runtime list is authoritative and is what the OpenAPI route parity test
// (`backend/openapi-route-parity.test.ts`) compares against
// `contract/api/openapi.yaml`. The static list is the cross-check and the only
// source of per-route evidence that a router stack cannot reveal: the
// authentication middleware in front of the route and the RBAC permissions its
// handler (or the functions it calls) names.
//
// Usage (repository root):
//   node --import tsx scripts/list-rest-routes.mts [--runtime|--static|--compare] [--json]
//
// The runtime walk sets OVERLORD_MCP_ENABLED=true before importing the app so
// that every environment-gated route family is registered. Importing the app
// reads configuration and opens the database client like the server does, so
// run it under `node scripts/with-ovld-home.mjs` to use a throwaway home.

import { readdirSync, readFileSync } from 'node:fs';
import { METHODS } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

import {
  type ExpressLayer,
  layerPrefix,
  normalizePath,
  toOpenapiPath
} from '../backend/http/express-routes.ts';

export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const HTTP_METHODS = Object.freeze([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options'
]);
const ROUTE_CALLS = new Set([...HTTP_METHODS, 'all']);

/** Middleware that parses or decorates requests and says nothing about who may call. */
const NON_AUTH_MIDDLEWARE = new Set([
  'query',
  'expressInit',
  'corsMiddleware',
  'jsonParser',
  'urlencodedParser',
  'serveStatic',
  'apiErrorHandler',
  'bound dispatch',
  '<anonymous>',
  'jsonBody',
  'urlEncodedBody',
  'runnerCompletionJsonBody',
  'rawUploadBody',
  'rawImageBody',
  'rawAttachmentBody',
  // Called by the app-level body-parser selector, not authentication.
  'isRawUploadRequest',
  'isRunnerCompletionRequest',
  // The REST boundary's request validation (backend/http/request-validation.ts).
  'apiRequestValidation',
  'deferredJsonBody',
  'apiResponseConformance'
]);

export type RuntimeRoute = {
  method: string;
  /** Express path as registered, with mount prefixes applied and no trailing slash. */
  path: string;
  /** Named middleware that runs before the handler (app, router and route level). */
  middleware: string[];
};

export type StaticRoute = {
  method: string;
  path: string;
  file: string;
  line: number;
  /** Source text of an enclosing `if` condition, when registration is conditional. */
  condition: string | null;
  /** Authentication or authorization middleware in front of the handler. */
  middleware: string[];
  /** RBAC permissions the route declares or its handler names directly. */
  directPermissions: string[];
  /**
   * RBAC permissions named by the nearest functions the handler calls (by name,
   * breadth-first, up to four calls deep), with the depth at which they were found.
   */
  calleePermissions: {
    depth: number;
    permissions: string[];
    via: string[];
    exhausted: boolean;
  } | null;
};

export { normalizePath, toOpenapiPath };

export function routeKey(route: { method: string; path: string }): string {
  return `${route.method.toUpperCase()} ${route.path}`;
}

// ---- Runtime walk ---------------------------------------------------------

type Layer = ExpressLayer;

export { layerPrefix };

function prefixApplies(prefix: string, routePath: string): boolean {
  return prefix === '' || routePath === prefix || routePath.startsWith(`${prefix}/`);
}

export function walkRouterStack(
  stack: Layer[],
  prefix = '',
  inherited: { prefix: string; name: string }[] = []
): RuntimeRoute[] {
  const routes: RuntimeRoute[] = [];
  const seen = [...inherited];
  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const routePath of paths) {
        const fullPath = normalizePath(`${prefix}${routePath}`);
        const middleware = [
          ...seen.filter(entry => prefixApplies(entry.prefix, fullPath)).map(entry => entry.name),
          ...layer.route.stack.slice(0, -1).map(entry => entry.name)
        ].filter(name => !NON_AUTH_MIDDLEWARE.has(name));
        const registered = Object.keys(layer.route.methods).filter(
          method => method !== '_all' && layer.route!.methods[method]
        );
        // `app.all()` registers every method Node knows; `route.all()` sets `_all`.
        const methods =
          layer.route.methods._all ||
          METHODS.every(method => registered.includes(method.toLowerCase()))
            ? ['all']
            : registered;
        for (const method of methods) {
          routes.push({
            method: method.toUpperCase(),
            path: fullPath,
            middleware: [...new Set(middleware)]
          });
        }
      }
    } else if (layer.name === 'router' && layer.handle.stack) {
      routes.push(...walkRouterStack(layer.handle.stack, `${prefix}${layerPrefix(layer)}`, seen));
    } else {
      seen.push({
        prefix: normalizePath(`${prefix}${layerPrefix(layer)}`) || '',
        name: layer.name
      });
    }
  }
  return routes;
}

export async function runtimeRoutes(): Promise<RuntimeRoute[]> {
  process.env.OVERLORD_MCP_ENABLED = 'true';
  const module = (await import(
    pathToFileURL(path.join(REPOSITORY_ROOT, 'backend/app.ts')).href
  )) as {
    app: { _router: { stack: Layer[] } };
  };
  return walkRouterStack(module.app._router.stack);
}

// ---- Static extraction ----------------------------------------------------

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-server')
      continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.d.ts') &&
      !/\.(test|e2e|bench|live-eval)\.ts$/.test(entry.name) &&
      !entry.name.includes('test-fixture') &&
      !entry.name.includes('test-helpers')
    ) {
      files.push(full);
    }
  }
  return files;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  node.forEachChild(child => visit(child, callback));
}

/** `PERMISSIONS.X` → `'x:y'`, read from the RBAC source. */
function permissionTable(): Map<string, string> {
  const table = new Map<string, string>();
  const file = parse(path.join(REPOSITORY_ROOT, 'auth/src/rbac/permissions.ts'));
  visit(file, node => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText() === 'PERMISSIONS' &&
      node.initializer
    ) {
      let initializer: ts.Expression = node.initializer;
      while (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer)) {
        initializer = initializer.expression;
      }
      if (!ts.isObjectLiteralExpression(initializer)) return;
      for (const property of initializer.properties) {
        if (ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.initializer)) {
          table.set(property.name.getText(), property.initializer.text);
        }
      }
    }
  });
  return table;
}

function permissionsIn(node: ts.Node, table: Map<string, string>): string[] {
  const found = new Set<string>();
  visit(node, child => {
    if (
      ts.isPropertyAccessExpression(child) &&
      child.expression.getText() === 'PERMISSIONS' &&
      table.has(child.name.text)
    ) {
      found.add(table.get(child.name.text)!);
    }
  });
  return [...found].sort();
}

/**
 * Role gates that authorize by workspace or organization role rather than by
 * an RBAC action (backend/workspaces.ts, backend/organizations.ts).
 */
export const ROLE_GATES = new Map([
  ['requireWorkspaceMember', 'workspace-member'],
  ['requireWorkspaceManager', 'workspace-manager'],
  ['requireWorkspaceAdmin', 'workspace-admin'],
  ['requireOrganizationAdmin', 'organization-admin']
]);

const IGNORED_CALLEES = new Set([
  'handle',
  'route',
  'chatRoute',
  'next',
  'String',
  'Number',
  'Boolean',
  'JSON',
  'Promise',
  'Array',
  'Object',
  'encodeURIComponent'
]);

function calledNames(node: ts.Node): string[] {
  const names = new Set<string>();
  visit(node, child => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
      if (!IGNORED_CALLEES.has(child.expression.text)) names.add(child.expression.text);
    }
  });
  return [...names];
}

type Registration = {
  kind: 'route' | 'use';
  method: string;
  path: string | null;
  owner: string; // 'app' or a router factory name
  file: string;
  line: number;
  condition: string | null;
  middleware: string[];
  handlerNodes: ts.Node[];
  mountedFactories: string[];
};

export function staticRoutes(): StaticRoute[] {
  const backendFiles = sourceFiles(path.join(REPOSITORY_ROOT, 'backend'));
  const lookupFiles = [
    ...backendFiles,
    ...sourceFiles(path.join(REPOSITORY_ROOT, 'packages/core/service')),
    ...sourceFiles(path.join(REPOSITORY_ROOT, 'auth/src')),
    ...sourceFiles(path.join(REPOSITORY_ROOT, 'mcp'))
  ];
  const parsed = new Map(lookupFiles.map(file => [file, parse(file)]));
  const table = permissionTable();

  // Module-level string constants (paths are sometimes named, e.g. a mount prefix).
  const strings = new Map<string, string | null>();
  // Named functions, for the callee permission search.
  const functions = new Map<string, ts.Node[]>();
  for (const file of parsed.values()) {
    visit(file, node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (ts.isStringLiteralLike(node.initializer)) {
          const name = node.name.text;
          const value = node.initializer.text;
          strings.set(name, strings.has(name) && strings.get(name) !== value ? null : value);
        }
        if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
          functions.set(node.name.text, [
            ...(functions.get(node.name.text) ?? []),
            node.initializer
          ]);
        }
      }
      if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        functions.set(node.name.text, [...(functions.get(node.name.text) ?? []), node]);
      }
    });
  }

  // A path argument is a literal, a module-level string constant, or the loop
  // variable of `for (const p of ['/a', '/b'])` (each element is a route).
  const resolvePaths = (expression: ts.Expression | undefined): string[] | null => {
    if (!expression) return null;
    if (ts.isStringLiteralLike(expression)) return [expression.text];
    if (!ts.isIdentifier(expression)) return null;
    for (let current: ts.Node | undefined = expression.parent; current; current = current.parent) {
      if (
        ts.isForOfStatement(current) &&
        ts.isVariableDeclarationList(current.initializer) &&
        current.initializer.declarations.some(
          declaration => declaration.name.getText() === expression.text
        ) &&
        ts.isArrayLiteralExpression(current.expression) &&
        current.expression.elements.every(ts.isStringLiteralLike)
      ) {
        return current.expression.elements.map(element => (element as ts.StringLiteralLike).text);
      }
    }
    const value = strings.get(expression.text);
    return value ? [value] : null;
  };

  const enclosingFactory = (node: ts.Node): string | null => {
    for (let current = node.parent; current; current = current.parent) {
      if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    }
    return null;
  };
  const enclosingCondition = (node: ts.Node): string | null => {
    for (let current = node.parent; current; current = current.parent) {
      if (ts.isIfStatement(current)) return current.expression.getText();
      if (ts.isFunctionLike(current)) return null;
    }
    return null;
  };

  // Router variables: `const x = Router()` (or `express.Router()`), keyed by factory.
  const registrations: Registration[] = [];
  for (const file of backendFiles) {
    const source = parsed.get(file)!;
    const routerVariables = new Set<string>();
    const appVariables = new Set<string>();
    visit(source, node => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isCallExpression(node.initializer)
      ) {
        const callee = node.initializer.expression.getText();
        if (callee === 'Router' || callee === 'express.Router') routerVariables.add(node.name.text);
        if (callee === 'express') appVariables.add(node.name.text);
      }
    });
    if (routerVariables.size === 0 && appVariables.size === 0) continue;
    visit(source, node => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
      const target = node.expression.expression.getText();
      const call = node.expression.name.text;
      const isApp = appVariables.has(target);
      if (!isApp && !routerVariables.has(target)) return;
      if (!ROUTE_CALLS.has(call) && call !== 'use') return;
      const owner = isApp ? 'app' : (enclosingFactory(node) ?? target);
      const [first, ...rest] = node.arguments;
      const routePaths = resolvePaths(first);
      const handlerArgs = routePaths === null && call === 'use' ? [...node.arguments] : rest;
      if (call !== 'use' && routePaths === null) {
        throw new Error(
          `${path.relative(REPOSITORY_ROOT, file)}: cannot resolve route path ${first?.getText()}`
        );
      }
      const middleware: string[] = [];
      const mountedFactories: string[] = [];
      // For a route the last argument is the handler; earlier identifiers are middleware.
      const middlewareArgs = call === 'use' ? handlerArgs : handlerArgs.slice(0, -1);
      for (const argument of middlewareArgs) {
        if (ts.isIdentifier(argument)) middleware.push(argument.text);
        else if (ts.isCallExpression(argument) && ts.isIdentifier(argument.expression)) {
          mountedFactories.push(argument.expression.text);
        } else if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
          // An inline router-level middleware is named by the functions it calls,
          // e.g. `requireChannelCredential` or the chat router's `owner` gate.
          if (call === 'use') middleware.push(...calledNames(argument));
        }
      }
      for (const routePath of routePaths ?? [null]) {
        registrations.push({
          kind: call === 'use' ? 'use' : 'route',
          method: call === 'use' ? 'USE' : call.toUpperCase(),
          path: routePath,
          owner,
          file: path.relative(REPOSITORY_ROOT, file),
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          condition: enclosingCondition(node),
          middleware,
          handlerNodes: handlerArgs,
          mountedFactories
        });
      }
    });
  }

  // Breadth-first over the functions the handler calls, by name, up to four
  // calls deep. The first depth that names an RBAC permission or calls a
  // role gate wins. `exhausted` means every reachable named function was
  // searched without finding one (calls through objects and classes are not
  // followed, so it is evidence, not proof).
  const calleePermissions = (nodes: ts.Node[]): StaticRoute['calleePermissions'] => {
    const visited = new Set<string>();
    let frontier = nodes.flatMap(calledNames);
    const roleGatesIn = (names: string[]) =>
      names.filter(name => ROLE_GATES.has(name)).map(name => ROLE_GATES.get(name)!);
    const atRoute = roleGatesIn(frontier);
    if (atRoute.length > 0) {
      return { depth: 0, permissions: [...new Set(atRoute)].sort(), via: [], exhausted: false };
    }
    for (let depth = 1; depth <= 4 && frontier.length > 0; depth++) {
      const found = new Set<string>();
      const via: string[] = [];
      const next: string[] = [];
      for (const name of frontier) {
        if (visited.has(name)) continue;
        visited.add(name);
        for (const declaration of functions.get(name) ?? []) {
          const called = calledNames(declaration);
          const guards = [...permissionsIn(declaration, table), ...roleGatesIn(called)];
          if (guards.length > 0) via.push(name);
          for (const guard of guards) found.add(guard);
          next.push(...called);
        }
      }
      if (found.size > 0) {
        return { depth, permissions: [...found].sort(), via: via.sort(), exhausted: false };
      }
      frontier = next.filter(name => !visited.has(name));
    }
    return { depth: 0, permissions: [], via: [], exhausted: frontier.length === 0 };
  };

  // Expand: app routes directly, router routes under each app mount of their factory.
  const routes: StaticRoute[] = [];
  const emit = (
    registration: Registration,
    prefix: string,
    guards: string[],
    condition: string | null
  ) => {
    const direct = [
      ...new Set(registration.handlerNodes.flatMap(node => permissionsIn(node, table)))
    ].sort();
    routes.push({
      method: registration.method === 'ALL' ? 'ALL' : registration.method,
      path: normalizePath(`${prefix}${registration.path}`),
      file: registration.file,
      line: registration.line,
      condition: registration.condition ?? condition,
      middleware: [...new Set([...guards, ...registration.middleware])].filter(
        name => !NON_AUTH_MIDDLEWARE.has(name)
      ),
      directPermissions: direct,
      calleePermissions: direct.length > 0 ? null : calleePermissions(registration.handlerNodes)
    });
  };

  const expand = (
    owner: string,
    prefix: string,
    inheritedGuards: { prefix: string; names: string[] }[],
    condition: string | null
  ) => {
    const guards = [...inheritedGuards];
    for (const registration of registrations.filter(entry => entry.owner === owner)) {
      if (registration.kind === 'use') {
        const usePrefix = normalizePath(`${prefix}${registration.path ?? ''}`);
        const effectivePrefix = usePrefix === '/' ? '' : usePrefix;
        if (registration.middleware.length > 0) {
          guards.push({ prefix: effectivePrefix, names: registration.middleware });
        }
        for (const factory of registration.mountedFactories) {
          if (registrations.some(entry => entry.owner === factory)) {
            // Guards registered so far are inherited; each route keeps those whose prefix covers it.
            expand(factory, effectivePrefix, [...guards], registration.condition ?? condition);
          }
        }
      } else {
        const full = normalizePath(`${prefix}${registration.path}`);
        emit(
          registration,
          prefix,
          guards.filter(guard => prefixApplies(guard.prefix, full)).flatMap(guard => guard.names),
          condition
        );
      }
    }
  };
  expand('app', '', [], null);
  return routes;
}

// ---- Cross-check ----------------------------------------------------------

/**
 * Differences between the two inventories. A statically found route whose
 * registration sits inside an `if` and is absent at runtime is explained, not a
 * mismatch: the condition was false in this environment (for example the SPA
 * fallback, registered only when a built web app exists next to a local
 * backend).
 */
export function compareInventories(
  runtime: { method: string; path: string }[],
  statics: { method: string; path: string; condition?: string | null }[]
) {
  const runtimeKeys = new Set(runtime.map(routeKey));
  const staticKeys = new Set(statics.map(routeKey));
  const absent = statics.filter(route => !runtimeKeys.has(routeKey(route)));
  return {
    onlyRuntime: [...runtimeKeys].filter(key => !staticKeys.has(key)).sort(),
    onlyStatic: absent
      .filter(route => !route.condition)
      .map(routeKey)
      .sort(),
    conditionalNotRegistered: absent
      .filter(route => route.condition)
      .map(route => `${routeKey(route)} (if ${route.condition})`)
      .sort()
  };
}

async function main(argv: string[]): Promise<void> {
  const json = argv.includes('--json');
  const mode = argv.includes('--static')
    ? 'static'
    : argv.includes('--compare')
      ? 'compare'
      : 'runtime';
  if (mode === 'static') {
    const routes = staticRoutes();
    process.stdout.write(
      json ? `${JSON.stringify(routes, null, 2)}\n` : `${routes.map(routeKey).join('\n')}\n`
    );
    return;
  }
  const runtime = await runtimeRoutes();
  if (mode === 'runtime') {
    process.stdout.write(
      json ? `${JSON.stringify(runtime, null, 2)}\n` : `${runtime.map(routeKey).join('\n')}\n`
    );
    return;
  }
  const statics = staticRoutes();
  const difference = compareInventories(runtime, statics);
  const report = { runtime: runtime.length, static: statics.length, ...difference };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (difference.onlyRuntime.length > 0 || difference.onlyStatic.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    // Importing the app starts module-level clients; the inventory is complete.
    () => process.exit(process.exitCode ?? 0),
    error => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exit(1);
    }
  );
}
