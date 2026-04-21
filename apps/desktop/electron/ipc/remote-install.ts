/**
 * IPC for one-time install of the remote helper on a target SSH host.
 *
 * Flow (from the desktop app):
 *   1. User provides structured SshConnectionConfig + projectId.
 *   2. We open an ssh2 connection, exec `bash -s -- --with-bundle`, and
 *      stream a rendered install script with the bundled server.mjs embedded
 *      inline as base64.
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
import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client as SshClient } from 'ssh2';

import { BUNDLED_REMOTE_HELPER_VERSION } from '../../../../lib/workspace/helper-version';
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
  version?: string;
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

function renderInstallScript(script: Buffer, bundle: Buffer): string {
  const scriptTemplate = script.toString('utf8');
  const bundleMarker = '__OVERLORD_REMOTE_BUNDLE_B64__';
  const bundleBase64 = bundle.toString('base64').replace(/(.{76})/g, '$1\n');
  if (scriptTemplate.includes(bundleMarker)) {
    return scriptTemplate.replace(bundleMarker, bundleBase64);
  }

  const legacyBundleBlock = [
    '# The server.mjs contents are streamed on stdin after this script, delimited by',
    '# a line matching OVERLORD_BUNDLE_BEGIN.',
    'if [ "${1-}" = "--with-bundle" ]; then',
    '  # Read bundle from stdin between markers.',
    "  awk '/^OVERLORD_BUNDLE_BEGIN$/{flag=1;next}/^OVERLORD_BUNDLE_END$/{flag=0}flag' \\",
    '    > "${SERVER_FILE}.tmp"',
    '  mv "${SERVER_FILE}.tmp" "${SERVER_FILE}"',
    '  chmod 644 "${SERVER_FILE}"',
    'fi',
    '',
    'NODE_BIN="$(command -v node || true)"',
    'if [ -z "${NODE_BIN}" ]; then',
    '  echo "OVERLORD_REMOTE_INSTALL_ERROR node is not installed on the remote host." >&2',
    '  exit 1',
    'fi'
  ].join('\n');

  const replacementBundleBlock = [
    'NODE_BIN="$(command -v node || true)"',
    'if [ -z "${NODE_BIN}" ]; then',
    '  echo "OVERLORD_REMOTE_INSTALL_ERROR node is not installed on the remote host." >&2',
    '  exit 1',
    'fi',
    '',
    'if [ "${1-}" = "--with-bundle" ]; then',
    `  cat > "\${SERVER_FILE}.b64" <<'OVERLORD_REMOTE_BUNDLE'`,
    bundleBase64,
    'OVERLORD_REMOTE_BUNDLE',
    `  "\${NODE_BIN}" -e '`,
    '    const fs = require("node:fs");',
    '    const [src, dest] = process.argv.slice(1);',
    '    const base64 = fs.readFileSync(src, "utf8").replace(/\\s+/g, "");',
    '    fs.writeFileSync(dest, Buffer.from(base64, "base64"));',
    `  ' "\${SERVER_FILE}.b64" "\${SERVER_FILE}.tmp"`,
    '  rm -f "${SERVER_FILE}.b64"',
    '  mv "${SERVER_FILE}.tmp" "${SERVER_FILE}"',
    '  chmod 644 "${SERVER_FILE}"',
    'fi'
  ].join('\n');

  if (scriptTemplate.includes(legacyBundleBlock)) {
    return scriptTemplate.replace(legacyBundleBlock, replacementBundleBlock);
  }

  throw new Error('Remote install script format is not recognized.');
}

function runInstall(ssh: SshClient, script: string): Promise<InstallResult> {
  return new Promise(resolve => {
    const command = `OVERLORD_HELPER_VERSION=${BUNDLED_REMOTE_HELPER_VERSION} bash -s -- --with-bundle`;
    ssh.exec(command, (err, channel) => {
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
        const version = /^VERSION=(.+)$/m.exec(stdout)?.[1]?.trim();
        if (!token || !serverPath || !nodeBin) {
          resolve({ ok: false, error: 'Install output missing expected markers.' });
          return;
        }
        resolve({ ok: true, token, serverPath, nodeBin, version });
      });

      channel.end(script);
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
      const renderedScript = renderInstallScript(script, bundle);
      ssh = await connect(payload.ssh);
      const result = await runInstall(ssh, renderedScript);
      if (result.ok && result.token && result.serverPath && result.nodeBin) {
        store.set(`remoteHelperToken:${payload.projectId}`, result.token);
        store.set(`remoteHelperServerPath:${payload.projectId}`, result.serverPath);
        store.set(`remoteHelperNodeBin:${payload.projectId}`, result.nodeBin);
        store.set(
          `remoteHelperVersion:${payload.projectId}`,
          result.version ?? BUNDLED_REMOTE_HELPER_VERSION
        );
      }
      return result;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Install failed.' };
    } finally {
      ssh?.end();
    }
  });

  ipcMain.handle('remote-install:status', async (_event, payload: { projectId: string }) => {
    const projectId = payload?.projectId ?? '';
    const installed = Boolean(store.get(`remoteHelperToken:${projectId}`, ''));
    const version = (store.get(`remoteHelperVersion:${projectId}`, '') as string) || null;
    return {
      installed,
      version,
      bundledVersion: BUNDLED_REMOTE_HELPER_VERSION,
      needsUpdate: installed && version !== BUNDLED_REMOTE_HELPER_VERSION
    };
  });
}
