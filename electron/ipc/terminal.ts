import { BrowserWindow, ipcMain } from 'electron';
import { exec } from 'child_process';

import {
  killTerminal,
  resizeTerminal,
  spawnTerminal,
  writeToTerminal
} from '../services/terminal-manager';
import { store } from '../services/settings-store';

export function registerTerminalIpc(): void {
  ipcMain.handle('terminal:spawn', (event, command?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('No window found');
    return spawnTerminal(win, command);
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

  ipcMain.handle('terminal:open-external', (_event, command: string) => {
    const termApp = store.get('externalTerminalApp', 'terminal');
    const escaped = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    let script: string;

    switch (termApp) {
      case 'iterm':
        script = `
          tell application "iTerm"
            activate
            create window with default profile command "${escaped}"
          end tell
        `;
        break;
      case 'warp':
        // Warp supports direct CLI invocation
        exec(`open -a Warp`);
        // Give Warp time to open, then use AppleScript to type command
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            exec(
              `osascript -e 'tell application "System Events" to keystroke "${escaped}" & return'`,
              () => resolve()
            );
          }, 1000);
        });
      default:
        script = `
          tell application "Terminal"
            activate
            do script "${escaped}"
          end tell
        `;
    }

    return new Promise<void>((resolve, reject) => {
      exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}
