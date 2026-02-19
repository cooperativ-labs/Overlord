import { fork, ChildProcess } from 'child_process';
import path from 'path';

let serverProcess: ChildProcess | null = null;

export function startNextServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, '..', '.next', 'standalone', 'server.js');

    serverProcess = fork(serverPath, [], {
      env: {
        ...process.env,
        PORT: '3000',
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

    serverProcess.on('error', reject);

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
