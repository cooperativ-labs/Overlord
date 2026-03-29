#!/usr/bin/env node
/* global console, fetch, process, setTimeout, URL, URLSearchParams */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';

import { buildAuthHeaders, clearCredentials, loadCredentials, loadRuntime, saveCredentials } from './credentials.mjs';

const DEFAULT_OVERLORD_URL = process.env.OVERLORD_URL ?? 'https://ovld.ai';
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

async function exchangeForAgentToken(platformUrl, supabaseAccessToken, localSecret) {
  const res = await fetch(`${platformUrl}/api/auth/token`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders('', localSecret),
      Authorization: `Bearer ${supabaseAccessToken}`
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Agent token exchange failed (${res.status}): ${snippet(text)}`);
  }

  return readJsonOrThrow(res, 'Agent token exchange', platformUrl);
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

  // 8. Exchange Supabase access token → Overlord agent_token
  const agentTokenData = await exchangeForAgentToken(
    resolvedPlatformUrl,
    supabaseTokens.access_token,
    localSecret
  );

  return {
    access_token: agentTokenData.access_token,
    platform_url: agentTokenData.platform_url ?? resolvedPlatformUrl
  };
}

// ---------------------------------------------------------------------------
// Public auth commands
// ---------------------------------------------------------------------------

export function resolveLoginPlatformUrl(runtime = loadRuntime()) {
  return process.env.OVERLORD_URL ?? runtime?.platform_url ?? DEFAULT_OVERLORD_URL;
}

export async function authLogin() {
  const runtime = loadRuntime();
  const platformUrl = resolveLoginPlatformUrl(runtime);
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

  saveCredentials({
    access_token: credentials.access_token,
    platform_url: credentials.platform_url ?? platformUrl
  });

  console.log('Logged in successfully!');
}

export function authStatus() {
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

export async function runAuthCommand(subcommand) {
  if (!subcommand || subcommand === 'help' || subcommand === '--help') {
    console.log(`ovld auth <subcommand>

Subcommands:
  login    Authorize the CLI via browser (works locally or over SSH)
  status   Show current login status
  logout   Remove stored credentials
`);
    return;
  }

  if (subcommand === 'login') {
    await authLogin();
    return;
  }

  if (subcommand === 'status') {
    authStatus();
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
