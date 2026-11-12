// Route parity between the Express app and contract/api/openapi.yaml (ADR 0006,
// ADR 0048): every registered route has an operation, every operation has a
// registered route, and the only registered routes without an operation are the
// documented `x-overlord-route-exclusions`. Also cross-checks the runtime
// router walk against the static extraction in scripts/list-rest-routes.mts.
//
// The runtime inventory imports backend/app.ts, which reads configuration and
// opens the database client, so it runs in a child process under a throwaway
// Overlord home (scripts/with-ovld-home.mjs keeps an OVLD_HOME already set).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import {
  compareInventories,
  type RuntimeRoute,
  staticRoutes,
  toOpenapiPath
} from '../scripts/list-rest-routes.mts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPERATION_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

type Exclusion = { method: string; path: string; kind: string; reason: string };
type OpenapiDocument = {
  paths: Record<string, Record<string, unknown>>;
  'x-overlord-route-exclusions': Exclusion[];
};

const openapi = parse(
  readFileSync(path.join(repoRoot, 'contract/api/openapi.yaml'), 'utf8')
) as OpenapiDocument;

function runtimeInventory(): RuntimeRoute[] {
  const output = execFileSync(
    process.execPath,
    [
      path.join(repoRoot, 'scripts/with-ovld-home.mjs'),
      process.execPath,
      '--import',
      'tsx',
      path.join(repoRoot, 'scripts/list-rest-routes.mts'),
      '--json'
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024
    }
  );
  return JSON.parse(output) as RuntimeRoute[];
}

const operationKeys = new Set(
  Object.entries(openapi.paths).flatMap(([template, item]) =>
    Object.keys(item)
      .filter(key => OPERATION_METHODS.includes(key))
      .map(method => `${method.toUpperCase()} ${template}`)
  )
);
const exclusions = openapi['x-overlord-route-exclusions'];
const exclusionKeys = new Set(exclusions.map(entry => `${entry.method} ${entry.path}`));

describe('OpenAPI route parity', () => {
  const runtime = runtimeInventory();
  const registered = new Set(runtime.map(route => `${route.method} ${toOpenapiPath(route.path)}`));

  it('documents every exclusion with a kind and a reason', () => {
    assert.ok(exclusions.length > 0);
    for (const entry of exclusions) {
      assert.ok(['provider-owned', 'non-api'].includes(entry.kind), `${entry.path}: kind`);
      assert.ok(entry.reason.trim().length > 0, `${entry.path}: reason`);
      assert.ok(
        !operationKeys.has(`${entry.method} ${entry.path}`),
        `${entry.path} is also an operation`
      );
    }
  });

  it('gives every registered route an operation, except the listed exclusions', () => {
    const undescribed = [...registered].filter(
      key => !operationKeys.has(key) && !exclusionKeys.has(key)
    );
    assert.deepEqual(undescribed, [], 'registered routes missing from contract/api/openapi.yaml');
  });

  it('serves every operation', () => {
    const unserved = [...operationKeys].filter(key => !registered.has(key));
    assert.deepEqual(
      unserved,
      [],
      'operations in contract/api/openapi.yaml with no registered route'
    );
  });

  it('keeps the Better Auth wildcard excluded and Overlord-owned /api/auth routes described', () => {
    assert.ok(registered.has('ALL /api/auth/*'));
    const ownAuthRoutes = [...registered].filter(
      key => key.includes(' /api/auth/') && key !== 'ALL /api/auth/*'
    );
    assert.ok(ownAuthRoutes.length > 0);
    for (const key of ownAuthRoutes) assert.ok(operationKeys.has(key), `${key} has no operation`);
  });

  it('finds the same routes by walking the router stack and by reading the source', () => {
    const difference = compareInventories(runtime, staticRoutes());
    assert.deepEqual(difference.onlyRuntime, []);
    assert.deepEqual(difference.onlyStatic, []);
    // A conditionally registered route absent here must be an excluded one.
    for (const entry of difference.conditionalNotRegistered) {
      const key = entry.replace(/ \(if .*\)$/, '');
      assert.ok(exclusionKeys.has(key), `${entry} is conditional, absent and not excluded`);
    }
  });
});
