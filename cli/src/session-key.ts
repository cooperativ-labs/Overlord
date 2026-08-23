import { createHash } from 'node:crypto';
import { existsSync, opendirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { resolveGlobalDataDir } from './config.js';
import {
  canonicalDirectory,
  ensureOwnerOnlyDirectory,
  readBoundedUtf8File,
  writeOwnerOnlyFileAtomically
} from './local-file-storage.js';

// Client-side cache of the protocol session key returned by `attach`. Every Bash
// tool call is a fresh shell, so a key captured at attach is otherwise gone by the
// next `ovld protocol` command unless the agent threads it through manually. The
// cache is scoped to (resolve(workingDirectory), missionId, objectiveId) so two
// objectives on the same mission cannot reuse each other's key. There is no
// mission-only cache: an objective identity or an explicit session key is required.

const MAX_SESSION_KEY_CACHE_FILE_BYTES = 4 * 1024;
const MAX_SESSION_KEY_CACHE_SCAN_ENTRIES = 4_096;

function sessionKeyCachePath({
  missionId,
  workingDirectory,
  objectiveId
}: {
  missionId: string;
  workingDirectory: string;
  objectiveId: string;
}): string {
  const resolved = canonicalDirectory(workingDirectory);
  const material = `${resolved}\0${missionId}\0${objectiveId.trim()}`;
  const key = createHash('sha256').update(material).digest('hex');
  return path.join(resolveGlobalDataDir(), 'protocol-session-keys', key);
}

function readSessionKeyFile(filePath: string): string | undefined {
  try {
    if (!existsSync(filePath)) return undefined;
    const contents = readBoundedUtf8File(filePath, MAX_SESSION_KEY_CACHE_FILE_BYTES);
    if (contents === null) return undefined;
    const raw = JSON.parse(contents) as { sessionKey?: unknown };
    return typeof raw.sessionKey === 'string' && raw.sessionKey.trim()
      ? raw.sessionKey.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

/** Cached session key for this exact (workingDir, mission, objective). */
export function readCachedSessionKey({
  missionId,
  workingDirectory,
  objectiveId
}: {
  missionId: string;
  workingDirectory: string;
  objectiveId: string;
}): string | undefined {
  if (!objectiveId.trim()) return undefined;
  return readSessionKeyFile(sessionKeyCachePath({ missionId, workingDirectory, objectiveId }));
}

function writeSessionKeyFile({
  filePath,
  sessionKey
}: {
  filePath: string;
  sessionKey: string;
}): void {
  ensureOwnerOnlyDirectory(path.dirname(filePath));
  const contents = JSON.stringify({ sessionKey, updatedAt: new Date().toISOString() });
  if (Buffer.byteLength(contents, 'utf8') > MAX_SESSION_KEY_CACHE_FILE_BYTES) return;
  writeOwnerOnlyFileAtomically(filePath, contents);
}

/** Persist the session key returned by attach/resume-follow-up for later reuse. */
export function writeCachedSessionKey({
  missionId,
  workingDirectory,
  sessionKey,
  objectiveId
}: {
  missionId: string;
  workingDirectory: string;
  sessionKey: string;
  objectiveId: string;
}): void {
  try {
    const trimmed = sessionKey.trim();
    if (!trimmed || !objectiveId.trim()) return;
    writeSessionKeyFile({
      filePath: sessionKeyCachePath({ missionId, workingDirectory, objectiveId }),
      sessionKey: trimmed
    });
  } catch {
    // Best-effort: a failed write just means the agent must pass --session-key
    // explicitly, the same as before this cache existed.
  }
}

/** Drop the cached key once the session ends so a stale key can't be reused. */
export function clearCachedSessionKey({
  missionId,
  workingDirectory,
  objectiveId,
  sessionKey
}: {
  missionId: string;
  workingDirectory: string;
  objectiveId?: string | null;
  /** When supplied, remove every UUID/display-id alias that stores this exact key. */
  sessionKey?: string | null;
}): void {
  try {
    const files = new Set<string>();
    const trimmedSessionKey = sessionKey?.trim();
    if (trimmedSessionKey) {
      const cacheDir = path.join(resolveGlobalDataDir(), 'protocol-session-keys');
      if (existsSync(cacheDir)) {
        const directory = opendirSync(cacheDir);
        let scanned = 0;
        let incomplete = false;
        try {
          while (true) {
            const entry = directory.readSync();
            if (!entry) break;
            if (scanned >= MAX_SESSION_KEY_CACHE_SCAN_ENTRIES) {
              incomplete = true;
              break;
            }
            scanned += 1;
            if (!entry.isFile() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
            const filePath = path.join(cacheDir, entry.name);
            if (readSessionKeyFile(filePath) === trimmedSessionKey) files.add(filePath);
          }
        } finally {
          directory.closeSync();
        }
        if (incomplete) {
          console.warn(
            `Warning: session-key alias cleanup stopped after ${MAX_SESSION_KEY_CACHE_SCAN_ENTRIES} cache entries; stale aliases may remain.`
          );
        }
      }
    } else {
      if (objectiveId?.trim()) {
        files.add(sessionKeyCachePath({ missionId, workingDirectory, objectiveId }));
      }
    }
    for (const filePath of files) {
      if (existsSync(filePath)) rmSync(filePath);
    }
  } catch {
    // Best-effort: a stale key at worst fails a downstream call with an invalid
    // session error, which the agent already handles by re-attaching.
  }
}
