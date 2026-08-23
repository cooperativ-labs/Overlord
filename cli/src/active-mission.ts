import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { resolveGlobalDataDir } from './config.js';

/**
 * Reverse lookup: which mission is this working directory on?
 *
 * Distinct from `session-key.ts` (keyed by cwd+mission, not reversible) and from
 * `active-objective-sessions.ts` (attribution bindings with session keys, no display title).
 * This pointer is what hooks and banners read locally instead of calling the
 * backend — written on attach/connect/resume-follow-up, then cleared only after
 * delivery's exact objective ledger has fully synchronized and finalized.
 */

export type ActiveMissionPointer = {
  missionId: string;
  displayId: string;
  title: string;
  updatedAt: string;
};

function pointerPath(workingDirectory: string): string {
  const key = createHash('sha256').update(path.resolve(workingDirectory)).digest('hex');
  return path.join(resolveGlobalDataDir(), 'active-mission', `${key}.json`);
}

/** Persist the mission currently attached in this working directory. */
export function writeActiveMissionPointer({
  workingDirectory,
  missionId,
  displayId,
  title
}: {
  workingDirectory: string;
  missionId: string;
  displayId: string;
  title?: string;
}): void {
  try {
    const trimmedMission = missionId.trim();
    const trimmedDisplay = displayId.trim();
    if (!trimmedMission || !trimmedDisplay) return;
    const filePath = pointerPath(workingDirectory);
    mkdirSync(path.dirname(filePath), { recursive: true });
    const payload: ActiveMissionPointer = {
      missionId: trimmedMission,
      displayId: trimmedDisplay,
      title: (title ?? '').trim(),
      updatedAt: new Date().toISOString()
    };
    writeFileSync(filePath, JSON.stringify(payload), { mode: 0o600 });
  } catch {
    // Best-effort: a missing pointer just means later surfaces fall back to
    // MISSION_ID / OVERLORD_MISSION_ID env, same as before this file existed.
  }
}

/** Read the active-mission pointer for a working directory, if present. */
export function readActiveMissionPointer(
  workingDirectory: string
): ActiveMissionPointer | undefined {
  try {
    const filePath = pointerPath(workingDirectory);
    if (!existsSync(filePath)) return undefined;
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<ActiveMissionPointer>;
    if (
      typeof raw.missionId !== 'string' ||
      !raw.missionId.trim() ||
      typeof raw.displayId !== 'string' ||
      !raw.displayId.trim()
    ) {
      return undefined;
    }
    return {
      missionId: raw.missionId.trim(),
      displayId: raw.displayId.trim(),
      title: typeof raw.title === 'string' ? raw.title.trim() : '',
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : ''
    };
  } catch {
    return undefined;
  }
}

/** Drop the pointer once the session ends so a stale banner cannot linger. */
export function clearActiveMissionPointer(workingDirectory: string): void {
  try {
    const filePath = pointerPath(workingDirectory);
    if (existsSync(filePath)) rmSync(filePath);
  } catch {
    // Best-effort.
  }
}
