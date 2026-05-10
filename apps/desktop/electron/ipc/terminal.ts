import { exec } from 'child_process';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';

import { type AgentType, prepareAgentLaunch } from '../services/agent-launcher';
import { store } from '../services/settings-store';

const AGENT_TYPES = [
  'claude',
  'codex',
  'cursor',
  'gemini',
  'opencode'
] as const satisfies readonly AgentType[];

const LaunchAgentPayloadSchema = z.object({
  ticketId: z.string().min(1).max(256),
  agent: z.enum(AGENT_TYPES),
  organizationId: z.number().int().positive().optional(),
  cwd: z.string().max(4096).optional(),
  launchMode: z.enum(['run', 'ask']).optional(),
  flags: z.array(z.string().max(512)).max(64).optional(),
  model: z.string().max(128).optional(),
  thinking: z.string().max(64).optional(),
  sshCommand: z.string().max(4096).optional(),
  remoteWorkingDirectory: z.string().max(4096).optional()
});

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
  tmuxHostApp: string;
  customTmuxHostApp: string;
  tmuxCommand: string;
};

function getLocalTerminalSettingsProfile(): TerminalSettingsProfile {
  return {
    termApp: store.get('externalTerminalApp', 'default') as string,
    launchMode: store.get('externalTerminalLaunchMode', 'window') as string,
    customHotkeyValue: store.get('externalTerminalCustomHotkey', '') as string,
    customApp: store.get('customExternalTerminalApp', '') as string,
    tmuxHostApp: store.get('externalTerminalTmuxHostApp', 'terminal') as string,
    customTmuxHostApp: store.get('customExternalTerminalTmuxHostApp', '') as string,
    tmuxCommand: store.get(
      'externalTerminalTmuxCommand',
      'tmux new-session bash {script}'
    ) as string
  };
}

/**
 * Server-side multiplexer config. Unlike the local profile, the server
 * section only controls what happens *inside* the SSH session on the remote
 * host — the local GUI terminal is always driven by the local profile.
 */
function getServerMultiplexerConfig(): { enabled: boolean; tmuxCommand: string } {
  const termApp = store.get('serverExternalTerminalApp', 'default') as string;
  const customApp = store.get('customServerExternalTerminalApp', '') as string;
  const tmuxCommand = store.get(
    'serverExternalTerminalTmuxCommand',
    'tmux new-session bash {script}'
  ) as string;
  return {
    enabled: isTmuxLikeTerminalApp(termApp, customApp),
    tmuxCommand
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

function resolveTmuxHostApplication(hostApp: string, customHostApp: string): string {
  if (hostApp === 'custom') return customHostApp.trim() || 'Terminal';

  const appMap: Record<string, string> = {
    terminal: 'Terminal',
    iterm: 'iTerm',
    warp: 'Warp',
    ghostty: 'Ghostty',
    alacritty: 'Alacritty',
    kitty: 'Kitty',
    hyper: 'Hyper'
  };

  return appMap[hostApp] ?? 'Terminal';
}

function buildTmuxLaunchCommand(template: string, scriptPath: string): string {
  const trimmedTemplate = template.trim();
  const commandTemplate =
    trimmedTemplate.length > 0 && trimmedTemplate.includes('{script}')
      ? trimmedTemplate
      : 'tmux new-session bash {script}';

  return commandTemplate.replaceAll('{script}', shellQuote(scriptPath));
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

  // If a cwd is set, guard the `cd` so that a missing/inaccessible directory
  // surfaces a troubleshooting message in the terminal instead of silently
  // continuing in the wrong directory and letting the agent fail with no
  // explanation.
  const cdGuard = cwd
    ? [
        `if ! cd ${shellQuote(cwd)} 2>/dev/null; then`,
        `  printf '\\n\\033[1;31mOverlord: Cannot open working directory:\\033[0m %s\\n\\n' ${shellQuote(cwd)}`,
        `  printf 'This usually means:\\n'`,
        `  printf '  • The directory does not exist or was moved/renamed\\n'`,
        `  printf '  • The Overlord app or your terminal is not yet permitted\\n'`,
        `  printf '    to access this folder\\n'`,
        `  printf '  • The project working directory in Overlord is out of date\\n\\n'`,
        `  printf 'Try one of:\\n'`,
        `  printf '  1. Update the project working directory in Overlord settings\\n'`,
        `  printf '  2. Open System Settings → Privacy & Security → Files and Folders\\n'`,
        `  printf '     and grant your terminal app access to the parent folder\\n'`,
        `  printf '  3. Re-clone or restore the missing directory\\n\\n'`,
        `  printf 'Press Enter to close this window... '`,
        `  read _ovld_dismiss`,
        `  exit 1`,
        `fi`
      ].join('\n')
    : null;

  // Detect a fast-failing agent (exits non-zero within 3 seconds) and print a
  // troubleshooting guide before the terminal closes. Common causes: agent CLI
  // missing from PATH, untrusted/unsupported project directory, or an expired
  // Overlord session.
  const guardedCommand = [
    '_ovld_started=$(date +%s)',
    `${command}`,
    '_ovld_exit=$?',
    '_ovld_elapsed=$(( $(date +%s) - _ovld_started ))',
    'if [ "$_ovld_exit" -ne 0 ] && [ "$_ovld_elapsed" -lt 3 ]; then',
    `  printf '\\n\\033[1;31mOverlord: Agent exited immediately (status %d after %ds).\\033[0m\\n\\n' "$_ovld_exit" "$_ovld_elapsed"`,
    `  printf 'Troubleshooting:\\n'`,
    `  printf '  • Confirm the agent CLI is installed and on your PATH\\n'`,
    `  printf '  • Confirm the working directory is correct and trusted by the agent\\n'`,
    `  printf '  • Re-authenticate with Overlord if your session expired\\n'`,
    `  printf '  • Re-run agent setup from Overlord → Settings → Agents\\n\\n'`,
    `  printf 'Press Enter to close this window... '`,
    '  read _ovld_dismiss',
    'fi',
    'exit $_ovld_exit'
  ].join('\n');

  const innerParts = [cdGuard, envLines || null, guardedCommand].filter((x): x is string =>
    Boolean(x)
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

async function launchScriptInExternalTerminal(scriptPath: string): Promise<void> {
  // Keep the command short for apps we drive via synthetic keystrokes.
  // Long leading shell conditionals can lose characters during app-switch/hotkey flows.
  const launchCmd = `bash ${shellQuote(scriptPath)}`;
  const profile = getLocalTerminalSettingsProfile();
  const {
    termApp,
    launchMode,
    customHotkeyValue,
    customApp,
    tmuxHostApp,
    customTmuxHostApp,
    tmuxCommand
  } = profile;
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
      await runShellCommand(
        buildNewInstanceApplicationCommand(
          resolveTmuxHostApplication(tmuxHostApp, customTmuxHostApp)
        )
      );
      return new Promise(resolve => {
        setTimeout(() => {
          const tmuxLaunchCmd = buildTmuxLaunchCommand(tmuxCommand, scriptPath);
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
  ipcMain.handle('terminal:launch-agent', async (_event, rawPayload: unknown) => {
    const payload = LaunchAgentPayloadSchema.parse(rawPayload);
    const isRemote = Boolean(payload.sshCommand?.trim());
    const { command, cwd, env } = await prepareAgentLaunch({
      ticketId: payload.ticketId,
      agent: payload.agent,
      organizationId: payload.organizationId,
      cwd: payload.cwd,
      launchMode: payload.launchMode,
      flags: payload.flags,
      model: payload.model,
      thinking: payload.thinking,
      sshCommand: payload.sshCommand,
      remoteWorkingDirectory: payload.remoteWorkingDirectory,
      serverMultiplexer: isRemote ? getServerMultiplexerConfig() : undefined
    });

    const scriptPath = writeLaunchScript(command, cwd, env);
    return launchScriptInExternalTerminal(scriptPath);
  });

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
