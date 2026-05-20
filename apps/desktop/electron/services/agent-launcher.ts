import { app } from 'electron';
import fs from 'fs';
import crypto from 'node:crypto';
import os from 'os';
import path from 'path';

import type { LaunchAgentType } from '@/lib/helpers/agent-types';

import { type AgentBundleAgent, isBundleInstalled } from './agent-bundle';
import { loadElectronCredentials, saveElectronCredentials } from './electron-credentials';

const OVERLORD_URL_DEFAULT = 'http://localhost:3000';
type AgentLaunchMode = 'run' | 'ask';

const agentIdentifierMap: Record<LaunchAgentType, string> = {
  claude: 'claude-code',
  codex: 'codex',
  cursor: 'cursor',
  antigravity: 'antigravity',
  opencode: 'opencode',
  pi: 'pi'
};

type LaunchAgentInput = {
  ticketId: string;
  agent: LaunchAgentType;
  organizationId?: number;
  /** Project UUID when the ticket is project-scoped; required for managed JJ workspaces. */
  projectId?: string | null;
  cwd?: string;
  launchMode?: AgentLaunchMode;
  /** Extra CLI flags from local agent configuration (e.g. --enable-auto-mode). */
  flags?: string[];
  /** Preferred model ID (e.g. 'claude-opus-4-6'). Passed as --model flag. */
  model?: string;
  /** Preferred thinking/effort level (e.g. 'high', 'max'). Passed as agent-specific flag. */
  thinking?: string;
  /** When set, context markdown includes the feed post appendix (desktop feed discuss). */
  feedPostId?: string;
  /** First user question for feed discuss (paired with feedPostId). */
  initialQuestion?: string;
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
  antigravity: string;
  opencode: string;
  pi: string;
};

export function buildAgentContextUrl(input: {
  agent: LaunchAgentType;
  connectorUrl: string;
  instructionMode: string;
  launchMode: AgentLaunchMode;
  sessionId: string;
  ticketId: string;
  feedPostId?: string;
  initialQuestion?: string;
}): string {
  const feedParams =
    input.feedPostId?.trim() && typeof input.initialQuestion === 'string'
      ? `&feedPostId=${encodeURIComponent(input.feedPostId.trim())}&initialQuestion=${encodeURIComponent(input.initialQuestion)}`
      : '';
  return (
    `${input.connectorUrl}/api/protocol/context/${input.ticketId}` +
    `?context=electron&agent=${input.agent}` +
    `${input.launchMode === 'ask' ? '&mode=ask' : ''}` +
    `&instructionMode=${input.instructionMode}&sessionId=${input.sessionId}` +
    feedParams
  );
}

function claudeSourcePluginDir(): string | null {
  const appPath = app.getAppPath();
  const bundledPath = path.join(appPath, 'plugins', 'claude');
  const unpackedPath = appPath.includes('app.asar')
    ? path.join(appPath.replace('app.asar', 'app.asar.unpacked'), 'plugins', 'claude')
    : bundledPath;
  const sourceDir = app.isPackaged && fs.existsSync(unpackedPath) ? unpackedPath : bundledPath;
  return fs.existsSync(path.join(sourceDir, '.claude-plugin', 'plugin.json')) ? sourceDir : null;
}

function buildProtocolHeaders(
  bearerToken: string,
  organizationId?: number | null
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }
  const localSecret = process.env.OVERLORD_LOCAL_SECRET?.trim();
  if (localSecret) {
    headers['X-Overlord-Local-Secret'] = localSecret;
  }
  if (typeof organizationId === 'number' && Number.isFinite(organizationId)) {
    headers['x-organization-id'] = String(organizationId);
  }
  return headers;
}

function parseOrganizationId(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function organizationIdFromTicketId(ticketId: string): number | null {
  const [organizationPart, _ticketSequencePart, ...rest] = ticketId.trim().split(':');
  if (rest.length > 0) return null;
  return parseOrganizationId(organizationPart);
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

function decodeJwtExpiry(accessToken: string): number | null {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8')
    ) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

function isAccessTokenFresh(accessToken?: string, expiresAt?: string): boolean {
  const parsedExpiry = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  const expiresAtMs = Number.isFinite(parsedExpiry)
    ? parsedExpiry
    : accessToken
      ? (decodeJwtExpiry(accessToken) ?? 0) * 1000
      : 0;
  return expiresAtMs - Date.now() > 60_000;
}

function computeAccessTokenExpiry(data: {
  access_token?: string;
  expires_in?: unknown;
}): string | undefined {
  const expiresIn = Number.parseInt(String(data.expires_in ?? ''), 10);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    return new Date(Date.now() + expiresIn * 1000).toISOString();
  }

  const jwtExp = data.access_token ? decodeJwtExpiry(data.access_token) : null;
  return jwtExp ? new Date(jwtExp * 1000).toISOString() : undefined;
}

async function refreshLaunchOAuthSession(
  platformUrl: string,
  refreshToken: string
): Promise<{ access_token: string; refresh_token?: string; access_token_expires_at?: string }> {
  const configResponse = await fetch(`${platformUrl}/api/auth/config`, {
    headers: buildProtocolHeaders('')
  });
  if (!configResponse.ok) {
    throw new Error(`Failed to load OAuth config (${configResponse.status}).`);
  }

  const config = (await configResponse.json()) as {
    supabase_url?: string;
    electron_client_id?: string;
    cli_client_id?: string;
  };
  const supabaseUrl = config.supabase_url;
  const clientId = config.electron_client_id ?? config.cli_client_id;
  if (!supabaseUrl || !clientId) {
    throw new Error('OAuth is not configured for Desktop launch.');
  }

  const tokenResponse = await fetch(`${supabaseUrl}/auth/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId
    })
  });
  if (!tokenResponse.ok) {
    const text = await tokenResponse.text().catch(() => '');
    throw new Error(
      `OAuth session refresh failed (${tokenResponse.status}): ${text.slice(0, 180)}`
    );
  }

  const data = (await tokenResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: unknown;
  };
  if (!data.access_token) {
    throw new Error('OAuth session refresh did not return an access token.');
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    access_token_expires_at: computeAccessTokenExpiry(data)
  };
}

async function resolveLaunchAuth(input: LaunchAgentInput): Promise<{
  bearerToken: string;
  organizationId: number | null;
  authMode: 'oauth';
  platformUrl: string | null;
}> {
  const credentials = await loadElectronCredentials();
  let oauthToken = credentials?.access_token?.trim() ?? '';
  const organizationId =
    organizationIdFromTicketId(input.ticketId) ??
    parseOrganizationId(input.organizationId) ??
    parseOrganizationId(credentials?.organization_id);

  if (
    credentials?.refresh_token &&
    credentials.platform_url &&
    !isAccessTokenFresh(oauthToken, credentials.access_token_expires_at)
  ) {
    const refreshed = await refreshLaunchOAuthSession(
      credentials.platform_url,
      credentials.refresh_token
    );
    await saveElectronCredentials({
      ...credentials,
      access_token: refreshed.access_token,
      access_token_expires_at: refreshed.access_token_expires_at,
      refresh_token: refreshed.refresh_token ?? credentials.refresh_token
    });
    oauthToken = refreshed.access_token;
  }

  if (oauthToken) {
    return {
      bearerToken: oauthToken,
      organizationId,
      authMode: 'oauth',
      platformUrl: credentials?.platform_url ?? null
    };
  }

  throw new Error(
    'No Overlord OAuth session is available for this workspace. Open Desktop or run `ovld auth login`.'
  );
}

/**
 * Builds CLI flags for model and thinking/effort selection per agent type.
 */
function buildModelThinkingFlags(
  agent: LaunchAgentType,
  model?: string,
  thinking?: string
): string {
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
    case 'antigravity':
      break;
    case 'opencode':
      if (model) parts.push(`--model ${shellQuote(model)}`);
      break;
    case 'pi':
      if (model) parts.push(`--model ${shellQuote(model)}`);
      if (thinking) parts.push(`--thinking ${shellQuote(thinking)}`);
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
  const launchAuth = await resolveLaunchAuth(input);
  const launchMode = input.launchMode ?? 'run';
  const launchSessionId = crypto.randomUUID();
  // Check if the Overlord local bundle is installed for this agent
  const bundleAgent =
    input.agent === 'claude' ||
    input.agent === 'cursor' ||
    input.agent === 'antigravity' ||
    input.agent === 'opencode'
      ? (input.agent as AgentBundleAgent)
      : null;
  const bundleInstalled =
    input.agent === 'codex'
      ? isCodexPluginInstalled()
      : input.agent === 'claude'
        ? Boolean(claudeSourcePluginDir())
        : bundleAgent
          ? isBundleInstalled(bundleAgent)
          : false;
  const instructionMode = bundleInstalled ? 'bundle' : 'legacy';
  const contextUrl = buildAgentContextUrl({
    agent: input.agent,
    connectorUrl,
    instructionMode,
    launchMode,
    sessionId: launchSessionId,
    ticketId: input.ticketId,
    feedPostId: input.feedPostId,
    initialQuestion: input.initialQuestion
  });
  const launchEnv: Record<string, string> = {
    OVERLORD_URL: connectorUrl,
    OVERLORD_CONNECTOR_URL: connectorUrl,
    OVERLORD_ACCESS_TOKEN: launchAuth.bearerToken,
    TICKET_ID: input.ticketId,
    AGENT_IDENTIFIER: agentIdentifierMap[input.agent],
    OVERLORD_MODEL_IDENTIFIER: input.model ?? '',
    MODEL_IDENTIFIER: input.model ?? '',
    OVERLORD_LOCAL_SECRET: process.env.OVERLORD_LOCAL_SECRET ?? '',
    OVERLORD_LAUNCH_SESSION_ID: launchSessionId,
    ...(launchAuth.organizationId !== null
      ? { OVERLORD_ORGANIZATION_ID: String(launchAuth.organizationId) }
      : {})
  };

  // Fetch context from the API (runs in the main process — no shell needed).
  // Use redirect: 'manual' so that cross-origin redirects don't strip the
  // Authorization header (Node fetch drops auth headers on redirect per spec).
  const headers = buildProtocolHeaders(launchAuth.bearerToken, launchAuth.organizationId);
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
    const fallback = await fetchContextCommandFallback(
      contextUrl,
      launchAuth.bearerToken,
      launchAuth.organizationId,
      input.agent
    );
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

  // Prefer the human-readable ticket_id from the response header so TICKET_ID
  // env var holds a value like "1:899" instead of the raw UUID.
  const humanTicketId = response.headers.get('X-Ticket-Id');
  if (humanTicketId) {
    launchEnv.TICKET_ID = humanTicketId;
    const orgFromHumanTicketId = organizationIdFromTicketId(humanTicketId);
    if (orgFromHumanTicketId !== null) {
      launchEnv.OVERLORD_ORGANIZATION_ID = String(orgFromHumanTicketId);
    }
  }

  // Use the project's working directory from the API if the caller didn't provide one
  const apiWorkingDirectory = response.headers.get('X-Working-Directory');

  const resolvedCwd = input.cwd || apiWorkingDirectory || undefined;

  // Pre-flight check: if a local cwd is configured but missing, surface a clear
  // error to the renderer instead of opening a terminal where `cd` silently
  // fails and the agent appears to do nothing.
  if (resolvedCwd) {
    const cwdProblem = describeLocalCwdProblem(resolvedCwd);
    if (cwdProblem) {
      throw new Error(
        `Working directory ${resolvedCwd} ${cwdProblem}. Open the project's settings to update its directory, or grant Overlord access in System Settings → Privacy & Security → Files and Folders.`
      );
    }
  }

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
  const codexLaunchEnv: Record<string, string> = {};
  if (input.agent === 'codex') {
    codexLaunchEnv._OVLD_CODEX_CMD = codexBaseCommand;
    codexLaunchEnv._OVLD_CTX_FILE = contextFile;
  }

  const contextRef = `"$(cat ${shellQuote(contextFile)})"`;

  if (input.agent === 'claude') {
    // When the bundle is installed, the durable hook is in ~/.claude/settings.json,
    // so we don't need to pass a temporary --settings file.
    const settingsArg = bundleInstalled ? '' : ` --settings ${shellQuote(settingsFile)}`;
    const pluginDir = claudeSourcePluginDir();
    const pluginArg = pluginDir ? ` --plugin-dir ${shellQuote(pluginDir)}` : '';
    command = `claude${pluginArg} --append-system-prompt ${contextRef}${settingsArg}${modelThinkingFlags}${extraFlags ? ` ${extraFlags}` : ''} ${shellQuote(startPrompt)}`;
  } else if (input.agent === 'codex') {
    command = buildInteractiveCodexCommand({ fallbackPromptRef: contextRef });
  } else if (input.agent === 'cursor') {
    command = `agent${modelThinkingFlags}${extraFlags ? ` ${extraFlags}` : ''} ${contextRef}`;
  } else if (input.agent === 'antigravity') {
    command = `agy --prompt-interactive @${contextFile} --add-dir ${shellQuote(os.tmpdir())}${extraFlags ? ` ${extraFlags}` : ''}`;
  } else if (input.agent === 'opencode') {
    command = `opencode${modelThinkingFlags}${extraFlags ? ` ${extraFlags}` : ''} --prompt ${contextRef}`;
  } else if (input.agent === 'pi') {
    command = `pi${modelThinkingFlags}${extraFlags ? ` ${extraFlags}` : ''} ${contextRef}`;
  } else {
    throw new Error(`Unknown agent type: ${input.agent}`);
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
    'if [ -n "$TICKET_ID" ] && command -v ovld >/dev/null 2>&1; then',
    '  { if [ -n "$BODY" ]; then printf \'%s\' "$BODY"; else printf \'{}\'; fi; } \\',
    '    | ovld protocol permission-request --ticket-id "$TICKET_ID" --payload-file - \\',
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

/**
 * Returns a short human-readable explanation of why a local working directory
 * can't be used, or `null` if the directory is fine. Used to translate the
 * silent `cd` failures users were seeing into actionable error messages.
 */
function describeLocalCwdProblem(cwd: string): string | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(cwd);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return 'does not exist';
    if (code === 'EACCES' || code === 'EPERM') {
      return 'is not accessible (permission denied)';
    }
    const message = error instanceof Error ? error.message : String(error);
    return `cannot be opened (${message})`;
  }
  if (!stat.isDirectory()) return 'is not a directory';
  try {
    fs.accessSync(cwd, fs.constants.R_OK | fs.constants.X_OK);
  } catch {
    return 'is not readable (permission denied)';
  }
  return null;
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
    'spawn -noecho sh -lc $env(_OVLD_CODEX_CMD)',
    'sleep 1',
    'send -- $overlord_prompt',
    'send -- "\\r"',
    'interact'
  ].join('\n');

  return [
    'if command -v expect >/dev/null 2>&1; then',
    `expect -c ${shellQuote(expectScript)};`,
    'else',
    `sh -lc ${shellQuote(`$_OVLD_CODEX_CMD ${options.fallbackPromptRef}`)};`,
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
  bearerToken: string,
  organizationId: number | null,
  agent: LaunchAgentType
): Promise<string | null> {
  try {
    const headers = buildProtocolHeaders(bearerToken, organizationId);
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
    if (agent === 'antigravity') {
      return typeof payload.antigravity === 'string' && payload.antigravity.trim().length > 0
        ? payload.antigravity
        : null;
    }
    if (agent === 'opencode') {
      return typeof payload.opencode === 'string' && payload.opencode.trim().length > 0
        ? payload.opencode
        : null;
    }
    if (agent === 'pi') {
      return typeof payload.pi === 'string' && payload.pi.trim().length > 0 ? payload.pi : null;
    }
    return typeof payload.claudeCode === 'string' && payload.claudeCode.trim().length > 0
      ? payload.claudeCode
      : null;
  } catch {
    return null;
  }
}
