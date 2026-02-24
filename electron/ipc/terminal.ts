import { exec } from 'child_process';
import { BrowserWindow, ipcMain } from 'electron';
import { dialog } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { type AgentType, prepareAgentLaunch } from '../services/agent-launcher';
import { store } from '../services/settings-store';
import {
  killTerminal,
  normalizeTerminalCwd,
  resizeTerminal,
  spawnTerminal,
  writeToTerminal
} from '../services/terminal-manager';

type TerminalLaunchPayload =
  | string
  | {
      command?: string;
      cwd?: string;
    };

function runAppleScript(script: string) {
  return new Promise<void>((resolve, reject) => {
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, err => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function normalizeLaunchPayload(payload?: TerminalLaunchPayload): {
  command?: string;
  cwd?: string;
} {
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
      `overlord-launch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sh`
    );

    let scriptContent = '#!/bin/bash\n';
    if (cwd) {
      scriptContent += `cd ${shellQuote(cwd)}\n`;
    }
    scriptContent += `${command}\n`;

    fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

    // Run via bash and keep the script around briefly so delayed/replayed launches
    // do not immediately fail with "no such file or directory".
    const launchCmd = [
      `if [ -f ${shellQuote(scriptPath)} ]; then`,
      `bash ${shellQuote(scriptPath)};`,
      'else',
      `echo "Launch script missing: ${scriptPath}";`,
      'echo "Re-run the launch command from Overlord to generate a new script.";',
      'fi'
    ].join(' ');
    const termApp = store.get('externalTerminalApp', 'default') as string;
    const launchMode = store.get('externalTerminalLaunchMode', 'window') as string;
    const openInTab = launchMode === 'tab';
    const escapedLaunchCmd = launchCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    // Best-effort cleanup after a reasonable grace period.
    setTimeout(() => {
      try {
        fs.unlinkSync(scriptPath);
      } catch {
        // Already deleted or unavailable — ignore.
      }
    }, 15 * 60_000);

    let script: string;

    switch (termApp) {
      case 'iterm':
        script = openInTab
          ? `
              tell application "iTerm"
                activate
                if (count of windows) = 0 then
                  create window with default profile
                else
                  tell current window
                    create tab with default profile
                  end tell
                end if
                tell current session of current window
                  write text "${escapedLaunchCmd}"
                end tell
              end tell
            `
          : `
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
        return new Promise<void>(resolve => {
          setTimeout(() => {
            runAppleScript(
              `tell application "System Events" to keystroke "${escapedLaunchCmd}" & return`
            ).finally(() => resolve());
          }, 1000);
        });
      case 'ghostty':
        exec(`ghostty -e bash ${shellQuote(scriptPath)}`);
        return Promise.resolve();
      case 'alacritty':
        exec(`alacritty -e bash ${shellQuote(scriptPath)}`);
        return Promise.resolve();
      case 'kitty':
        exec(`kitty bash ${shellQuote(scriptPath)}`);
        return Promise.resolve();
      case 'hyper':
        exec(`open -a Hyper`);
        return new Promise<void>(resolve => {
          setTimeout(() => {
            runAppleScript(
              `tell application "System Events" to keystroke "${escapedLaunchCmd}" & return`
            ).finally(() => resolve());
          }, 1000);
        });
      case 'tmux':
        script = openInTab
          ? `
              tell application "Terminal"
                activate
                if (count of windows) = 0 then
                  do script "tmux new-session -- ${escapedLaunchCmd}"
                else
                  do script "tmux new-session -- ${escapedLaunchCmd}" in front window
                end if
              end tell
            `
          : `
              tell application "Terminal"
                activate
                do script "tmux new-session -- ${escapedLaunchCmd}"
              end tell
            `;
        break;
      case 'cmux':
        script = openInTab
          ? `
              tell application "Terminal"
                activate
                if (count of windows) = 0 then
                  do script "cmux new-session -- ${escapedLaunchCmd}"
                else
                  do script "cmux new-session -- ${escapedLaunchCmd}" in front window
                end if
              end tell
            `
          : `
              tell application "Terminal"
                activate
                do script "cmux new-session -- ${escapedLaunchCmd}"
              end tell
            `;
        break;
      default: // 'terminal' or 'default'
        script = openInTab
          ? `
              tell application "Terminal"
                activate
                if (count of windows) = 0 then
                  do script "${escapedLaunchCmd}"
                else
                  do script "${escapedLaunchCmd}" in front window
                end if
              end tell
            `
          : `
              tell application "Terminal"
                activate
                do script "${escapedLaunchCmd}"
              end tell
            `;
    }

    return runAppleScript(script);
  });

  ipcMain.handle(
    'terminal:launch-agent',
    async (
      event,
      payload: { ticketId: string; agent: AgentType; cwd?: string; agentToken?: string }
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) throw new Error('No window found');

      const { command, cwd, env } = await prepareAgentLaunch({
        ticketId: payload.ticketId,
        agent: payload.agent,
        cwd: payload.cwd,
        agentToken: payload.agentToken
      });

      const terminalMode = store.get('terminalMode', 'embedded') as string;

      if (terminalMode === 'external') {
        // For external terminal, write a self-contained script
        const scriptPath = path.join(
          os.tmpdir(),
          `overlord-launch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sh`
        );

        const envLines = Object.entries(env)
          .map(([k, v]) => `export ${k}=${shellQuote(v)}`)
          .join('\n');

        let scriptContent = '#!/bin/bash\n';
        if (cwd) {
          scriptContent += `cd ${shellQuote(cwd)}\n`;
        }
        scriptContent += `${envLines}\n`;
        scriptContent += `${command}\n`;

        fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

        setTimeout(() => {
          try {
            fs.unlinkSync(scriptPath);
          } catch {
            // Already deleted — ignore
          }
        }, 15 * 60_000);

        const launchCmd = `bash ${shellQuote(scriptPath)}`;
        const termApp = store.get('externalTerminalApp', 'default') as string;
        const launchMode = store.get('externalTerminalLaunchMode', 'window') as string;
        const openInTab = launchMode === 'tab';
        const escapedLaunchCmd = launchCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

        let script: string;
        switch (termApp) {
          case 'iterm':
            script = openInTab
              ? `
                  tell application "iTerm"
                    activate
                    if (count of windows) = 0 then
                      create window with default profile
                    else
                      tell current window
                        create tab with default profile
                      end tell
                    end if
                    tell current session of current window
                      write text "${escapedLaunchCmd}"
                    end tell
                  end tell
                `
              : `
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
            exec(`open -a Warp`);
            return new Promise<void>(resolve => {
              setTimeout(() => {
                runAppleScript(
                  `tell application "System Events" to keystroke "${escapedLaunchCmd}" & return`
                ).finally(() => resolve());
              }, 1000);
            });
          case 'ghostty':
            exec(`ghostty -e bash ${shellQuote(scriptPath)}`);
            return Promise.resolve();
          case 'alacritty':
            exec(`alacritty -e bash ${shellQuote(scriptPath)}`);
            return Promise.resolve();
          case 'kitty':
            exec(`kitty bash ${shellQuote(scriptPath)}`);
            return Promise.resolve();
          case 'hyper':
            exec(`open -a Hyper`);
            return new Promise<void>(resolve => {
              setTimeout(() => {
                runAppleScript(
                  `tell application "System Events" to keystroke "${escapedLaunchCmd}" & return`
                ).finally(() => resolve());
              }, 1000);
            });
          case 'tmux':
            script = openInTab
              ? `
                  tell application "Terminal"
                    activate
                    if (count of windows) = 0 then
                      do script "tmux new-session -- ${escapedLaunchCmd}"
                    else
                      do script "tmux new-session -- ${escapedLaunchCmd}" in front window
                    end if
                  end tell
                `
              : `
                  tell application "Terminal"
                    activate
                    do script "tmux new-session -- ${escapedLaunchCmd}"
                  end tell
                `;
            break;
          case 'cmux':
            script = openInTab
              ? `
                  tell application "Terminal"
                    activate
                    if (count of windows) = 0 then
                      do script "cmux new-session -- ${escapedLaunchCmd}"
                    else
                      do script "cmux new-session -- ${escapedLaunchCmd}" in front window
                    end if
                  end tell
                `
              : `
                  tell application "Terminal"
                    activate
                    do script "cmux new-session -- ${escapedLaunchCmd}"
                  end tell
                `;
            break;
          default:
            script = openInTab
              ? `
                  tell application "Terminal"
                    activate
                    if (count of windows) = 0 then
                      do script "${escapedLaunchCmd}"
                    else
                      do script "${escapedLaunchCmd}" in front window
                    end if
                  end tell
                `
              : `
                  tell application "Terminal"
                    activate
                    do script "${escapedLaunchCmd}"
                  end tell
                `;
        }

        return runAppleScript(script);
      }

      // Embedded terminal — spawn PTY with env vars baked in
      return spawnTerminal(win, command, cwd, env);
    }
  );

  ipcMain.handle('terminal:choose-directory', async event => {
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
