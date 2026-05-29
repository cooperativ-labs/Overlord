import fs from 'fs';

import type { LaunchAgentType } from '@/lib/helpers/agent-types';

import { loadElectronCredentials, saveElectronCredentials } from './electron-credentials';

const OVERLORD_URL_DEFAULT = 'http://localhost:3000';

type LaunchAgentInput = {
  ticketId: string;
  agent: LaunchAgentType;
  organizationId?: number;
  projectId?: string | null;
  cwd?: string;
  sshCommand?: string;
  remoteWorkingDirectory?: string;
  serverMultiplexer?: { enabled: boolean; tmuxCommand?: string | null };
  launchMode?: 'run' | 'ask';
  flags?: string[];
  preCommand?: string;
  customCommand?: string;
  model?: string;
  thinking?: string;
  feedPostId?: string;
  initialQuestion?: string;
};

type LaunchAgentResult = {
  command: string;
  cwd?: string;
  env: Record<string, string>;
};

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

function parseOrganizationId(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function organizationIdFromTicketId(ticketId: string): number | null {
  const [organizationPart, , ...rest] = ticketId.trim().split(':');
  if (rest.length > 0) return null;
  return parseOrganizationId(organizationPart);
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

/**
 * Resolves auth, validates the working directory, and returns an `ovld launch`
 * command that delegates context fetching and agent execution to the CLI runner.
 */
export async function prepareAgentLaunch(input: LaunchAgentInput): Promise<LaunchAgentResult> {
  const connectorUrl = getConnectorUrl();
  const launchAuth = await resolveLaunchAuth(input);
  const isRemote = Boolean(input.sshCommand?.trim());
  const customCommand = input.customCommand?.trim() ? input.customCommand.trim() : null;

  const resolvedCwd = isRemote ? undefined : input.cwd || undefined;

  if (!isRemote && resolvedCwd) {
    const cwdProblem = describeLocalCwdProblem(resolvedCwd);
    if (cwdProblem) {
      throw new Error(
        `Working directory ${resolvedCwd} ${cwdProblem}. Open the project's settings to update its directory, or grant Overlord access in System Settings → Privacy & Security → Files and Folders.`
      );
    }
  }

  const launchEnv: Record<string, string> = {
    OVERLORD_URL: connectorUrl,
    OVERLORD_CONNECTOR_URL: connectorUrl,
    OVERLORD_ACCESS_TOKEN: launchAuth.bearerToken,
    OVERLORD_LOCAL_SECRET: process.env.OVERLORD_LOCAL_SECRET ?? '',
    ...(launchAuth.organizationId !== null
      ? { OVERLORD_ORGANIZATION_ID: String(launchAuth.organizationId) }
      : {})
  };

  const parts: string[] = [];

  if (customCommand) {
    parts.push('ovld', 'launch-custom');
    parts.push('--command', shellQuote(customCommand));
  } else {
    parts.push('ovld', 'launch', input.agent);
  }

  parts.push('--ticket-id', shellQuote(input.ticketId));

  if (resolvedCwd) {
    parts.push('--working-directory', shellQuote(resolvedCwd));
  }
  if (input.model) parts.push('--model', shellQuote(input.model));
  if (input.thinking) parts.push('--thinking', shellQuote(input.thinking));
  if (input.launchMode === 'ask') parts.push('--launch-mode', 'ask');
  if (input.preCommand?.trim()) parts.push('--pre-command', shellQuote(input.preCommand.trim()));
  for (const flag of input.flags ?? []) parts.push('--flag', shellQuote(flag));

  if (isRemote) {
    parts.push('--ssh-command', shellQuote(input.sshCommand!.trim()));
    if (input.remoteWorkingDirectory?.trim()) {
      parts.push('--remote-working-directory', shellQuote(input.remoteWorkingDirectory.trim()));
    }
    if (input.serverMultiplexer?.enabled) {
      parts.push('--server-multiplexer', 'tmux');
      if (input.serverMultiplexer.tmuxCommand) {
        parts.push('--tmux-command', shellQuote(input.serverMultiplexer.tmuxCommand));
      }
    }
  }

  if (input.feedPostId?.trim()) {
    parts.push('--feed-post-id', shellQuote(input.feedPostId.trim()));
    if (typeof input.initialQuestion === 'string') {
      parts.push('--initial-question', shellQuote(input.initialQuestion));
    }
  }

  return {
    command: parts.join(' '),
    cwd: resolvedCwd,
    env: launchEnv
  };
}
