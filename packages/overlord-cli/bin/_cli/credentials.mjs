#!/usr/bin/env node
/* global process, URL */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CREDENTIALS_DIR = path.join(os.homedir(), '.ovld');
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'credentials.json');
const RUNTIME_FILE_PATTERN = /^runtime\..+\.json$/;
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
    const parsed = new URL(targetUrl);
    const normalized = parsed.origin
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return path.join(CREDENTIALS_DIR, `runtime.${normalized || 'unknown'}.json`);
  } catch {
    return null;
  }
}

function getLegacyRuntimeFilePath(targetUrl) {
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
      .map(f => path.join(CREDENTIALS_DIR, f))
      .sort((left, right) => {
        try {
          return fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs;
        } catch {
          return 0;
        }
      });
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
      !isSupportedPlatformUrl(parsed.platform_url)
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

function isSupportedPlatformUrl(value) {
  try {
    const parsed = new URL(value);
    if (isLocalhostUrl(value)) return true;
    return parsed.protocol === 'https:';
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
    const candidatePaths = [getRuntimeFilePath(targetUrl), getLegacyRuntimeFilePath(targetUrl)]
      .filter(Boolean);
    for (const filePath of candidatePaths) {
      const runtime = loadRuntimeFromFile(filePath);
      if (runtime) return runtime;
    }
    return null;
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
  const connectorUrlFromEnv = normalizePlatformUrl(process.env.OVERLORD_CONNECTOR_URL);
  const overlordUrlFromEnv = normalizePlatformUrl(process.env.OVERLORD_URL);
  const overlordUrlFromCreds = normalizePlatformUrl(creds?.platform_url);

  const runtimeTarget =
    connectorUrlFromEnv || isLocalhostUrl(overlordUrlFromEnv)
      ? (connectorUrlFromEnv || overlordUrlFromEnv)
      : null;
  const targetedRuntime = loadRuntime(runtimeTarget ?? null);
  const fallbackRuntime = targetedRuntime ?? loadRuntime(null);
  const runtime =
    targetedRuntime && isLocalhostUrl(targetedRuntime.platform_url)
      ? targetedRuntime
      : fallbackRuntime && isLocalhostUrl(fallbackRuntime.platform_url)
        ? fallbackRuntime
        : targetedRuntime;
  const runtimeOverlordUrl = runtime?.platform_url;

  const platformUrl =
    connectorUrlFromEnv ??
    (overlordUrlFromEnv && isLocalhostUrl(overlordUrlFromEnv) ? overlordUrlFromEnv : undefined) ??
    runtimeOverlordUrl ??
    overlordUrlFromEnv ??
    overlordUrlFromCreds ??
    DEFAULT_OVERLORD_URL;
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
    agentToken:
      normalizeAgentToken(creds?.access_token) ||
      normalizeAgentToken(process.env.AGENT_TOKEN) ||
      'overlord-local-dev-token',
    localSecret
  };
}

function normalizeAgentToken(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizePlatformUrl(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (!isSupportedPlatformUrl(parsed.toString())) return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}
