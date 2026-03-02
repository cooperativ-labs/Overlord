#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { buildAuthHeaders, clearCredentials, loadCredentials, loadRuntime, saveCredentials } from './credentials.mjs';

const DEFAULT_OVERLORD_URL =
  process.env.OVERLORD_URL ?? 'http://localhost:3000';

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1_000; // 10 minutes

function snippet(value, max = 180) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

async function readJsonOrThrow(res, context, platformUrl) {
  const contentType = res.headers.get('content-type') ?? '';
  const bodyText = await res.text();

  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(
      `${context} returned non-JSON content (${res.status}, ${contentType || 'unknown content type'}). ` +
        `Response: ${snippet(bodyText)}\n` +
        `Check OVERLORD_URL and ensure Overlord is running at ${platformUrl}.`
    );
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    throw new Error(
      `${context} returned invalid JSON (${res.status}). Response: ${snippet(bodyText)}\n` +
        `Check OVERLORD_URL and ensure Overlord is running at ${platformUrl}.`
    );
  }
}

function openBrowser(url) {
  try {
    const platform = process.platform;
    if (platform === 'darwin') execFileSync('open', [url]);
    else if (platform === 'win32') execFileSync('cmd', ['/c', 'start', '', url]);
    else execFileSync('xdg-open', [url]);
  } catch {
    // Best-effort; user will see the URL in stdout anyway
  }
}

async function requestDeviceCode(platformUrl, localSecret) {
  const res = await fetch(`${platformUrl}/api/auth/device/request`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders('', localSecret),
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to start login (${res.status}): ${text}`);
  }
  return readJsonOrThrow(res, 'Device code request', platformUrl);
}

async function pollDeviceCode(platformUrl, deviceCode, localSecret) {
  const res = await fetch(`${platformUrl}/api/auth/device/poll`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders('', localSecret),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ device_code: deviceCode })
  });

  if (res.status === 400) {
    const data = await readJsonOrThrow(res, 'Device code poll', platformUrl);
    if (data.status === 'expired') return { status: 'expired' };
    throw new Error(`Poll error (${res.status}): ${JSON.stringify(data)}`);
  }

  if (!res.ok) {
    throw new Error(`Poll error (${res.status}): ${await res.text()}`);
  }

  return readJsonOrThrow(res, 'Device code poll', platformUrl);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function authLogin() {
  const runtime = loadRuntime();
  const platformUrl = process.env.OVERLORD_URL ?? runtime?.platform_url ?? DEFAULT_OVERLORD_URL;
  const localSecret = runtime?.local_secret ?? process.env.OVERLORD_LOCAL_SECRET ?? '';

  console.log('Starting Overlord CLI authorization...\n');

  const { device_code, user_code, verification_uri, expires_in } =
    await requestDeviceCode(platformUrl, localSecret);

  console.log(`  Authorization URL: ${verification_uri}`);
  console.log(`  Authorization code: ${user_code}`);
  console.log(`\nOpening browser... (expires in ${Math.round(expires_in / 60)} minutes)\n`);

  openBrowser(verification_uri);

  console.log('Waiting for approval');
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    process.stdout.write('.');

    const result = await pollDeviceCode(platformUrl, device_code, localSecret);

    if (result.status === 'expired') {
      console.log('\nAuthorization code expired. Please run ovld auth login again.');
      process.exit(1);
    }

    if (result.status === 'authorized') {
      console.log('\n\nLogged in successfully!');
      saveCredentials({
        access_token: result.access_token,
        platform_url: result.platform_url ?? platformUrl
      });
      return;
    }

    // status === 'pending' → keep polling
  }

  console.log('\nTimed out waiting for approval. Please run ovld auth login again.');
  process.exit(1);
}

export function authStatus() {
  const creds = loadCredentials();
  if (!creds) {
    console.log('Not logged in. Run: ovld auth login');
    return;
  }
  console.log(`Logged in`);
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
  login    Authorize the CLI via browser (device-code flow)
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
