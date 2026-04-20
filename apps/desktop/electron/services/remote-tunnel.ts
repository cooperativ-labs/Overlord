/**
 * Remote tunnel manager.
 *
 * For each project using SSH execution, maintains:
 *   1. A persistent ssh2 Client connected to the configured host.
 *   2. A background `node ~/.overlord/remote/server.mjs` process started via
 *      the SSH channel. The server binds 127.0.0.1:<random> and prints
 *      `OVERLORD_REMOTE_READY <host>:<port>` to stdout.
 *   3. A local net.Server that accepts incoming connections on an ephemeral
 *      127.0.0.1 port and forwards them to the remote helper's port through
 *      the SSH connection (ssh2 `forwardOut`). That gives us an HTTP endpoint
 *      reachable on localhost from the Electron main process.
 *
 * A project is keyed by projectId. Switching projects closes the previous
 * tunnel; agents spawned for tickets on that project share the single tunnel.
 */

import { readFile } from 'node:fs/promises';
import { createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { ClientChannel, ConnectConfig } from 'ssh2';
import { Client as SshClient } from 'ssh2';

import { RemoteWorkspaceClient } from '../../../../lib/workspace/remote';
import type { SshConnectionConfig, WorkspaceClient } from '../../../../lib/workspace/types';

import { store } from './settings-store';

type TunnelRecord = {
  projectId: string;
  ssh: SshClient;
  channel: ClientChannel;
  localServer: NetServer;
  localPort: number;
  remotePort: number;
  authToken: string;
  remoteWorkingDirectory: string;
  createdAt: number;
};

const tunnels = new Map<string, TunnelRecord>();

/** Per-project cached auth token, populated at install time by the installer IPC. */
function getStoredHelperToken(projectId: string): string | undefined {
  const key = `remoteHelperToken:${projectId}`;
  const value = store.get(key, '') as string;
  return value?.trim() || undefined;
}

function getStoredHelperPath(projectId: string): string {
  const key = `remoteHelperServerPath:${projectId}`;
  const value = store.get(key, '') as string;
  return value?.trim() || path.posix.join('~/.overlord/remote/server.mjs');
}

function getStoredNodeBin(projectId: string): string {
  const key = `remoteHelperNodeBin:${projectId}`;
  const value = store.get(key, '') as string;
  return value?.trim() || 'node';
}

function buildConnectConfig(ssh: SshConnectionConfig): ConnectConfig {
  const base: ConnectConfig = {
    host: ssh.host,
    port: ssh.port ?? 22,
    username: ssh.user,
    keepaliveInterval: 15_000,
    readyTimeout: 20_000
  };
  if (ssh.authMethod === 'key') {
    if (!ssh.privateKeyPath) {
      throw new Error('privateKeyPath is required when authMethod is "key".');
    }
    // Loaded lazily below so we fail with a clear message if the file is missing.
    return { ...base, privateKey: undefined, passphrase: ssh.passphrase };
  }
  if (ssh.authMethod === 'tailscale') {
    // Tailscale SSH: remote tailscaled authenticates via tailnet ACLs; ssh2
    // must offer 'none' auth. Requires `tailscale up --ssh` on the target.
    return { ...base, authHandler: ['none'] };
  }
  // ssh-agent mode
  const agentSock = process.env.SSH_AUTH_SOCK;
  if (!agentSock) {
    throw new Error('SSH_AUTH_SOCK is not set — cannot use ssh-agent authentication.');
  }
  return { ...base, agent: agentSock };
}

async function connectSsh(ssh: SshConnectionConfig): Promise<SshClient> {
  const config = buildConnectConfig(ssh);
  if (ssh.authMethod === 'key' && ssh.privateKeyPath) {
    const resolved = ssh.privateKeyPath.startsWith('~')
      ? path.join(os.homedir(), ssh.privateKeyPath.slice(1))
      : ssh.privateKeyPath;
    config.privateKey = await readFile(resolved);
  }
  return new Promise((resolve, reject) => {
    const client = new SshClient();
    client.once('ready', () => resolve(client));
    client.once('error', reject);
    client.connect(config);
  });
}

function launchRemoteHelper(
  ssh: SshClient,
  projectId: string
): Promise<{ channel: ClientChannel; remotePort: number }> {
  const nodeBin = getStoredNodeBin(projectId);
  const serverPath = getStoredHelperPath(projectId);
  // Ask the server to bind a random port; it writes OVERLORD_REMOTE_READY to stdout.
  const command = `OVERLORD_REMOTE_PORT=0 ${nodeBin} ${serverPath}`;

  return new Promise((resolve, reject) => {
    ssh.exec(command, { pty: false }, (err, channel) => {
      if (err) return reject(err);

      let stdoutBuffer = '';
      let stderrBuffer = '';
      let settled = false;

      const onData = (chunk: Buffer | string) => {
        stdoutBuffer += chunk.toString();
        const match = /OVERLORD_REMOTE_READY\s+([^\s:]+):(\d+)/.exec(stdoutBuffer);
        if (match && !settled) {
          settled = true;
          const remotePort = Number.parseInt(match[2] ?? '0', 10);
          resolve({ channel, remotePort });
        }
      };

      channel.on('data', onData);
      channel.stderr.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString();
      });
      channel.once('close', () => {
        if (!settled) {
          settled = true;
          reject(
            new Error(`Remote helper exited before ready. stderr:\n${stderrBuffer.slice(0, 2000)}`)
          );
        }
      });
    });
  });
}

function openLocalForward(ssh: SshClient, remotePort: number): Promise<NetServer> {
  return new Promise((resolve, reject) => {
    const server = createNetServer((local: Socket) => {
      ssh.forwardOut('127.0.0.1', 0, '127.0.0.1', remotePort, (err, stream) => {
        if (err) {
          local.destroy(err);
          return;
        }
        local.pipe(stream).pipe(local);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function getLocalPort(server: NetServer): number {
  const address = server.address();
  if (!address || typeof address !== 'object') throw new Error('Local forward has no port.');
  return address.port;
}

export type ResolveRemoteWorkspaceOptions = {
  projectId: string;
  ssh: SshConnectionConfig;
  remoteWorkingDirectory: string;
};

export async function resolveRemoteWorkspaceClient(
  options: ResolveRemoteWorkspaceOptions
): Promise<WorkspaceClient> {
  const existing = tunnels.get(options.projectId);
  if (existing && existing.remoteWorkingDirectory === options.remoteWorkingDirectory) {
    return new RemoteWorkspaceClient({
      endpoint: { host: '127.0.0.1', port: existing.localPort },
      authToken: existing.authToken,
      remoteWorkingDirectory: existing.remoteWorkingDirectory
    });
  }
  if (existing) {
    await closeTunnel(options.projectId);
  }

  const authToken = getStoredHelperToken(options.projectId);
  if (!authToken) {
    throw new Error(
      'Remote helper is not installed for this project. Run "Install remote helper" first.'
    );
  }

  const ssh = await connectSsh(options.ssh);
  let channel: ClientChannel | null = null;
  let localServer: NetServer | null = null;

  try {
    const launched = await launchRemoteHelper(ssh, options.projectId);
    channel = launched.channel;
    localServer = await openLocalForward(ssh, launched.remotePort);
    const localPort = getLocalPort(localServer);

    const record: TunnelRecord = {
      projectId: options.projectId,
      ssh,
      channel,
      localServer,
      localPort,
      remotePort: launched.remotePort,
      authToken,
      remoteWorkingDirectory: options.remoteWorkingDirectory,
      createdAt: Date.now()
    };
    tunnels.set(options.projectId, record);

    // When the SSH connection drops, tear the tunnel down so the next call
    // re-establishes from scratch.
    ssh.once('close', () => {
      tunnels.delete(options.projectId);
      localServer?.close();
    });

    return new RemoteWorkspaceClient({
      endpoint: { host: '127.0.0.1', port: localPort },
      authToken,
      remoteWorkingDirectory: options.remoteWorkingDirectory
    });
  } catch (error) {
    channel?.close();
    localServer?.close();
    ssh.end();
    throw error;
  }
}

export async function closeTunnel(projectId: string): Promise<void> {
  const record = tunnels.get(projectId);
  if (!record) return;
  tunnels.delete(projectId);
  try {
    record.channel.close();
  } catch {
    // ignore
  }
  await new Promise<void>(resolve => record.localServer.close(() => resolve()));
  record.ssh.end();
}

export async function shutdownAllRemoteTunnels(): Promise<void> {
  const ids = [...tunnels.keys()];
  await Promise.all(ids.map(id => closeTunnel(id)));
}
