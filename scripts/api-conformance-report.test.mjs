import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { operationIds, summarise } from './api-conformance-report.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'api-conformance-report.mjs');

describe('api-conformance-report', () => {
  it('lists operation ids from the description', () => {
    assert.deepEqual(
      operationIds({
        paths: {
          '/a': { get: { operationId: 'getA' }, parameters: [] },
          '/b': { post: { operationId: 'postB' }, delete: { operationId: 'deleteB' } }
        }
      }),
      ['deleteB', 'getA', 'postB']
    );
  });

  it('counts covered operations and reports response problems and accepted invalid requests', () => {
    const summary = summarise(
      [
        { kind: 'response', operationId: 'getA', method: 'GET', status: 200, problems: [] },
        {
          kind: 'response',
          operationId: 'getA',
          method: 'GET',
          status: 418,
          problems: ['status 418 is not declared']
        },
        {
          kind: 'request',
          operationId: 'postB',
          method: 'POST',
          outcome: 'answered_by_handler',
          status: 400,
          issues: []
        },
        {
          kind: 'request',
          operationId: 'postB',
          method: 'POST',
          outcome: 'accepted',
          status: 200,
          issues: [{ in: 'body', path: 'name', code: 'invalid_type' }]
        }
      ],
      ['deleteB', 'getA', 'postB']
    );
    assert.equal(summary.responses, 2);
    assert.equal(summary.invalidRequests, 2);
    assert.deepEqual(summary.covered, ['getA']);
    assert.deepEqual(summary.uncovered, ['deleteB', 'postB']);
    assert.equal(summary.problems.length, 2);
    assert.match(summary.problems[0], /^response getA GET 418: status 418 is not declared$/);
    assert.match(summary.problems[1], /^request postB POST: answered 200 .* body\.name \(invalid_type\)$/);
  });

  it('fails the run when the wrapped command fails', () => {
    assert.throws(() =>
      execFileSync(process.execPath, [script, '--', process.execPath, '-e', 'process.exit(3)'], {
        stdio: 'pipe'
      })
    );
    const output = execFileSync(process.execPath, [script, '--', process.execPath, '-e', ''], {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    assert.match(output, /API conformance: 0 responses checked across 0 of \d+ operations/);
  });
});
