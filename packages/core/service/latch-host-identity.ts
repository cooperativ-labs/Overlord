import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

import { resolveLatchBinaryPath } from './latch-binary.ts';
import { latchChildEnvironment } from './latch-environment.ts';

export const READ_LATCH_HOST_IDENTITY = 'readLatchHostIdentity';
const execFileAsync = promisify(execFile);

export function isLatchHostPublicKey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) && !/^0+$/.test(value);
}

export function latchHostKeyDigest(key: string): string {
  return createHash('sha256').update(Buffer.from(key, 'hex')).digest('hex');
}

/** Use only Latch's public Remote Link status. Pairings and private material stay on the host. */
export async function readLatchHostIdentity(): Promise<{ hostKeyDigest: string } | null> {
  const binary = resolveLatchBinaryPath();
  if (!binary) return null;

  try {
    const { stdout } = await execFileAsync(binary, ['remote-access', 'status', '--json'], {
      env: latchChildEnvironment(),
      timeout: 5_000,
      maxBuffer: 16_384
    });
    const status = JSON.parse(stdout);
    return status?.formatVersion === 2 &&
      status.enabled === true &&
      isLatchHostPublicKey(status.publicKey)
      ? { hostKeyDigest: latchHostKeyDigest(status.publicKey) }
      : null;
  } catch {
    return null;
  }
}
