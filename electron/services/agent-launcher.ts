import fs from 'fs';
import os from 'os';
import path from 'path';

const PLATFORM_URL_DEFAULT = 'http://localhost:3000';

export type AgentType = 'claude' | 'codex';

type LaunchAgentInput = {
  ticketId: string;
  agent: AgentType;
  cwd?: string;
  /** Per-user agent token from the agent_tokens table. Falls back to AGENT_TOKEN env var. */
  agentToken?: string;
};

type LaunchAgentResult = {
  command: string;
  cwd?: string;
  env: Record<string, string>;
};

type ContextCommandsResponse = {
  claudeCode: string;
  codex: string;
};

function getPlatformUrl(): string {
  // Electron should target the locally running Overlord app by default.
  // NEXT_PUBLIC_SITE_URL may point to a deployed web instance and break local launches.
  return process.env.PLATFORM_URL ?? PLATFORM_URL_DEFAULT;
}

/**
 * Fetches the ticket context markdown from the protocol API,
 * writes it to a temp file, and returns a clean shell command
 * plus env vars for the PTY.
 */
export async function prepareAgentLaunch(input: LaunchAgentInput): Promise<LaunchAgentResult> {
  const platformUrl = getPlatformUrl();
  // Use the per-user token passed from the UI; fall back to AGENT_TOKEN env var
  const agentToken = input.agentToken ?? process.env.AGENT_TOKEN ?? '';
  const contextUrl = `${platformUrl}/api/protocol/context/${input.ticketId}`;
  const launchEnv = {
    PLATFORM_URL: platformUrl,
    AGENT_TOKEN: agentToken,
    TICKET_ID: input.ticketId
  };

  // Fetch context from the API (runs in the main process — no shell needed)
  const response = await fetch(contextUrl, {
    headers: { Authorization: `Bearer ${agentToken}` }
  });

  if (!response.ok) {
    const fallback = await fetchContextCommandFallback(contextUrl, agentToken, input.agent);
    if (fallback) {
      return {
        command: fallback,
        cwd: input.cwd || undefined,
        env: launchEnv
      };
    }

    const details = await readErrorBody(response);
    const suffix = details ? ` - ${details}` : ' - <empty response body>';
    throw new Error(
      `Failed to fetch ticket context (${contextUrl}): ${response.status} ${response.statusText}${suffix}`
    );
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
    env: launchEnv
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const payload = (await response.json()) as { error?: unknown };
      const message = typeof payload?.error === 'string' ? payload.error.trim() : '';
      return message;
    }

    const text = (await response.text()).trim();
    if (!text) return '';
    const compact = text.replace(/\s+/g, ' ');
    return compact.slice(0, 500);
  } catch {
    return '';
  }
}

async function fetchContextCommandFallback(
  contextUrl: string,
  agentToken: string,
  agent: AgentType
): Promise<string | null> {
  try {
    const response = await fetch(contextUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentToken}` }
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as Partial<ContextCommandsResponse>;
    if (agent === 'claude') {
      return typeof payload.claudeCode === 'string' && payload.claudeCode.trim().length > 0
        ? payload.claudeCode
        : null;
    }

    return typeof payload.codex === 'string' && payload.codex.trim().length > 0
      ? payload.codex
      : null;
  } catch {
    return null;
  }
}
