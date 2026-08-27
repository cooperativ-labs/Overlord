/**
 * Latch v2 Conversation Hub client (coo:833 Phase C).
 *
 * The fake gateway below is a real loopback HTTP server that serves
 * `/v2/capabilities` and performs the RFC 6455 upgrade for
 * `/v2/sessions/{id}/conversation`, so these tests exercise the production
 * `WebSocket` client — subprotocol token, server-first snapshot, and all —
 * rather than a stubbed transport.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  latchConversationSocketUrl,
  LatchGatewayError,
  parseLatchGatewayCapabilities,
  resolveLatchGatewayConfig
} from './latch-gateway.ts';
import { LatchSessionCommandError, sendLatchMessage } from './latch-session.ts';

const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const TOKEN = 'a1b2c3d4';
const SESSION_ID = 'ses_test';

function acceptKey(key: string): string {
  return createHash('sha1')
    .update(key + WEBSOCKET_GUID)
    .digest('base64');
}

function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65_536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Pull whole client frames out of an accumulating buffer. Text frames only. */
function drainTextFrames(buffer: Buffer): { texts: string[]; rest: Buffer } {
  const texts: string[] = [];
  let cursor = buffer;
  for (;;) {
    if (cursor.length < 2) break;
    const opcode = cursor[0] & 0x0f;
    const masked = (cursor[1] & 0x80) !== 0;
    let length = cursor[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (cursor.length < offset + 2) break;
      length = cursor.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (cursor.length < offset + 8) break;
      length = Number(cursor.readBigUInt64BE(offset));
      offset += 8;
    }
    const maskKey = masked ? cursor.subarray(offset, offset + 4) : null;
    if (masked) offset += 4;
    if (cursor.length < offset + length) break;
    const payload = Buffer.from(cursor.subarray(offset, offset + length));
    if (maskKey) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= maskKey[index % 4];
      }
    }
    cursor = cursor.subarray(offset + length);
    if (opcode === 0x1) texts.push(payload.toString('utf8'));
  }
  return { texts, rest: cursor };
}

type GatewaySession = {
  send(message: unknown): void;
  close(): void;
};

type FakeGateway = {
  baseUrl: string;
  token: string;
  received: Record<string, unknown>[];
  close(): Promise<void>;
};

/**
 * Start a loopback gateway. `onOpen` receives the upgraded connection and
 * drives whatever the scenario needs; `onMessage` sees every client op.
 */
async function startFakeGateway({
  conversation = true,
  protocolVersion = 2,
  onOpen,
  onMessage
}: {
  conversation?: boolean;
  protocolVersion?: number;
  onOpen?: (session: GatewaySession) => void;
  onMessage?: (message: Record<string, unknown>, session: GatewaySession) => void;
} = {}): Promise<FakeGateway> {
  const received: Record<string, unknown>[] = [];
  const sockets = new Set<Duplex>();
  const server: Server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      response.writeHead(401).end();
      return;
    }
    if (request.url === '/v2/capabilities') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          protocolVersion,
          productVersion: '0.0.0-test',
          capabilities: {
            create: true,
            openViewer: true,
            localAttach: true,
            cloudAttach: false,
            selfUpdate: false,
            extensions: []
          },
          endpoints: { sessions: true, terminal: true, conversation },
          features: { exclusiveTerminal: true },
          gatewayInstanceId: 'gw-abc123-def456',
          operationRetentionSeconds: 600
        })
      );
      return;
    }
    response.writeHead(404).end();
  });

  server.on('upgrade', (request, socket: Duplex) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const offered = String(request.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map(part => part.trim())
      .find(part => part.startsWith('latch.v2.'));
    if (offered !== `latch.v2.${TOKEN}`) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return;
    }
    if (request.url !== `/v2/sessions/${SESSION_ID}/conversation`) {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey(String(request.headers['sec-websocket-key']))}`,
        `Sec-WebSocket-Protocol: ${offered}`,
        '\r\n'
      ].join('\r\n')
    );
    const session: GatewaySession = {
      send: (message: unknown) => {
        if (!socket.destroyed) socket.write(encodeTextFrame(JSON.stringify(message)));
      },
      close: () => socket.destroy()
    };
    let pending = Buffer.alloc(0);
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      const { texts, rest } = drainTextFrames(pending);
      pending = rest;
      for (const text of texts) {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        received.push(parsed);
        onMessage?.(parsed, session);
      }
    });
    onOpen?.(session);
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('gateway did not bind');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    token: TOKEN,
    received,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  };
}

function snapshot({
  phase,
  enabled,
  reason = null
}: {
  phase: string;
  enabled: boolean;
  reason?: string | null;
}) {
  return {
    type: 'snapshot',
    generation: 'gen-1',
    revision: 4,
    operationEpoch: 'epoch-1',
    items: [],
    hasMoreBefore: false,
    reason: 'initial',
    state: {
      phase,
      sendMessage: { enabled, reason },
      resolveRequest: { enabled: false, reason: null },
      pendingRequest: null,
      connector: { id: 'claude', version: '1' }
    }
  };
}

function stateChanged({ phase, enabled }: { phase: string; enabled: boolean }) {
  return {
    type: 'state_changed',
    generation: 'gen-1',
    revision: 5,
    state: {
      phase,
      sendMessage: { enabled, reason: null },
      resolveRequest: { enabled: false, reason: null },
      pendingRequest: null,
      connector: null
    }
  };
}

async function withGateway(
  options: Parameters<typeof startFakeGateway>[0],
  run: (gateway: FakeGateway) => Promise<void>
): Promise<void> {
  const gateway = await startFakeGateway(options);
  try {
    await run(gateway);
  } finally {
    await gateway.close();
  }
}

test('an idle session accepts the answer', async () => {
  await withGateway(
    {
      onOpen: session => session.send(snapshot({ phase: 'idle', enabled: true })),
      onMessage: (message, session) =>
        session.send({
          type: 'operation_result',
          operationId: message.operationId,
          status: 'accepted',
          itemId: 'item-1',
          reason: null
        })
    },
    async gateway => {
      const outcome = await sendLatchMessage({
        providerSessionId: SESSION_ID,
        operationId: 'req-1',
        text: 'ship it',
        gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
      });
      assert.equal(outcome.status, 'accepted');
      assert.equal(outcome.reason, null);
      assert.equal(outcome.operationId, 'req-1');
      assert.deepEqual(gateway.received, [
        {
          type: 'send_message',
          operationEpoch: 'epoch-1',
          operationId: 'req-1',
          text: 'ship it'
        }
      ]);
    }
  );
});

test('a working session is waited out until send becomes enabled', async () => {
  await withGateway(
    {
      onOpen: session => {
        session.send(snapshot({ phase: 'working', enabled: false, reason: 'agent is busy' }));
        setTimeout(() => session.send(stateChanged({ phase: 'idle', enabled: true })), 20);
      },
      onMessage: (message, session) =>
        session.send({
          type: 'operation_result',
          operationId: message.operationId,
          status: 'accepted'
        })
    },
    async gateway => {
      const outcome = await sendLatchMessage({
        providerSessionId: SESSION_ID,
        operationId: 'req-2',
        text: 'yes',
        waitForIdleMs: 2_000,
        gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
      });
      assert.equal(outcome.status, 'accepted');
      assert.equal(gateway.received.length, 1);
    }
  );
});

test('an exited session refuses without sending anything', async () => {
  await withGateway(
    {
      onOpen: session =>
        session.send(
          snapshot({ phase: 'exited', enabled: false, reason: 'the session has exited' })
        )
    },
    async gateway => {
      const outcome = await sendLatchMessage({
        providerSessionId: SESSION_ID,
        operationId: 'req-3',
        text: 'too late',
        gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
      });
      assert.equal(outcome.status, 'refused');
      assert.equal(outcome.reason, 'the session has exited');
      assert.deepEqual(gateway.received, []);
    }
  );
});

test('a busy session that never frees up refuses with the gateway reason', async () => {
  await withGateway(
    {
      onOpen: session =>
        session.send(snapshot({ phase: 'working', enabled: false, reason: 'agent is busy' }))
    },
    async gateway => {
      const outcome = await sendLatchMessage({
        providerSessionId: SESSION_ID,
        operationId: 'req-4',
        text: 'hello',
        waitForIdleMs: 60,
        gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
      });
      assert.equal(outcome.status, 'refused');
      assert.equal(outcome.reason, 'agent is busy');
      assert.deepEqual(gateway.received, []);
    }
  );
});

test('an ambiguous result is reported verbatim and never resent', async () => {
  await withGateway(
    {
      onOpen: session => session.send(snapshot({ phase: 'idle', enabled: true })),
      onMessage: (message, session) =>
        session.send({
          type: 'operation_result',
          operationId: message.operationId,
          status: 'ambiguous',
          reason: 'the connector did not confirm'
        })
    },
    async gateway => {
      const outcome = await sendLatchMessage({
        providerSessionId: SESSION_ID,
        operationId: 'req-5',
        text: 'maybe',
        gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
      });
      assert.equal(outcome.status, 'ambiguous');
      assert.equal(outcome.reason, 'the connector did not confirm');
      assert.equal(gateway.received.length, 1);
    }
  );
});

test('a conversation that drops after the send is ambiguous, not refused', async () => {
  await withGateway(
    {
      onOpen: session => session.send(snapshot({ phase: 'idle', enabled: true })),
      onMessage: (_message, session) => session.close()
    },
    async gateway => {
      const outcome = await sendLatchMessage({
        providerSessionId: SESSION_ID,
        operationId: 'req-6',
        text: 'dropped',
        gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
      });
      assert.equal(outcome.status, 'ambiguous');
    }
  );
});

test('a gateway error before the send is a command failure', async () => {
  await withGateway(
    {
      onOpen: session =>
        session.send({ type: 'error', code: 'unavailable', message: 'conversation is unavailable' })
    },
    async gateway => {
      await assert.rejects(
        sendLatchMessage({
          providerSessionId: SESSION_ID,
          operationId: 'req-7',
          text: 'hello',
          gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
        }),
        (error: unknown) =>
          error instanceof LatchSessionCommandError &&
          error.message === 'conversation is unavailable'
      );
      assert.deepEqual(gateway.received, []);
    }
  );
});

test('a gateway without the conversation endpoint fails before any upgrade', async () => {
  await withGateway({ conversation: false }, async gateway => {
    await assert.rejects(
      sendLatchMessage({
        providerSessionId: SESSION_ID,
        operationId: 'req-8',
        text: 'hello',
        gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
      }),
      /does not serve the conversation endpoint/
    );
  });
});

test('a gateway on an unsupported protocol major is refused', async () => {
  await withGateway({ protocolVersion: 3 }, async gateway => {
    await assert.rejects(
      sendLatchMessage({
        providerSessionId: SESSION_ID,
        operationId: 'req-9',
        text: 'hello',
        gateway: { baseUrl: gateway.baseUrl, token: gateway.token }
      }),
      /protocolVersion 3 is not supported/
    );
  });
});

test('empty text and a missing operation id are rejected before dialing', async () => {
  await assert.rejects(
    sendLatchMessage({ providerSessionId: SESSION_ID, operationId: 'req-10', text: '   ' }),
    /answer message is required/
  );
  await assert.rejects(
    sendLatchMessage({ providerSessionId: SESSION_ID, operationId: ' ', text: 'hello' }),
    /operation id is required/
  );
});

test('gateway config defaults to the loopback bind and refuses anything else', () => {
  const config = resolveLatchGatewayConfig({
    env: { LATCH_GATEWAY_TOKEN: TOKEN } as NodeJS.ProcessEnv
  });
  assert.equal(config.baseUrl, 'http://127.0.0.1:4610');
  assert.equal(config.token, TOKEN);

  assert.throws(
    () =>
      resolveLatchGatewayConfig({
        env: {
          LATCH_GATEWAY_URL: 'http://192.168.1.20:4610',
          LATCH_GATEWAY_TOKEN: TOKEN
        } as NodeJS.ProcessEnv
      }),
    (error: unknown) =>
      error instanceof LatchGatewayError && /non-loopback host/.test(error.message)
  );
});

test('a missing gateway token names the file to create', () => {
  assert.throws(
    () =>
      resolveLatchGatewayConfig({
        env: { LATCH_HOME: '/nowhere/.latch' } as NodeJS.ProcessEnv,
        fileExists: () => false
      }),
    /latch serve/
  );
});

test('the conversation socket url is the ws form of the loopback origin', () => {
  assert.equal(
    latchConversationSocketUrl({
      gateway: { baseUrl: 'http://127.0.0.1:4610', token: TOKEN },
      providerSessionId: 'ses_1'
    }),
    'ws://127.0.0.1:4610/v2/sessions/ses_1/conversation'
  );
});

test('a capabilities document missing required fields is not accepted', () => {
  assert.equal(parseLatchGatewayCapabilities({ protocolVersion: 2 }), null);
  assert.equal(
    parseLatchGatewayCapabilities({
      protocolVersion: 2,
      productVersion: '1.0.0',
      endpoints: { sessions: true, terminal: true, conversation: true },
      gatewayInstanceId: 'gw-a-b'
    })?.endpoints.preview,
    null
  );
});

/**
 * Source guard, in the spirit of `connectors/adapters/opencode/fixtures/
 * sidecar-loopback-only.json`: the Latch gateway speaks plaintext HTTP and its
 * bearer token grants `control`, so this client must only ever dial loopback.
 * A runtime test cannot pin this — the dangerous version works too.
 */
test('the Latch conversation client dials loopback only', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sources = ['latch-gateway.ts', 'latch-session.ts'].map(name =>
    readFileSync(path.join(here, name), 'utf8')
  );
  const gatewaySource = sources[0];
  assert.match(gatewaySource, /127\.0\.0\.1/);
  assert.match(gatewaySource, /isLoopbackHostname/);
  for (const source of sources) {
    for (const forbidden of ['0.0.0.0', "'::'", '"::"', 'allow-remote', 'allowRemote']) {
      assert.ok(
        !source.includes(forbidden),
        `a wildcard/remote marker leaked into the Latch conversation client: ${forbidden}`
      );
    }
  }
});
