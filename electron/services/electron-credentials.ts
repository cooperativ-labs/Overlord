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

export function loadElectronCredentials(): ElectronCredentials | null {
  try {
    const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as {
      encrypted_token?: string;
      platform_url?: string;
      encrypted_refresh_token?: string;
    };

    if (!parsed.encrypted_token || !parsed.platform_url) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;

    const decrypted = safeStorage.decryptString(Buffer.from(parsed.encrypted_token, 'base64'));

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

    return { agent_token: decrypted, platform_url: parsed.platform_url, supabase_refresh_token };
  } catch {
    return null;
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
  const tempFile = `${CREDENTIALS_FILE}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), { mode: FILE_MODE });
  fs.renameSync(tempFile, CREDENTIALS_FILE);
  fs.chmodSync(CREDENTIALS_FILE, FILE_MODE);

  // Also write plaintext credentials for the CLI (`npx overlord protocol ...`)
  // so it can pick up the same token without a separate `npx overlord login`.
  const cliPayload = JSON.stringify(
    { access_token: credentials.agent_token, platform_url: credentials.platform_url },
    null,
    2
  );
  const cliTempFile = `${CLI_CREDENTIALS_FILE}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(cliTempFile, cliPayload, { mode: FILE_MODE });
  fs.renameSync(cliTempFile, CLI_CREDENTIALS_FILE);
  fs.chmodSync(CLI_CREDENTIALS_FILE, FILE_MODE);
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
