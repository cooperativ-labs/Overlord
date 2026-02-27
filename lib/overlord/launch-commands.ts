type BuildLaunchCommandsInput = {
  ticketId: string;
  platformUrl: string;
  token: string;
};

export type LaunchCommands = {
  claudeCode: string;
  codex: string;
  cursor: string;
  gemini: string;
  contextUrl: string;
};

export type ResumeCommands = {
  claudeCode: string;
  codex: string;
  cursor: string;
  gemini: string;
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
  platformUrl,
  token
}: BuildLaunchCommandsInput): LaunchCommands {
  const contextUrl = `${platformUrl}/api/protocol/context/${ticketId}`;
  const envBlock = `OVERLORD_URL=${platformUrl} AGENT_TOKEN=${token} TICKET_ID=${ticketId}`;

  return {
    claudeCode: `${envBlock} npx overlord run claude`,
    codex: `${envBlock} npx overlord run codex`,
    cursor: `${envBlock} npx overlord run cursor`,
    gemini: `${envBlock} npx overlord run gemini`,
    contextUrl
  };
}

/**
 * Builds restart commands that use each agent's native resume flow.
 * The `overlord resume` subcommand fetches latest ticket context and
 * passes it as the first resumed prompt so new system messages are included.
 */
export function buildResumeCommands({
  ticketId,
  platformUrl,
  token
}: BuildLaunchCommandsInput): ResumeCommands {
  const envBlock = `OVERLORD_URL=${platformUrl} AGENT_TOKEN=${token} TICKET_ID=${ticketId}`;

  return {
    claudeCode: `${envBlock} npx overlord resume claude`,
    codex: `${envBlock} npx overlord resume codex`,
    cursor: `${envBlock} npx overlord resume cursor`,
    gemini: `${envBlock} npx overlord resume gemini`
  };
}

/**
 * Builds the raw fallback command (no CLI dependency) for restart artifacts.
 * Uses $(curl ...) to fetch context inline — works in standard shells.
 */
export function buildRawLaunchCommand(
  agent: 'claude' | 'codex' | 'cursor' | 'gemini',
  { ticketId, platformUrl, token }: BuildLaunchCommandsInput
): string {
  const contextUrl = `${platformUrl}/api/protocol/context/${ticketId}`;
  const curlFragment = `"$(curl -s -H 'Authorization: Bearer ${token}' ${contextUrl})"`;
  const envPrefix = `OVERLORD_URL=${platformUrl} AGENT_TOKEN=${token} TICKET_ID=${ticketId}`;

  if (agent === 'claude') {
    return `${envPrefix} claude --append-system-prompt ${curlFragment} "Begin working on this ticket. Start by calling the attach endpoint, then proceed with the objective described in your system prompt."`;
  }
  if (agent === 'codex') {
    return `${envPrefix} codex ${curlFragment}`;
  }
  if (agent === 'cursor') {
    return `${envPrefix} agent ${curlFragment}`;
  }
  return `${envPrefix} gemini ${curlFragment}`;
}

export function selectRestartSessionCommand(
  agentIdentifier: string | null | undefined,
  commands: Pick<LaunchCommands, 'claudeCode' | 'codex' | 'cursor' | 'gemini'>
): string {
  const normalized = agentIdentifier?.trim().toLowerCase() ?? '';
  if (normalized.includes('claude')) {
    return commands.claudeCode;
  }
  if (normalized.includes('cursor')) {
    return commands.cursor;
  }
  if (normalized.includes('gemini')) {
    return commands.gemini;
  }
  return commands.codex;
}
