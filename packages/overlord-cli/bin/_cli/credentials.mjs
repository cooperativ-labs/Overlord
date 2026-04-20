#!/usr/bin/env node

/* global process, URL */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CREDENTIALS_DIR = path.join(os.homedir(), '.ovld');
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'credentials.json');
const ELECTRON_CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'electron-credentials.json');
const RUNTIME_FILE_PATTERN = /^runtime\..+\.json$/;
const HOSTED_OVERLORD_URL = 'https://www.ovld.ai';
const LOCAL_DEV_OVERLORD_URL = 'http://localhost:3000';
const LOCAL_SECRET_HEADER = 'X-Overlord-Local-Secret';

/**
 * @typedef {{ access_token: string, platform_url: string, user_email?: string }} Credentials
 */

function ensureCredentialsDir() {
  fs.mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(CREDENTIALS_DIR, 0o700);
  } catch {
    // Best-effort hardening for existing directories.
  }
}

function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function writeJsonFileAtomic(filePath, data) {
  ensureCredentialsDir();
  const tempFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tempFile, filePath);
  fs.chmodSync(filePath, 0o600);
}

function parseStoredCredentialsData(parsed, { requireAccessToken = false } = {}) {
  if (!parsed || typeof parsed !== 'object') return null;

  const accessToken = normalizeAgentToken(parsed.access_token);
  const platformUrl = typeof parsed.platform_url === 'string' ? parsed.platform_url.trim() : '';
  if (requireAccessToken && !accessToken) return null;
  if (!accessToken && !platformUrl) return null;

  return {
    access_token: accessToken,
    platform_url: platformUrl,
    ...(typeof parsed.user_email === 'string' && parsed.user_email.trim()
      ? { user_email: parsed.user_email.trim() }
      : {})
  };
}

function normalizeCredentialsForSave(data) {
  const parsed = parseStoredCredentialsData(data, { requireAccessToken: true });
  if (!parsed) return null;

  const platformUrl = normalizePlatformUrl(parsed.platform_url);
  if (!platformUrl) return null;

  return {
    ...parsed,
    platform_url: platformUrl
  };
}

/** @returns {Credentials | null} */
export function loadCredentials() {
  return (
    parseStoredCredentialsData(readJsonFile(ELECTRON_CREDENTIALS_FILE), {
      requireAccessToken: true
    }) ??
    parseStoredCredentialsData(readJsonFile(CREDENTIALS_FILE))
  );
}

/** @param {Credentials} data */
export function saveCredentials(data) {
  const credentials = normalizeCredentialsForSave(data);
  if (!credentials) {
    throw new Error('Cannot save empty Overlord credentials.');
  }

  writeJsonFileAtomic(CREDENTIALS_FILE, credentials);

  // `electron-credentials.json` is now the shared desktop/CLI credential record.
  // Preserve Electron-only encrypted fields when CLI login refreshes the agent token.
  const existingElectronCredentials = readJsonFile(ELECTRON_CREDENTIALS_FILE);
  const electronPayload =
    existingElectronCredentials && typeof existingElectronCredentials === 'object'
      ? { ...existingElectronCredentials, ...credentials }
      : credentials;
  writeJsonFileAtomic(ELECTRON_CREDENTIALS_FILE, electronPayload);
}

export function clearCredentials() {
  for (const filePath of [CREDENTIALS_FILE, ELECTRON_CREDENTIALS_FILE]) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Already gone
    }
  }
}

function getCredentialFileSource() {
  const electronCredentials = parseStoredCredentialsData(readJsonFile(ELECTRON_CREDENTIALS_FILE), {
    requireAccessToken: true
  });
  if (electronCredentials) return 'electron-credentials.json';

  const cliCredentials = parseStoredCredentialsData(readJsonFile(CREDENTIALS_FILE));
  if (cliCredentials) return 'credentials.json';

  return 'none';
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

function isLocalDevOverlordUrl(value) {
  try {
    return new URL(value).origin === LOCAL_DEV_OVERLORD_URL;
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

export function getDefaultOverlordUrl() {
  return isLocalDevCli() ? LOCAL_DEV_OVERLORD_URL : HOSTED_OVERLORD_URL;
}

function isLocalDevCli() {
  const sourcePath = fileURLToPath(import.meta.url);
  return !sourcePath.split(path.sep).includes('node_modules');
}

/**
 * Resolve the overlord URL and agent token from credentials file or env vars.
 * @returns {{ platformUrl: string, agentToken: string }}
 */
export function resolveAuth() {
  const creds = loadCredentials();
  const overlordUrlFromEnv = normalizePlatformUrl(process.env.OVERLORD_URL);
  const overlordUrlFromCreds = normalizeStoredPlatformUrl(creds?.platform_url);

  const runtime = overlordUrlFromEnv && isLocalhostUrl(overlordUrlFromEnv)
    ? loadRuntime(overlordUrlFromEnv)
    : null;
  const runtimeOverlordUrl = runtime?.platform_url;

  const platformUrl =
    overlordUrlFromEnv ??
    overlordUrlFromCreds ??
    getDefaultOverlordUrl();
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
      normalizeAgentToken(process.env.AGENT_TOKEN) ||
      normalizeAgentToken(creds?.access_token) ||
      'overlord-local-dev-token',
    localSecret
  };
}

export function getAuthStatus() {
  const creds = loadCredentials();
  const resolved = resolveAuth();

  let tokenSource = 'fallback';
  if (normalizeAgentToken(process.env.AGENT_TOKEN)) {
    tokenSource = 'AGENT_TOKEN';
  } else if (normalizeAgentToken(creds?.access_token)) {
    tokenSource = getCredentialFileSource();
  }

  let platformUrlSource = 'default';
  if (normalizePlatformUrl(process.env.OVERLORD_URL)) {
    platformUrlSource = 'OVERLORD_URL';
  } else if (normalizeStoredPlatformUrl(creds?.platform_url)) {
    platformUrlSource = getCredentialFileSource();
  }

  return {
    isLoggedIn: tokenSource !== 'fallback',
    platformUrl: resolved.platformUrl,
    platformUrlSource,
    tokenPresent: tokenSource !== 'fallback',
    tokenSource,
    hasLocalSecret: Boolean(resolved.localSecret),
    credentialsFileExists: fileExists(CREDENTIALS_FILE),
    electronCredentialsFileExists: fileExists(ELECTRON_CREDENTIALS_FILE)
  };
}

export function repairCredentials() {
  const creds = loadCredentials();
  if (!creds || !normalizeAgentToken(creds.access_token)) {
    ensureCredentialsDir();
    return {
      repaired: false,
      reason: 'No valid stored credentials with an access token were found.',
      status: getAuthStatus()
    };
  }

  saveCredentials(creds);

  return {
    repaired: true,
    status: getAuthStatus()
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
    if (parsed.protocol === 'https:' && parsed.hostname === 'ovld.ai') {
      return HOSTED_OVERLORD_URL;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function normalizeStoredPlatformUrl(value) {
  const normalized = normalizePlatformUrl(value);
  if (!normalized) return undefined;
  if (isLocalhostUrl(normalized) && !isLocalDevOverlordUrl(normalized)) return undefined;
  return normalized;
}
