import { safeStorage } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OVLD_DIR = path.join(os.homedir(), '.ovld');
const PROD_DESKTOP_CREDENTIALS_FILE = path.join(OVLD_DIR, 'credentials.desktop.json');
const DEV_DESKTOP_CREDENTIALS_FILE = path.join(OVLD_DIR, 'dev-credentials.desktop.json');
const LEGACY_CREDENTIALS_FILE = path.join(OVLD_DIR, 'credentials.json');
const LEGACY_ELECTRON_FILE = path.join(OVLD_DIR, 'electron-credentials.json');
const LEGACY_MIGRATION_MARKER = path.join(OVLD_DIR, '.desktop-migrated');
const FILE_MODE = 0o600;

export type ElectronCredentialsProfile = 'prod' | 'dev';

let credentialsProfile: ElectronCredentialsProfile =
  process.env.OVERLORD_DESKTOP_CREDENTIALS_PROFILE === 'dev' ? 'dev' : 'prod';

export type ElectronCredentials = {
  access_token?: string;
  access_token_expires_at?: string;
  refresh_token?: string;
  organization_id?: number | null;
  platform_url: string;
  user_email?: string;
};

function ensureOvldDir(): void {
  fs.mkdirSync(OVLD_DIR, { recursive: true, mode: 0o700 });
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeJsonFileAtomic(filePath: string, payload: Record<string, unknown>): void {
  ensureOvldDir();
  const tempFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), { mode: FILE_MODE });
  fs.renameSync(tempFile, filePath);
  fs.chmodSync(filePath, FILE_MODE);
}

function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function getDesktopCredentialsFile(): string {
  return credentialsProfile === 'dev'
    ? DEV_DESKTOP_CREDENTIALS_FILE
    : PROD_DESKTOP_CREDENTIALS_FILE;
}

export function setElectronCredentialsProfile(profile: ElectronCredentialsProfile): void {
  credentialsProfile = profile;
}

function parseCredentials(parsed: Record<string, unknown> | null): ElectronCredentials | null {
  if (!parsed) return null;

  const platformUrl = typeof parsed.platform_url === 'string' ? parsed.platform_url.trim() : '';
  if (!platformUrl) return null;

  const accessToken = typeof parsed.access_token === 'string' ? parsed.access_token.trim() : '';
  const refreshToken =
    typeof parsed.refresh_token === 'string'
      ? parsed.refresh_token.trim()
      : typeof parsed.supabase_refresh_token === 'string'
        ? parsed.supabase_refresh_token.trim()
        : '';
  const organizationId =
    typeof parsed.organization_id === 'number' && Number.isFinite(parsed.organization_id)
      ? parsed.organization_id
      : null;
  const accessTokenExpiresAt =
    typeof parsed.access_token_expires_at === 'string' ? parsed.access_token_expires_at.trim() : '';
  if (!refreshToken) return null;

  return {
    platform_url: platformUrl,
    ...(accessToken ? { access_token: accessToken } : {}),
    ...(accessTokenExpiresAt ? { access_token_expires_at: accessTokenExpiresAt } : {}),
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    ...(organizationId ? { organization_id: organizationId } : {}),
    ...(typeof parsed.user_email === 'string' && parsed.user_email.trim()
      ? { user_email: parsed.user_email.trim() }
      : {})
  };
}

function hasOrganizationId(organizationId: number | null | undefined): boolean {
  return typeof organizationId === 'number' && Number.isFinite(organizationId);
}

function decryptLegacyElectronCredentials(): ElectronCredentials | null {
  const parsed = readJsonFile(LEGACY_ELECTRON_FILE) as {
    encrypted_access_token?: string;
    encrypted_refresh_token?: string;
    access_token?: string;
    refresh_token?: string;
    platform_url?: string;
    access_token_expires_at?: string;
    organization_id?: number;
    user_email?: string;
  } | null;

  if (!parsed?.platform_url) return null;

  let accessToken = typeof parsed.access_token === 'string' ? parsed.access_token.trim() : '';
  if (!accessToken && parsed.encrypted_access_token && safeStorage.isEncryptionAvailable()) {
    try {
      accessToken = safeStorage.decryptString(Buffer.from(parsed.encrypted_access_token, 'base64'));
    } catch {
      accessToken = '';
    }
  }

  let refreshToken = typeof parsed.refresh_token === 'string' ? parsed.refresh_token.trim() : '';
  if (!refreshToken && parsed.encrypted_refresh_token && safeStorage.isEncryptionAvailable()) {
    try {
      refreshToken = safeStorage.decryptString(
        Buffer.from(parsed.encrypted_refresh_token, 'base64')
      );
    } catch {
      refreshToken = '';
    }
  }

  return parseCredentials({
    ...parsed,
    access_token: accessToken || parsed.access_token,
    refresh_token: refreshToken || parsed.refresh_token
  });
}

function migrateLegacyCredentials(): ElectronCredentials | null {
  if (credentialsProfile === 'dev') return null;
  if (fileExists(LEGACY_MIGRATION_MARKER)) return null;

  const legacyShared = parseCredentials(readJsonFile(LEGACY_CREDENTIALS_FILE));
  const legacyEncrypted = decryptLegacyElectronCredentials();
  const source = legacyShared ?? legacyEncrypted;

  if (!source) return null;

  try {
    writeDesktopCredentials(source);
    ensureOvldDir();
    fs.writeFileSync(LEGACY_MIGRATION_MARKER, new Date().toISOString(), { mode: FILE_MODE });
  } catch {
    // Best-effort migration
  }

  return source;
}

function writeDesktopCredentials(credentials: ElectronCredentials): void {
  const payload: Record<string, unknown> = {
    platform_url: credentials.platform_url,
    updated_at: new Date().toISOString(),
    ...(credentials.access_token ? { access_token: credentials.access_token } : {}),
    ...(credentials.access_token_expires_at
      ? { access_token_expires_at: credentials.access_token_expires_at }
      : {}),
    ...(credentials.refresh_token ? { refresh_token: credentials.refresh_token } : {}),
    ...(hasOrganizationId(credentials.organization_id)
      ? { organization_id: credentials.organization_id }
      : {}),
    ...(credentials.user_email ? { user_email: credentials.user_email } : {})
  };

  if (safeStorage.isEncryptionAvailable()) {
    if (credentials.access_token) {
      payload.encrypted_access_token = safeStorage
        .encryptString(credentials.access_token)
        .toString('base64');
    }
    if (credentials.refresh_token) {
      payload.encrypted_refresh_token = safeStorage
        .encryptString(credentials.refresh_token)
        .toString('base64');
    }
  }

  writeJsonFileAtomic(getDesktopCredentialsFile(), payload);
}

export function loadElectronCredentials(): ElectronCredentials | null {
  try {
    const desktopCredentials = readDesktopCredentials();
    if (desktopCredentials) return desktopCredentials;

    return migrateLegacyCredentials();
  } catch {
    return null;
  }
}

function readDesktopCredentials(): ElectronCredentials | null {
  const parsed = readJsonFile(getDesktopCredentialsFile()) as {
    encrypted_access_token?: string;
    encrypted_refresh_token?: string;
    access_token?: string;
    refresh_token?: string;
    platform_url?: string;
    access_token_expires_at?: string;
    organization_id?: number;
    user_email?: string;
  } | null;

  if (!parsed?.platform_url) return null;

  let accessToken = typeof parsed.access_token === 'string' ? parsed.access_token.trim() : '';
  if (!accessToken && parsed.encrypted_access_token && safeStorage.isEncryptionAvailable()) {
    try {
      accessToken = safeStorage.decryptString(Buffer.from(parsed.encrypted_access_token, 'base64'));
    } catch {
      accessToken = '';
    }
  }

  let refreshToken = typeof parsed.refresh_token === 'string' ? parsed.refresh_token.trim() : '';
  if (!refreshToken && parsed.encrypted_refresh_token && safeStorage.isEncryptionAvailable()) {
    try {
      refreshToken = safeStorage.decryptString(
        Buffer.from(parsed.encrypted_refresh_token, 'base64')
      );
    } catch {
      refreshToken = '';
    }
  }

  return parseCredentials({
    ...parsed,
    access_token: accessToken || parsed.access_token,
    refresh_token: refreshToken || parsed.refresh_token
  });
}

export function saveElectronCredentials(credentials: ElectronCredentials): void {
  writeDesktopCredentials(credentials);
}

export function clearElectronCredentials(): void {
  for (const file of [getDesktopCredentialsFile()]) {
    try {
      fs.unlinkSync(file);
    } catch {
      // Best-effort
    }
  }
}
