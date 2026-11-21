import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';

/**
 * Message transports for the Codex app server.
 *
 * `codex app-server --listen unix://PATH` speaks WebSocket over an HTTP upgrade on the socket,
 * not raw JSON Lines (spike, LIVE): one JSON-RPC message per text frame. Node's global
 * `WebSocket` cannot dial a Unix socket, so this module carries a small RFC 6455 client over
 * `net.Socket`. It implements only what a client of one trusted local server needs: masked text
 * frames out, unmasked text/binary/continuation frames in, ping → pong, and close.
 *
 * The stdio transport (one JSON message per line) serves the recorded-frame fixtures and
 * one-shot queries against `codex app-server` over stdio.
 */

export type MessageTransport = {
  send: (text: string) => void;
  onMessage: (listener: (text: string) => void) => void;
  onClose: (listener: (reason: string) => void) => void;
  close: () => void;
};

/**
 * macOS limits `sun_path` to 104 bytes. For a long `--listen unix://PATH`, Codex creates the
 * real socket under a short directory and leaves a symlink at PATH; connecting to the symlink
 * fails with EINVAL, so connect to its resolved target.
 */
export function resolveSocketTarget(socketPath: string): string {
  try {
    return realpathSync(socketPath);
  } catch {
    return socketPath;
  }
}

/**
 * The resolved socket must be ours. Codex puts it in `/tmp/codex-daemon-<uid>/` (0700, LIVE), a
 * name any local user could create first in a shared `/tmp`. Before connecting, the socket and
 * its directory must belong to this user and the directory must not be group- or
 * world-writable; otherwise another user could stand in for the server. Throws on a mismatch.
 * A platform without `getuid` (Windows, where this mode is unsupported) skips the check.
 */
export function assertOwnedSocketTarget(target: string): void {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (uid === null) return;
  const socket = lstatSync(target);
  const dir = lstatSync(path.dirname(target));
  if (socket.uid !== uid || dir.uid !== uid || !dir.isDirectory() || (dir.mode & 0o022) !== 0) {
    throw new Error(`refusing to connect: ${target} is not an owner-only socket of this user`);
  }
}

const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

export function encodeClientFrame(
  payload: Buffer,
  opcode: number,
  mask: Buffer = randomBytes(4)
): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode;
  const masked = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) {
    masked[index] = payload[index]! ^ mask[index % 4]!;
  }
  return Buffer.concat([header, mask, masked]);
}

type ParsedFrame = { fin: boolean; opcode: number; payload: Buffer; consumed: number };

/** Parse one frame from the head of `buffer`, or `null` when more bytes are needed. */
export function parseServerFrame(buffer: Buffer): ParsedFrame | null {
  if (buffer.length < 2) return null;
  const fin = (buffer[0]! & 0x80) !== 0;
  const opcode = buffer[0]! & 0x0f;
  const masked = (buffer[1]! & 0x80) !== 0;
  let length = buffer[1]! & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    const big = buffer.readBigUInt64BE(2);
    if (big > BigInt(MAX_MESSAGE_BYTES)) throw new Error('websocket frame too large');
    length = Number(big);
    offset = 10;
  }
  const maskBytes = masked ? 4 : 0;
  if (buffer.length < offset + maskBytes + length) return null;
  let payload = buffer.subarray(offset + maskBytes, offset + maskBytes + length);
  if (masked) {
    const mask = buffer.subarray(offset, offset + 4);
    const unmasked = Buffer.alloc(length);
    for (let index = 0; index < length; index += 1) {
      unmasked[index] = payload[index]! ^ mask[index % 4]!;
    }
    payload = unmasked;
  }
  return { fin, opcode, payload: Buffer.from(payload), consumed: offset + maskBytes + length };
}

export type WebSocketTarget =
  | { kind: 'unix'; socketPath: string }
  | { kind: 'loopback'; host: '127.0.0.1'; port: number; bearerToken: string };

/**
 * Connect to the app server over WebSocket.
 *
 * The bearer token (loopback fallback only) travels in the upgrade's Authorization header —
 * never in the URL or argv. Codex refuses an upgrade that carries an `Origin` header (it blocks
 * browsers), so none is sent.
 */
export function connectWebSocket(
  target: WebSocketTarget,
  { timeoutMs = 5000 }: { timeoutMs?: number } = {}
): Promise<MessageTransport> {
  return new Promise((resolve, reject) => {
    let unixPath: string | null = null;
    if (target.kind === 'unix') {
      unixPath = resolveSocketTarget(target.socketPath);
      try {
        assertOwnedSocketTarget(unixPath);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
    }
    const socket =
      target.kind === 'unix'
        ? net.connect({ path: unixPath ?? target.socketPath })
        : net.connect({ host: target.host, port: target.port });
    const key = randomBytes(16).toString('base64');
    const expectedAccept = createHash('sha1')
      .update(key + WEBSOCKET_GUID)
      .digest('base64');
    const messageListeners: ((text: string) => void)[] = [];
    const closeListeners: ((reason: string) => void)[] = [];
    let handshakeDone = false;
    let buffered = Buffer.alloc(0);
    let fragments: Buffer[] = [];
    let closed = false;

    const timer = setTimeout(() => {
      if (!handshakeDone) {
        socket.destroy();
        reject(new Error('websocket handshake timed out'));
      }
    }, timeoutMs);

    const finish = (reason: string) => {
      if (closed) return;
      closed = true;
      for (const listener of closeListeners) listener(reason);
    };

    socket.on('connect', () => {
      const lines = [
        'GET / HTTP/1.1',
        `Host: ${target.kind === 'unix' ? 'localhost' : `${target.host}:${target.port}`}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        ...(target.kind === 'loopback' ? [`Authorization: Bearer ${target.bearerToken}`] : []),
        '',
        ''
      ];
      socket.write(lines.join('\r\n'));
    });

    // Frames that arrive in the same chunk as the upgrade response would otherwise reach no
    // listener, because the caller attaches one only after this promise resolves.
    const early: string[] = [];
    const transport: MessageTransport = {
      send: text => {
        if (closed) return;
        socket.write(encodeClientFrame(Buffer.from(text, 'utf8'), 0x1));
      },
      onMessage: listener => {
        messageListeners.push(listener);
        for (const text of early.splice(0)) listener(text);
      },
      onClose: listener => closeListeners.push(listener),
      close: () => {
        if (closed) return;
        try {
          socket.write(encodeClientFrame(Buffer.from([0x03, 0xe8]), 0x8));
        } catch {
          // The peer is already gone.
        }
        socket.end();
        finish('closed by client');
      }
    };

    socket.on('data', (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!handshakeDone) {
        const headerEnd = buffered.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const header = buffered.subarray(0, headerEnd).toString('latin1');
        buffered = buffered.subarray(headerEnd + 4);
        const status = /^HTTP\/1\.1 (\d{3})/.exec(header)?.[1];
        const accept = /^sec-websocket-accept:\s*(.+)$/im.exec(header)?.[1]?.trim();
        clearTimeout(timer);
        if (status !== '101' || accept !== expectedAccept) {
          socket.destroy();
          reject(new Error(`websocket upgrade refused (status ${status ?? 'unknown'})`));
          return;
        }
        handshakeDone = true;
        resolve(transport);
      }
      for (;;) {
        let frame: ParsedFrame | null;
        try {
          frame = parseServerFrame(buffered);
        } catch {
          socket.destroy();
          finish('protocol error');
          return;
        }
        if (!frame) return;
        buffered = buffered.subarray(frame.consumed);
        if (frame.opcode === 0x8) {
          socket.end();
          finish('closed by server');
          return;
        }
        if (frame.opcode === 0x9) {
          socket.write(encodeClientFrame(frame.payload, 0xa));
          continue;
        }
        if (frame.opcode === 0xa) continue;
        if (frame.opcode === 0x1 || frame.opcode === 0x2 || frame.opcode === 0x0) {
          fragments.push(frame.payload);
          if (!frame.fin) continue;
          const text = Buffer.concat(fragments).toString('utf8');
          fragments = [];
          if (messageListeners.length === 0) early.push(text);
          for (const listener of messageListeners) listener(text);
        }
      }
    });
    socket.on('error', error => {
      clearTimeout(timer);
      if (!handshakeDone) reject(error);
      finish(error.message);
    });
    socket.on('close', () => finish('socket closed'));
  });
}

/** One JSON message per line over a pair of streams (stdio server, recorded-frame fixtures). */
export function createLineTransport({
  input,
  output
}: {
  input: Readable;
  output: Writable;
}): MessageTransport {
  const messageListeners: ((text: string) => void)[] = [];
  const closeListeners: ((reason: string) => void)[] = [];
  let buffered = '';
  let closed = false;
  const finish = (reason: string) => {
    if (closed) return;
    closed = true;
    for (const listener of closeListeners) listener(reason);
  };
  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    buffered += chunk;
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (line) for (const listener of messageListeners) listener(line);
      newline = buffered.indexOf('\n');
    }
  });
  input.on('end', () => finish('input ended'));
  input.on('error', error => finish(error.message));
  return {
    send: text => {
      if (!closed) output.write(`${text}\n`);
    },
    onMessage: listener => messageListeners.push(listener),
    onClose: listener => closeListeners.push(listener),
    close: () => finish('closed by client')
  };
}
