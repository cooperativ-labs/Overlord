import { BrowserWindow } from 'electron';
import os from 'os';
import * as pty from 'node-pty';

const terminals = new Map<string, pty.IPty>();
let counter = 0;

export function spawnTerminal(
  mainWindow: BrowserWindow,
  command?: string
): string {
  const id = `term-${++counter}`;
  const shell =
    process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh');

  const term = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: process.env.HOME || os.homedir(),
    env: { ...process.env } as Record<string, string>
  });

  term.onData((data) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:data', id, data);
    }
  });

  term.onExit(({ exitCode }) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:exit', id, exitCode);
    }
    terminals.delete(id);
  });

  terminals.set(id, term);

  // If a command was provided, write it after shell initializes
  if (command) {
    setTimeout(() => {
      const t = terminals.get(id);
      if (t) {
        t.write(command + '\r');
      }
    }, 300);
  }

  return id;
}

export function writeToTerminal(id: string, data: string): void {
  terminals.get(id)?.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  terminals.get(id)?.resize(cols, rows);
}

export function killTerminal(id: string): void {
  const term = terminals.get(id);
  if (term) {
    term.kill();
    terminals.delete(id);
  }
}

export function killAllTerminals(): void {
  for (const [id, term] of terminals) {
    term.kill();
    terminals.delete(id);
  }
}
