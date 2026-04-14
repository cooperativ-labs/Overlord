import os from 'os';
import path from 'path';

import {
  backupFile,
  readJsonFile,
  writeJsonFile,
  writeTextFile
} from './agent-bundle/merge-helpers';

export type AgentPermissionAgent = 'claude' | 'cursor' | 'gemini' | 'opencode';

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
    const required = [
      'Bash(ovld protocol:*)',
      'Bash(curl -sS -X POST:*)',
      'Read(/tmp/*)',
      'Write(/tmp/*)'
    ];

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
      details: `Added ${required.length} allow rules for protocol shell commands and /tmp file access.`
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
    const required = [
      'Shell(ovld protocol:*)',
      'Shell(curl -sS -X POST:*)',
      'Read(/tmp/*)',
      'Write(/tmp/*)'
    ];

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
      details: `Added ${required.length} allowed shell command patterns and /tmp file access.`
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
      '',
      '[[rule]]',
      'toolName = "read_file"',
      'pathPrefix = "/tmp/"',
      'decision = "allow"',
      'priority = 900',
      '',
      '[[rule]]',
      'toolName = "write_file"',
      'pathPrefix = "/tmp/"',
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
      details: 'Installed Gemini policy rules for ovld protocol, curl POST, and /tmp file access.'
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

function configureOpenCode(): AgentPermissionResult {
  const backups: string[] = [];
  const filePath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

  try {
    withOptionalBackup(filePath, backups);

    const settings = readJsonFile(filePath);
    const permission =
      settings.permission && typeof settings.permission === 'object'
        ? (settings.permission as Record<string, unknown>)
        : {};
    const bashPermission =
      permission.bash && typeof permission.bash === 'object'
        ? (permission.bash as Record<string, unknown>)
        : {};

    const next = {
      ...settings,
      $schema: 'https://opencode.ai/config.json',
      permission: {
        ...permission,
        bash: {
          '*': 'ask',
          ...bashPermission,
          'ovld protocol *': 'allow',
          'curl -sS -X POST *': 'allow',
          'curl -s -X POST *': 'allow',
          'cat /tmp/*': 'allow',
          'echo * /tmp/*': 'allow',
          'tee /tmp/*': 'allow',
          'cp * /tmp/*': 'allow',
          'mv * /tmp/*': 'allow',
          'rm /tmp/*': 'allow'
        }
      }
    };

    writeJsonFile(filePath, next);

    return {
      agent: 'opencode',
      ok: true,
      filePath,
      backups,
      details:
        'Updated OpenCode bash permissions for ovld protocol, curl POST, and /tmp file access.'
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      agent: 'opencode',
      ok: false,
      filePath,
      backups,
      details: 'Failed to update OpenCode permissions.',
      error: message
    };
  }
}

export function configureAgentPermissions(
  options: ConfigureAgentPermissionsOptions = {}
): ConfigureAgentPermissionsResult {
  const results = [
    configureClaude(options.projectDirectory),
    configureCursor(options.projectDirectory),
    configureGemini(),
    configureOpenCode()
  ];

  return {
    ok: results.every(result => result.ok),
    results
  };
}
