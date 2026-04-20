/**
 * IPC for one-time install of the remote helper on a target SSH host.
 *
 * Flow (from the desktop app):
 *   1. User provides structured SshConnectionConfig + projectId.
 *   2. We open an ssh2 connection, exec `bash -s -- --with-bundle`, and
 *      stream the install script + the bundled server.mjs on stdin.
 *   3. The script drops the server at ~/.overlord/remote/server.mjs, mints
 *      an auth token at ~/.overlord/remote/token, and prints TOKEN / path
 *      markers on stdout.
 *   4. We capture those markers and persist (token, path, nodeBin) in the
 *      desktop settings store keyed by projectId — the tunnel manager reads
 *      them when opening a session.
 *
 * The bundled server.mjs is built from apps/remote-agent at desktop build
 * time and copied into resources/remote-agent/server.mjs.
 */

import { ipcMain } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';

import { Client as SshClient } from 'ssh2';

import type { SshConnectionConfig } from '../../../../lib/workspace/types';
import { store } from '../services/settings-store';

type InstallPayload = {
  projectId: string;
  ssh: SshConnectionConfig;
};

type InstallResult = {
  ok: boolean;
  token?: string;
  serverPath?: string;
  nodeBin?: string;
  error?: string;
};

async function readResource(relativePath: string): Promise<Buffer> {
  const resourcesPath = app.isPackaged
    ? path.join(process.resourcesPath, relativePath)
    : path.join(__dirname, '..', 'resources', relativePath);
  return readFile(resourcesPath);
}

async function connect(ssh: SshConnectionConfig): Promise<SshClient> {
  return new Promise((resolve, reject) => {
    const client = new SshClient();
    client.once('ready', () => resolve(client));
    client.once('error', reject);
    const base = {
      host: ssh.host,
      port: ssh.port ?? 22,
      username: ssh.user,
      readyTimeout: 20_000
    };
    if (ssh.authMethod === 'key') {
      if (!ssh.privateKeyPath) return reject(new Error('privateKeyPath is required.'));
      const resolved = ssh.privateKeyPath.startsWith('~')
        ? path.join(os.homedir(), ssh.privateKeyPath.slice(1))
        : ssh.privateKeyPath;
      readFile(resolved)
        .then(privateKey => client.connect({ ...base, privateKey, passphrase: ssh.passphrase }))
        .catch(reject);
    } else if (ssh.authMethod === 'tailscale') {
      // Tailscale SSH: tailscaled on the remote node handles auth via tailnet
      // ACLs, so no key is required. ssh2 must advertise 'none' auth and the
      // remote side accepts it. Requires `tailscale up --ssh` on the target.
      client.connect({ ...base, authHandler: ['none'] });
    } else {
      const agent = process.env.SSH_AUTH_SOCK;
      if (!agent) return reject(new Error('SSH_AUTH_SOCK is not set.'));
      client.connect({ ...base, agent });
    }
  });
}

function runInstall(ssh: SshClient, script: Buffer, bundle: Buffer): Promise<InstallResult> {
  return new Promise(resolve => {
    ssh.exec('bash -s -- --with-bundle', (err, channel) => {
      if (err) return resolve({ ok: false, error: err.message });

      let stdout = '';
      let stderr = '';
      channel.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      channel.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      channel.once('close', () => {
        if (!stdout.includes('OVERLORD_REMOTE_INSTALLED')) {
          resolve({ ok: false, error: stderr.slice(0, 2000) || 'Install did not complete.' });
          return;
        }
        const token = /^TOKEN=(.+)$/m.exec(stdout)?.[1]?.trim();
        const serverPath = /^SERVER_PATH=(.+)$/m.exec(stdout)?.[1]?.trim();
        const nodeBin = /^NODE_BIN=(.+)$/m.exec(stdout)?.[1]?.trim();
        if (!token || !serverPath || !nodeBin) {
          resolve({ ok: false, error: 'Install output missing expected markers.' });
          return;
        }
        resolve({ ok: true, token, serverPath, nodeBin });
      });

      // Feed: install.sh → marker line → bundle → marker line
      channel.write(script);
      channel.write('\nOVERLORD_BUNDLE_BEGIN\n');
      channel.write(bundle);
      channel.write('\nOVERLORD_BUNDLE_END\n');
      channel.end();
    });
  });
}

export function registerRemoteInstallIpc(): void {
  ipcMain.handle('remote-install:install', async (_event, payload: InstallPayload) => {
    if (!payload?.projectId || !payload.ssh?.host || !payload.ssh?.user) {
      return { ok: false, error: 'projectId, ssh.host, and ssh.user are required.' };
    }
    let ssh: SshClient | null = null;
    try {
      const [script, bundle] = await Promise.all([
        readResource('remote-agent/install.sh'),
        readResource('remote-agent/server.mjs')
      ]);
      ssh = await connect(payload.ssh);
      const result = await runInstall(ssh, script, bundle);
      if (result.ok && result.token && result.serverPath && result.nodeBin) {
        store.set(`remoteHelperToken:${payload.projectId}`, result.token);
        store.set(`remoteHelperServerPath:${payload.projectId}`, result.serverPath);
        store.set(`remoteHelperNodeBin:${payload.projectId}`, result.nodeBin);
      }
      return result;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Install failed.' };
    } finally {
      ssh?.end();
    }
  });

  ipcMain.handle('remote-install:status', async (_event, payload: { projectId: string }) => {
    const installed = Boolean(store.get(`remoteHelperToken:${payload?.projectId ?? ''}`, ''));
    return { installed };
  });
}
