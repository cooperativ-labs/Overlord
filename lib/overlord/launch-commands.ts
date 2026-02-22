type BuildLaunchCommandsInput = {
  ticketId: string;
  platformUrl: string;
  token: string;
};

export type LaunchCommands = {
  claudeCode: string;
  codex: string;
  contextUrl: string;
};

/**
 * Builds human-readable launch commands for clipboard / display use.
 * These use the `coop` CLI which handles context fetching internally.
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
  const envBlock = `PLATFORM_URL=${platformUrl} AGENT_TOKEN=${token} TICKET_ID=${ticketId}`;

  return {
    claudeCode: `${envBlock} npx overlord run claude`,
    codex: `${envBlock} npx overlord run codex`,
    contextUrl
  };
}

/**
 * Builds the raw fallback command (no CLI dependency) for restart artifacts.
 * Uses $(curl ...) to fetch context inline — works in standard shells.
 */
export function buildRawLaunchCommand(
  agent: 'claude' | 'codex',
  { ticketId, platformUrl, token }: BuildLaunchCommandsInput
): string {
  const contextUrl = `${platformUrl}/api/protocol/context/${ticketId}`;
  const curlFragment = `"$(curl -s -H 'Authorization: Bearer ${token}' ${contextUrl})"`;
  const envPrefix = `PLATFORM_URL=${platformUrl} AGENT_TOKEN=${token} TICKET_ID=${ticketId}`;

  if (agent === 'claude') {
    return `${envPrefix} claude --append-system-prompt ${curlFragment} "Begin working on this ticket. Start by calling the attach endpoint, then proceed with the objective described in your system prompt."`;
  }
  return `${envPrefix} codex ${curlFragment}`;
}

export function selectRestartSessionCommand(
  agentIdentifier: string | null | undefined,
  commands: Pick<LaunchCommands, 'claudeCode' | 'codex'>
): string {
  const normalized = agentIdentifier?.trim().toLowerCase() ?? '';
  if (normalized.includes('claude')) {
    return commands.claudeCode;
  }
  return commands.codex;
}
