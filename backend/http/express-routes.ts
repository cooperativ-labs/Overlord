// Express 4 router-stack helpers shared by the REST boundary (request validation,
// `backend/http/request-validation.ts`) and the route inventory
// (`scripts/list-rest-routes.mts`). Express 4 keeps no mount path on a router
// layer, only the compiled regular expression, so the literal prefix is recovered
// from it.

/** The parts of an Express 4 layer the helpers read. */
export type ExpressLayer = {
  name: string;
  regexp: RegExp & { fast_slash?: boolean };
  keys: { name: string }[];
  method?: string;
  route?: { path: string | string[]; methods: Record<string, boolean>; stack: ExpressLayer[] };
  handle: { stack?: ExpressLayer[] } & ((...args: never[]) => unknown);
};

/** Express `:param` segments as OpenAPI `{param}` segments. */
export function toOpenapiPath(expressPath: string): string {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

export function normalizePath(value: string): string {
  const collapsed = value.replace(/\/{2,}/g, '/');
  return collapsed.length > 1 && collapsed.endsWith('/') ? collapsed.slice(0, -1) : collapsed;
}

/** Recovers the literal mount prefix Express 4 compiled into a non-terminal layer. */
export function layerPrefix(layer: Pick<ExpressLayer, 'regexp' | 'keys'>): string {
  if (layer.regexp.fast_slash) return '';
  let source = layer.regexp.source;
  if (source === '^\\/?(?=\\/|$)') return '';
  source = source.replace(/^\^/, '').replace(/\\\/\?\(\?=\\\/\|\$\)$/, '');
  let index = 0;
  source = source.replace(/\(\?:\\\/\(\[\^\\\/\]\+\?\)\)/g, () => `/:${layer.keys[index++]?.name}`);
  if (/[()[\]*+?|^$]/.test(source.replace(/\\./g, ''))) {
    throw new Error(`Unsupported mount pattern ${layer.regexp.source}`);
  }
  return source.replace(/\\(.)/g, '$1');
}

/** A registered route: its full Express path, its methods and its own layer stack. */
export type RegisteredRoute = {
  /** Express path with mount prefixes applied and no trailing slash. */
  path: string;
  /** Upper-case methods, or `ALL` for `app.all()` / `route.all()`. */
  methods: string[];
  stack: ExpressLayer[];
};

/** Every route in a router stack, descending into mounted routers. */
export function registeredRoutes(stack: ExpressLayer[], prefix = ''): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      const methods = layer.route.methods._all
        ? ['ALL']
        : Object.keys(layer.route.methods)
            .filter(method => layer.route!.methods[method])
            .map(method => method.toUpperCase());
      for (const routePath of paths) {
        routes.push({
          path: normalizePath(`${prefix}${routePath}`),
          methods,
          stack: layer.route.stack
        });
      }
    } else if (layer.name === 'router' && layer.handle.stack) {
      routes.push(...registeredRoutes(layer.handle.stack, `${prefix}${layerPrefix(layer)}`));
    }
  }
  return routes;
}
