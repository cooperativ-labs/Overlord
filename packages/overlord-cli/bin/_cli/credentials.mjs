#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CREDENTIALS_DIR = path.join(os.homedir(), '.ovld');
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'credentials.json');
const RUNTIME_FILE_PATTERN = /^runtime\.\d+\.json$/;
const DEFAULT_OVERLORD_URL = 'http://localhost:3000';
const LOCAL_SECRET_HEADER = 'X-Overlord-Local-Secret';

/**
 * @typedef {{ access_token: string, platform_url: string, user_email?: string }} Credentials
 */

/** @returns {Credentials | null} */
export function loadCredentials() {
  try {
    const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** @param {Credentials} data */
export function saveCredentials(data) {
  fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function clearCredentials() {
  try {
    fs.unlinkSync(CREDENTIALS_FILE);
  } catch {
    // Already gone
  }
}

function getRuntimeFilePath(targetUrl) {
  try {
    const port = new URL(targetUrl).port || '80';
    return path.join(CREDENTIALS_DIR, `runtime.${port}.json`);
  } catch {
    return null;
  }
}

function getAllRuntimeFiles() {
  try {
    return fs
      .readdirSync(CREDENTIALS_DIR)
      .filter(f => RUNTIME_FILE_PATTERN.test(f))
      .map(f => path.join(CREDENTIALS_DIR, f));
  } catch {
    return [];
  }
}

function getRuntimeStatIfSecure(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;

    const mode = stat.mode & 0o777;
    if ((mode & 0o077) !== 0) return null;

    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
      return null;
    }

    return stat;
  } catch {
    return null;
  }
}

function loadRuntimeFromFile(filePath) {
  if (!getRuntimeStatIfSecure(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.platform_url !== 'string' ||
      typeof parsed.pid !== 'number' ||
      !isRunningPid(parsed.pid) ||
      !isLocalhostUrl(parsed.platform_url)
    ) {
      return null;
    }

    if (parsed.local_secret !== undefined && typeof parsed.local_secret !== 'string') {
      return null;
    }

    return {
      platform_url: parsed.platform_url,
      local_secret: parsed.local_secret
    };
  } catch {
    return null;
  }
}

function isLocalhostUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:') return false;
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function isRunningPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** @returns {{ platform_url?: string, local_secret?: string } | null} */
export function loadRuntime(targetUrl) {
  if (targetUrl) {
    const filePath = getRuntimeFilePath(targetUrl);
    if (!filePath) return null;
    return loadRuntimeFromFile(filePath);
  }

  for (const filePath of getAllRuntimeFiles()) {
    const result = loadRuntimeFromFile(filePath);
    if (result) return result;
  }

  return null;
}

/**
 * @param {string} token
 * @param {string} [localSecret]
 * @returns {Record<string, string>}
 */
export function buildAuthHeaders(token, localSecret) {
  const headers = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (localSecret) {
    headers[LOCAL_SECRET_HEADER] = localSecret;
  }

  return headers;
}

/**
 * Resolve the overlord URL and agent token from credentials file or env vars.
 * @returns {{ platformUrl: string, agentToken: string }}
 */
export function resolveAuth() {
  const creds = loadCredentials();
  const overlordUrlFromEnv = process.env.OVERLORD_URL;
  const overlordUrlFromCreds = creds?.platform_url;

  // If OVERLORD_URL is set, look only at the runtime file for that specific port.
  // Otherwise scan all runtime.*.json files and pick the first valid running instance.
  const runtime = loadRuntime(overlordUrlFromEnv ?? null);
  const runtimeOverlordUrl = runtime?.platform_url;

  const platformUrl =
    overlordUrlFromEnv ?? runtimeOverlordUrl ?? overlordUrlFromCreds ?? DEFAULT_OVERLORD_URL;
  const localSecret =
    runtime &&
    runtime.local_secret &&
    runtimeOverlordUrl &&
    runtimeOverlordUrl === platformUrl &&
    isLocalhostUrl(platformUrl)
      ? runtime.local_secret
      : '';

  return {
    platformUrl,
    agentToken: creds?.access_token ?? process.env.AGENT_TOKEN ?? 'overlord-local-dev-token',
    localSecret
  };
}
