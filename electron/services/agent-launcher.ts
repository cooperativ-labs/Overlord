import fs from 'fs';
import os from 'os';
import path from 'path';

import { parseSshCommand } from '../../lib/ssh/shell-utils';

import { type AgentBundleAgent, isBundleInstalled } from './agent-bundle';

const OVERLORD_URL_DEFAULT = 'http://localhost:3000';

export type AgentType = 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode';
type AgentLaunchMode = 'run' | 'ask';

const agentIdentifierMap: Record<AgentType, string> = {
  claude: 'claude-code',
  codex: 'codex',
  cursor: 'cursor',
  gemini: 'gemini',
  opencode: 'opencode'
};

type LaunchAgentInput = {
  ticketId: string;
  agent: AgentType;
  cwd?: string;
  /** Per-user agent token from the agent_tokens table. Falls back to AGENT_TOKEN env var. */
  agentToken?: string;
  launchMode?: AgentLaunchMode;
  /** Extra CLI flags from local agent configuration (e.g. --enable-auto-mode). */
  flags?: string[];
  /** Preferred model ID (e.g. 'claude-opus-4-6'). Passed as --model flag. */
  model?: string;
  /** Preferred thinking/effort level (e.g. 'high', 'max'). Passed as agent-specific flag. */
  thinking?: string;
  /** SSH command to connect to remote server (e.g. "ssh user@host"). */
  sshCommand?: string;
  /** Working directory path on the remote server. */
  remoteWorkingDirectory?: string;
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
  opencode: string;
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

function getConnectorUrl(): string {
  const explicitConnectorUrl = process.env.OVERLORD_CONNECTOR_URL?.trim();
  if (explicitConnectorUrl) {
    return explicitConnectorUrl;
  }

  const legacyOverlordUrl = process.env.OVERLORD_URL?.trim();
  if (legacyOverlordUrl) {
    try {
      const parsed = new URL(legacyOverlordUrl);
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        return parsed.toString().replace(/\/$/, '');
      }
    } catch {
      // Fall through to the default connector URL.
    }
  }

  return OVERLORD_URL_DEFAULT;
}

function normalizeAgentToken(value?: string): string {
  return value?.trim() ?? '';
}

/**
 * Builds CLI flags for model and thinking/effort selection per agent type.
 */
function buildModelThinkingFlags(agent: AgentType, model?: string, thinking?: string): string {
  const parts: string[] = [];

  switch (agent) {
    case 'claude':
      if (model) parts.push(`--model ${shellQuote(model)}`);
      if (thinking) parts.push(`--effort ${shellQuote(thinking)}`);
      break;
    case 'codex':
      if (model) parts.push(`--model ${shellQuote(model)}`);
      if (thinking) {
        parts.push(`-c ${shellQuote(`model_reasoning_effort=${toTomlString(thinking)}`)}`);
      }
      break;
    case 'cursor':
      if (model) parts.push(`--model ${shellQuote(model)}`);
      break;
    case 'gemini':
      if (model) parts.push(`--model ${shellQuote(model)}`);
      if (thinking) parts.push(`--thinking-level ${shellQuote(thinking)}`);
      break;
    case 'opencode':
      if (model) parts.push(`--model ${shellQuote(model)}`);
      break;
  }

  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

/**
 * Fetches the ticket context markdown from the protocol API,
 * writes it to a temp file, and returns a clean shell command
 * plus env vars for the PTY.
 */
export async function prepareAgentLaunch(input: LaunchAgentInput): Promise<LaunchAgentResult> {
  const connectorUrl = getConnectorUrl();
  const isRemote = Boolean(input.sshCommand?.trim());
  // Use the per-user token passed from the UI; fall back to AGENT_TOKEN env var
  const agentToken =
    normalizeAgentToken(input.agentToken) || normalizeAgentToken(process.env.AGENT_TOKEN);
  if (!agentToken) {
    throw new Error(
      'No agent token is available for this workspace. Open Settings > Agents & MCP and refresh the token.'
    );
  }
  const launchMode = input.launchMode ?? 'run';
  // Check if the Overlord local bundle is installed for this agent
  const bundleAgent =
    input.agent === 'claude' || input.agent === 'cursor' || input.agent === 'opencode'
      ? (input.agent as AgentBundleAgent)
      : null;
  const bundleInstalled =
    input.agent === 'codex'
      ? isCodexPluginInstalled()
      : bundleAgent
        ? isBundleInstalled(bundleAgent)
        : false;
  const instructionMode = bundleInstalled ? 'bundle' : 'legacy';
  const workspaceParam = isRemote ? '&workspace=ssh' : '';
  const contextUrl = `${connectorUrl}/api/protocol/context/${input.ticketId}?context=electron&agent=${input.agent}${launchMode === 'ask' ? '&mode=ask' : ''}&instructionMode=${instructionMode}${workspaceParam}`;
  const launchEnv = {
    OVERLORD_URL: connectorUrl,
    OVERLORD_CONNECTOR_URL: connectorUrl,
    AGENT_TOKEN: agentToken,
    TICKET_ID: input.ticketId,
    AGENT_IDENTIFIER: agentIdentifierMap[input.agent],
    OVERLORD_LOCAL_SECRET: process.env.OVERLORD_LOCAL_SECRET ?? ''
  };

  // Fetch context from the API (runs in the main process — no shell needed).
  // Use redirect: 'manual' so that cross-origin redirects don't strip the
  // Authorization header (Node fetch drops auth headers on redirect per spec).
  const headers = buildProtocolHeaders(agentToken);
  let response = await fetch(contextUrl, { headers, redirect: 'manual' });

  // Follow up to 5 redirects manually, preserving the Authorization header.
  let redirectCount = 0;
  while (response.status >= 300 && response.status < 400 && redirectCount < 5) {
    const location = response.headers.get('location');
    if (!location) break;
    const redirectUrl = new URL(location, contextUrl).toString();
    response = await fetch(redirectUrl, { headers, redirect: 'manual' });
    redirectCount++;
  }

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

  // Write PermissionRequest hook script so Claude notifies Overlord when awaiting tool permission.
  // When the bundle is installed for Claude, the durable hook is already in ~/.claude/settings.json,
  // so we still write a temp settings file as a fallback but prefer the installed one.
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

  const extraFlags = (input.flags ?? []).map(f => shellQuote(f)).join(' ');

  // Build model/thinking flags per agent
  const modelThinkingFlags = buildModelThinkingFlags(input.agent, input.model, input.thinking);
  const codexBaseCommand = `codex${modelThinkingFlags}${extraFlags ? ` ${extraFlags}` : ''}`;
  const codexLaunchEnv =
    input.agent === 'codex'
      ? {
          _OVLD_CODEX_CMD: codexBaseCommand,
          ...(isRemote ? {} : { _OVLD_CTX_FILE: contextFile })
        }
      : {};

  // For remote (SSH) launches, inline the context via base64 to avoid referencing
  // a local temp file that doesn't exist on the remote server.
  const contextRef = isRemote
    ? '"$(cat "$_OVLD_CTX_FILE")"'
    : `"$(cat ${shellQuote(contextFile)})"`;

  if (input.agent === 'claude') {
    // When the bundle is installed, the durable hook is in ~/.claude/settings.json,
    // so we don't need to pass a temporary --settings file.
    // For SSH, skip the local settings file — it won't exist on the remote.
    const settingsArg =
      bundleInstalled || isRemote ? '' : ` --settings ${shellQuote(settingsFile)}`;
    command = `claude --append-system-prompt ${contextRef}${settingsArg}${modelThinkingFlags}${extraFlags ? ` ${extraFlags}` : ''} ${shellQuote(startPrompt)}`;
  } else if (input.agent === 'codex') {
    command = buildInteractiveCodexCommand({ fallbackPromptRef: contextRef });
  } else if (input.agent === 'cursor') {
    command = `agent${modelThinkingFlags}${extraFlags ? ` ${extraFlags}` : ''} ${contextRef}`;
  } else if (input.agent === 'gemini') {
    command = `gemini${modelThinkingFlags}${extraFlags ? ` ${extraFlags}` : ''} ${contextRef}`;
  } else if (input.agent === 'opencode') {
    command = `opencode${modelThinkingFlags}${extraFlags ? ` ${extraFlags}` : ''} --prompt ${contextRef}`;
  } else {
    throw new Error(`Unknown agent type: ${input.agent}`);
  }

  // When SSH is configured, wrap the command to run on the remote server.
  // The launch script will SSH into the server, cd to the remote directory,
  // set env vars, and run the agent command remotely.
  if (isRemote) {
    const remoteCwd = input.remoteWorkingDirectory?.trim();
    // Base64-encode the context so it can be decoded on the remote without
    // needing the local temp file (which doesn't exist on the remote server).
    const contextB64 = Buffer.from(contextMarkdown).toString('base64');
    // Augment PATH with common CLI install locations and source NVM if available,
    // since SSH non-interactive shells don't source shell profile files.
    const pathSetup =
      'export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.cargo/bin:$PATH"; [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" 2>/dev/null';
    const remoteContextSetup = [
      'export _OVLD_CTX_FILE=$(mktemp "${TMPDIR:-/tmp}/overlord-codex-ctx.XXXXXX")',
      'trap \'rm -f "$_OVLD_CTX_FILE"\' EXIT',
      `if printf '%s' '${contextB64}' | base64 --decode > "$_OVLD_CTX_FILE" 2>/dev/null; then`,
      '  :',
      `elif printf '%s' '${contextB64}' | base64 -d > "$_OVLD_CTX_FILE" 2>/dev/null; then`,
      '  :',
      'else',
      '  echo "Failed to decode Overlord prompt context on the remote host."',
      '  exit 1',
      'fi'
    ].join('; ');
    const remoteLaunchEnv = { ...launchEnv, ...codexLaunchEnv };
    const envExports = Object.entries(remoteLaunchEnv)
      .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
      .join('; ');
    const cdPart = remoteCwd ? `cd ${shellQuote(remoteCwd)} && ` : '';
    const remoteScript = `${pathSetup}; ${cdPart}${envExports}; ${remoteContextSetup}; ${command}`;
    // Force PTY allocation so the remote agent gets a working terminal for
    // stdin.  Without -tt, SSH runs the remote command without a pseudo-terminal
    // and interactive CLIs (claude, codex, etc.) fail with "stdin is not a terminal".
    const sshParts = parseSshCommand(input.sshCommand!.trim(), { forceTty: true });
    const sshBase = sshParts.map(p => (p.includes(' ') ? shellQuote(p) : p)).join(' ');
    const sshWrappedCommand = `${sshBase} ${shellQuote(remoteScript)}`;

    return {
      command: sshWrappedCommand,
      // No local cwd needed — the command runs remotely
      cwd: undefined,
      // No local env vars needed — they're exported inside the SSH session
      env: {}
    };
  }

  return {
    command,
    cwd: resolvedCwd,
    env: { ...launchEnv, ...codexLaunchEnv }
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
    'if [ -n "$OVERLORD_URL" ] && [ -n "$AGENT_TOKEN" ] && [ -n "$TICKET_ID" ]; then',
    '  curl -sf -m 5 \\',
    '    -X POST "$OVERLORD_URL/api/protocol/permission-request?ticketId=$TICKET_ID" \\',
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

  // Read the user's existing Claude settings and merge our hook into them
  // so we don't clobber their preferences (model, plugins, permissions, etc.).
  const userSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  let baseSettings: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(userSettingsPath, 'utf-8');
    baseSettings = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // No user settings or invalid JSON — start from scratch
  }

  const overlordHook = {
    matcher: '.*',
    hooks: [{ type: 'command', command: hookScript }]
  };

  // Merge into existing hooks.PermissionRequest array (if any)
  const existingHooks = (baseSettings.hooks ?? {}) as Record<string, unknown[]>;
  const existingPermHooks = Array.isArray(existingHooks.PermissionRequest)
    ? existingHooks.PermissionRequest
    : [];

  const mergedSettings = {
    ...baseSettings,
    hooks: {
      ...existingHooks,
      PermissionRequest: [...existingPermHooks, overlordHook]
    }
  };

  fs.writeFileSync(settingsFile, JSON.stringify(mergedSettings, null, 2), 'utf-8');

  return { hookScript, settingsFile };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isCodexPluginInstalled(): boolean {
  return fs.existsSync(
    path.join(os.homedir(), '.codex', 'plugins', 'overlord', '.codex-plugin', 'plugin.json')
  );
}

function buildInteractiveCodexCommand(options: { fallbackPromptRef: string }): string {
  const expectScript = [
    'set timeout -1',
    'if {[info exists env(_OVLD_CTX_FILE)]} {',
    '  set fh [open $env(_OVLD_CTX_FILE) r]',
    '  set overlord_prompt [read $fh]',
    '  close $fh',
    '} elseif {[info exists env(_OVLD_CTX)]} {',
    '  set overlord_prompt $env(_OVLD_CTX)',
    '} else {',
    '  send_user "Missing Overlord Codex prompt context.\\n"',
    '  exit 1',
    '}',
    'if {![info exists env(_OVLD_CODEX_CMD)]} {',
    '  send_user "Missing Overlord Codex launch command.\\n"',
    '  exit 1',
    '}',
    'spawn sh -lc $env(_OVLD_CODEX_CMD)',
    'sleep 1',
    'send -- $overlord_prompt',
    'send -- "\\r"',
    'interact'
  ].join('\n');

  return [
    'if command -v expect >/dev/null 2>&1; then',
    `expect -c ${shellQuote(expectScript)};`,
    'else',
    `$_OVLD_CODEX_CMD ${options.fallbackPromptRef};`,
    'fi'
  ].join(' ');
}

function toTomlString(value: string): string {
  return JSON.stringify(value);
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
    const headers = buildProtocolHeaders(agentToken);
    let response = await fetch(contextUrl, {
      method: 'POST',
      headers,
      redirect: 'manual'
    });
    // Follow redirects manually to preserve Authorization header
    let redirects = 0;
    while (response.status >= 300 && response.status < 400 && redirects < 5) {
      const location = response.headers.get('location');
      if (!location) break;
      response = await fetch(new URL(location, contextUrl).toString(), {
        method: 'POST',
        headers,
        redirect: 'manual'
      });
      redirects++;
    }
    if (!response.ok) return null;

    const payload = (await response.json()) as Partial<ContextCommandsResponse>;

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
    if (agent === 'gemini') {
      return typeof payload.gemini === 'string' && payload.gemini.trim().length > 0
        ? payload.gemini
        : null;
    }
    return typeof payload.claudeCode === 'string' && payload.claudeCode.trim().length > 0
      ? payload.claudeCode
      : null;
  } catch {
    return null;
  }
}
