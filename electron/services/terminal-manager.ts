import { BrowserWindow } from 'electron';
import fs from 'fs';
import * as pty from 'node-pty';
import os from 'os';
import path from 'path';

const terminals = new Map<string, pty.IPty>();
let counter = 0;
const homeDirectory = process.env.HOME || os.homedir();

export function normalizeTerminalCwd(cwd?: string): string | undefined {
  const raw = cwd?.trim();
  if (!raw) return undefined;

  let resolved = raw;
  if (raw === '~') {
    resolved = homeDirectory;
  } else if (raw.startsWith('~/')) {
    resolved = path.join(homeDirectory, raw.slice(2));
  } else if (!path.isAbsolute(raw)) {
    resolved = path.resolve(raw);
  }

  const normalized = path.normalize(resolved);
  return fs.existsSync(normalized) ? normalized : undefined;
}

export function spawnTerminal(
  mainWindow: BrowserWindow,
  command?: string,
  cwd?: string,
  extraEnv?: Record<string, string>
): string {
  const id = `term-${++counter}`;
  const shell = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh');
  const resolvedCwd = normalizeTerminalCwd(cwd) ?? homeDirectory;

  const term = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: resolvedCwd,
    env: { ...process.env, ...extraEnv } as Record<string, string>
  });

  term.onData(data => {
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

  // If a command was provided, wait for the shell to be ready before writing it.
  // We listen for the first data event (usually the prompt) which signals the shell
  // has initialized. Fall back to a timeout in case the shell doesn't produce output.
  if (command) {
    let written = false;
    const writeCommand = () => {
      if (written) return;
      written = true;
      const t = terminals.get(id);
      if (t) {
        t.write(command + '\r');
      }
    };

    // Listen for first data event from the shell (prompt ready)
    const disposable = term.onData(() => {
      disposable.dispose();
      // Small extra delay after prompt appears to ensure shell is fully ready
      setTimeout(writeCommand, 50);
    });

    // Fallback timeout in case shell doesn't produce visible output
    setTimeout(writeCommand, 1500);
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
