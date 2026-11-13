import { apiOperations } from '@overlord/contract/api';
import express from 'express';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { z } from 'zod';

import { CONFORMANCE_REPORT_ENV } from './conformance-report.ts';
import { apiResponseConformance, checkResponse, closedSchema } from './response-conformance.ts';

describe('closedSchema', () => {
  it('refuses undocumented members at every depth and keeps declared catch-alls', () => {
    const inner = z.object({ id: z.string() });
    const schema = closedSchema(
      z.object({
        item: inner,
        list: z.array(inner),
        maybe: z.exactOptional(inner.nullable()),
        either: z.union([inner, z.string()]),
        map: z.record(z.string(), inner),
        open: z.looseObject({ id: z.string() }),
        later: z.lazy(() => inner)
      })
    );
    const valid = {
      item: { id: 'a' },
      list: [{ id: 'b' }],
      maybe: null,
      either: 'c',
      map: { k: { id: 'd' } },
      open: { id: 'e', extra: 1 },
      later: { id: 'f' }
    };
    assert.equal(schema.safeParse(valid).success, true);
    for (const variant of [
      { ...valid, extra: true },
      { ...valid, item: { id: 'a', extra: 1 } },
      { ...valid, list: [{ id: 'b', extra: 1 }] },
      { ...valid, maybe: { id: 'x', extra: 1 } },
      { ...valid, either: { id: 'x', extra: 1 } },
      { ...valid, map: { k: { id: 'd', extra: 1 } } },
      { ...valid, later: { id: 'f', extra: 1 } }
    ]) {
      assert.equal(schema.safeParse(variant).success, false, JSON.stringify(variant));
    }
  });

  it('leaves the generated schema itself lenient', () => {
    const inner = z.object({ id: z.string() });
    closedSchema(inner);
    assert.equal(inner.safeParse({ id: 'a', extra: 1 }).success, true);
  });
});

describe('checkResponse', () => {
  const operation = apiOperations.postProjectsByIdTags;
  const tag = { id: 't', projectId: 'p', label: 'x', color: null, active: true };

  it('accepts a declared status, media type and body', () => {
    assert.deepEqual(checkResponse(operation, 200, 'application/json', JSON.stringify(tag)), []);
    assert.deepEqual(
      checkResponse(operation, 404, 'application/json', JSON.stringify({ error: 'Not found' })),
      []
    );
  });

  it('reports an undeclared status, media type or member', () => {
    assert.deepEqual(checkResponse(operation, 418, 'application/json', '{}'), [
      'status 418 is not declared'
    ]);
    assert.match(checkResponse(operation, 200, 'text/plain', 'x')[0] ?? '', /text\/plain/);
    const extra = checkResponse(
      operation,
      200,
      'application/json',
      JSON.stringify({ ...tag, secret: 1 })
    );
    assert.equal(extra.length, 1);
    assert.match(extra[0]!, /^body: /);
    assert.match(checkResponse(operation, 200, 'application/json', '{')[0] ?? '', /not JSON/);
  });

  it('rejects missing JSON bodies and missing Content-Type on captured responses', () => {
    for (const body of ['', JSON.stringify(tag)]) {
      assert.match(checkResponse(operation, 200, null, body)[0] ?? '', /Content-Type/);
    }
    assert.match(checkResponse(operation, 200, 'application/json', '')[0] ?? '', /not JSON/);
  });

  it('does not inspect uncaptured bodies, event streams or bodyless statuses', () => {
    assert.deepEqual(checkResponse(operation, 200, null, null), []);
    assert.deepEqual(checkResponse(operation, 200, 'application/json', null), []);
    assert.deepEqual(checkResponse(apiOperations.getRealtime, 200, 'text/event-stream', null), []);
    const bodyless = { ...operation, responses: { '204': { headers: [], content: {} } } };
    assert.deepEqual(checkResponse(bodyless, 204, null, ''), []);
  });
});

describe('apiResponseConformance', () => {
  it('records each response of an Overlord route, and nothing without a report file', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'overlord-conformance-'));
    const file = path.join(directory, 'report.jsonl');
    const previous = process.env[CONFORMANCE_REPORT_ENV];
    const app = express();
    app.use(apiResponseConformance());
    app.get('/api/health', (req, res) => {
      if (req.query.empty === 'true') return res.status(200).end();
      if (req.query.valid === 'true') return res.json({ ok: true });
      return res.json({ ok: true, extra: 1 });
    });
    app.get('/not-an-operation', (_req, res) => res.json({}));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      delete process.env[CONFORMANCE_REPORT_ENV];
      await (await fetch(`${base}/api/health`)).text();
      process.env[CONFORMANCE_REPORT_ENV] = file;
      await (await fetch(`${base}/api/health`)).text();
      await (await fetch(`${base}/api/health?empty=true`)).text();
      await (await fetch(`${base}/api/health?empty=true`, { method: 'HEAD' })).text();
      await (await fetch(`${base}/api/health?valid=true`)).text();
      await (await fetch(`${base}/not-an-operation`)).text();
      await new Promise(resolve => setTimeout(resolve, 20));
      const records = readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line));
      assert.equal(records.length, 4);
      assert.equal(records[0].operationId, 'getHealth');
      assert.equal(records[0].status, 200);
      assert.equal(records[0].problems.length, 1);
      assert.equal(records[1].operationId, 'getHealth');
      assert.equal(records[1].status, 200);
      assert.equal(records[1].problems.length, 1);
      assert.match(records[1].problems[0], /Content-Type/);
      assert.equal(records[2].method, 'HEAD');
      assert.deepEqual(records[2].problems, []);
      assert.deepEqual(records[3].problems, []);
    } finally {
      if (previous === undefined) delete process.env[CONFORMANCE_REPORT_ENV];
      else process.env[CONFORMANCE_REPORT_ENV] = previous;
      await new Promise<void>(resolve => server.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
