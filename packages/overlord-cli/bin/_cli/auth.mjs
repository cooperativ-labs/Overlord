#!/usr/bin/env node
/* global console, fetch, process, setTimeout, URL, URLSearchParams */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';

import {
  buildAuthHeaders,
  clearCredentials,
  getDefaultOverlordUrl,
  getAuthStatus,
  loadCredentials,
  loadRuntime,
  repairCredentials,
  resolveAuth,
  resolveOrganizations,
  saveCredentials
} from './credentials.mjs';

const DEFAULT_CLI_REDIRECT_URI = 'http://127.0.0.1:45619/callback';
const DEFAULT_DEVICE_POLL_INTERVAL_SECONDS = 5;

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function generateCodeVerifier() {
  return crypto.randomBytes(96).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

// ---------------------------------------------------------------------------
// Redirect + callback listener
// ---------------------------------------------------------------------------

function parseLoopbackRedirectUri(rawValue) {
  const value = String(rawValue ?? '').trim();
  if (!value) {
    throw new Error('OAuth redirect URI is missing.');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid OAuth redirect URI: ${value}`);
  }

  if (parsed.protocol !== 'http:') {
    throw new Error('OAuth redirect URI must use http:// for loopback callbacks.');
  }

  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error('OAuth redirect URI host must be 127.0.0.1 or localhost.');
  }

  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`OAuth redirect URI must include a valid port: ${value}`);
  }

  const callbackPath = parsed.pathname || '/';
  return {
    callbackPath,
    host: parsed.hostname,
    port,
    redirectUri: `${parsed.origin}${callbackPath}`
  };
}

function waitForOAuthCallback(host, port, callbackPath, expectedState) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${host}:${port}`);
      if (url.pathname !== callbackPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const errorParam = url.searchParams.get('error');

      const html = (title, body) =>
        `<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>${title}</h2><p>${body}</p></body></html>`;

      res.writeHead(200, { 'Content-Type': 'text/html' });

      if (errorParam) {
        res.end(html('Authorization Denied', 'You can close this window and return to the terminal.'));
        server.close();
        reject(new Error(`Authorization denied: ${errorParam}`));
        return;
      }

      if (returnedState !== expectedState) {
        res.end(html('Error', 'State mismatch. Please try again.'));
        server.close();
        reject(new Error('State mismatch — possible CSRF. Please try again.'));
        return;
      }

      if (!code) {
        res.end(html('Error', 'No authorization code received.'));
        server.close();
        reject(new Error('No authorization code in callback.'));
        return;
      }

      res.end(html('Authorization Complete', 'You can close this window and return to the terminal.'));
      server.close();
      resolve(code);
    });

    server.listen(port, host);
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `OAuth callback port ${port} is already in use. ` +
              'Close the application using that port or check for firewall/proxy interference, then try again.'
          )
        );
      } else {
        reject(err);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

function snippet(value, max = 180) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`;
}

function describeNetworkError(error, context) {
  const cause = error?.cause;
  const details = [cause?.code, cause?.message].filter(Boolean).join(': ');
  if (details) {
    return new Error(`${context}: ${details}`);
  }

  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${context}: ${message}`);
}

async function readJsonOrThrow(res, context, baseUrl) {
  const contentType = res.headers.get('content-type') ?? '';
  const bodyText = await res.text();

  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(
      `${context} returned non-JSON content (${res.status}, ${contentType || 'unknown'}). ` +
        `Response: ${snippet(bodyText)}\nCheck that Overlord is running at ${baseUrl}.`
    );
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    throw new Error(
      `${context} returned invalid JSON (${res.status}). Response: ${snippet(bodyText)}`
    );
  }
}

async function fetchAuthConfig(platformUrl, localSecret) {
  let res;
  try {
    res = await fetch(`${platformUrl}/api/auth/config`, {
      headers: buildAuthHeaders('', localSecret)
    });
  } catch (error) {
    throw describeNetworkError(error, `Failed to fetch auth config from ${platformUrl}`);
  }
  if (!res.ok) {
    throw new Error(
      `Failed to fetch auth config (${res.status}). Check that Overlord is running at ${platformUrl}.`
    );
  }
  const config = await readJsonOrThrow(res, 'Auth config', platformUrl);
  return {
    ...config,
    platform_url: new URL(res.url).origin
  };
}

async function requestDeviceAuthorization(platformUrl, localSecret) {
  let res;
  try {
    res = await fetch(`${platformUrl}/api/auth/device/request`, {
      method: 'POST',
      headers: buildAuthHeaders('', localSecret)
    });
  } catch (error) {
    throw describeNetworkError(
      error,
      `Device authorization request failed for ${platformUrl}`
    );
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Device authorization request failed (${res.status}): ${snippet(text)}`);
  }

  return readJsonOrThrow(res, 'Device authorization request', platformUrl);
}

async function pollDeviceAuthorization(platformUrl, deviceCode, localSecret) {
  let res;
  try {
    res = await fetch(`${platformUrl}/api/auth/device/poll`, {
      method: 'POST',
      headers: {
        ...buildAuthHeaders('', localSecret),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ device_code: deviceCode })
    });
  } catch (error) {
    throw describeNetworkError(
      error,
      `Device authorization poll failed for ${platformUrl}`
    );
  }

  const body = await readJsonOrThrow(res, 'Device authorization poll', platformUrl);

  if (res.ok) return body;

  if (res.status === 400 || res.status === 404 || res.status === 429) {
    return body;
  }

  throw new Error(`Device authorization poll failed (${res.status}): ${snippet(JSON.stringify(body))}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function exchangeCodeForSupabaseTokens(supabaseUrl, clientId, code, codeVerifier, redirectUri) {
  let res;
  try {
    res = await fetch(`${supabaseUrl}/auth/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier
      })
    });
  } catch (error) {
    throw describeNetworkError(
      error,
      `Token exchange failed for ${new URL(supabaseUrl).host}`
    );
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${snippet(text)}`);
  }

  return readJsonOrThrow(res, 'Token exchange', supabaseUrl);
}

function openBrowser(url) {
  try {
    const platform = process.platform;
    if (platform === 'darwin') execFileSync('open', [url]);
    else if (platform === 'win32') execFileSync('cmd', ['/c', 'start', '', url]);
    else execFileSync('xdg-open', [url]);
  } catch {
    // Best-effort; user sees the URL in stdout anyway
  }
}

function printDeviceAuthorizationInstructions(verificationUri, userCode, logger = console) {
  logger.log('  Verification URL:', verificationUri);
  logger.log('  Authorization code:', userCode);
  logger.log('\nOpen the verification URL in any browser to approve this CLI login.\n');
}

export async function authLoginViaDeviceFlow(
  platformUrl,
  localSecret,
  {
    browserOpener = openBrowser,
    logger = console,
    sleepFn = sleep,
    stdout = process.stdout
  } = {}
) {
  const deviceAuth = await requestDeviceAuthorization(platformUrl, localSecret);
  const verificationUri = String(deviceAuth.verification_uri ?? '').trim();
  const userCode = String(deviceAuth.user_code ?? '').trim();
  const deviceCode = String(deviceAuth.device_code ?? '').trim();

  if (!verificationUri || !userCode || !deviceCode) {
    throw new Error('Device authorization response was missing required fields.');
  }

  const initialPollIntervalSeconds = Number(deviceAuth.interval);
  let pollIntervalSeconds =
    Number.isFinite(initialPollIntervalSeconds) && initialPollIntervalSeconds > 0
      ? initialPollIntervalSeconds
      : DEFAULT_DEVICE_POLL_INTERVAL_SECONDS;

  printDeviceAuthorizationInstructions(verificationUri, userCode, logger);
  logger.log('Opening browser...\n');
  browserOpener(verificationUri);

  stdout.write('Waiting for browser authorization');

  for (;;) {
    await sleepFn(pollIntervalSeconds * 1000);

    const result = await pollDeviceAuthorization(platformUrl, deviceCode, localSecret);
    const status = String(result?.status ?? '');

    if (status === 'pending') {
      stdout.write('.');
      continue;
    }

    if (status === 'slow_down') {
      stdout.write('.');
      const nextInterval = Number(result?.interval);
      if (Number.isFinite(nextInterval) && nextInterval > 0) {
        pollIntervalSeconds = nextInterval;
      } else {
        pollIntervalSeconds += 1;
      }
      continue;
    }

    if (status === 'authorized') {
      logger.log('\n');
      return {
        access_token: result.access_token,
        access_token_expires_at: result.access_token_expires_at ?? null,
        refresh_token: result.refresh_token,
        platform_url: result.platform_url ?? platformUrl
      };
    }

    if (status === 'expired') {
      throw new Error('Authorization request expired. Please run `ovld auth login` again.');
    }

    if (result?.error) {
      throw new Error(String(result.error));
    }

    throw new Error(`Unexpected device authorization status: ${status || 'unknown'}`);
  }
}

export async function authLoginViaOAuthLoopback(platformUrl, localSecret) {
  // 1. Discover OAuth config from the platform
  let supabaseUrl, cliClientId, cliRedirectUri, resolvedPlatformUrl;
  const config = await fetchAuthConfig(platformUrl, localSecret);
  supabaseUrl = config.supabase_url;
  cliClientId = config.cli_client_id;
  cliRedirectUri = config.cli_redirect_uri;
  resolvedPlatformUrl = config.platform_url ?? platformUrl;

  if (!supabaseUrl || !cliClientId) {
    throw new Error(
      'OAuth is not configured for CLI login. Set SUPABASE_OAUTH_CLI_CLIENT_ID on the Overlord server.'
    );
  }

  // 2. PKCE parameters + state
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  // 3. Use exact loopback redirect URI (Supabase does not support wildcard callback URLs)
  const redirectTarget = parseLoopbackRedirectUri(cliRedirectUri ?? DEFAULT_CLI_REDIRECT_URI);
  const { host, port, callbackPath, redirectUri } = redirectTarget;

  // 4. Build the Supabase OAuth authorization URL
  const authorizeUrl = new URL(`${supabaseUrl}/auth/v1/oauth/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', cliClientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('scope', 'openid email');

  console.log(`  Authorization URL: ${authorizeUrl.toString()}`);
  console.log('\nOpening browser...\n');

  // 5. Start listener before opening browser so we don't miss the redirect
  const callbackPromise = waitForOAuthCallback(host, port, callbackPath, state);
  openBrowser(authorizeUrl.toString());

  // 6. Wait for the auth code
  let authCode;
  process.stdout.write('Waiting for browser authorization');
  authCode = await callbackPromise;
  console.log('\n');

  // 7. Exchange auth code → Supabase tokens
  const supabaseTokens = await exchangeCodeForSupabaseTokens(
    supabaseUrl,
    cliClientId,
    authCode,
    codeVerifier,
    redirectUri
  );

  return {
    access_token: supabaseTokens.access_token,
    access_token_expires_at:
      typeof supabaseTokens.expires_in === 'number' && supabaseTokens.expires_in > 0
        ? new Date(Date.now() + supabaseTokens.expires_in * 1000).toISOString()
        : null,
    refresh_token: supabaseTokens.refresh_token,
    platform_url: resolvedPlatformUrl
  };
}

async function fetchOrganizations(platformUrl, accessToken, localSecret) {
  const res = await fetch(`${platformUrl}/api/auth/organizations`, {
    headers: {
      ...buildAuthHeaders('', localSecret),
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to load organizations (${res.status}): ${snippet(text)}`);
  }

  const data = await readJsonOrThrow(res, 'Organizations', platformUrl);
  return Array.isArray(data.organizations) ? data.organizations : [];
}

export function selectLoginOrganization(organizations, preselectedId = null) {
  if (!organizations.length) {
    throw new Error('No organizations found. Please complete onboarding first.');
  }

  if (preselectedId !== null) {
    const match = organizations.find(org => org.id === preselectedId);
    if (!match) {
      throw new Error(
        `Organization ${preselectedId} is not available to this account. ` +
          `Available: ${organizations.map(o => o.id).join(', ')}`
      );
    }
    return match;
  }

  return organizations[0];
}

function describeOrganization(organization) {
  const name = String(organization?.name ?? '').trim();
  const id = organization?.id;
  return name ? `${name} (${id})` : `organization ${id}`;
}

// ---------------------------------------------------------------------------
// Public auth commands
// ---------------------------------------------------------------------------

export function resolveLoginPlatformUrl(runtime = null, storedPlatformUrl = null) {
  return process.env.OVERLORD_URL ?? storedPlatformUrl ?? runtime?.platform_url ?? getDefaultOverlordUrl();
}

function parseOrganizationFlag(args) {
  const index = args.findIndex(arg => arg === '--organization-id' || arg.startsWith('--organization-id='));
  if (index === -1) return null;
  const raw = args[index].includes('=') ? args[index].split('=')[1] : args[index + 1];
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) {
    throw new Error('--organization-id must be a numeric id');
  }
  return parsed;
}

function parseTokenFlag(args) {
  const index = args.findIndex(arg => arg === '--token' || arg.startsWith('--token='));
  if (index === -1) return null;
  const raw = args[index].includes('=') ? args[index].split('=')[1] : args[index + 1];
  if (!raw || typeof raw !== 'string') {
    throw new Error('--token requires a value (e.g. --token oat_…)');
  }
  const trimmed = raw.trim();
  if (!trimmed.startsWith('oat_')) {
    throw new Error('--token value must be an agent token starting with oat_');
  }
  return trimmed;
}

export async function authLogin(args = []) {
  const agentToken = parseTokenFlag(args);

  if (agentToken) {
    return authLoginWithAgentToken(agentToken, args);
  }

  const preselectedOrganizationId = parseOrganizationFlag(args);
  const storedCredentials = loadCredentials();
  const platformUrl = resolveLoginPlatformUrl(null, storedCredentials?.platform_url ?? null);
  const runtime = loadRuntime(platformUrl);
  const localSecret = runtime?.local_secret ?? process.env.OVERLORD_LOCAL_SECRET ?? '';

  console.log('Starting Overlord CLI authorization...\n');
  let credentials;
  try {
    credentials = await authLoginViaDeviceFlow(platformUrl, localSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const canFallbackToLoopback =
      message.includes('Device authorization request failed (404)') ||
      message.includes('Device authorization request failed (405)');

    if (!canFallbackToLoopback) {
      console.error(`\nAuthorization failed: ${message}`);
      process.exit(1);
    }

    console.log('Device authorization is unavailable on this server. Falling back to loopback OAuth.\n');

    try {
      credentials = await authLoginViaOAuthLoopback(platformUrl, localSecret);
    } catch (fallbackErr) {
      console.error(`\nAuthorization failed: ${fallbackErr.message}`);
      process.exit(1);
    }
  }

  const resolvedPlatformUrl = credentials.platform_url ?? platformUrl;
  const organizations = await fetchOrganizations(
    resolvedPlatformUrl,
    credentials.access_token,
    localSecret
  );

  // The CLI is organization-agnostic: login stores the identity only, never a
  // default organization. `--organization-id` is still validated so a typo is
  // caught early, but it is no longer persisted — every command resolves its org
  // from the ticket id, an explicit --organization-id, or your membership.
  if (preselectedOrganizationId !== null) {
    selectLoginOrganization(organizations, preselectedOrganizationId);
  }

  saveCredentials({
    access_token: credentials.access_token,
    access_token_expires_at: credentials.access_token_expires_at ?? undefined,
    refresh_token: credentials.refresh_token,
    platform_url: resolvedPlatformUrl
  });

  console.log('Logged in successfully.');
  printOrganizationMemberships(organizations);
  if (preselectedOrganizationId !== null) {
    console.log(
      `\nNote: --organization-id is no longer stored as a default. ` +
        'Commands resolve their organization from the ticket id, an explicit --organization-id, or your membership.'
    );
  }
}

function printOrganizationMemberships(organizations) {
  if (!organizations.length) {
    console.log('  You are not yet a member of any organization. Complete onboarding in Overlord first.');
    return;
  }

  if (organizations.length === 1) {
    console.log(`  Organization: ${describeOrganization(organizations[0])}`);
    return;
  }

  console.log(`  Member of ${organizations.length} organizations:`);
  for (const organization of organizations) {
    console.log(`    - ${describeOrganization(organization)}`);
  }
  console.log('  Commands resolve their organization from the ticket id or --organization-id.');
}

async function authLoginWithAgentToken(agentToken, args) {
  const preselectedOrganizationId = parseOrganizationFlag(args);
  const storedCredentials = loadCredentials();
  const platformUrl = resolveLoginPlatformUrl(null, storedCredentials?.platform_url ?? null);

  // Agent-token login stores the identity only — never a default organization.
  saveCredentials({
    agent_token: agentToken,
    platform_url: platformUrl
  });

  console.log(`Agent token saved. The CLI will use this token for all protocol commands.`);
  console.log(`  Organizations are resolved from your token's membership per command.`);
  if (preselectedOrganizationId !== null) {
    console.log(
      `  Note: --organization-id is no longer stored as a default; pass it per command (or use a ticket id) to scope an action.`
    );
  }
  console.log(`  Platform URL: ${platformUrl}`);
  console.log(`\nTo remove: ovld auth logout`);
}

async function printOrganizationMembershipStatus() {
  try {
    const auth = await resolveAuth();
    const organizations = await resolveOrganizations(auth);
    if (!organizations.length) {
      console.log('  Organizations: none (not a member of any organization)');
      return;
    }
    console.log(`  Organizations (${organizations.length}):`);
    for (const organization of organizations) {
      console.log(`    - ${describeOrganization(organization)}`);
    }
  } catch (error) {
    console.log(
      `  Organizations: unavailable (${error instanceof Error ? error.message : String(error)})`
    );
  }
}

async function printVerboseAuthStatus() {
  const status = await getAuthStatus();
  if (!status.isLoggedIn) {
    const hasStoredAuth =
      status.credentialsFileExists || status.legacyCredentialsFileExists || status.electronCredentialsFileExists;
    console.log(
      hasStoredAuth
        ? 'Not logged in. Run: ovld auth repair, then ovld auth login if needed.'
        : 'Not logged in. Run: ovld auth login'
    );
  } else {
    console.log('Logged in');
  }
  console.log(`  Platform URL: ${status.platformUrl}`);
  console.log(`  Platform source: ${status.platformUrlSource}`);
  console.log(`  Token source: ${status.tokenSource}`);
  console.log(`  Token present: ${status.tokenPresent ? 'yes' : 'no'}`);
  console.log(`  Auth mode: ${status.authMode}`);
  if (status.isLoggedIn) {
    await printOrganizationMembershipStatus();
  }
  if (status.error) {
    console.log(`  Error: ${status.error}`);
  }
  console.log(`  Local secret: ${status.hasLocalSecret ? 'yes' : 'no'}`);
  console.log(`  credentials.cli.json: ${status.credentialsFileExists ? 'present' : 'missing'}`);
  if (status.legacyCredentialsFileExists) {
    console.log(`  credentials.json (legacy): present`);
  }
  if (status.electronCredentialsFileExists) {
    console.log(`  electron-credentials.json (legacy): present`);
  }
}

export async function authStatus(args = []) {
  if (args.includes('--verbose') || args.includes('-v')) {
    await printVerboseAuthStatus();
    return;
  }

  const status = await getAuthStatus();
  if (!status.isLoggedIn) {
    const hasStoredAuth =
      status.credentialsFileExists || status.legacyCredentialsFileExists || status.electronCredentialsFileExists;
    console.log(
      hasStoredAuth
        ? 'Not logged in. Run: ovld auth repair, then ovld auth login if needed.'
        : 'Not logged in. Run: ovld auth login'
    );
    return;
  }
  console.log('Logged in');
  const creds = loadCredentials();
  if (creds) {
    console.log(`  Platform URL: ${creds.platform_url}`);
    if (creds.user_email) {
      console.log(`  Email: ${creds.user_email}`);
    }
  }
}

export function authLogout() {
  clearCredentials();
  console.log('Logged out.');
}

export function authRepair() {
  const result = repairCredentials();
  if (result.repaired) {
    console.log('Credentials repaired.');
  } else {
    console.log(`Credentials not repaired: ${result.reason}`);
  }
  void printVerboseAuthStatus();
}

export async function runAuthCommand(subcommand, args = []) {
  if (!subcommand || subcommand === 'help' || subcommand === '--help') {
    console.log(`ovld auth <subcommand>

Subcommands:
  signup   Create a new Overlord account from the terminal (email + confirmation code)
             --email <email>          Email to create the account with.
             --name <name>            Display name.
             --password <password>    Optional password-manager password.
             --no-agent-token         Skip minting a durable oat_ token.
           Run \`ovld auth signup help\` for request/verify split flow.
  login    Authorize the CLI via browser (works locally or over SSH)
             --email <email>          Log in with an emailed code instead of a browser.
             --token <oat_…>          Persist an agent token from Settings → Agents & MCP.
                                      Skips the browser flow; token never expires.
             --organization-id <id>   Optional. Validated against your membership but
                                      no longer stored as a default — the CLI is
                                      organization-agnostic. Scope a command with a
                                      ticket id (e.g. 1:899) or --organization-id.
  status   Show current login status (use --verbose to list your organizations)
  repair   Mirror and chmod shared Desktop/CLI credentials when possible
  logout   Remove stored credentials
`);
    return;
  }

  if (subcommand === 'signup') {
    const { runAuthSignupCommand } = await import('./signup.mjs');
    await runAuthSignupCommand(args);
    return;
  }

  if (subcommand === 'login') {
    const [maybeSub, ...rest] = args;
    if (maybeSub === 'request') {
      const { runEmailLoginRequest } = await import('./signup.mjs');
      await runEmailLoginRequest(rest);
      return;
    }
    if (maybeSub === 'verify') {
      const { runEmailLoginVerify } = await import('./signup.mjs');
      await runEmailLoginVerify(rest);
      return;
    }
    if (args.some(arg => arg === '--email' || arg.startsWith('--email='))) {
      const { runEmailLogin } = await import('./signup.mjs');
      await runEmailLogin(args);
      return;
    }
    await authLogin(args);
    return;
  }

  if (subcommand === 'status') {
    await authStatus(args);
    return;
  }

  if (subcommand === 'repair') {
    authRepair();
    return;
  }

  if (subcommand === 'logout') {
    authLogout();
    return;
  }

  console.error(`Unknown auth subcommand: ${subcommand}\n`);
  console.log('Run: ovld auth help');
  process.exit(1);
}
