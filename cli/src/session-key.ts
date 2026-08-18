import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { resolveGlobalDataDir } from './config.js';

// Client-side cache of the protocol session key returned by `attach`. Every Bash
// tool call is a fresh shell, so a key captured at attach is otherwise gone by the
// next `ovld protocol` command unless the agent threads it through manually. The
// cache is scoped to (resolve(workingDirectory), missionId, objectiveId) so two
// objectives on the same mission cannot reuse each other's key. Mission-only
// reads retain the serial compatibility cache, but an objective-specific miss
// must never fall back to a sibling's mission-wide key.

function sessionKeyCachePath({
  missionId,
  workingDirectory,
  objectiveId
}: {
  missionId: string;
  workingDirectory: string;
  objectiveId?: string | null;
}): string {
  const resolved = path.resolve(workingDirectory);
  const material = objectiveId?.trim()
    ? `${resolved}\0${missionId}\0${objectiveId.trim()}`
    : `${resolved}\0${missionId}`;
  const key = createHash('sha256').update(material).digest('hex');
  return path.join(resolveGlobalDataDir(), 'protocol-session-keys', key);
}

function readSessionKeyFile(filePath: string): string | undefined {
  try {
    if (!existsSync(filePath)) return undefined;
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as { sessionKey?: unknown };
    return typeof raw.sessionKey === 'string' && raw.sessionKey.trim()
      ? raw.sessionKey.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

/** Cached session key for this (workingDir, mission[, objective]), or undefined when absent. */
export function readCachedSessionKey({
  missionId,
  workingDirectory,
  objectiveId
}: {
  missionId: string;
  workingDirectory: string;
  objectiveId?: string | null;
}): string | undefined {
  if (objectiveId?.trim()) {
    return readSessionKeyFile(sessionKeyCachePath({ missionId, workingDirectory, objectiveId }));
  }
  return readSessionKeyFile(sessionKeyCachePath({ missionId, workingDirectory }));
}

function writeSessionKeyFile({
  filePath,
  sessionKey
}: {
  filePath: string;
  sessionKey: string;
}): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify({ sessionKey, updatedAt: new Date().toISOString() }), {
    mode: 0o600
  });
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
  objectiveId?: string | null;
}): void {
  try {
    const trimmed = sessionKey.trim();
    if (!trimmed) return;
    writeSessionKeyFile({
      filePath: sessionKeyCachePath({ missionId, workingDirectory }),
      sessionKey: trimmed
    });
    if (objectiveId?.trim()) {
      writeSessionKeyFile({
        filePath: sessionKeyCachePath({ missionId, workingDirectory, objectiveId }),
        sessionKey: trimmed
      });
    }
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
        for (const name of readdirSync(cacheDir)) {
          const filePath = path.join(cacheDir, name);
          if (readSessionKeyFile(filePath) === trimmedSessionKey) files.add(filePath);
        }
      }
    } else {
      files.add(sessionKeyCachePath({ missionId, workingDirectory }));
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
