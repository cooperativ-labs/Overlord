import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';

import { resolveLatchBinaryPath } from './binary.ts';
import { latchChildEnvironment } from './environment.ts';

export const READ_LATCH_HOST_IDENTITY = 'readLatchHostIdentity';
const execFileAsync = promisify(execFile);

export type LatchHostIdentityInput = { sharedRootId?: string; sourceDirectory?: string };
export type LatchHostIdentityResult = { hostKeyDigest: string; verifiedSharedRootId?: string };

export function isLatchSharedRootId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function isLatchHostPublicKey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) && !/^0+$/.test(value);
}

export function latchHostKeyDigest(key: string): string {
  return createHash('sha256').update(Buffer.from(key, 'hex')).digest('hex');
}

/** Observe the owner CLI locally and return only bounded correlation metadata. */
export async function readLatchHostIdentity({
  sharedRootId,
  sourceDirectory
}: LatchHostIdentityInput = {}): Promise<LatchHostIdentityResult | null> {
  const binary = resolveLatchBinaryPath();
  if (!binary) return null;

  const read = async (command: string, maxBuffer: number) => {
    const { stdout } = await execFileAsync(binary, ['remote-access', command, '--json'], {
      env: latchChildEnvironment(),
      timeout: 5_000,
      maxBuffer
    });
    return JSON.parse(stdout);
  };

  try {
    const status = await read('status', 16_384);
    if (
      status?.formatVersion !== 2 ||
      status.enabled !== true ||
      !isLatchHostPublicKey(status.publicKey)
    )
      return null;
    const hostKeyDigest = latchHostKeyDigest(status.publicKey);
    if (sharedRootId === undefined) return { hostKeyDigest };
    if (!isLatchSharedRootId(sharedRootId) || !sourceDirectory || !isAbsolute(sourceDirectory))
      return null;

    const roots = await read('shared-roots', 1_048_576);
    if (!Array.isArray(roots)) return null;
    const matches = roots.filter(root => root?.rootId === sharedRootId);
    if (matches.length !== 1) return null;
    const [root] = matches;
    const path = await realpath(sourceDirectory);
    if (
      root.path !== path ||
      typeof root.deviceId !== 'string' ||
      !Number.isSafeInteger(root.grantRevision) ||
      root.grantRevision < 1
    )
      return null;
    const directory = await stat(path, { bigint: true });
    const identity = root.identity;
    if (
      !directory.isDirectory() ||
      !Number.isSafeInteger(identity?.device) ||
      !Number.isSafeInteger(identity?.inode) ||
      directory.dev !== BigInt(identity.device) ||
      directory.ino !== BigInt(identity.inode)
    )
      return null;
    if (identity.created !== null) {
      const { secs_since_epoch, nanos_since_epoch } = identity.created;
      if (
        !Number.isSafeInteger(secs_since_epoch) ||
        !Number.isSafeInteger(nanos_since_epoch) ||
        directory.birthtimeNs !==
          BigInt(secs_since_epoch) * 1_000_000_000n + BigInt(nanos_since_epoch)
      )
        return null;
    }
    const devices = await read('devices', 1_048_576);
    if (
      !Array.isArray(devices) ||
      !devices.some(
        device =>
          device?.deviceId === root.deviceId &&
          device.revoked === false &&
          device.permission === 'control' &&
          device.grantRevision === root.grantRevision
      )
    )
      return null;
    return { hostKeyDigest, verifiedSharedRootId: sharedRootId };
  } catch {
    return null;
  }
}
