import fs from 'fs';
import os from 'os';
import path from 'path';

const AGENT_TOKEN_DEFAULT = 'overlord-local-dev-token';
const PLATFORM_URL_DEFAULT = 'http://localhost:3000';

export type AgentType = 'claude' | 'codex';

type LaunchAgentInput = {
  ticketId: string;
  agent: AgentType;
  cwd?: string;
};

type LaunchAgentResult = {
  command: string;
  cwd?: string;
  env: Record<string, string>;
};

function getPlatformUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? PLATFORM_URL_DEFAULT;
}

function getAgentToken(): string {
  return process.env.OVERLORD_AGENT_TOKEN ?? AGENT_TOKEN_DEFAULT;
}

/**
 * Fetches the ticket context markdown from the protocol API,
 * writes it to a temp file, and returns a clean shell command
 * plus env vars for the PTY.
 */
export async function prepareAgentLaunch(input: LaunchAgentInput): Promise<LaunchAgentResult> {
  const platformUrl = getPlatformUrl();
  const agentToken = getAgentToken();
  const contextUrl = `${platformUrl}/api/protocol/context/${input.ticketId}`;

  // Fetch context from the API (runs in the main process — no shell needed)
  const response = await fetch(contextUrl, {
    headers: { Authorization: `Bearer ${agentToken}` }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ticket context: ${response.status} ${response.statusText}`);
  }

  // Use the project's working directory from the API if the caller didn't provide one
  const apiWorkingDirectory = response.headers.get('X-Working-Directory');
  const resolvedCwd = input.cwd || apiWorkingDirectory || undefined;

  const contextMarkdown = await response.text();

  // Write context to a temp file (avoids shell expansion / quoting issues)
  const contextFile = path.join(
    os.tmpdir(),
    `overlord-ctx-${input.ticketId.slice(-8)}-${Date.now()}.md`
  );
  fs.writeFileSync(contextFile, contextMarkdown, 'utf-8');

  // Schedule cleanup after 30 minutes
  setTimeout(() => {
    try {
      fs.unlinkSync(contextFile);
    } catch {
      // Already deleted — ignore
    }
  }, 30 * 60_000);

  // Build clean command — no inline env vars, no $(curl ...) subshell
  const startPrompt =
    'Begin working on this ticket. Start by calling the attach endpoint, then proceed with the objective described in your system prompt.';
  let command: string;

  if (input.agent === 'claude') {
    command = `claude --append-system-prompt "$(cat ${shellQuote(contextFile)})" ${shellQuote(startPrompt)}`;
  } else {
    command = `codex "$(cat ${shellQuote(contextFile)})"`;
  }

  return {
    command,
    cwd: resolvedCwd,
    env: {
      PLATFORM_URL: platformUrl,
      AGENT_TOKEN: agentToken,
      TICKET_ID: input.ticketId
    }
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
