import type { LaunchAgentType } from '@/lib/helpers/agent-types';
import type { SshConnectionConfig } from '@/lib/workspace/types';
import type { TicketAssignedAgent } from '@/types/tickets';

type LaunchCommandOptions = {
  organizationId?: number | null;
  workingDirectory?: string | null;
  launchMode?: 'run' | 'ask' | null;
  flags?: string[] | null;
  preCommand?: string | null;
  model?: string | null;
  thinking?: string | null;
  sshCommand?: string | SshConnectionConfig | null;
  remoteWorkingDirectory?: string | null;
  serverMultiplexer?: {
    enabled: boolean;
    tmuxCommand?: string | null;
  } | null;
};

type DirectAgentCommandOptions = {
  flags?: string[] | null;
  preCommand?: string | null;
  includeModelPlaceholder?: boolean;
  includeThinkingPlaceholder?: boolean;
  promptPlaceholder?: string;
};

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
  workingDirectory?: string | null;
  sshCommand?: string | SshConnectionConfig | null;
  remoteWorkingDirectory?: string | null;
  serverMultiplexer?: {
    enabled: boolean;
    tmuxCommand?: string | null;
  } | null;
  agentFlags?: Partial<Record<LaunchAgentType, string[]>>;
  agentPreCommands?: Partial<Record<LaunchAgentType, string>>;
  assignedAgent?: TicketAssignedAgent | null;
};

export type LaunchCommands = {
  claudeCode: string;
  codex: string;
  cursor: string;
  antigravity: string;
  opencode: string;
  pi: string;
  contextUrl: string;
};

export type ResumeCommands = {
  claudeCode: string;
  codex: string;
  cursor: string;
  antigravity: string;
  opencode: string;
  pi: string;
};

export type AgentCommands = {
  launchCommands?: LaunchCommands;
  resumeCommands?: ResumeCommands;
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function pushOptionalFlag(parts: string[], name: string, value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return;
  parts.push(name, shellQuote(trimmed));
}

function pushDirectModelPlaceholder(parts: string[], agent: LaunchAgentType) {
  if (agent === 'antigravity') return;
  parts.push('--model', '<model>');
}

function pushDirectThinkingPlaceholder(parts: string[], agent: LaunchAgentType) {
  if (agent === 'claude') {
    parts.push('--effort', '<effort>');
  } else if (agent === 'codex') {
    parts.push('-c', 'model_reasoning_effort="<effort>"');
  } else if (agent === 'pi') {
    parts.push('--thinking', '<effort>');
  }
}

function directAgentBinary(agent: LaunchAgentType): string {
  if (agent === 'cursor') return 'agent';
  if (agent === 'antigravity') return 'agy';
  return agent;
}

export function buildDirectAgentCommand(
  agent: LaunchAgentType,
  options: DirectAgentCommandOptions = {}
): string {
  const preCommand = options.preCommand?.trim();
  const parts = [
    preCommand ? `${preCommand} ${directAgentBinary(agent)}` : directAgentBinary(agent)
  ];

  if (options.includeModelPlaceholder ?? true) {
    pushDirectModelPlaceholder(parts, agent);
  }

  if (options.includeThinkingPlaceholder ?? true) {
    pushDirectThinkingPlaceholder(parts, agent);
  }

  for (const flag of options.flags ?? []) {
    const trimmed = flag.trim();
    if (trimmed) parts.push(trimmed);
  }

  const promptPlaceholder = options.promptPlaceholder ?? '<prompt>';
  if (agent === 'antigravity') {
    parts.push('--prompt-interactive', promptPlaceholder);
  } else if (agent === 'opencode') {
    parts.push('--prompt', promptPlaceholder);
  } else {
    parts.push(promptPlaceholder);
  }

  return parts.join(' ');
}

function hasOrganizationInTicketId(ticketId: string): boolean {
  return /^\d+:\d+$/.test(ticketId.trim());
}

function normalizeAgentLaunchOptions(
  agent: LaunchAgentType,
  input: BuildLaunchCommandsInput
): LaunchCommandOptions {
  const assignedAgent = input.assignedAgent?.agent === agent ? input.assignedAgent : null;
  return {
    workingDirectory: input.workingDirectory,
    organizationId: input.organizationId,
    launchMode: 'run',
    flags: input.agentFlags?.[agent] ?? [],
    preCommand: input.agentPreCommands?.[agent] ?? null,
    model: assignedAgent?.model ?? null,
    thinking: assignedAgent?.thinking ?? null,
    sshCommand: input.sshCommand,
    remoteWorkingDirectory: input.remoteWorkingDirectory,
    serverMultiplexer: input.serverMultiplexer
  };
}

export function buildAgentLaunchCommand(
  agent: LaunchAgentType,
  ticketId: string,
  options: LaunchCommandOptions = {}
): string {
  const parts = ['ovld', 'launch', agent, '--ticket-id', shellQuote(ticketId)];

  if (
    !hasOrganizationInTicketId(ticketId) &&
    typeof options.organizationId === 'number' &&
    Number.isFinite(options.organizationId)
  ) {
    parts.push('--organization-id', String(options.organizationId));
  }

  pushOptionalFlag(parts, '--working-directory', options.workingDirectory ?? null);
  pushOptionalFlag(parts, '--pre-command', options.preCommand ?? null);

  if (options.launchMode === 'ask') {
    parts.push('--launch-mode', 'ask');
  }

  if (agent !== 'antigravity') {
    pushOptionalFlag(parts, '--model', options.model ?? null);
    pushOptionalFlag(parts, '--thinking', options.thinking ?? null);
  }

  for (const flag of options.flags ?? []) {
    const trimmed = flag.trim();
    if (!trimmed) continue;
    parts.push('--flag', shellQuote(trimmed));
  }

  const sshCommand =
    typeof options.sshCommand === 'string'
      ? options.sshCommand
      : sshConnectionConfigToCommand(options.sshCommand ?? null);
  pushOptionalFlag(parts, '--ssh-command', sshCommand ?? null);
  pushOptionalFlag(parts, '--remote-working-directory', options.remoteWorkingDirectory ?? null);

  if (options.serverMultiplexer?.enabled) {
    parts.push('--server-multiplexer', 'tmux');
    pushOptionalFlag(parts, '--tmux-command', options.serverMultiplexer.tmuxCommand ?? null);
  }

  return parts.join(' ');
}

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
  platformUrl,
  organizationId,
  workingDirectory,
  sshCommand,
  remoteWorkingDirectory,
  serverMultiplexer,
  agentFlags,
  agentPreCommands,
  assignedAgent
}: BuildLaunchCommandsInput): LaunchCommands {
  const contextUrl = `${platformUrl}/api/protocol/context/${ticketId}`;
  const sharedInput: BuildLaunchCommandsInput = {
    ticketId,
    platformUrl,
    organizationId,
    workingDirectory,
    sshCommand,
    remoteWorkingDirectory,
    serverMultiplexer,
    agentFlags,
    agentPreCommands,
    assignedAgent
  };

  return {
    claudeCode: buildAgentLaunchCommand(
      'claude',
      ticketId,
      normalizeAgentLaunchOptions('claude', sharedInput)
    ),
    codex: buildAgentLaunchCommand(
      'codex',
      ticketId,
      normalizeAgentLaunchOptions('codex', sharedInput)
    ),
    cursor: buildAgentLaunchCommand(
      'cursor',
      ticketId,
      normalizeAgentLaunchOptions('cursor', sharedInput)
    ),
    antigravity: buildAgentLaunchCommand(
      'antigravity',
      ticketId,
      normalizeAgentLaunchOptions('antigravity', sharedInput)
    ),
    opencode: buildAgentLaunchCommand(
      'opencode',
      ticketId,
      normalizeAgentLaunchOptions('opencode', sharedInput)
    ),
    pi: buildAgentLaunchCommand('pi', ticketId, normalizeAgentLaunchOptions('pi', sharedInput)),
    contextUrl
  };
}

/**
 * Builds restart commands that use each agent's native resume flow.
 * The `overlord resume` subcommand fetches latest ticket context and
 * passes it as the first resumed prompt so new system messages are included.
 *
 */

export function buildResumeCommands({
  ticketId,
  organizationId
}: BuildLaunchCommandsInput): ResumeCommands {
  const organizationFlag =
    !hasOrganizationInTicketId(ticketId) &&
    typeof organizationId === 'number' &&
    Number.isFinite(organizationId)
      ? ` --organization-id ${organizationId}`
      : '';
  return {
    claudeCode: `ovld restart claude --ticket-id ${ticketId}${organizationFlag}`,
    codex: `ovld restart codex --ticket-id ${ticketId}${organizationFlag}`,
    cursor: `ovld restart cursor --ticket-id ${ticketId}${organizationFlag}`,
    antigravity: `ovld restart antigravity --ticket-id ${ticketId}${organizationFlag}`,
    opencode: `ovld restart opencode --ticket-id ${ticketId}${organizationFlag}`,
    pi: `ovld restart pi --ticket-id ${ticketId}${organizationFlag}`
  };
}

/**
 * Builds the fallback command shown in restart artifacts.
 * Normal usage goes through ovld so shared OAuth credentials are resolved from ~/.ovld.
 */
export function buildRawLaunchCommand(
  agent: LaunchAgentType,
  { ticketId, platformUrl, oauthAccessToken, organizationId }: BuildLaunchCommandsInput
): string {
  const envParts = [`OVERLORD_URL=${platformUrl}`];
  if (oauthAccessToken) {
    envParts.push(`OVERLORD_ACCESS_TOKEN=${oauthAccessToken}`);
  }
  if (
    !hasOrganizationInTicketId(ticketId) &&
    typeof organizationId === 'number' &&
    Number.isFinite(organizationId)
  ) {
    envParts.push(`OVERLORD_ORGANIZATION_ID=${organizationId}`);
  }
  const envPrefix = envParts.join(' ');
  return `${envPrefix} ${buildAgentLaunchCommand(agent, ticketId)}`;
}

export function selectRestartSessionCommand(
  agentIdentifier: string | null | undefined,
  commands: Pick<
    LaunchCommands,
    'claudeCode' | 'codex' | 'cursor' | 'antigravity' | 'opencode' | 'pi'
  >,
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
  if (normalized.includes('antigravity') || normalized === 'agy') {
    return commands.antigravity;
  }
  if (normalized.includes('opencode')) {
    return commands.opencode;
  }
  if (normalized === 'pi' || normalized.startsWith('pi-') || normalized.includes('pi.dev')) {
    return commands.pi;
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
  if (normalized.includes('antigravity') || normalized === 'agy') {
    return `agy --conversation ${sessionId}`;
  }
  if (normalized.includes('opencode')) {
    return `opencode --continue --session ${sessionId}`;
  }
  if (normalized === 'pi' || normalized.startsWith('pi-') || normalized.includes('pi.dev')) {
    return `pi --resume ${sessionId}`;
  }
  return null;
}
