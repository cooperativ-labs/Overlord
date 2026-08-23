import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';

const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_STALE_LOCK_MS = 30_000;
const LOCK_POLL_MS = 5;
const BOUNDED_READ_CHUNK_BYTES = 64 * 1024;

const sleepArray = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

function sleepSync(milliseconds: number): void {
  Atomics.wait(sleepArray, 0, 0, milliseconds);
}

/** Read at most maxBytes + 1 from an open descriptor; null means oversized/read failure. */
export function readBoundedUtf8FromDescriptor(
  fileDescriptor: number,
  maxBytes: number
): string | null {
  try {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (totalBytes <= maxBytes) {
      const remaining = maxBytes + 1 - totalBytes;
      const chunk = Buffer.allocUnsafe(Math.min(BOUNDED_READ_CHUNK_BYTES, remaining));
      const bytesRead = readSync(fileDescriptor, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      totalBytes += bytesRead;
    }
    if (totalBytes > maxBytes) return null;
    return Buffer.concat(chunks, totalBytes).toString('utf8');
  } catch {
    return null;
  }
}

/** Open, bounded-read, and always close one UTF-8 file. */
export function readBoundedUtf8File(filePath: string, maxBytes: number): string | null {
  let fileDescriptor: number | null = null;
  try {
    fileDescriptor = openSync(filePath, 'r');
    return readBoundedUtf8FromDescriptor(fileDescriptor, maxBytes);
  } catch {
    return null;
  } finally {
    if (fileDescriptor !== null) {
      try {
        closeSync(fileDescriptor);
      } catch {
        // Best-effort descriptor cleanup.
      }
    }
  }
}

export function canonicalDirectory(directory: string): string {
  const resolved = path.resolve(directory);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function ensureOwnerOnlyDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

export function writeOwnerOnlyFileAtomically(target: string, contents: string): void {
  ensureOwnerOnlyDirectory(path.dirname(target));
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, contents, { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, target);
    chmodSync(target, 0o600);
  } finally {
    try {
      if (existsSync(temporary)) unlinkSync(temporary);
    } catch {
      // A failed cleanup is harmless; the uniquely named temporary is never read.
    }
  }
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH is the only result that proves the process is gone. Sandboxes can
    // report EPERM/EACCES for a live sibling; treating an unfamiliar denial as
    // dead would let a contender reap a lock that is still being initialized.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function shouldRecoverLock(lockPath: string, staleAfterMs: number): boolean {
  try {
    const ageMs = Date.now() - statSync(lockPath).mtimeMs;
    let ownerPid: number | null = null;
    try {
      const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: unknown };
      ownerPid = typeof parsed.pid === 'number' ? parsed.pid : null;
    } catch {
      // A just-created lock may not have its owner payload yet. Only age can
      // establish that an unreadable lock is stale.
    }
    if (ownerPid !== null && !processIsAlive(ownerPid)) return true;
    return ageMs >= staleAfterMs && ownerPid === null;
  } catch (error) {
    // Missing means another owner released or recovered the lock. It is not a
    // stale target: unlinking after this check could delete a newly acquired
    // successor lock created in the gap.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function removeOwnedLock(lockPath: string, token: string): void {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as { token?: unknown };
    if (parsed.token === token) unlinkSync(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** Let only one contender reap a stale lock, so it cannot unlink a successor. */
function recoverStaleLock(lockPath: string, staleAfterMs: number): void {
  const recoveryPath = `${lockPath}.recovery`;
  const recoveryToken = randomUUID();
  let descriptor: number | null = null;
  let createdRecovery = false;
  try {
    descriptor = openSync(recoveryPath, 'wx', 0o600);
    createdRecovery = true;
    writeFileSync(
      descriptor,
      JSON.stringify({
        pid: process.pid,
        token: recoveryToken,
        createdAt: new Date().toISOString()
      })
    );
    closeSync(descriptor);
    descriptor = null;
  } catch (error) {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // Best-effort descriptor cleanup.
      }
    }
    if (createdRecovery) {
      try {
        unlinkSync(recoveryPath);
      } catch {
        // The failed create/write remains recoverable by age.
      }
    }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      if (shouldRecoverLock(recoveryPath, staleAfterMs)) {
        try {
          unlinkSync(recoveryPath);
        } catch {
          // Another contender may already have recovered it.
        }
      }
      return;
    }
    throw error;
  }

  try {
    if (shouldRecoverLock(lockPath, staleAfterMs)) {
      try {
        unlinkSync(lockPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  } finally {
    removeOwnedLock(recoveryPath, recoveryToken);
  }
}

export class LocalFileLockTimeoutError extends Error {
  constructor(lockPath: string) {
    super(`Timed out acquiring local state lock: ${lockPath}`);
    this.name = 'LocalFileLockTimeoutError';
  }
}

/**
 * Serialize a local read-modify-write transaction across processes.
 *
 * The lock is a sibling of the protected file, created with O_EXCL and owner-only
 * permissions. A lock owned by a dead process is recovered immediately; an old
 * unreadable lock is recovered after the stale threshold. A live owner is never
 * evicted merely for taking longer than expected.
 */
export function withLocalFileLock<T>(
  target: string,
  action: () => T,
  options: { timeoutMs?: number; staleAfterMs?: number } = {}
): T {
  ensureOwnerOnlyDirectory(path.dirname(target));
  const lockPath = `${target}.lock`;
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_LOCK_MS;
  let acquired = false;
  let ownerToken = '';

  while (!acquired) {
    let descriptor: number | null = null;
    let createdLock = false;
    const candidateToken = randomUUID();
    try {
      descriptor = openSync(lockPath, 'wx', 0o600);
      createdLock = true;
      writeFileSync(
        descriptor,
        JSON.stringify({
          pid: process.pid,
          token: candidateToken,
          createdAt: new Date().toISOString()
        })
      );
      closeSync(descriptor);
      descriptor = null;
      acquired = true;
      ownerToken = candidateToken;
    } catch (error) {
      if (descriptor !== null) {
        try {
          closeSync(descriptor);
        } catch {
          // Best-effort descriptor cleanup.
        }
      }
      if (createdLock) {
        try {
          unlinkSync(lockPath);
        } catch {
          // The incomplete lock is recoverable by age if cleanup fails.
        }
      }
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      recoverStaleLock(lockPath, staleAfterMs);
      if (Date.now() >= deadline) throw new LocalFileLockTimeoutError(lockPath);
      sleepSync(LOCK_POLL_MS);
    }
  }

  try {
    return action();
  } finally {
    removeOwnedLock(lockPath, ownerToken);
  }
}
