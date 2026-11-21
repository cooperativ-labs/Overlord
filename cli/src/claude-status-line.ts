import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';

/**
 * Opt-in Claude Code status line (`ovld agent-setup claude --status-line`).
 *
 * A Claude Code plugin cannot ship a `statusLine`; only user or project settings can set one. So
 * setup writes it to the user's `settings.json`, and only when the user asked and no status line
 * is configured yet. An existing status line is never replaced: setup reports it and shows how to
 * add the Overlord segment to the user's own script, which receives the same stdin JSON.
 */

export const CLAUDE_STATUS_LINE_COMMAND = 'ovld status-line --agent claude --payload-file -';
/**
 * Claude re-runs the command on its own events (new assistant message, permission-mode change,
 * …). The interval also re-runs it while the session is idle, so an answer given in Overlord or
 * a question the agent asked shows up without waiting for the next message.
 */
export const CLAUDE_STATUS_LINE_REFRESH_SECONDS = 10;

export type ClaudeStatusLineSetup = {
  status: 'installed' | 'would-install' | 'unchanged' | 'kept-existing' | 'unreadable';
  settingsPath: string;
  existingCommand: string | null;
  message: string;
};

export function claudeStatusLineSetting(): Record<string, unknown> {
  return {
    type: 'command',
    command: CLAUDE_STATUS_LINE_COMMAND,
    padding: 0,
    refreshInterval: CLAUDE_STATUS_LINE_REFRESH_SECONDS
  };
}

export function isOverlordStatusLineCommand(command: unknown): boolean {
  return typeof command === 'string' && /\b(?:ovld|overlord)\s+status-line\b/.test(command);
}

/** How a user's existing status line script can add the Overlord segment. */
export const CLAUDE_STATUS_LINE_COMPOSE_HINT =
  'To add Overlord to your own status line script, pass it the same stdin: ' +
  `\`input=$(cat); …; printf '%s' "$input" | ${CLAUDE_STATUS_LINE_COMMAND}\`.`;

function readSettings(settingsPath: string): Record<string, unknown> | null {
  if (!existsSync(settingsPath)) return {};
  try {
    const raw = readFileSync(settingsPath, 'utf8');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Read-only: what status line the Claude config dir has. */
export function inspectClaudeStatusLine(configDir: string): {
  state: 'overlord' | 'other' | 'none' | 'unreadable';
  command: string | null;
} {
  const settings = readSettings(path.join(configDir, 'settings.json'));
  if (!settings) return { state: 'unreadable', command: null };
  const statusLine = settings.statusLine;
  if (!statusLine || typeof statusLine !== 'object') return { state: 'none', command: null };
  const command = (statusLine as Record<string, unknown>).command;
  const text = typeof command === 'string' ? command : null;
  return { state: isOverlordStatusLineCommand(text) ? 'overlord' : 'other', command: text };
}

export function configureClaudeStatusLine({
  configDir,
  dryRun = false
}: {
  configDir: string;
  dryRun?: boolean;
}): ClaudeStatusLineSetup {
  const settingsPath = path.join(configDir, 'settings.json');
  const settings = readSettings(settingsPath);
  if (!settings) {
    return {
      status: 'unreadable',
      settingsPath,
      existingCommand: null,
      message:
        `Did not add the Claude status line: ${settingsPath} is not a JSON object. ` +
        `Fix the file, then re-run \`ovld agent-setup claude --status-line\`.`
    };
  }

  const current = inspectClaudeStatusLine(configDir);
  if (current.state === 'overlord') {
    return {
      status: 'unchanged',
      settingsPath,
      existingCommand: current.command,
      message: `Claude status line already shows Overlord (${settingsPath}).`
    };
  }
  if (current.state === 'other') {
    return {
      status: 'kept-existing',
      settingsPath,
      existingCommand: current.command,
      message:
        `Kept your existing Claude status line (${settingsPath}). ` +
        CLAUDE_STATUS_LINE_COMPOSE_HINT
    };
  }

  if (dryRun) {
    return {
      status: 'would-install',
      settingsPath,
      existingCommand: null,
      message: `Would add the Overlord status line to ${settingsPath}.`
    };
  }

  const next = { ...settings, statusLine: claudeStatusLineSetting() };
  writeSettingsAtomically(settingsPath, `${JSON.stringify(next, null, 2)}\n`);
  return {
    status: 'installed',
    settingsPath,
    existingCommand: null,
    message:
      `Added the Overlord status line to ${settingsPath}. It shows the bound mission and ` +
      `objective in new Claude Code sessions; remove the \`statusLine\` key to turn it off.`
  };
}

/**
 * Replace `settings.json` atomically, keeping its permissions. Claude Code owns this file and its
 * directory, so unlike Overlord's own state files neither is re-permissioned here.
 */
function writeSettingsAtomically(settingsPath: string, contents: string): void {
  const mode = existsSync(settingsPath) ? statSync(settingsPath).mode & 0o777 : 0o600;
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  const temporary = `${settingsPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, contents, { mode });
    renameSync(temporary, settingsPath);
  } finally {
    rmSync(temporary, { force: true });
  }
}
