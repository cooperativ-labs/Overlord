/**
 * A loopback stand-in for Latch's v2 gateway, for tests.
 *
 * A real HTTP server that serves `/v2/capabilities` and performs the RFC 6455
 * upgrade for `/v2/sessions/{id}/conversation`, so a test exercises the
 * production `WebSocket` client — subprotocol token, server-first snapshot and
 * all — rather than a stubbed transport.
 */

import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { Duplex } from 'node:stream';

const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const TOKEN = 'a1b2c3d4';
export const SESSION_ID = 'ses_test';

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
    const first = cursor.readUInt8(0);
    const second = cursor.readUInt8(1);
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
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
        payload.writeUInt8(payload.readUInt8(index) ^ maskKey.readUInt8(index % 4), index);
      }
    }
    cursor = cursor.subarray(offset + length);
    if (opcode === 0x1) texts.push(payload.toString('utf8'));
  }
  return { texts, rest: cursor };
}

export type GatewaySession = {
  send(message: unknown): void;
  close(): void;
};

export type FakeGateway = {
  baseUrl: string;
  token: string;
  received: Record<string, unknown>[];
  close(): Promise<void>;
};

/**
 * Start a loopback gateway. `onOpen` receives the upgraded connection and
 * drives whatever the scenario needs; `onMessage` sees every client op.
 */
export async function startFakeGateway({
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
    let pending: Buffer = Buffer.alloc(0);
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

export function snapshot({
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

export function stateChanged({ phase, enabled }: { phase: string; enabled: boolean }) {
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

export async function withGateway(
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
