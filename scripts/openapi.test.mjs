import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Validator } from '@seriousme/openapi-schema-validator';
import { parse } from 'yaml';

import { checkOpenapi, openapiErrors, scanOperations } from './check-openapi.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const openapiText = readFileSync(path.join(repoRoot, 'contract/api/openapi.yaml'), 'utf8');
const document = parse(openapiText);
const OPERATION_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

// Vocabularies of the operation extensions (ADR 0048).
const EXPLICIT_PERMISSIONS = [
  'public',
  'authenticated',
  'owner',
  'channel-credential',
  'workspace-member',
  'workspace-manager',
  'workspace-admin',
  'organization-admin',
  'unknown'
];
const EDITIONS = ['local', 'cloud', 'both'];
const CONSUMERS = [
  'webapp',
  'cli',
  'desktop',
  'mobile',
  'runner',
  'gateway',
  'external',
  'unverified'
];
const EXTENSIONS = { '/ext/everhour/': 'everhour', '/ext/github/': 'github' };

function rbacActions() {
  const source = readFileSync(path.join(repoRoot, 'auth/src/rbac/permissions.ts'), 'utf8');
  const block = /export const PERMISSIONS = \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? '';
  return [...block.matchAll(/:\s*'([a-z_:]+)'/g)].map(match => match[1]);
}

function operations() {
  return Object.entries(document.paths).flatMap(([template, item]) =>
    Object.entries(item)
      .filter(([key]) => OPERATION_METHODS.includes(key))
      .map(([method, operation]) => ({ template, item, method, operation }))
  );
}

describe('contract/api/openapi.yaml', () => {
  it('is a valid OpenAPI 3.1 document', async () => {
    const validator = new Validator();
    const result = await validator.validate(document);
    assert.equal(validator.version, '3.1');
    assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  });

  it('declares every path parameter of every path, and no others', () => {
    for (const { template, item } of operations()) {
      const inTemplate = [...template.matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort();
      const declared = (item.parameters ?? [])
        .filter(parameter => parameter.in === 'path')
        .map(parameter => {
          assert.equal(parameter.required, true, `${template} ${parameter.name} must be required`);
          return parameter.name;
        })
        .sort();
      assert.deepEqual(declared, inTemplate, template);
    }
  });

  it('tags every operation with a declared tag', () => {
    const declared = new Set(document.tags.map(tag => tag.name));
    for (const { template, method, operation } of operations()) {
      assert.ok(operation.tags?.length === 1, `${method} ${template} needs one tag`);
      assert.ok(declared.has(operation.tags[0]), `${method} ${template} tag ${operation.tags[0]}`);
    }
  });

  it('uses the extension vocabularies on every operation', () => {
    const permissions = new Set([...rbacActions(), ...EXPLICIT_PERMISSIONS]);
    for (const { template, method, operation } of operations()) {
      const label = `${method.toUpperCase()} ${template}`;
      assert.ok(
        permissions.has(operation['x-overlord-permission']),
        `${label} x-overlord-permission ${operation['x-overlord-permission']}`
      );
      const candidates = operation['x-overlord-permission-candidates'];
      if (candidates !== undefined) {
        assert.equal(operation['x-overlord-permission'], 'unknown', `${label} candidates`);
        for (const candidate of candidates) assert.ok(permissions.has(candidate), label);
      }
      assert.ok(EDITIONS.includes(operation['x-overlord-edition']), `${label} x-overlord-edition`);
      const consumers = operation['x-overlord-consumers'];
      assert.ok(Array.isArray(consumers) && consumers.length > 0, `${label} x-overlord-consumers`);
      for (const consumer of consumers)
        assert.ok(CONSUMERS.includes(consumer), `${label} ${consumer}`);
      if (consumers.includes('unverified')) assert.deepEqual(consumers, ['unverified'], label);
      const extension = Object.entries(EXTENSIONS).find(([prefix]) => template.startsWith(prefix));
      assert.equal(
        operation['x-overlord-extension'],
        extension?.[1],
        `${label} x-overlord-extension`
      );
      const status = operation['x-overlord-schema-status'];
      assert.ok(status === undefined || status === 'stub', `${label} x-overlord-schema-status`);
    }
  });

  it('passes the dependency-free structural check and agrees with it', () => {
    const { errors, operations: count, stubs } = checkOpenapi(repoRoot);
    assert.deepEqual(errors, []);
    assert.equal(count, operations().length);
    assert.equal(
      stubs,
      operations().filter(entry => entry.operation['x-overlord-schema-status'] === 'stub').length
    );
    const ids = operations().map(entry => entry.operation.operationId);
    assert.deepEqual(
      scanOperations(openapiText).map(entry => entry.operationId),
      ids
    );
  });
});

describe('scripts/check-openapi.mjs', () => {
  const doc = operationsYaml =>
    `openapi: 3.1.0\ninfo:\n  title: T\n  version: 1.0.0\npaths:\n${operationsYaml}components: {}\n`;
  const health = id =>
    `  /api/health:\n    get:\n      operationId: ${id}\n      x-overlord-schema-status: stub\n`;

  it('accepts a document whose stub count matches the ratchet', () => {
    assert.deepEqual(openapiErrors(doc(health('getHealth')), { stubOperations: 1 }).errors, []);
  });

  it('fails when stubs rise above the ratchet, and asks for the ratchet to move down', () => {
    assert.match(
      openapiErrors(doc(health('getHealth')), { stubOperations: 0 }).errors.join('\n'),
      /more than the 0 recorded/
    );
    assert.match(
      openapiErrors(doc(health('getHealth')), { stubOperations: 2 }).errors.join('\n'),
      /lower stubOperations to 1/
    );
  });

  it('rejects missing, duplicate and non-camelCase operationIds', () => {
    const twice = `${health('getHealth')}    post:\n      operationId: getHealth\n`;
    assert.match(
      openapiErrors(doc(twice), { stubOperations: 1 }).errors.join('\n'),
      /used by both/
    );
    assert.match(
      openapiErrors(doc(health('Get_Health')), { stubOperations: 1 }).errors.join('\n'),
      /not lowerCamelCase/
    );
    assert.match(
      openapiErrors(doc('  /api/health:\n    get:\n      summary: x\n'), {
        stubOperations: 0
      }).errors.join('\n'),
      /has no operationId/
    );
  });

  it('rejects a missing or malformed ratchet', () => {
    assert.match(
      openapiErrors(doc(health('getHealth')), {}).errors.join('\n'),
      /non-negative integer/
    );
  });
});
