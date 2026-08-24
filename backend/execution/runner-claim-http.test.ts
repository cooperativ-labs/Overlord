import express from 'express';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import test from 'node:test';

import {
  flushRunnerClaimHeaders,
  sendRunnerClaimResponse,
  writeRunnerClaimBody
} from './runner-claim-http.ts';

test('empty long-poll body is JSON-only after flushed headers', () => {
  const chunks: string[] = [];
  const res = {
    headersSent: false,
    writableEnded: false,
    status() {
      return this;
    },
    setHeader() {
      return this;
    },
    flushHeaders() {
      this.headersSent = true;
    },
    json() {
      throw new Error('res.json() cannot run after flushHeaders');
    },
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    end() {
      this.writableEnded = true;
    }
  };
  flushRunnerClaimHeaders(res);
  writeRunnerClaimBody(res, { request: null, longPoll: true });
  const body = chunks.join('');
  assert.equal(body[0], '{');
  assert.equal(body, JSON.stringify({ request: null, longPoll: true }));
  assert.deepEqual(JSON.parse(body), { request: null, longPoll: true });
});

test('fetch JSON.parse of an empty long-poll body has no preamble', async () => {
  const app = express();
  app.post('/claim', (_req, res) => {
    void sendRunnerClaimResponse({
      res,
      claim: async ({ onListenArmed }) => {
        onListenArmed();
        await new Promise(resolve => setTimeout(resolve, 15));
        return { request: null, longPoll: true };
      }
    });
  });
  const server = await listen(app);
  try {
    const response = await fetch(`${server.baseUrl}/claim`, { method: 'POST' });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.equal(text, JSON.stringify({ request: null, longPoll: true }));
    assert.deepEqual(JSON.parse(text), { request: null, longPoll: true });
  } finally {
    await server.close();
  }
});

test('long-poll flushes HTTP headers before the JSON body', async () => {
  let releaseBody!: () => void;
  const bodyGate = new Promise<void>(resolve => {
    releaseBody = resolve;
  });
  const app = express();
  app.post('/claim', (_req, res) => {
    void sendRunnerClaimResponse({
      res,
      claim: async ({ onListenArmed }) => {
        onListenArmed();
        await bodyGate;
        return { request: null, longPoll: true };
      }
    });
  });
  const server = await listen(app);
  try {
    const port = Number(new URL(server.baseUrl).port);
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = net.connect({ port, host: '127.0.0.1' }, () => {
        socket.write('POST /claim HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
      });
      let buf = '';
      let released = false;
      socket.on('data', chunk => {
        buf += chunk.toString('utf8');
        if (!released && buf.includes('\r\n\r\n')) {
          released = true;
          releaseBody();
        }
      });
      socket.on('end', () => resolve(buf));
      socket.on('error', reject);
    });
    const headerEnd = raw.indexOf('\r\n\r\n');
    assert.ok(headerEnd >= 0);
    const headers = raw.slice(0, headerEnd);
    assert.match(headers, /^HTTP\/1\.1 200 /);
    assert.match(headers, /content-type: application\/json/i);
    const wireBody = raw.slice(headerEnd + 4);
    assert.match(wireBody, /\{"request":null,"longPoll":true\}/);
  } finally {
    await server.close();
  }
});

async function listen(
  app: express.Express
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      })
  };
}
