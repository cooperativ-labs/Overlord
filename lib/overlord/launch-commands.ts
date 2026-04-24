import type { SshConnectionConfig } from '@/lib/workspace/types';

/**
 * Derive a legacy free-form ssh command string from a structured SshConnectionConfig.
 * Used to wrap launch commands for external terminals that still need a raw ssh invocation.
 */
export function sshConnectionConfigToCommand(
  config: SshConnectionConfig | null | undefined
): string | null {
  if (!config || !config.host || !config.user) return null;
  const parts = ['ssh'];
  if (config.authMethod === 'key' && config.privateKeyPath) {
    parts.push('-i', config.privateKeyPath);
  }
  if (config.port && Number.isFinite(config.port)) {
    parts.push('-p', String(config.port));
  }
  parts.push(`${config.user}@${config.host}`);
  return parts.join(' ');
}

type BuildLaunchCommandsInput = {
  ticketId: string;
  platformUrl: string;
  oauthAccessToken?: string;
  organizationId?: number | null;
};

export type LaunchCommands = {
  claudeCode: string;
  codex: string;
  cursor: string;
  gemini: string;
  opencode: string;
  contextUrl: string;
};

export type ResumeCommands = {
  claudeCode: string;
  codex: string;
  cursor: string;
  gemini: string;
  opencode: string;
};

/**
 * Builds human-readable launch commands for clipboard / display use.
 * These use the Overlord CLI which handles context fetching internally.
 * Primary command name is `ovld` (aliases: `overlord`).
 *
 * For Electron's embedded/external terminal, use the `terminal:launch-agent`
 * IPC instead — it fetches context server-side and avoids shell expansion issues.
 */
export function buildLaunchCommands({
  ticketId,
  platformUrl
}: BuildLaunchCommandsInput): LaunchCommands {
  const contextUrl = `${platformUrl}/api/protocol/context/${ticketId}`;

  return {
    claudeCode: `ovld connect claude --ticket-id ${ticketId}`,
    codex: `ovld connect codex --ticket-id ${ticketId}`,
    cursor: `ovld connect cursor --ticket-id ${ticketId}`,
    gemini: `ovld connect gemini --ticket-id ${ticketId}`,
    opencode: `ovld connect opencode --ticket-id ${ticketId}`,
    contextUrl
  };
}

/**
 * Builds restart commands that use each agent's native resume flow.
 * The `overlord resume` subcommand fetches latest ticket context and
 * passes it as the first resumed prompt so new system messages are included.
 */
export function buildResumeCommands({ ticketId }: BuildLaunchCommandsInput): ResumeCommands {
  return {
    claudeCode: `ovld restart claude --ticket-id ${ticketId}`,
    codex: `ovld restart codex --ticket-id ${ticketId}`,
    cursor: `ovld restart cursor --ticket-id ${ticketId}`,
    gemini: `ovld restart gemini --ticket-id ${ticketId}`,
    opencode: `ovld restart opencode --ticket-id ${ticketId}`
  };
}

/**
 * Builds the fallback command shown in restart artifacts.
 * Normal usage goes through ovld so shared OAuth credentials are resolved from ~/.ovld.
 */
export function buildRawLaunchCommand(
  agent: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode',
  { ticketId, platformUrl, oauthAccessToken, organizationId }: BuildLaunchCommandsInput
): string {
  const envParts = [`OVERLORD_URL=${platformUrl}`];
  if (oauthAccessToken) {
    envParts.push(`OVERLORD_ACCESS_TOKEN=${oauthAccessToken}`);
  }
  if (typeof organizationId === 'number' && Number.isFinite(organizationId)) {
    envParts.push(`OVERLORD_ORGANIZATION_ID=${organizationId}`);
  }
  const envPrefix = envParts.join(' ');
  return `${envPrefix} ovld connect ${agent} --ticket-id ${ticketId}`;
}

export function selectRestartSessionCommand(
  agentIdentifier: string | null | undefined,
  commands: Pick<LaunchCommands, 'claudeCode' | 'codex' | 'cursor' | 'gemini' | 'opencode'>,
  externalSessionId?: string | null
): string {
  const normalized = agentIdentifier?.trim().toLowerCase() ?? '';
  const native = buildNativeResumeCommand(normalized, externalSessionId);
  if (native) return native;

  if (normalized.includes('claude')) {
    return commands.claudeCode;
  }
  if (normalized.includes('cursor')) {
    return commands.cursor;
  }
  if (normalized.includes('gemini')) {
    return commands.gemini;
  }
  if (normalized.includes('opencode')) {
    return commands.opencode;
  }
  return commands.codex;
}

/**
 * Wraps an existing launch command to run on a remote server via SSH.
 * If no sshCommand is provided, returns the original command unchanged.
 */
export function buildSshWrappedCommand(
  baseCommand: string,
  sshCommand: string | SshConnectionConfig | null | undefined,
  remoteWorkingDirectory?: string | null
): string {
  const derived =
    typeof sshCommand === 'string' ? sshCommand : sshConnectionConfigToCommand(sshCommand ?? null);
  if (!derived?.trim()) return baseCommand;
  const cdPart = remoteWorkingDirectory?.trim() ? `cd ${remoteWorkingDirectory.trim()} && ` : '';
  return `${derived.trim()} '${cdPart}${baseCommand.replace(/'/g, "'\\''")}'`;
}

export function buildNativeResumeCommand(
  agentIdentifier: string | null | undefined,
  externalSessionId: string | null | undefined
): string | null {
  if (!externalSessionId) return null;
  const sessionId = externalSessionId.trim();
  if (!sessionId) return null;

  const normalized = agentIdentifier?.trim().toLowerCase() ?? '';
  if (normalized.includes('claude')) {
    return `claude --resume ${sessionId}`;
  }
  if (normalized.includes('codex')) {
    return `codex resume ${sessionId}`;
  }
  if (normalized.includes('cursor')) {
    return `cursor --resume ${sessionId}`;
  }
  if (normalized.includes('gemini')) {
    return `gemini --resume ${sessionId}`;
  }
  if (normalized.includes('opencode')) {
    return `opencode --continue --session ${sessionId}`;
  }
  return null;
}
