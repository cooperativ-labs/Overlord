import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { removeChangeLedger, resetChangeLedger } from './change-ledger.js';
import { resolveGlobalDataDir } from './config.js';
import {
  canonicalDirectory,
  readBoundedUtf8File,
  withLocalFileLock,
  writeOwnerOnlyFileAtomically
} from './local-file-storage.js';

/**
 * Canonical objective/session bindings for native mutation callbacks.
 *
 * A callback must provide an objective identifier. The cwd is storage scope,
 * never selection logic: it is unsafe to guess between concurrent objectives
 * sharing a worktree.
 */
export type ActiveSessionEntry = {
  missionId: string;
  objectiveId: string;
  objectiveAliases: string[];
  sessionKey: string;
  attachedAt: string;
  deliveryPendingSync: boolean;
};

export type ResolvedSession = { missionId: string; objectiveId: string; sessionKey: string };

type ActiveSessionManifest = {
  schemaVersion: 3;
  workingDirectory: string;
  entries: ActiveSessionEntry[];
};

export const MAX_ACTIVE_OBJECTIVE_SESSION_BINDINGS = 64;
const MAX_OBJECTIVE_ALIASES = 16;
const MAX_ID_LENGTH = 200;
const MAX_ACTIVE_SESSION_MANIFEST_BYTES = 512 * 1024;

function normalizeIdentifier(value: string): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function manifestPath(workingDirectory: string): string {
  const key = createHash('sha256').update(canonicalDirectory(workingDirectory)).digest('hex');
  return path.join(resolveGlobalDataDir(), 'active-objective-sessions', `${key}.json`);
}

function emptyManifest(workingDirectory: string): ActiveSessionManifest {
  return {
    schemaVersion: 3,
    workingDirectory: canonicalDirectory(workingDirectory),
    entries: []
  };
}

function normalizeEntry(value: unknown): ActiveSessionEntry | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ActiveSessionEntry>;
  if (
    typeof candidate.missionId !== 'string' ||
    typeof candidate.objectiveId !== 'string' ||
    !Array.isArray(candidate.objectiveAliases) ||
    candidate.objectiveAliases.some(alias => typeof alias !== 'string') ||
    typeof candidate.sessionKey !== 'string' ||
    typeof candidate.attachedAt !== 'string' ||
    typeof candidate.deliveryPendingSync !== 'boolean'
  ) {
    return null;
  }

  const missionId = normalizeIdentifier(candidate.missionId);
  const objectiveId = normalizeIdentifier(candidate.objectiveId);
  const sessionKey = candidate.sessionKey.trim();
  const objectiveAliases = [
    ...new Set(
      candidate.objectiveAliases
        .slice(0, MAX_OBJECTIVE_ALIASES)
        .map(normalizeIdentifier)
        .filter(alias => isValidIdentifier(alias) && alias !== objectiveId)
    )
  ];
  const attachedAtMs = Date.parse(candidate.attachedAt);
  if (
    !isValidIdentifier(missionId) ||
    !isValidIdentifier(objectiveId) ||
    !isValidIdentifier(sessionKey) ||
    Number.isNaN(attachedAtMs)
  ) {
    return null;
  }

  return {
    missionId,
    objectiveId,
    objectiveAliases,
    sessionKey,
    attachedAt: candidate.attachedAt,
    deliveryPendingSync: candidate.deliveryPendingSync
  };
}

function readManifest(workingDirectory: string): ActiveSessionManifest | null {
  const expected = emptyManifest(workingDirectory);
  try {
    const target = manifestPath(workingDirectory);
    if (!existsSync(target)) return expected;
    const raw = readBoundedUtf8File(target, MAX_ACTIVE_SESSION_MANIFEST_BYTES);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<ActiveSessionManifest>;
    if (
      value.schemaVersion !== 3 ||
      value.workingDirectory !== expected.workingDirectory ||
      !Array.isArray(value.entries) ||
      value.entries.length > MAX_ACTIVE_OBJECTIVE_SESSION_BINDINGS
    ) {
      return null;
    }
    return {
      ...expected,
      entries: value.entries.flatMap(entry => {
        const normalized = normalizeEntry(entry);
        return normalized ? [normalized] : [];
      })
    };
  } catch {
    return null;
  }
}

function writeManifest(workingDirectory: string, entries: ActiveSessionEntry[]): void {
  const manifest = { ...emptyManifest(workingDirectory), entries };
  writeOwnerOnlyFileAtomically(manifestPath(workingDirectory), JSON.stringify(manifest));
}

function resolveEntry(
  entries: ActiveSessionEntry[],
  requestedObjectiveId: string
): ResolvedSession | null {
  const matching = entries.filter(
    entry => !entry.deliveryPendingSync && entryMatchesObjective(entry, requestedObjectiveId)
  );
  if (matching.length !== 1) return null;
  const [entry] = matching;
  return entry
    ? { missionId: entry.missionId, objectiveId: entry.objectiveId, sessionKey: entry.sessionKey }
    : null;
}

function entryMatchesObjective(entry: ActiveSessionEntry, requestedObjectiveId: string): boolean {
  return (
    entry.objectiveId === requestedObjectiveId ||
    entry.objectiveAliases.includes(requestedObjectiveId)
  );
}

/** Record or refresh a canonical objective/session binding. */
export function writeActiveSession({
  workingDirectory,
  missionId,
  objectiveId,
  objectiveAliases,
  sessionKey
}: {
  workingDirectory: string;
  missionId: string;
  objectiveId: string;
  objectiveAliases: string[];
  sessionKey: string;
}): boolean {
  const trimmedMission = normalizeIdentifier(missionId);
  const trimmedObjective = normalizeIdentifier(objectiveId);
  const trimmedKey = sessionKey.trim();
  if (
    !isValidIdentifier(trimmedMission) ||
    !isValidIdentifier(trimmedObjective) ||
    !isValidIdentifier(trimmedKey) ||
    !Array.isArray(objectiveAliases)
  ) {
    return false;
  }
  const normalizedAliases = [
    ...new Set(
      objectiveAliases
        .slice(0, MAX_OBJECTIVE_ALIASES)
        .filter((alias): alias is string => typeof alias === 'string')
        .map(normalizeIdentifier)
        .filter(alias => isValidIdentifier(alias) && alias !== trimmedObjective)
    )
  ];
  const target = manifestPath(workingDirectory);
  try {
    return withLocalFileLock(target, () => {
      const manifest = readManifest(workingDirectory);
      if (!manifest) return false;
      const current = manifest.entries;
      const prior = current.find(
        entry => entry.objectiveId === trimmedObjective && !entry.deliveryPendingSync
      );
      const entries = current.filter(
        entry => entry.objectiveId !== trimmedObjective || entry.deliveryPendingSync
      );
      if (prior && prior.sessionKey !== trimmedKey) {
        const removed = removeChangeLedger({
          workingDirectory,
          objectiveId: prior.objectiveId,
          sessionKey: prior.sessionKey
        });
        if (!removed) entries.push({ ...prior, deliveryPendingSync: true });
      }
      if (entries.length >= MAX_ACTIVE_OBJECTIVE_SESSION_BINDINGS) {
        if (prior && prior.sessionKey !== trimmedKey) writeManifest(workingDirectory, entries);
        return false;
      }
      const next = {
        missionId: trimmedMission,
        objectiveId: trimmedObjective,
        objectiveAliases: normalizedAliases,
        sessionKey: trimmedKey,
        attachedAt: new Date().toISOString(),
        deliveryPendingSync: false
      };
      if (prior?.sessionKey !== trimmedKey) {
        resetChangeLedger({
          workingDirectory,
          objectiveId: trimmedObjective,
          sessionKey: trimmedKey
        });
      }
      entries.push(next);
      writeManifest(workingDirectory, entries);
      return true;
    });
  } catch {
    // Local attribution state is advisory and must not interrupt attach.
    return false;
  }
}

/** Live strict-schema session bindings for this working directory. */
export function readActiveSessions(workingDirectory: string): ActiveSessionEntry[] {
  return readManifest(workingDirectory)?.entries ?? [];
}

/** Every exact stored binding for one explicitly addressed objective, including retry state. */
export function readObjectiveSessions({
  workingDirectory,
  objectiveId
}: {
  workingDirectory: string;
  objectiveId: string;
}): ActiveSessionEntry[] {
  const requested = normalizeIdentifier(objectiveId);
  if (!isValidIdentifier(requested)) return [];
  const entries = readManifest(workingDirectory)?.entries ?? [];
  const canonical = entries.filter(entry => entry.objectiveId === requested);
  if (canonical.length > 0) return canonical;
  const aliases = entries.filter(entry => entry.objectiveAliases.includes(requested));
  return new Set(aliases.map(entry => entry.objectiveId)).size === 1 ? aliases : [];
}

/**
 * Run a ledger mutation against an explicitly addressed active session while
 * retaining the manifest lock. Finalization uses the same manifest → ledger
 * lock order, so capture cannot append after its binding has been removed.
 */
export function withActiveObjectiveSession<T>({
  workingDirectory,
  objectiveId,
  fallback,
  action
}: {
  workingDirectory: string;
  objectiveId: string;
  fallback: T;
  action: (session: ResolvedSession) => T;
}): T {
  const requested = normalizeIdentifier(objectiveId);
  if (!isValidIdentifier(requested)) return fallback;
  const target = manifestPath(workingDirectory);
  try {
    return withLocalFileLock(target, () => {
      const manifest = readManifest(workingDirectory);
      if (!manifest) return fallback;
      const session = resolveEntry(manifest.entries, requested);
      return session ? action(session) : fallback;
    });
  } catch {
    return fallback;
  }
}

/**
 * Remove a delivered session only when its exact ledger is fully synchronized.
 * Unsynced evidence leaves both the ledger and binding intact for retry.
 */
export function finalizeActiveSession({
  workingDirectory,
  objectiveId,
  sessionKey
}: {
  workingDirectory: string;
  objectiveId: string;
  sessionKey: string;
}): boolean {
  const canonicalObjectiveId = normalizeIdentifier(objectiveId);
  const exactSessionKey = typeof sessionKey === 'string' ? sessionKey.trim() : '';
  if (!isValidIdentifier(canonicalObjectiveId) || !exactSessionKey) return false;
  const target = manifestPath(workingDirectory);
  try {
    return withLocalFileLock(target, () => {
      const manifest = readManifest(workingDirectory);
      if (
        !manifest ||
        !manifest.entries.some(
          entry =>
            entry.objectiveId === canonicalObjectiveId && entry.sessionKey === exactSessionKey
        )
      ) {
        return false;
      }
      if (
        !removeChangeLedger({
          workingDirectory,
          objectiveId: canonicalObjectiveId,
          sessionKey: exactSessionKey
        })
      ) {
        const entries = manifest.entries.map(entry =>
          entry.objectiveId === canonicalObjectiveId && entry.sessionKey === exactSessionKey
            ? { ...entry, deliveryPendingSync: true }
            : entry
        );
        if (entries.some((entry, index) => entry !== manifest.entries[index])) {
          writeManifest(workingDirectory, entries);
        }
        return false;
      }
      const remaining = manifest.entries.filter(
        entry => entry.objectiveId !== canonicalObjectiveId || entry.sessionKey !== exactSessionKey
      );
      if (remaining.length !== manifest.entries.length) {
        writeManifest(workingDirectory, remaining);
      }
      return true;
    });
  } catch {
    return false;
  }
}
