import { exec } from 'child_process';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { type AgentType, prepareAgentLaunch } from '../services/agent-launcher';
import { store } from '../services/settings-store';

function runAppleScript(script: string) {
  return new Promise<void>((resolve, reject) => {
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, err => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function runShellCommand(command: string) {
  return new Promise<void>((resolve, reject) => {
    exec(command, err => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildOpenApplicationCommand(app: string, args?: string[]) {
  const argSegment = args && args.length > 0 ? ` --args ${args.map(shellQuote).join(' ')}` : '';
  return `open -a ${shellQuote(app)}${argSegment}`;
}

async function runShellCommandWithFallback(
  commands: string[],
  errorMessage: string
): Promise<void> {
  let lastError: unknown = null;

  for (const command of commands) {
    try {
      await runShellCommand(command);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  const detail =
    lastError instanceof Error && lastError.message.trim().length > 0
      ? `: ${lastError.message}`
      : '';
  throw new Error(`${errorMessage}${detail}`);
}

function buildHotkeyAppleScript(hotkey: string): string | null {
  const trimmed = hotkey.trim();
  if (!trimmed) return null;

  const parts = trimmed
    .toLowerCase()
    .split('+')
    .map(part => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return null;

  const key = parts[parts.length - 1] ?? '';
  if (!key) return null;

  const modifiers = parts.slice(0, -1);
  const modifierMap: Record<string, string> = {
    cmd: 'command down',
    command: 'command down',
    meta: 'command down',
    shift: 'shift down',
    option: 'option down',
    alt: 'option down',
    ctrl: 'control down',
    control: 'control down'
  };

  const applescriptModifiers = modifiers.map(mod => modifierMap[mod]).filter(Boolean);
  const keyLiteral = key.length === 1 ? key : '';
  if (!keyLiteral) return null;

  if (applescriptModifiers.length === 0) {
    return `keystroke "${keyLiteral}"`;
  }

  return `keystroke "${keyLiteral}" using {${applescriptModifiers.join(', ')}}`;
}

function buildLaunchScriptContent(
  command: string,
  cwd?: string,
  env?: Record<string, string>
): string {
  const envLines = env
    ? Object.entries(env)
        .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
        .join('\n')
    : '';

  return ['#!/bin/bash', cwd ? `cd ${shellQuote(cwd)}` : null, envLines || null, command]
    .filter(Boolean)
    .join('\n');
}

function writeLaunchScript(command: string, cwd?: string, env?: Record<string, string>) {
  const scriptPath = path.join(
    os.tmpdir(),
    `overlord-launch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sh`
  );

  fs.writeFileSync(scriptPath, buildLaunchScriptContent(command, cwd, env), { mode: 0o755 });

  setTimeout(() => {
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      // Already deleted or unavailable.
    }
  }, 15 * 60_000);

  return scriptPath;
}

async function launchScriptInExternalTerminal(scriptPath: string): Promise<void> {
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
  const isCustomLaunchMode = launchMode === 'custom';
  const customHotkeyValue = store.get('externalTerminalCustomHotkey', '') as string;
  const hotkeyScript = buildHotkeyAppleScript(customHotkeyValue);
  const escapedLaunchCmd = launchCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  let script: string;

  switch (termApp) {
    case 'iterm':
      if (isCustomLaunchMode && hotkeyScript) {
        script = `
            tell application "iTerm"
              activate
              if (count of windows) = 0 then
                create window with default profile
              end if
            end tell
            tell application "System Events"
              ${hotkeyScript}
              keystroke "${escapedLaunchCmd}" & return
            end tell
          `;
      } else {
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
      }
      return runAppleScript(script);
    case 'warp':
      await runShellCommand(buildOpenApplicationCommand('Warp'));
      return new Promise(resolve => {
        setTimeout(() => {
          const baseScript = hotkeyScript
            ? `
                tell application "System Events"
                  ${hotkeyScript}
                  keystroke "${escapedLaunchCmd}" & return
                end tell
              `
            : `tell application "System Events" to keystroke "${escapedLaunchCmd}" & return`;
          runAppleScript(baseScript).finally(() => resolve());
        }, 1000);
      });
    case 'ghostty':
      await runShellCommandWithFallback(
        [
          `ghostty -e bash ${shellQuote(scriptPath)}`,
          buildOpenApplicationCommand('Ghostty', ['-e', 'bash', scriptPath])
        ],
        'Failed to open Ghostty.'
      );
      return Promise.resolve();
    case 'alacritty':
      await runShellCommandWithFallback(
        [
          `alacritty -e bash ${shellQuote(scriptPath)}`,
          buildOpenApplicationCommand('Alacritty', ['-e', 'bash', scriptPath])
        ],
        'Failed to open Alacritty.'
      );
      return Promise.resolve();
    case 'kitty':
      await runShellCommandWithFallback(
        [
          `kitty bash ${shellQuote(scriptPath)}`,
          buildOpenApplicationCommand('Kitty', ['bash', scriptPath]),
          buildOpenApplicationCommand('kitty', ['bash', scriptPath])
        ],
        'Failed to open Kitty.'
      );
      return Promise.resolve();
    case 'hyper':
      await runShellCommand(buildOpenApplicationCommand('Hyper'));
      return new Promise(resolve => {
        setTimeout(() => {
          const baseScript = hotkeyScript
            ? `
                tell application "System Events"
                  ${hotkeyScript}
                  keystroke "${escapedLaunchCmd}" & return
                end tell
              `
            : `tell application "System Events" to keystroke "${escapedLaunchCmd}" & return`;
          runAppleScript(baseScript).finally(() => resolve());
        }, 1000);
      });
    case 'cmux':
      await runShellCommand(buildOpenApplicationCommand('cmux'));
      return new Promise(resolve => {
        setTimeout(() => {
          const baseScript = hotkeyScript
            ? `
                tell application "System Events"
                  ${hotkeyScript}
                  keystroke "${escapedLaunchCmd}" & return
                end tell
              `
            : `tell application "System Events" to keystroke "${escapedLaunchCmd}" & return`;
          runAppleScript(baseScript).finally(() => resolve());
        }, 1000);
      });
    case 'custom': {
      const customApp = store.get('customExternalTerminalApp', '') as string;
      if (!customApp) {
        script =
          isCustomLaunchMode && hotkeyScript
            ? `
              tell application "Terminal"
                activate
                if (count of windows) = 0 then
                  do script ""
                end if
              end tell
              tell application "System Events"
                ${hotkeyScript}
                keystroke "${escapedLaunchCmd}" & return
              end tell
            `
            : openInTab
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
        return runAppleScript(script);
      }

      await runShellCommand(buildOpenApplicationCommand(customApp));
      return new Promise(resolve => {
        setTimeout(() => {
          runAppleScript(
            `tell application "System Events" to keystroke "${escapedLaunchCmd}" & return`
          ).finally(() => resolve());
        }, 1000);
      });
    }
    default:
      script =
        isCustomLaunchMode && hotkeyScript
          ? `
            tell application "Terminal"
              activate
              if (count of windows) = 0 then
                do script ""
              end if
            end tell
            tell application "System Events"
              ${hotkeyScript}
              keystroke "${escapedLaunchCmd}" & return
            end tell
          `
          : openInTab
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
      return runAppleScript(script);
  }
}

export function registerTerminalIpc(): void {
  ipcMain.handle(
    'terminal:launch-agent',
    async (
      _event,
      payload: {
        ticketId: string;
        agent: AgentType;
        cwd?: string;
        agentToken?: string;
        launchMode?: 'run' | 'ask';
        flags?: string[];
        model?: string;
        thinking?: string;
        sshCommand?: string;
        remoteWorkingDirectory?: string;
      }
    ) => {
      const { command, cwd, env } = await prepareAgentLaunch({
        ticketId: payload.ticketId,
        agent: payload.agent,
        cwd: payload.cwd,
        agentToken: payload.agentToken,
        launchMode: payload.launchMode,
        flags: payload.flags,
        model: payload.model,
        thinking: payload.thinking,
        sshCommand: payload.sshCommand,
        remoteWorkingDirectory: payload.remoteWorkingDirectory
      });

      const scriptPath = writeLaunchScript(command, cwd, env);
      return launchScriptInExternalTerminal(scriptPath);
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
