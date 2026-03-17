import os from 'os';
import path from 'path';

import {
  backupFile,
  readJsonFile,
  readTextFile,
  writeJsonFile,
  writeTextFile
} from './agent-bundle/merge-helpers';

export type AgentPermissionAgent = 'claude' | 'codex' | 'cursor' | 'gemini';

export type AgentPermissionResult = {
  agent: AgentPermissionAgent;
  ok: boolean;
  filePath: string;
  details: string;
  backups: string[];
  error?: string;
};

export type ConfigureAgentPermissionsOptions = {
  projectDirectory?: string;
};

export type ConfigureAgentPermissionsResult = {
  ok: boolean;
  results: AgentPermissionResult[];
};

const CODEX_START = '# overlord:permissions:start';
const CODEX_END = '# overlord:permissions:end';

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function withOptionalBackup(filePath: string, backups: string[]): void {
  const backup = backupFile(filePath);
  if (backup) backups.push(backup);
}

function configureClaude(projectDirectory?: string): AgentPermissionResult {
  const backups: string[] = [];
  const filePath = projectDirectory
    ? path.join(projectDirectory, '.claude', 'settings.local.json')
    : path.join(os.homedir(), '.claude', 'settings.json');

  try {
    withOptionalBackup(filePath, backups);

    const settings = readJsonFile(filePath);
    const permissions =
      settings.permissions && typeof settings.permissions === 'object'
        ? (settings.permissions as Record<string, unknown>)
        : {};

    const existingAllow = asStringArray(permissions.allow);
    const required = ['Bash(ovld protocol:*)', 'Bash(curl -sS -X POST:*)'];

    const mergedAllow = Array.from(new Set([...existingAllow, ...required]));

    const next = {
      ...settings,
      permissions: {
        ...permissions,
        allow: mergedAllow
      }
    };

    writeJsonFile(filePath, next);

    return {
      agent: 'claude',
      ok: true,
      filePath,
      backups,
      details: `Added ${required.length} allow rules for protocol shell commands.`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      agent: 'claude',
      ok: false,
      filePath,
      backups,
      details: 'Failed to update Claude permissions.',
      error: message
    };
  }
}

function mergeCodexRules(existingContent: string): string {
  const managedBlock = [
    CODEX_START,
    'prefix_rule(',
    '  pattern = ["npx", "overlord", "protocol"],',
    '  decision = "allow",',
    '  justification = "Allow all Overlord protocol commands without prompts.",',
    ')',
    '',
    'prefix_rule(',
    '  pattern = ["curl", "-sS", "-X", "POST"],',
    '  decision = "allow",',
    '  justification = "Allow curl protocol POST commands without prompts.",',
    ')',
    CODEX_END
  ].join('\n');

  const startIndex = existingContent.indexOf(CODEX_START);
  const endIndex = existingContent.indexOf(CODEX_END);

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = existingContent.slice(0, startIndex).trimEnd();
    const after = existingContent.slice(endIndex + CODEX_END.length).trimStart();

    if (!before && !after) return `${managedBlock}\n`;
    if (!before) return `${managedBlock}\n\n${after}`;
    if (!after) return `${before}\n\n${managedBlock}\n`;
    return `${before}\n\n${managedBlock}\n\n${after}`;
  }

  const trimmed = existingContent.trimEnd();
  if (!trimmed) return `${managedBlock}\n`;
  return `${trimmed}\n\n${managedBlock}\n`;
}

function configureCodex(): AgentPermissionResult {
  const backups: string[] = [];
  const filePath = path.join(os.homedir(), '.codex', 'rules', 'default.rules');

  try {
    withOptionalBackup(filePath, backups);

    const existing = readTextFile(filePath);
    const merged = mergeCodexRules(existing);
    writeTextFile(filePath, merged);

    return {
      agent: 'codex',
      ok: true,
      filePath,
      backups,
      details: 'Updated Codex prefix rules for ovld protocol and curl POST.'
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      agent: 'codex',
      ok: false,
      filePath,
      backups,
      details: 'Failed to update Codex rules.',
      error: message
    };
  }
}

function configureCursor(projectDirectory?: string): AgentPermissionResult {
  const backups: string[] = [];
  const filePath = projectDirectory
    ? path.join(projectDirectory, '.cursor', 'settings.json')
    : path.join(os.homedir(), '.cursor', 'settings.json');

  try {
    withOptionalBackup(filePath, backups);

    const settings = readJsonFile(filePath);
    const permissions =
      settings.permissions && typeof settings.permissions === 'object'
        ? (settings.permissions as Record<string, unknown>)
        : {};

    const existingAllow = asStringArray(permissions.allow);
    const required = ['Shell(ovld protocol:*)', 'Shell(curl -sS -X POST:*)'];

    const mergedAllow = Array.from(new Set([...existingAllow, ...required]));

    const next = {
      ...settings,
      permissions: {
        ...permissions,
        allow: mergedAllow
      }
    };

    writeJsonFile(filePath, next);

    return {
      agent: 'cursor',
      ok: true,
      filePath,
      backups,
      details: `Added ${required.length} allowed shell command patterns.`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      agent: 'cursor',
      ok: false,
      filePath,
      backups,
      details: 'Failed to update Cursor permissions.',
      error: message
    };
  }
}

function configureGemini(): AgentPermissionResult {
  const backups: string[] = [];
  const filePath = path.join(os.homedir(), '.gemini', 'policies', 'overlord-protocol.toml');

  try {
    withOptionalBackup(filePath, backups);

    const content = [
      '# Managed by Overlord onboarding',
      '[[rule]]',
      'toolName = "run_shell_command"',
      'commandPrefix = "ovld protocol"',
      'decision = "allow"',
      'priority = 900',
      '',
      '[[rule]]',
      'toolName = "run_shell_command"',
      'commandPrefix = "curl -sS -X POST"',
      'decision = "allow"',
      'priority = 900',
      ''
    ].join('\n');

    writeTextFile(filePath, content);

    return {
      agent: 'gemini',
      ok: true,
      filePath,
      backups,
      details: 'Installed Gemini policy rules for ovld protocol and curl POST.'
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      agent: 'gemini',
      ok: false,
      filePath,
      backups,
      details: 'Failed to install Gemini policy rules.',
      error: message
    };
  }
}

export function configureAgentPermissions(
  options: ConfigureAgentPermissionsOptions = {}
): ConfigureAgentPermissionsResult {
  const results = [
    configureClaude(options.projectDirectory),
    configureCodex(),
    configureCursor(options.projectDirectory),
    configureGemini()
  ];

  return {
    ok: results.every(result => result.ok),
    results
  };
}
