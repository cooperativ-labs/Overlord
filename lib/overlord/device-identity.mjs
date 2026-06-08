import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const CANONICAL_DEVICE_FILE = path.join(os.homedir(), '.ovld', 'device.json');

export function getLegacyDesktopDeviceFilePath(userDataPath) {
  return path.join(userDataPath, 'overlord-device.json');
}

function parseDeviceFingerprint(raw) {
  const parsed = JSON.parse(raw);
  return typeof parsed.deviceFingerprint === 'string' ? parsed.deviceFingerprint.trim() : '';
}

function serializeDeviceFingerprint(deviceFingerprint) {
  return `${JSON.stringify({ deviceFingerprint }, null, 2)}\n`;
}

function readDeviceFingerprintSync(filePath) {
  try {
    const fingerprint = parseDeviceFingerprint(fs.readFileSync(filePath, 'utf8'));
    return fingerprint || null;
  } catch {
    return null;
  }
}

async function readDeviceFingerprint(filePath) {
  try {
    const fingerprint = parseDeviceFingerprint(await fsp.readFile(filePath, 'utf8'));
    return fingerprint || null;
  } catch {
    return null;
  }
}

function writeCanonicalDeviceFingerprintSync(deviceFingerprint) {
  fs.mkdirSync(path.dirname(CANONICAL_DEVICE_FILE), { recursive: true });
  fs.writeFileSync(CANONICAL_DEVICE_FILE, serializeDeviceFingerprint(deviceFingerprint), 'utf8');
}

async function writeCanonicalDeviceFingerprint(deviceFingerprint) {
  await fsp.mkdir(path.dirname(CANONICAL_DEVICE_FILE), { recursive: true });
  await fsp.writeFile(CANONICAL_DEVICE_FILE, serializeDeviceFingerprint(deviceFingerprint), 'utf8');
}

export function readOrCreateCanonicalDeviceFingerprintSync({
  explicitFingerprint,
  legacyDesktopUserDataPath
} = {}) {
  const explicit = typeof explicitFingerprint === 'string' ? explicitFingerprint.trim() : '';
  if (explicit) return explicit;

  const canonical = readDeviceFingerprintSync(CANONICAL_DEVICE_FILE);
  if (canonical) return canonical;

  if (legacyDesktopUserDataPath) {
    const legacy = readDeviceFingerprintSync(getLegacyDesktopDeviceFilePath(legacyDesktopUserDataPath));
    if (legacy) {
      writeCanonicalDeviceFingerprintSync(legacy);
      return legacy;
    }
  }

  const deviceFingerprint = randomUUID();
  writeCanonicalDeviceFingerprintSync(deviceFingerprint);
  return deviceFingerprint;
}

export async function readOrCreateCanonicalDeviceFingerprint({
  legacyDesktopUserDataPath
} = {}) {
  const canonical = await readDeviceFingerprint(CANONICAL_DEVICE_FILE);
  if (canonical) return canonical;

  if (legacyDesktopUserDataPath) {
    const legacy = await readDeviceFingerprint(
      getLegacyDesktopDeviceFilePath(legacyDesktopUserDataPath)
    );
    if (legacy) {
      await writeCanonicalDeviceFingerprint(legacy);
      return legacy;
    }
  }

  const deviceFingerprint = randomUUID();
  await writeCanonicalDeviceFingerprint(deviceFingerprint);
  return deviceFingerprint;
}
