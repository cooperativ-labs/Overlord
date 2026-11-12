#!/usr/bin/env node

// Dependency-free structural checks of contract/api/openapi.yaml, run by
// scripts/check-contract.sh (`yarn contract:check`) on every push. They need no
// YAML parser, so they read the document line by line in the layout it is
// written in (two-space indentation, one operation key per line).
//
// - Every operation has an operationId; operationIds are unique, lowerCamelCase.
// - The schema-stub ratchet: the number of operations marked
//   `x-overlord-schema-status: stub` equals `stubOperations` in
//   contract/api/openapi-ratchet.json. More stubs than recorded fails (a new
//   route arrived without schemas); fewer fails too, so the recorded number is
//   lowered in the same change and can never drift back up (ADR 0048).
//
// Full OpenAPI 3.1 validation, the extension vocabularies and the route parity
// test need dependencies and run under node:test (scripts/openapi.test.mjs,
// backend/openapi-route-parity.test.ts).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OPENAPI_PATH = 'contract/api/openapi.yaml';
export const RATCHET_PATH = 'contract/api/openapi-ratchet.json';

const OPERATION_KEY = /^ {4}(get|put|post|delete|options|head|patch|trace):\s*$/;
const OPERATION_ID = /^ {6}operationId:\s*(\S+)\s*$/;
const STUB = /^ {6}x-overlord-schema-status:\s*stub\s*$/;
const CAMEL_CASE = /^[a-z][A-Za-z0-9]*$/;

/** Operations as { method, path, operationId, stub } in document order. */
export function scanOperations(openapi) {
  const operations = [];
  let inPaths = false;
  let currentPath = null;
  let current = null;
  for (const line of openapi.split('\n')) {
    if (/^\S/.test(line)) {
      inPaths = /^paths:\s*$/.test(line);
      currentPath = null;
      current = null;
      continue;
    }
    if (!inPaths) continue;
    const pathMatch = /^ {2}(['"]?)(\/[^'"]*)\1:\s*$/.exec(line);
    if (pathMatch) {
      currentPath = pathMatch[2];
      current = null;
      continue;
    }
    const operationMatch = OPERATION_KEY.exec(line);
    if (operationMatch && currentPath) {
      current = { method: operationMatch[1], path: currentPath, operationId: null, stub: false };
      operations.push(current);
      continue;
    }
    if (/^ {4}\S/.test(line)) {
      current = null;
      continue;
    }
    if (!current) continue;
    const idMatch = OPERATION_ID.exec(line);
    if (idMatch) current.operationId = idMatch[1].replace(/^(['"])(.*)\1$/, '$2');
    if (STUB.test(line)) current.stub = true;
  }
  return operations;
}

export function openapiErrors(openapi, ratchet) {
  const errors = [];
  const operations = scanOperations(openapi);
  if (operations.length === 0) errors.push(`${OPENAPI_PATH} declares no operations`);
  const seen = new Map();
  for (const operation of operations) {
    const label = `${operation.method.toUpperCase()} ${operation.path}`;
    if (!operation.operationId) {
      errors.push(`${label} has no operationId`);
      continue;
    }
    if (!CAMEL_CASE.test(operation.operationId)) {
      errors.push(`${label} operationId ${operation.operationId} is not lowerCamelCase`);
    }
    if (seen.has(operation.operationId)) {
      errors.push(
        `operationId ${operation.operationId} is used by both ${seen.get(operation.operationId)} and ${label}`
      );
    }
    seen.set(operation.operationId, label);
  }
  const stubs = operations.filter(operation => operation.stub).length;
  const recorded = ratchet?.stubOperations;
  if (!Number.isInteger(recorded) || recorded < 0) {
    errors.push(`${RATCHET_PATH} must record stubOperations as a non-negative integer`);
  } else if (stubs > recorded) {
    errors.push(
      `${OPENAPI_PATH} has ${stubs} operations marked x-overlord-schema-status: stub, more than ` +
        `the ${recorded} recorded in ${RATCHET_PATH}; give the new operations real schemas`
    );
  } else if (stubs < recorded) {
    errors.push(
      `${OPENAPI_PATH} has ${stubs} stub operations but ${RATCHET_PATH} records ${recorded}; ` +
        `lower stubOperations to ${stubs} so the ratchet holds`
    );
  }
  return { errors, operations: operations.length, stubs };
}

export function checkOpenapi(root = ROOT) {
  const openapi = readFileSync(path.join(root, OPENAPI_PATH), 'utf8');
  const ratchet = JSON.parse(readFileSync(path.join(root, RATCHET_PATH), 'utf8'));
  return openapiErrors(openapi, ratchet);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { errors, operations, stubs } = checkOpenapi();
    if (errors.length > 0) {
      process.stderr.write(`OpenAPI check failed:\n- ${errors.join('\n- ')}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`OpenAPI check passed: ${operations} operations, ${stubs} stubs\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
