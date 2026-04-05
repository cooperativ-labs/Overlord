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

function buildNewInstanceApplicationCommand(app: string, args?: string[]) {
  const argSegment = args && args.length > 0 ? ` --args ${args.map(shellQuote).join(' ')}` : '';
  return `open -n -a ${shellQuote(app)}${argSegment}`;
}

type TerminalSettingsProfile = {
  termApp: string;
  launchMode: string;
  customHotkeyValue: string;
  customApp: string;
};

function getTerminalSettingsProfile(isRemote: boolean): TerminalSettingsProfile {
  const prefix = isRemote ? 'server' : '';
  const appKey = prefix ? 'serverExternalTerminalApp' : 'externalTerminalApp';
  const launchModeKey = prefix ? 'serverExternalTerminalLaunchMode' : 'externalTerminalLaunchMode';
  const customHotkeyKey = prefix
    ? 'serverExternalTerminalCustomHotkey'
    : 'externalTerminalCustomHotkey';
  const customAppKey = prefix ? 'customServerExternalTerminalApp' : 'customExternalTerminalApp';

  return {
    termApp: store.get(appKey, 'default') as string,
    launchMode: store.get(launchModeKey, 'window') as string,
    customHotkeyValue: store.get(customHotkeyKey, '') as string,
    customApp: store.get(customAppKey, '') as string
  };
}

function isTmuxLikeTerminalApp(termApp: string, customApp?: string): boolean {
  if (termApp === 'tmux' || termApp === 'cmux') return true;
  if (termApp !== 'custom') return false;
  const normalized = customApp?.trim().toLowerCase() ?? '';
  return normalized.includes('tmux') || normalized.includes('cmux');
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

  const innerParts = [cwd ? `cd ${shellQuote(cwd)}` : null, envLines || null, command].filter(
    (x): x is string => Boolean(x)
  );
  const innerScript = innerParts.join('\n');

  // Run through the user's preferred shell in interactive mode so that aliases
  // and functions defined in ~/.zshrc / ~/.bashrc are available. This is
  // required when the SSH command field contains a shell alias (e.g. "claw").
  return ['#!/bin/bash', `exec "\${SHELL:-zsh}" -i -c ${shellQuote(innerScript)}`].join('\n');
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

async function launchScriptInExternalTerminal(
  scriptPath: string,
  isRemote: boolean
): Promise<void> {
  const launchCmd = [
    `if [ -f ${shellQuote(scriptPath)} ]; then`,
    `bash ${shellQuote(scriptPath)};`,
    'else',
    `echo "Launch script missing: ${scriptPath}";`,
    'echo "Re-run the launch command from Overlord to generate a new script.";',
    'fi'
  ].join(' ');
  const profile = getTerminalSettingsProfile(isRemote);
  const { termApp, launchMode, customHotkeyValue, customApp } = profile;
  const openInTab = launchMode === 'tab';
  const isCustomLaunchMode = launchMode === 'custom';
  const hotkeyScript = buildHotkeyAppleScript(customHotkeyValue);
  const escapedLaunchCmd = launchCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const shouldForceNewInstance = isTmuxLikeTerminalApp(termApp, customApp);

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
    case 'tmux':
      await runShellCommand(buildNewInstanceApplicationCommand('Terminal'));
      return new Promise(resolve => {
        setTimeout(() => {
          const tmuxLaunchCmd = `tmux new-session bash ${shellQuote(scriptPath)}`;
          const escapedTmuxLaunchCmd = tmuxLaunchCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          runAppleScript(
            `tell application "System Events" to keystroke "${escapedTmuxLaunchCmd}" & return`
          ).finally(() => resolve());
        }, 1000);
      });
    case 'cmux':
      await runShellCommand(
        shouldForceNewInstance
          ? buildNewInstanceApplicationCommand('cmux')
          : buildOpenApplicationCommand('cmux')
      );
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

      await runShellCommand(
        shouldForceNewInstance
          ? buildNewInstanceApplicationCommand(customApp)
          : buildOpenApplicationCommand(customApp)
      );
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
      const isRemote = Boolean(payload.sshCommand?.trim());
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
      return launchScriptInExternalTerminal(scriptPath, isRemote);
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
