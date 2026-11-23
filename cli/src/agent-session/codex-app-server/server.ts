import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  CODEX_APP_SERVER_ADAPTER_KEY,
  CONTROL_PLANE_SURFACE_ENV,
  parseCliVersion
} from './protocol.js';

/**
 * The private Codex app server one Overlord session runs against.
 *
 * Security model (plan §7):
 *  - **No TCP.** The server listens on `unix://` in `~/.ovld/cx/`, a directory that must be
 *    owner-only (0700); Codex creates the socket 0600. The path is short on purpose: macOS caps
 *    `sun_path` at 104 bytes.
 *  - **Never the user's shared daemon** (`~/.codex/app-server-control/…`) and never remote
 *    control; the supervisor stops if remote control reports itself enabled.
 *  - **An allowlisted environment.** Commands the agent runs inherit the server's environment,
 *    so Overlord credentials and objective scope are dropped: `OVERLORD_USER_TOKEN`, channel
 *    tokens, `MISSION_ID`, `OVERLORD_OBJECTIVE_ID` and the rest never reach it. The surface
 *    marker is added, so Overlord's own Codex plugin hooks stay silent inside this server.
 *  - **Own process group**, so stopping the supervisor stops the server and its children.
 */

export function socketDirectory(home: string = os.homedir()): string {
  return path.join(home, '.ovld', 'cx');
}

/** Create (or verify) the owner-only socket directory. Throws when it is not owner-only. */
export function prepareSocketDirectory(home?: string): string {
  const dir = socketDirectory(home);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Verified below.
  }
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${dir} is not a directory`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(`${dir} must be owner-only (0700)`);
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(`${dir} is not owned by the current user`);
  }
  return dir;
}

export function newSocketPath(dir: string): string {
  return path.join(dir, `${randomBytes(4).toString('hex')}.sock`);
}

const ENV_ALLOWLIST = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TERM',
  'LANG',
  'TZ',
  'CODEX_HOME',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'SSH_AUTH_SOCK',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  // Where the agent's own `ovld` finds its backend and data directory. Neither is a credential
  // or a scope: `ovld protocol attach` inside the thread still authenticates as the person and
  // binds the launch channel by objective.
  'OVERLORD_BACKEND_URL',
  'OVLD_HOME'
]);

/** The app server's environment: an allowlist plus the control-plane surface marker. */
export function buildServerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (ENV_ALLOWLIST.has(key) || key.startsWith('LC_') || key.startsWith('XDG_')) {
      out[key] = value;
    }
  }
  out[CONTROL_PLANE_SURFACE_ENV] = CODEX_APP_SERVER_ADAPTER_KEY;
  return out;
}

export function readCodexVersion(codexBin: string, env: NodeJS.ProcessEnv): string | null {
  const result = spawnSync(codexBin, ['--version'], {
    encoding: 'utf8',
    env: buildServerEnv(env),
    timeout: 10_000
  });
  if (result.status !== 0) return null;
  return parseCliVersion(String(result.stdout));
}

/**
 * The server is spawned detached (its own process group) so a graceful stop can end it and every
 * command it runs. That also means it outlives a supervisor killed with SIGKILL, and would keep
 * running its turn with nobody posting events or answering approvals. This watchdog — a detached
 * `sh` loop, no Node, no credentials in its env or argv — ends the server's group as soon as the
 * supervisor pid is gone, and exits on its own when the server does.
 */
const WATCHDOG_SCRIPT = [
  'sup=$1; srv=$2',
  'while kill -0 "$sup" 2>/dev/null && kill -0 "$srv" 2>/dev/null; do sleep 1; done',
  'if kill -0 "$srv" 2>/dev/null; then',
  '  kill -TERM -"$srv" 2>/dev/null; sleep 3; kill -KILL -"$srv" 2>/dev/null',
  'fi'
].join('\n');

export function startServerWatchdog(supervisorPid: number, serverPid: number): ChildProcess {
  const watchdog = spawn(
    '/bin/sh',
    ['-c', WATCHDOG_SCRIPT, 'ovld-codex-watchdog', String(supervisorPid), String(serverPid)],
    { detached: true, stdio: 'ignore', env: { PATH: '/usr/bin:/bin' } }
  );
  watchdog.unref();
  return watchdog;
}

export type PrivateAppServer = {
  socketPath: string;
  child: ChildProcess;
  stop: () => Promise<void>;
};

export async function spawnPrivateAppServer({
  codexBin = 'codex',
  cwd,
  env,
  home,
  readyTimeoutMs = 15_000
}: {
  codexBin?: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  home?: string;
  readyTimeoutMs?: number;
}): Promise<PrivateAppServer> {
  const socketPath = newSocketPath(prepareSocketDirectory(home));
  const child = spawn(codexBin, ['app-server', '--listen', `unix://${socketPath}`], {
    cwd,
    env: buildServerEnv(env),
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore']
  });
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  const watchdog = child.pid ? startServerWatchdog(process.pid, child.pid) : null;
  // Codex puts the real socket in its own owner-only directory
  // (`/private/tmp/codex-daemon-<uid>/<sha256>`, LIVE on 0.170) and leaves a symlink at the
  // requested path. Both are removed on stop, with Codex's lock file.
  let realSocket: string | null = null;

  const stop = async (): Promise<void> => {
    try {
      watchdog?.kill('SIGTERM');
    } catch {
      // Already gone.
    }
    if (!exited && child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // Already gone.
      }
      const deadline = Date.now() + 3000;
      while (!exited && Date.now() < deadline) await sleep(50);
      if (!exited) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // Already gone.
        }
      }
    }
    rmSync(socketPath, { force: true });
    if (
      exited &&
      realSocket &&
      path.basename(path.dirname(realSocket)).startsWith('codex-daemon-')
    ) {
      rmSync(realSocket, { force: true });
      rmSync(`${realSocket}.lock`, { force: true });
    }
  };

  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    if (exited) throw new Error('codex app-server exited before it was ready');
    if (existsSync(socketPath)) {
      try {
        if (statSync(socketPath).isSocket()) {
          realSocket = realpathSync(socketPath);
          return { socketPath, child, stop };
        }
      } catch {
        // Not ready yet.
      }
    }
    await sleep(50);
  }
  await stop();
  throw new Error('codex app-server did not open its socket in time');
}
