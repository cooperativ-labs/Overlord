import { ChildProcess, fork } from 'child_process';
import { app } from 'electron';
import net from 'net';
import path from 'path';

let serverProcess: ChildProcess | null = null;

function getServerPath(): string {
  const appPath = app.getAppPath();
  // When asar is used, unpacked files are in app.asar.unpacked instead of app.asar
  const unpackedPath = appPath.replace('app.asar', 'app.asar.unpacked');
  return path.join(unpackedPath, '.next', 'standalone', 'server.js');
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

export function startNextServer(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const serverPath = getServerPath();
    console.log(`[next] Starting server from: ${serverPath} on port ${port}`);

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
      console.log('[next]', output);
      if (output.includes('Ready') || output.includes('started server')) {
        resolve();
      }
    });

    serverProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[next]', data.toString());
    });

    serverProcess.on('error', err => {
      console.error('[next] Failed to start server:', err);
      reject(err);
    });

    serverProcess.on('exit', code => {
      if (code !== null && code !== 0) {
        console.error('[next] Server exited with code:', code);
      }
    });

    // Resolve after timeout even if we didn't see the "Ready" message
    setTimeout(resolve, 8000);
  });
}

export function stopNextServer(): void {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}
