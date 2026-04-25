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
  const res = await fetch(`${platformUrl}/api/auth/config`, {
    headers: buildAuthHeaders('', localSecret)
  });
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
  const res = await fetch(`${platformUrl}/api/auth/device/request`, {
    method: 'POST',
    headers: buildAuthHeaders('', localSecret)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Device authorization request failed (${res.status}): ${snippet(text)}`);
  }

  return readJsonOrThrow(res, 'Device authorization request', platformUrl);
}

async function pollDeviceAuthorization(platformUrl, deviceCode, localSecret) {
  const res = await fetch(`${platformUrl}/api/auth/device/poll`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders('', localSecret),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ device_code: deviceCode })
  });

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
  const res = await fetch(`${supabaseUrl}/auth/v1/oauth/token`, {
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

async function promptForOrganization(organizations, preselectedId = null) {
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

  if (organizations.length === 1) {
    return organizations[0];
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      'Multiple organizations available but stdin is not a TTY. ' +
        'Pass --organization-id <id> to select non-interactively.'
    );
  }

  const rl = (await import('node:readline')).createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    for (;;) {
      console.log('\nOrganizations');
      organizations.forEach((organization, index) => {
        console.log(`  ${index + 1}. ${organization.name} (${organization.id})`);
      });

      const answer = await new Promise(resolve => {
        rl.question('\nSelect an organization by number: ', resolve);
      });
      const selected = Number.parseInt(String(answer).trim(), 10);
      if (Number.isFinite(selected) && selected >= 1 && selected <= organizations.length) {
        return organizations[selected - 1];
      }

      console.log(`Enter a number between 1 and ${organizations.length}.`);
    }
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Public auth commands
// ---------------------------------------------------------------------------

export function resolveLoginPlatformUrl(runtime = null) {
  return process.env.OVERLORD_URL ?? runtime?.platform_url ?? getDefaultOverlordUrl();
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

export async function authLogin(args = []) {
  const preselectedOrganizationId = parseOrganizationFlag(args);
  const platformUrl = resolveLoginPlatformUrl();
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
  const selectedOrganization = await promptForOrganization(organizations, preselectedOrganizationId);

  saveCredentials({
    access_token: credentials.access_token,
    access_token_expires_at: credentials.access_token_expires_at ?? undefined,
    refresh_token: credentials.refresh_token,
    organization_id: selectedOrganization.id,
    platform_url: resolvedPlatformUrl
  });

  console.log('Logged in successfully!');
}

async function printVerboseAuthStatus() {
  const status = await getAuthStatus();
  if (!status.isLoggedIn) {
    console.log('Not logged in. Run: ovld auth login');
  } else {
    console.log('Logged in');
  }
  console.log(`  Platform URL: ${status.platformUrl}`);
  console.log(`  Platform source: ${status.platformUrlSource}`);
  console.log(`  Token source: ${status.tokenSource}`);
  console.log(`  Token present: ${status.tokenPresent ? 'yes' : 'no'}`);
  console.log(`  Auth mode: ${status.authMode}`);
  console.log(`  Organization ID: ${status.organizationId ?? 'none'}`);
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

  const creds = loadCredentials();
  if (!creds) {
    console.log('Not logged in. Run: ovld auth login');
    return;
  }
  console.log('Logged in');
  console.log(`  Platform URL: ${creds.platform_url}`);
  if (creds.user_email) {
    console.log(`  Email: ${creds.user_email}`);
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
  login    Authorize the CLI via browser (works locally or over SSH)
  status   Show current login status (use --verbose for redacted diagnostics)
  repair   Mirror and chmod shared Desktop/CLI credentials when possible
  logout   Remove stored credentials
`);
    return;
  }

  if (subcommand === 'login') {
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
