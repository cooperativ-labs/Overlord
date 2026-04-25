#!/usr/bin/env node

/* global Buffer, fetch, process, URL, URLSearchParams */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CREDENTIALS_DIR = path.join(os.homedir(), '.ovld');
const CLI_CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'credentials.cli.json');
const LEGACY_CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'credentials.json');
const LEGACY_ELECTRON_CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'electron-credentials.json');
const LEGACY_MIGRATION_MARKER = path.join(CREDENTIALS_DIR, '.cli-migrated');
const RUNTIME_FILE_PATTERN = /^runtime\..+\.json$/;
const HOSTED_OVERLORD_URL = 'https://www.ovld.ai';
const LOCAL_DEV_OVERLORD_URL = 'http://localhost:3000';
const LOCAL_SECRET_HEADER = 'X-Overlord-Local-Secret';

/**
 * @typedef {{
 *   access_token?: string,
 *   access_token_expires_at?: string,
 *   refresh_token?: string,
 *   organization_id?: number | null,
 *   platform_url: string,
 *   user_email?: string
 * }} Credentials
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

function parseStoredCredentialsData(parsed, { requireAuthData = false } = {}) {
  if (!parsed || typeof parsed !== 'object') return null;

  const platformUrl = typeof parsed.platform_url === 'string' ? parsed.platform_url.trim() : '';
  const refreshToken =
    typeof parsed.refresh_token === 'string'
      ? parsed.refresh_token.trim()
      : typeof parsed.supabase_refresh_token === 'string'
        ? parsed.supabase_refresh_token.trim()
        : '';
  const accessToken = typeof parsed.access_token === 'string' ? parsed.access_token.trim() : '';
  const accessTokenExpiresAt =
    typeof parsed.access_token_expires_at === 'string'
      ? parsed.access_token_expires_at.trim()
      : '';
  const organizationId =
    typeof parsed.organization_id === 'number' && Number.isFinite(parsed.organization_id)
      ? parsed.organization_id
      : null;

  if (!platformUrl) return null;
  if (requireAuthData && !refreshToken) return null;

  return {
    platform_url: platformUrl,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    ...(accessToken ? { access_token: accessToken } : {}),
    ...(accessTokenExpiresAt ? { access_token_expires_at: accessTokenExpiresAt } : {}),
    ...(organizationId ? { organization_id: organizationId } : {}),
    ...(typeof parsed.user_email === 'string' && parsed.user_email.trim()
      ? { user_email: parsed.user_email.trim() }
      : {})
  };
}

function normalizeCredentialsForSave(data) {
  const parsed = parseStoredCredentialsData(data, { requireAuthData: true });
  if (!parsed) return null;

  const platformUrl = normalizePlatformUrl(parsed.platform_url);
  if (!platformUrl) return null;

  return {
    platform_url: platformUrl,
    ...(parsed.refresh_token ? { refresh_token: parsed.refresh_token } : {}),
    ...(parsed.access_token ? { access_token: parsed.access_token } : {}),
    ...(parsed.access_token_expires_at
      ? { access_token_expires_at: parsed.access_token_expires_at }
      : {}),
    ...(parsed.organization_id ? { organization_id: parsed.organization_id } : {}),
    ...(parsed.user_email ? { user_email: parsed.user_email } : {})
  };
}

function migrateLegacyCredentials() {
  if (fileExists(LEGACY_MIGRATION_MARKER)) return null;

  const legacyShared = parseStoredCredentialsData(readJsonFile(LEGACY_CREDENTIALS_FILE), {
    requireAuthData: true
  });
  const legacyElectron = parseStoredCredentialsData(readJsonFile(LEGACY_ELECTRON_CREDENTIALS_FILE), {
    requireAuthData: true
  });

  const source = legacyShared ?? legacyElectron;
  if (!source) return null;

  try {
    writeJsonFileAtomic(CLI_CREDENTIALS_FILE, { ...source, updated_at: new Date().toISOString() });
    ensureCredentialsDir();
    fs.writeFileSync(LEGACY_MIGRATION_MARKER, new Date().toISOString(), { mode: 0o600 });
  } catch {
    // Best-effort migration
  }

  return source;
}

/** @returns {Credentials | null} */
export function loadCredentials() {
  const cliCredentials = parseStoredCredentialsData(readJsonFile(CLI_CREDENTIALS_FILE), {
    requireAuthData: true
  });

  if (cliCredentials?.refresh_token) return cliCredentials;

  return migrateLegacyCredentials();
}

/** @param {Credentials} data */
export function saveCredentials(data) {
  const credentials = normalizeCredentialsForSave(data);
  if (!credentials) {
    throw new Error('Cannot save empty Overlord credentials.');
  }

  writeJsonFileAtomic(CLI_CREDENTIALS_FILE, { ...credentials, updated_at: new Date().toISOString() });
}

export function clearCredentials() {
  try {
    fs.unlinkSync(CLI_CREDENTIALS_FILE);
  } catch {
    // Already gone
  }
}

function getCredentialFileSource() {
  const cliCredentials = parseStoredCredentialsData(readJsonFile(CLI_CREDENTIALS_FILE), {
    requireAuthData: true
  });
  if (cliCredentials?.refresh_token) return 'credentials.cli.json';

  if (fileExists(LEGACY_CREDENTIALS_FILE)) {
    const legacyShared = parseStoredCredentialsData(readJsonFile(LEGACY_CREDENTIALS_FILE), {
      requireAuthData: true
    });
    if (legacyShared?.refresh_token) return 'credentials.json (legacy)';
  }

  if (fileExists(LEGACY_ELECTRON_CREDENTIALS_FILE)) {
    const legacyElectron = parseStoredCredentialsData(readJsonFile(LEGACY_ELECTRON_CREDENTIALS_FILE), {
      requireAuthData: true
    });
    if (legacyElectron?.refresh_token) return 'electron-credentials.json (legacy)';
  }

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

function decodeJwtExpiry(accessToken) {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

function computeAccessTokenExpiry(data) {
  const expiresIn = Number.parseInt(String(data?.expires_in ?? ''), 10);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    return new Date(Date.now() + expiresIn * 1000).toISOString();
  }

  const jwtExp = typeof data?.access_token === 'string' ? decodeJwtExpiry(data.access_token) : null;
  return jwtExp ? new Date(jwtExp * 1000).toISOString() : null;
}

function resolveAccessTokenExpiry(credentials) {
  if (!credentials?.access_token) return null;
  if (credentials.access_token_expires_at) {
    const parsed = Date.parse(credentials.access_token_expires_at);
    if (Number.isFinite(parsed)) return parsed;
  }
  const jwtExp = decodeJwtExpiry(credentials.access_token);
  return jwtExp ? jwtExp * 1000 : null;
}

function isAccessTokenFresh(credentials) {
  const expiresAt = resolveAccessTokenExpiry(credentials);
  if (expiresAt === null) return false;
  return expiresAt - Date.now() > 60_000;
}

const authConfigCache = new Map();

async function fetchAuthConfig(platformUrl, localSecret) {
  if (authConfigCache.has(platformUrl)) return authConfigCache.get(platformUrl);
  const res = await fetch(`${platformUrl}/api/auth/config`, {
    headers: buildAuthHeaders('', localSecret)
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch auth config (${res.status}).`);
  }
  const data = await res.json();
  authConfigCache.set(platformUrl, data);
  return data;
}

async function refreshOAuthAccessToken(platformUrl, refreshToken, localSecret) {
  const config = await fetchAuthConfig(platformUrl, localSecret);
  const clientId = config.cli_client_id ?? config.electron_client_id;
  const supabaseUrl = config.supabase_url;

  if (!supabaseUrl || !clientId) {
    throw new Error('OAuth is not configured for Overlord CLI auth.');
  }

  const res = await fetch(`${supabaseUrl}/auth/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OAuth token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    access_token_expires_at: computeAccessTokenExpiry(data)
  };
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
 * @param {number | null | undefined} [organizationId]
 * @returns {Record<string, string>}
 */
export function buildAuthHeaders(token, localSecret, organizationId) {
  const headers = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (localSecret) {
    headers[LOCAL_SECRET_HEADER] = localSecret;
  }

  if (organizationId && Number.isFinite(organizationId)) {
    headers['x-organization-id'] = String(organizationId);
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
 * Resolve the Overlord auth session from env vars or shared credentials.
 * Refreshes OAuth access tokens when possible.
 */
export async function resolveAuth() {
  const creds = loadCredentials();
  const overlordUrlFromEnv = normalizePlatformUrl(process.env.OVERLORD_URL);
  const overlordUrlFromCreds = normalizeStoredPlatformUrl(creds?.platform_url);

  const platformUrl = overlordUrlFromEnv ?? overlordUrlFromCreds ?? getDefaultOverlordUrl();
  const runtime = isLocalhostUrl(platformUrl) ? loadRuntime(platformUrl) : null;
  const runtimeOverlordUrl = runtime?.platform_url;
  const localSecret =
    runtime &&
    runtime.local_secret &&
    runtimeOverlordUrl &&
    runtimeOverlordUrl === platformUrl &&
    isLocalhostUrl(platformUrl)
      ? runtime.local_secret
      : '';

  const envAccessToken = normalizeAccessToken(process.env.OVERLORD_ACCESS_TOKEN);
  if (envAccessToken) {
    const envOrganizationId =
      typeof process.env.OVERLORD_ORGANIZATION_ID === 'string'
        ? Number.parseInt(process.env.OVERLORD_ORGANIZATION_ID, 10)
        : null;
    if (!Number.isFinite(envOrganizationId)) {
      throw new Error(
        'OVERLORD_ACCESS_TOKEN requires OVERLORD_ORGANIZATION_ID so protocol requests stay scoped.'
      );
    }
    return {
      platformUrl,
      bearerToken: envAccessToken,
      localSecret,
      organizationId: envOrganizationId,
      authMode: 'oauth_env'
    };
  }

  if (!creds) {
    return {
      platformUrl,
      bearerToken: 'overlord-local-dev-token',
      localSecret,
      organizationId: null,
      authMode: 'local_fallback'
    };
  }

  if (creds.refresh_token) {
    let nextCredentials = creds;
    if (!isAccessTokenFresh(creds)) {
      try {
        const refreshed = await refreshOAuthAccessToken(platformUrl, creds.refresh_token, localSecret);
        nextCredentials = {
          ...creds,
          access_token: refreshed.access_token,
          access_token_expires_at: refreshed.access_token_expires_at,
          refresh_token: refreshed.refresh_token || creds.refresh_token
        };
        saveCredentials(nextCredentials);
      } catch (refreshError) {
        if (!creds.access_token) throw refreshError;
        // Transient refresh failure — keep the existing access token and let the server
        // reject it if it's truly expired/revoked.
      }
    }

    if (!Number.isFinite(nextCredentials.organization_id)) {
      throw new Error('Overlord login is missing an organization selection. Run `ovld auth login` again.');
    }

    if (!nextCredentials.access_token) {
      throw new Error('No OAuth access token is available. Run `ovld auth login` again.');
    }

    return {
      platformUrl,
      bearerToken: nextCredentials.access_token,
      localSecret,
      organizationId: nextCredentials.organization_id,
      authMode: 'oauth'
    };
  }

  return {
    platformUrl,
    bearerToken: 'overlord-local-dev-token',
    localSecret,
    organizationId: null,
    authMode: 'local_fallback'
  };
}

export async function getAuthStatus() {
  const creds = loadCredentials();
  let resolved;
  let error = null;
  try {
    resolved = await resolveAuth();
  } catch (resolveError) {
    error = resolveError instanceof Error ? resolveError.message : String(resolveError);
    resolved = {
      platformUrl:
        normalizePlatformUrl(process.env.OVERLORD_URL) ??
        normalizeStoredPlatformUrl(creds?.platform_url) ??
        getDefaultOverlordUrl(),
      localSecret: '',
      organizationId: creds?.organization_id ?? null,
      authMode: 'error'
    };
  }

  let tokenSource = 'fallback';
  if (normalizeAccessToken(process.env.OVERLORD_ACCESS_TOKEN)) {
    tokenSource = 'OVERLORD_ACCESS_TOKEN';
  } else if (creds?.refresh_token) {
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
    organizationId: resolved.organizationId ?? null,
    authMode: resolved.authMode,
    error,
    credentialsFileExists: fileExists(CLI_CREDENTIALS_FILE),
    legacyCredentialsFileExists: fileExists(LEGACY_CREDENTIALS_FILE),
    electronCredentialsFileExists: fileExists(LEGACY_ELECTRON_CREDENTIALS_FILE)
  };
}

export function repairCredentials() {
  const creds = loadCredentials();
  if (!creds) {
    ensureCredentialsDir();
    return {
      repaired: false,
      reason: 'No valid stored credentials were found.',
      status: null
    };
  }

  saveCredentials(creds);

  return {
    repaired: true,
    status: null
  };
}

function normalizeAccessToken(value) {
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
