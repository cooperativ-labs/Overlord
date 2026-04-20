#!/usr/bin/env node
/**
 * Overlord remote helper daemon.
 *
 * Listens on 127.0.0.1 (never a public interface) on the host the Overlord
 * desktop/mobile client is connected to via SSH. The client establishes a
 * port-forward through the SSH connection so it can reach this process at
 * an ephemeral localhost port on its own machine.
 *
 * Authentication is a single bearer token generated at install time and
 * stored at ~/.overlord/remote/token. Because the daemon only binds to
 * loopback, the only way to reach it is through an authenticated SSH session
 * — the bearer token is a second layer to defend against local users on the
 * same host.
 *
 * All filesystem + git logic is delegated to LocalWorkspaceClient so behavior
 * matches the Electron local mode exactly.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { LocalWorkspaceClient } from '../../../lib/workspace/local.js';
import type {
  CommitAndPushOptions,
  GitDiffOptions,
  ListFilesOptions,
  ReadFileOptions
} from '../../../lib/workspace/types.js';

const VERSION = '0.1.0';

const DEFAULT_PORT = Number.parseInt(process.env.OVERLORD_REMOTE_PORT ?? '0', 10);
const DEFAULT_HOST = '127.0.0.1';
const TOKEN_PATH = process.env.OVERLORD_REMOTE_TOKEN_PATH ?? join(homedir(), '.overlord', 'remote', 'token');

async function loadAuthToken(): Promise<string> {
  const raw = await readFile(TOKEN_PATH, 'utf8');
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`Auth token at ${TOKEN_PATH} is empty.`);
  return trimmed;
}

type Handler = (body: Record<string, unknown>) => Promise<unknown>;

function buildHandlers(): Record<string, Handler> {
  const workspaceFor = (body: Record<string, unknown>): LocalWorkspaceClient => {
    const dir = typeof body.workingDirectory === 'string' ? body.workingDirectory : '';
    if (!dir) throw new Error('workingDirectory is required.');
    return new LocalWorkspaceClient(dir);
  };

  return {
    '/directory-exists': async body => ({ exists: await workspaceFor(body).directoryExists() }),
    '/list-project-files': async body =>
      workspaceFor(body).listProjectFiles((body.options as ListFilesOptions | undefined) ?? undefined),
    '/read-file': async body =>
      workspaceFor(body).readFile(body.options as ReadFileOptions),
    '/git/status': async body => workspaceFor(body).getGitStatus(),
    '/git/diff': async body => workspaceFor(body).getGitDiff(body.options as GitDiffOptions),
    '/git/aggregate-diff': async body => workspaceFor(body).getAggregateDiff(),
    '/git/commit-and-push': async body =>
      workspaceFor(body).commitAndPush(body.options as CommitAndPushOptions)
  };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/plain' : 'application/json',
    'content-length': Buffer.byteLength(payload).toString()
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) throw new Error('Request body too large.');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const authToken = await loadAuthToken();
  const handlers = buildHandlers();

  const server = createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';

    if (url === '/health') {
      const header = req.headers.authorization ?? '';
      if (!header.startsWith('Bearer ') || header.slice(7) !== authToken) {
        return send(res, 401, { ok: false, error: 'Unauthorized.' });
      }
      return send(res, 200, { ok: true, version: VERSION });
    }

    if (method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });

    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ') || header.slice(7) !== authToken) {
      return send(res, 401, { error: 'Unauthorized.' });
    }

    const handler = handlers[url];
    if (!handler) return send(res, 404, { error: 'Not found.' });

    try {
      const rawBody = await readBody(req, 16 * 1024 * 1024);
      const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
      const result = await handler(body);
      return send(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal error.';
      return send(res, 500, { error: message });
    }
  });

  server.on('listening', () => {
    const address = server.address();
    if (address && typeof address === 'object') {
      // Emit a machine-parseable ready line so the installer / launcher can
      // pick up the assigned port when PORT=0 was requested.
      process.stdout.write(`OVERLORD_REMOTE_READY ${address.address}:${address.port}\n`);
    }
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  server.listen(DEFAULT_PORT, DEFAULT_HOST);
}

main().catch(error => {
  process.stderr.write(`overlord-remote-agent failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
