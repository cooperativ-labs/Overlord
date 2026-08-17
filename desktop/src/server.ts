import { type UtilityProcess, utilityProcess } from 'electron';
import http from 'node:http';
import net from 'node:net';

import { createProcessSupervisor } from './backend-process.js';
import { serverBundlePath, webappDistPath } from './paths.js';

/**
 * Supervises the embedded web/REST server. The server runs in an Electron
 * `utilityProcess` — a Node.js context on Electron's own ABI — so we ship and
 * sign a single runtime (no separate Node binary) while keeping the server
 * isolated from the renderer. It is the same server bundle `ovld serve` runs.
 *
 * The DB location is intentionally left to the server's default (the per-user
 * global `~/.ovld/Overlord.sqlite`), so an `ovld` invoked from a terminal shares
 * the exact same database the window shows with no extra wiring. Set
 * OVERLORD_SQLITE_PATH in the environment to override (e.g. for an isolated
 * app-data database).
 */
export interface ServerOptions {
  host: string;
  port: number;
}

/**
 * Fork parameters for the next `startServer()` call. The supervisor owns the
 * "is one already running?" decision, so the options travel through here rather
 * than through the fork callback's arguments.
 */
let pendingOptions: ServerOptions | null = null;

const supervisor = createProcessSupervisor<UtilityProcess>({
  fork: () => forkServer(pendingOptions!),
  onEvent: message => process.stderr.write(`[server] ${message}\n`)
});

function forkServer({ host, port }: ServerOptions): UtilityProcess {
  const child = utilityProcess.fork(serverBundlePath(), [], {
    serviceName: 'overlord-server',
    stdio: 'pipe',
    env: {
      ...process.env,
      OVERLORD_WEB_HOST: host,
      OVERLORD_WEB_PORT: String(port),
      OVERLORD_WEBAPP_DIST: webappDistPath(),
      OVERLORD_SERVE_SPA: 'true',
      // The desktop never auto-launches the optional SQL Studio process.
      OVERLORD_SQL_STUDIO_ENABLED: 'false'
    }
  });

  child.stdout?.on('data', chunk => process.stdout.write(`[server] ${chunk}`));
  child.stderr?.on('data', chunk => process.stderr.write(`[server] ${chunk}`));
  return child;
}

/**
 * Fork the embedded web/REST server. Only ever called for a **Local** backend
 * profile — see `backend-lifecycle.ts`, which is the single decision point for
 * whether a profile is allowed to run it at all.
 */
export function startServer(options: ServerOptions): void {
  pendingOptions = options;
  supervisor.start();
}

/**
 * Terminate the embedded server and wait until it has actually exited, so no
 * backend process survives a profile transition or app shutdown.
 */
export function stopServer(): Promise<void> {
  return supervisor.stop();
}

export function isServerRunning(): boolean {
  return supervisor.isRunning();
}

export function serverProcessPid(): number | null {
  return supervisor.pid();
}

/** Poll `GET /api/health` until the server answers `{ ok: true }` or we time out. */
export async function waitForHealth({
  host,
  port,
  timeoutMs = 30_000,
  intervalMs = 300,
  https = false
}: {
  host: string;
  port: number;
  timeoutMs?: number;
  intervalMs?: number;
  https?: boolean;
}): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pingHealth({ host, port, https })) return true;
    await delay(intervalMs);
  }
  return false;
}

export async function waitForRemoteHealth({
  backendUrl,
  timeoutMs = 30_000,
  intervalMs = 500
}: {
  backendUrl: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<boolean> {
  const parsed = new URL(backendUrl);
  const https = parsed.protocol === 'https:';
  const port = parsed.port ? Number(parsed.port) : https ? 443 : 80;
  return waitForHealth({
    host: parsed.hostname,
    port,
    timeoutMs,
    intervalMs,
    https
  });
}

function pingHealth({
  host,
  port,
  https
}: {
  host: string;
  port: number;
  https: boolean;
}): Promise<boolean> {
  return new Promise(resolve => {
    const path = '/api/health';
    if (https) {
      import('node:https').then(({ get }) => {
        const req = get({ host, port, path, timeout: 4_000 }, res => {
          let body = '';
          res.on('data', chunk => (body += chunk));
          res.on('end', () => {
            try {
              resolve(res.statusCode === 200 && JSON.parse(body).ok === true);
            } catch {
              resolve(false);
            }
          });
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });
      });
      return;
    }

    const req = http.get({ host, port, path, timeout: 2_000 }, res => {
      let body = '';
      res.on('data', d => (body += d));
      res.on('end', () => {
        try {
          resolve(res.statusCode === 200 && JSON.parse(body).ok === true);
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Find a free TCP port on the loopback interface, starting at `preferred`. */
export function findFreePort(preferred: number, host = '127.0.0.1'): Promise<number> {
  if (!isValidPort(preferred)) {
    return Promise.reject(
      new Error(`Preferred port must be an integer from 0 to 65535; got ${preferred}`)
    );
  }

  return new Promise((resolve, reject) => {
    const tryPort = (candidate: number, attemptsLeft: number) => {
      const server = net.createServer();
      server.once('error', (err: NodeJS.ErrnoException) => {
        server.close();
        if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
          tryPort(candidate + 1, attemptsLeft - 1);
        } else {
          reject(err);
        }
      });
      server.listen(candidate, host, () => {
        const { port } = server.address() as net.AddressInfo;
        server.close(() => resolve(port));
      });
    };
    tryPort(preferred, 20);
  });
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 0 && port < 65536;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
