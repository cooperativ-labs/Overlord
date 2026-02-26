import fs from 'fs';
import os from 'os';
import path from 'path';

const PLATFORM_URL_DEFAULT = 'http://localhost:3000';

export type AgentType = 'claude' | 'codex' | 'cursor' | 'gemini';

const agentIdentifierMap: Record<AgentType, string> = {
  claude: 'claude-code',
  codex: 'codex',
  cursor: 'cursor',
  gemini: 'gemini'
};

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
  cursor: string;
  gemini: string;
};

function buildProtocolHeaders(agentToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${agentToken}`
  };
  const localSecret = process.env.OVERLORD_LOCAL_SECRET?.trim();
  if (localSecret) {
    headers['X-Overlord-Local-Secret'] = localSecret;
  }
  return headers;
}

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
  const contextUrl = `${platformUrl}/api/protocol/context/${input.ticketId}?context=electron`;
  const launchEnv = {
    PLATFORM_URL: platformUrl,
    AGENT_TOKEN: agentToken,
    TICKET_ID: input.ticketId,
    AGENT_IDENTIFIER: agentIdentifierMap[input.agent],
    OVERLORD_LOCAL_SECRET: process.env.OVERLORD_LOCAL_SECRET ?? ''
  };

  // Fetch context from the API (runs in the main process — no shell needed)
  const response = await fetch(contextUrl, {
    headers: buildProtocolHeaders(agentToken)
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

  const tag = `overlord-${input.ticketId.slice(-8)}-${Date.now()}`;

  // Write context to a temp file (avoids shell expansion / quoting issues)
  const contextFile = path.join(os.tmpdir(), `${tag}-ctx.md`);
  fs.writeFileSync(contextFile, contextMarkdown, 'utf-8');

  // Write PermissionRequest hook script so Claude notifies Overlord when awaiting tool permission
  const { hookScript, settingsFile } = writePermissionRequestHookFiles(tag);

  // Schedule cleanup after 30 minutes
  setTimeout(() => {
    for (const file of [contextFile, hookScript, settingsFile]) {
      try {
        fs.unlinkSync(file);
      } catch {
        // Already deleted — ignore
      }
    }
  }, 30 * 60_000);

  // Build clean command — no inline env vars, no $(curl ...) subshell
  const startPrompt =
    'Begin working on this ticket. Start by calling the attach endpoint, then proceed with the objective described in your system prompt.';
  let command: string;

  if (input.agent === 'claude') {
    command = `claude --append-system-prompt "$(cat ${shellQuote(contextFile)})" --settings ${shellQuote(settingsFile)} ${shellQuote(startPrompt)}`;
  } else if (input.agent === 'codex') {
    command = `codex "$(cat ${shellQuote(contextFile)})"`;
  } else if (input.agent === 'cursor') {
    command = `agent "$(cat ${shellQuote(contextFile)})"`;
  } else {
    command = `gemini "$(cat ${shellQuote(contextFile)})"`;
  }

  return {
    command,
    cwd: resolvedCwd,
    env: launchEnv
  };
}

/**
 * Writes a PermissionRequest hook script and a Claude settings JSON file that
 * registers the hook. When Claude requests tool permission, the hook calls the
 * Overlord API so the UI can show a notification (badge, sound, Kanban dot).
 *
 * The hook exits 0 without printing anything, so Claude still shows its normal
 * permission prompt — Overlord only adds an extra UI notification on top.
 */
function writePermissionRequestHookFiles(tag: string): {
  hookScript: string;
  settingsFile: string;
} {
  const hookScript = path.join(os.tmpdir(), `${tag}-perm-hook.sh`);
  const settingsFile = path.join(os.tmpdir(), `${tag}-settings.json`);

  // The script reads Claude's JSON permission request from stdin, then calls
  // the Overlord API in the background and exits 0 immediately so Claude can
  // continue showing its permission prompt without waiting for the HTTP request.
  const scriptLines = [
    '#!/bin/bash',
    '# Overlord PermissionRequest notification hook',
    'BODY=$(cat -)',
    'if [ -n "$PLATFORM_URL" ] && [ -n "$AGENT_TOKEN" ] && [ -n "$TICKET_ID" ]; then',
    '  curl -sf -m 5 \\',
    '    -X POST "$PLATFORM_URL/api/protocol/permission-request?ticketId=$TICKET_ID" \\',
    '    -H "Authorization: Bearer $AGENT_TOKEN" \\',
    '    -H "X-Overlord-Local-Secret: $OVERLORD_LOCAL_SECRET" \\',
    '    -H "Content-Type: application/json" \\',
    '    -d "$BODY" \\',
    '    >/dev/null 2>&1 &',
    '  disown',
    'fi',
    'exit 0',
    ''
  ];

  fs.writeFileSync(hookScript, scriptLines.join('\n'), { encoding: 'utf-8', mode: 0o755 });

  // Claude settings format: hooks → event name → array of matcher objects,
  // each with a nested hooks array. ".*" matches all tool names.
  const settings = {
    hooks: {
      PermissionRequest: [
        {
          matcher: '.*',
          hooks: [{ type: 'command', command: hookScript }]
        }
      ]
    }
  };

  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');

  return { hookScript, settingsFile };
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
      headers: buildProtocolHeaders(agentToken)
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as Partial<ContextCommandsResponse>;
    if (agent === 'claude') {
      return typeof payload.claudeCode === 'string' && payload.claudeCode.trim().length > 0
        ? payload.claudeCode
        : null;
    }
    if (agent === 'codex') {
      return typeof payload.codex === 'string' && payload.codex.trim().length > 0
        ? payload.codex
        : null;
    }
    if (agent === 'cursor') {
      return typeof payload.cursor === 'string' && payload.cursor.trim().length > 0
        ? payload.cursor
        : null;
    }

    return typeof payload.gemini === 'string' && payload.gemini.trim().length > 0
      ? payload.gemini
      : null;
  } catch {
    return null;
  }
}
