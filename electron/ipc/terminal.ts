import { BrowserWindow, ipcMain } from 'electron';
import { dialog } from 'electron';
import { exec } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  killTerminal,
  normalizeTerminalCwd,
  resizeTerminal,
  spawnTerminal,
  writeToTerminal
} from '../services/terminal-manager';
import { store } from '../services/settings-store';

type TerminalLaunchPayload =
  | string
  | {
      command?: string;
      cwd?: string;
    };

function runAppleScript(script: string) {
  return new Promise<void>((resolve, reject) => {
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function normalizeLaunchPayload(payload?: TerminalLaunchPayload): { command?: string; cwd?: string } {
  if (!payload) return {};
  if (typeof payload === 'string') {
    return { command: payload };
  }

  const command =
    typeof payload.command === 'string' && payload.command.trim().length > 0
      ? payload.command
      : undefined;
  const cwd = typeof payload.cwd === 'string' ? normalizeTerminalCwd(payload.cwd) : undefined;

  return { command, cwd };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function applyCwd(command: string, cwd?: string): string {
  if (!cwd) return command;
  return `cd ${shellQuote(cwd)} && ${command}`;
}

export function registerTerminalIpc(): void {
  ipcMain.handle('terminal:spawn', (event, payload?: TerminalLaunchPayload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('No window found');
    const { command, cwd } = normalizeLaunchPayload(payload);
    return spawnTerminal(win, command, cwd);
  });

  ipcMain.on('terminal:write', (_event, id: string, data: string) => {
    writeToTerminal(id, data);
  });

  ipcMain.on('terminal:resize', (_event, id: string, cols: number, rows: number) => {
    resizeTerminal(id, cols, rows);
  });

  ipcMain.handle('terminal:kill', (_event, id: string) => {
    killTerminal(id);
  });

  ipcMain.handle('terminal:open-external', (_event, payload?: TerminalLaunchPayload) => {
    const { command, cwd } = normalizeLaunchPayload(payload);
    if (!command) {
      return;
    }

    // Write the command to a temp script file to avoid escaping issues
    // when passing complex commands (with $(curl ...), &&, quotes, etc.)
    // through AppleScript string interpolation.
    const scriptPath = path.join(
      os.tmpdir(),
      `cooperativ-launch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sh`
    );

    let scriptContent = '#!/bin/bash\n';
    if (cwd) {
      scriptContent += `cd ${shellQuote(cwd)}\n`;
    }
    scriptContent += `${command}\n`;

    fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

    // The terminal command sources the script then removes the temp file
    const launchCmd = `source ${shellQuote(scriptPath)} ; rm -f ${shellQuote(scriptPath)}`;
    const termApp = store.get('externalTerminalApp', 'default') as string;
    const escapedLaunchCmd = launchCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    let script: string;

    switch (termApp) {
      case 'iterm':
        script = `
          tell application "iTerm"
            activate
            create window with default profile
            tell current session of current window
              write text "${escapedLaunchCmd}"
            end tell
          end tell
        `;
        break;
      case 'warp':
        // Warp supports direct CLI invocation
        exec(`open -a Warp`);
        // Give Warp time to open, then use AppleScript to type command
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            runAppleScript(
              `tell application "System Events" to keystroke "${escapedLaunchCmd}" & return`
            ).finally(() => resolve());
          }, 1000);
        });
      default: // 'terminal' or 'default'
        script = `
          tell application "Terminal"
            activate
            do script "${escapedLaunchCmd}"
          end tell
        `;
    }

    // Clean up the temp file after a generous timeout as a safety net
    // (the script itself also removes it via the `rm -f` above)
    setTimeout(() => {
      try {
        fs.unlinkSync(scriptPath);
      } catch {
        // Already deleted by the terminal command — ignore
      }
    }, 60_000);

    return runAppleScript(script);
  });

  ipcMain.handle('terminal:choose-directory', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win
      ? await dialog.showOpenDialog(win, {
          properties: ['openDirectory', 'createDirectory']
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory']
        });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });
}
