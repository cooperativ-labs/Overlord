import { safeStorage } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OVLD_DIR = path.join(os.homedir(), '.ovld');
const CREDENTIALS_FILE = path.join(OVLD_DIR, 'electron-credentials.json');
const CLI_CREDENTIALS_FILE = path.join(OVLD_DIR, 'credentials.json');
const FILE_MODE = 0o600;

export type ElectronCredentials = {
  agent_token: string;
  platform_url: string;
  supabase_refresh_token?: string;
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

function readCliCredentials(): Pick<ElectronCredentials, 'agent_token' | 'platform_url'> | null {
  const parsed = readJsonFile(CLI_CREDENTIALS_FILE);
  const accessToken = typeof parsed?.access_token === 'string' ? parsed.access_token.trim() : '';
  const platformUrl = typeof parsed?.platform_url === 'string' ? parsed.platform_url.trim() : '';
  if (!accessToken || !platformUrl) return null;
  return { agent_token: accessToken, platform_url: platformUrl };
}

function writeSharedCredentials(
  credentials: Pick<ElectronCredentials, 'agent_token' | 'platform_url'>
): void {
  const cliPayload = {
    access_token: credentials.agent_token,
    platform_url: credentials.platform_url
  };
  writeJsonFileAtomic(CLI_CREDENTIALS_FILE, cliPayload);

  const existingElectronCredentials = readJsonFile(CREDENTIALS_FILE);
  const electronPayload = {
    ...(existingElectronCredentials ?? {}),
    access_token: credentials.agent_token,
    platform_url: credentials.platform_url
  };
  writeJsonFileAtomic(CREDENTIALS_FILE, electronPayload);
}

export function loadElectronCredentials(): ElectronCredentials | null {
  try {
    const parsed = readJsonFile(CREDENTIALS_FILE) as {
      encrypted_token?: string;
      access_token?: string;
      platform_url?: string;
      encrypted_refresh_token?: string;
    } | null;

    if (!parsed?.platform_url) return readCliCredentials();

    let agentToken = typeof parsed.access_token === 'string' ? parsed.access_token.trim() : '';
    if (!agentToken && parsed.encrypted_token) {
      if (!safeStorage.isEncryptionAvailable()) return readCliCredentials();
      agentToken = safeStorage.decryptString(Buffer.from(parsed.encrypted_token, 'base64'));
    }

    if (!agentToken) return readCliCredentials();

    let supabase_refresh_token: string | undefined;
    if (parsed.encrypted_refresh_token) {
      try {
        supabase_refresh_token = safeStorage.decryptString(
          Buffer.from(parsed.encrypted_refresh_token, 'base64')
        );
      } catch {
        // If refresh token decryption fails, continue without it
      }
    }

    writeSharedCredentials({ agent_token: agentToken, platform_url: parsed.platform_url });

    return { agent_token: agentToken, platform_url: parsed.platform_url, supabase_refresh_token };
  } catch {
    return readCliCredentials();
  }
}

export function saveElectronCredentials(credentials: ElectronCredentials): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available on this system.');
  }

  const encrypted = safeStorage.encryptString(credentials.agent_token);
  const payload: Record<string, string> = {
    encrypted_token: encrypted.toString('base64'),
    platform_url: credentials.platform_url
  };

  if (credentials.supabase_refresh_token) {
    const encryptedRefresh = safeStorage.encryptString(credentials.supabase_refresh_token);
    payload.encrypted_refresh_token = encryptedRefresh.toString('base64');
  }

  ensureOvldDir();
  payload.access_token = credentials.agent_token;
  writeJsonFileAtomic(CREDENTIALS_FILE, payload);

  writeSharedCredentials(credentials);
}

export function clearElectronCredentials(): void {
  for (const file of [CREDENTIALS_FILE, CLI_CREDENTIALS_FILE]) {
    try {
      fs.unlinkSync(file);
    } catch {
      // Best-effort
    }
  }
}
