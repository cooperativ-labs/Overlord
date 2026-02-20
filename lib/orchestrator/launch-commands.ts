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

export function buildLaunchCommands({
  ticketId,
  platformUrl,
  token
}: BuildLaunchCommandsInput): LaunchCommands {
  const contextUrl = `${platformUrl}/api/protocol/context/${ticketId}`;
  const curlFragment = `"$(curl -s -H 'Authorization: Bearer ${token}' ${contextUrl})"`;
  const envPrefix = `PLATFORM_URL=${platformUrl} AGENT_TOKEN=${token} TICKET_ID=${ticketId}`;

  return {
    // Use --append-system-prompt to preserve Claude Code's built-in capabilities
    // (file editing, bash, etc.) while adding ticket context.
    // Pass a positional argument so Claude starts working immediately
    // instead of waiting for user input.
    claudeCode: `${envPrefix} claude --append-system-prompt ${curlFragment} "Begin working on this ticket. Start by calling the attach endpoint, then proceed with the objective described in your system prompt."`,
    codex: `${envPrefix} codex ${curlFragment}`,
    contextUrl
  };
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
