import { ChildProcess, fork } from 'child_process';
import { app } from 'electron';
import fs from 'fs';
import net from 'net';
import path from 'path';

let serverProcess: ChildProcess | null = null;
const PORT_STATE_FILE_MODE = 0o600;

type PortState = {
  port: number;
  updated_at: string;
};

function getServerPath(): string {
  const appPath = app.getAppPath();
  // When asar is used, unpacked files are in app.asar.unpacked instead of app.asar
  const unpackedPath = appPath.replace('app.asar', 'app.asar.unpacked');
  return path.join(
    unpackedPath,
    'apps',
    'web',
    '.next',
    'standalone',
    'apps',
    'web',
    'server.js'
  );
}

function getPortStateFilePath(): string {
  return path.join(app.getPath('userData'), 'next-server-port.json');
}

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(err => {
        if (err || !port) reject(err ?? new Error('Could not determine free port'));
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

export function readSavedNextServerPort(): number | null {
  const stateFile = getPortStateFilePath();

  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PortState>;
    if (!Number.isInteger(parsed.port)) return null;
    if (parsed.port! <= 0 || parsed.port! > 65535) return null;
    return parsed.port!;
  } catch {
    return null;
  }
}

export function writeSavedNextServerPort(port: number): void {
  const stateFile = getPortStateFilePath();
  const tempFile = `${stateFile}.tmp-${process.pid}-${Date.now()}`;

  const payload: PortState = {
    port,
    updated_at: new Date().toISOString()
  };

  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), { mode: PORT_STATE_FILE_MODE });
  fs.renameSync(tempFile, stateFile);
  fs.chmodSync(stateFile, PORT_STATE_FILE_MODE);
}

export function startNextServer(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const serverPath = getServerPath();
    console.warn(`[next] Starting server from: ${serverPath} on port ${port}`);

    serverProcess = fork(serverPath, [], {
      env: {
        ...process.env,
        PORT: String(port),
        HOSTNAME: 'localhost'
      },
      stdio: 'pipe'
    });

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      console.warn('[next]', output);
      if (output.includes('Ready') || output.includes('started server')) {
        finish(resolve);
      }
    });

    serverProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[next]', data.toString());
    });

    serverProcess.on('error', err => {
      console.error('[next] Failed to start server:', err);
      finish(() => reject(err));
    });

    serverProcess.on('exit', code => {
      const exitError =
        code !== null && code !== 0
          ? new Error(`Next server exited before becoming ready (code ${code})`)
          : new Error('Next server exited before becoming ready');

      if (code !== null && code !== 0) {
        console.error('[next] Server exited with code:', code);
      }
      serverProcess = null;
      finish(() => reject(exitError));
    });

    // Resolve after timeout even if we didn't see the "Ready" message
    setTimeout(() => {
      finish(resolve);
    }, 8000);
  });
}

export function stopNextServer(): void {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}
