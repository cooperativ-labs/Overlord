import { safeStorage } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OVLD_DIR = path.join(os.homedir(), '.ovld');
const CREDENTIALS_FILE = path.join(OVLD_DIR, 'electron-credentials.json');
const FILE_MODE = 0o600;

export type ElectronCredentials = {
  agent_token: string;
  platform_url: string;
};

function ensureOvldDir(): void {
  fs.mkdirSync(OVLD_DIR, { recursive: true, mode: 0o700 });
}

export function loadElectronCredentials(): ElectronCredentials | null {
  try {
    const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { encrypted_token?: string; platform_url?: string };

    if (!parsed.encrypted_token || !parsed.platform_url) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;

    const decrypted = safeStorage.decryptString(Buffer.from(parsed.encrypted_token, 'base64'));
    return { agent_token: decrypted, platform_url: parsed.platform_url };
  } catch {
    return null;
  }
}

export function saveElectronCredentials(credentials: ElectronCredentials): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available on this system.');
  }

  const encrypted = safeStorage.encryptString(credentials.agent_token);
  const payload = {
    encrypted_token: encrypted.toString('base64'),
    platform_url: credentials.platform_url
  };

  ensureOvldDir();
  const tempFile = `${CREDENTIALS_FILE}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), { mode: FILE_MODE });
  fs.renameSync(tempFile, CREDENTIALS_FILE);
  fs.chmodSync(CREDENTIALS_FILE, FILE_MODE);
}

export function clearElectronCredentials(): void {
  try {
    fs.unlinkSync(CREDENTIALS_FILE);
  } catch {
    // Best-effort
  }
}
