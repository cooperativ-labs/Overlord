import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OVLD_DIR_MODE = 0o700;
const RUNTIME_FILE_MODE = 0o600;

export const LOCAL_SECRET_HEADER = 'x-overlord-local-secret';

type RuntimeMetadata = {
  platform_url: string;
  local_secret?: string;
  pid: number;
  started_at: string;
};

function getRuntimeDir(): string {
  return path.join(os.homedir(), '.ovld');
}

function getRuntimeFileKey(platformUrl: string): string {
  try {
    const parsed = new URL(platformUrl);
    const origin = parsed.origin.toLowerCase();
    const normalized = origin.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return normalized || 'unknown';
  } catch {
    return 'unknown';
  }
}

function getRuntimeFilePath(platformUrl: string): string {
  return path.join(getRuntimeDir(), `runtime.${getRuntimeFileKey(platformUrl)}.json`);
}

export function generateLocalSecret(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function writeLocalRuntime(platformUrl: string, localSecret?: string): void {
  const runtimeDir = getRuntimeDir();
  const runtimeFile = getRuntimeFilePath(platformUrl);
  const tempFile = `${runtimeFile}.tmp-${process.pid}-${Date.now()}`;

  const payload: RuntimeMetadata = {
    platform_url: platformUrl,
    pid: process.pid,
    started_at: new Date().toISOString()
  };
  if (localSecret) {
    payload.local_secret = localSecret;
  }

  fs.mkdirSync(runtimeDir, { recursive: true, mode: OVLD_DIR_MODE });
  fs.chmodSync(runtimeDir, OVLD_DIR_MODE);
  fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), { mode: RUNTIME_FILE_MODE });
  fs.renameSync(tempFile, runtimeFile);
  fs.chmodSync(runtimeFile, RUNTIME_FILE_MODE);
}

export function clearLocalRuntime(platformUrl: string): void {
  const runtimeFile = getRuntimeFilePath(platformUrl);

  try {
    const raw = fs.readFileSync(runtimeFile, 'utf8');
    const parsed = JSON.parse(raw) as Partial<RuntimeMetadata>;

    // Only remove files created for this running instance.
    if (parsed.pid !== process.pid) return;
  } catch {
    return;
  }

  try {
    fs.unlinkSync(runtimeFile);
  } catch {
    // Best-effort cleanup only.
  }
}
