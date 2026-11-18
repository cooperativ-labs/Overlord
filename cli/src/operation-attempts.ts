import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';

import { resolveGlobalDataDir } from './config.js';
import { CliError } from './errors.js';

/**
 * Client retry identity for finalizations (coo:1297.hk2v R4, contract ADR 0075).
 *
 * The logical attempt owns the operation id, not the request text. Before a
 * `deliver` or `record-work` request is sent, the CLI persists an owner-only
 * attempt record: the id, the operation kind, a digest of the semantic request
 * and a digest of the addressed scope. It never stores the request body, the
 * session key or a token. Re-running the same command after a timeout or a
 * restart finds the pending record and retries with the same id; the server
 * then replays its durable receipt instead of finalizing twice.
 *
 * - `--operation-id <id>`: a caller-retained id, used as given.
 * - `--retry-operation <id>`: resume that recorded attempt; a different request is refused.
 * - `--new-operation`: start a new attempt (intentionally identical record-work).
 *
 * The CLI never mints a new id for a retry. When the record cannot be saved,
 * record-work requires an explicit `--operation-id`; deliver proceeds with a
 * warning because the server still refuses a second finalization of a session.
 * `publish-delivery-summary` (ADR 0076) uses the same attempt boundary; the
 * server allows one successful publication per delivery, so an unsaved id
 * only loses the replay of a lost response, never adds a second publication.
 */

export type AttemptKind = 'deliver' | 'record_work' | 'publish_summary';

const KIND_LABEL: Record<AttemptKind, string> = {
  deliver: 'deliver',
  record_work: 'record-work',
  publish_summary: 'publish-delivery-summary'
};

export type AttemptRecord = {
  version: 1;
  operationId: string;
  kind: AttemptKind;
  requestDigest: string;
  scopeDigest: string;
  status: 'pending' | 'accepted';
  createdAt: string;
  updatedAt: string;
  deliveryId?: string;
  missionId?: string;
};

export type PreparedAttempt = {
  /** The id sent to the backend, or null when the request goes without one. */
  operationId: string | null;
  kind: AttemptKind;
  /** Whether a local record backs this attempt (it can be resumed after restart). */
  persisted: boolean;
};

const OPERATION_FLAGS = ['--operation-id', '--retry-operation', '--new-operation'] as const;
const ATTEMPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Flags whose values never enter the request digest (secrets and retry controls). */
const DIGEST_EXCLUDED_FLAGS = new Set<string>(['--session-key', ...OPERATION_FLAGS]);

export function attemptKindFor(subcommand: string): AttemptKind | null {
  if (subcommand === 'deliver') return 'deliver';
  if (subcommand === 'record-work') return 'record_work';
  if (subcommand === 'publish-delivery-summary') return 'publish_summary';
  return null;
}

export function attemptsDirectory(): string {
  return path.join(resolveGlobalDataDir(), 'operation-attempts');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .filter(key => (value as Record<string, unknown>)[key] !== undefined)
        .map(key => [key, canonical((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

/** Digest of what the caller asked for; excludes secrets and retry controls. */
export function attemptRequestDigest({
  kind,
  flags,
  fileInputs,
  positional
}: {
  kind: AttemptKind;
  flags: Record<string, string | true>;
  fileInputs: Record<string, string>;
  positional: string[];
}): string {
  const semanticFlags = Object.fromEntries(
    Object.entries(flags).filter(([flag]) => !DIGEST_EXCLUDED_FLAGS.has(flag))
  );
  return `v1:${sha256(JSON.stringify(canonical({ kind, flags: semanticFlags, fileInputs, positional })))}`;
}

/** Digest of where the request goes: backend, mission/project and the session (hashed). */
export function attemptScopeDigest({
  backendUrl,
  kind,
  flags
}: {
  backendUrl: string;
  kind: AttemptKind;
  flags: Record<string, string | true>;
}): string {
  const value = (flag: string) => (typeof flags[flag] === 'string' ? flags[flag] : null);
  return `v1:${sha256(
    JSON.stringify([
      backendUrl,
      kind,
      value('--mission-id'),
      value('--objective-id'),
      value('--project-id'),
      value('--session-key') ? sha256(value('--session-key') as string) : null,
      // Publication addresses one delivery; older kinds keep their digest.
      ...(kind === 'publish_summary' ? [value('--delivery-id'), value('--publication-id')] : [])
    ])
  )}`;
}

function recordPath(operationId: string): string {
  return path.join(attemptsDirectory(), `${sha256(operationId).slice(0, 32)}.json`);
}

function ensureDirectory(): void {
  const dir = attemptsDirectory();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

export function readAttempt(operationId: string): AttemptRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(recordPath(operationId), 'utf8')) as AttemptRecord;
    return parsed.version === 1 && parsed.operationId === operationId ? parsed : null;
  } catch {
    return null;
  }
}

/** Atomic, owner-only write. Throws when the attempt store is unavailable. */
export function writeAttempt(record: AttemptRecord): void {
  ensureDirectory();
  const target = recordPath(record.operationId);
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, target);
}

function removeAttempt(operationId: string): void {
  try {
    rmSync(recordPath(operationId), { force: true });
  } catch {
    // Best effort: a stale record only makes a later identical retry reuse a dead id.
  }
}

function listAttempts(): AttemptRecord[] {
  const dir = attemptsDirectory();
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const records: AttemptRecord[] = [];
  const cutoff = Date.now() - ATTEMPT_RETENTION_MS;
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const file = path.join(dir, entry);
    try {
      if (statSync(file).mtimeMs < cutoff) {
        rmSync(file, { force: true });
        continue;
      }
      const record = JSON.parse(readFileSync(file, 'utf8')) as AttemptRecord;
      if (record.version === 1) records.push(record);
    } catch {
      // Ignore unreadable entries; they never match a digest.
    }
  }
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** A caller-retained `operationId` inside the `--payload-json|--payload-file` envelope. */
function envelopeOperationId(
  flags: Record<string, string | true>,
  fileInputs: Record<string, string>
): string | null {
  const raw =
    typeof flags['--payload-json'] === 'string'
      ? flags['--payload-json']
      : fileInputs['--payload-file'];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { operationId?: unknown };
    return typeof parsed.operationId === 'string' && parsed.operationId ? parsed.operationId : null;
  } catch {
    return null;
  }
}

function newOperationId(kind: AttemptKind): string {
  const prefix = kind === 'deliver' ? 'dlv' : kind === 'record_work' ? 'rw' : 'pub';
  return `ovld-${prefix}-${randomUUID()}`;
}

function warn(message: string): void {
  process.stderr.write(`[overlord] ${message}\n`);
}

/**
 * Choose and persist the operation id before the request is sent, and put it in
 * `flags['--operation-id']`. Removes the CLI-only retry controls from `flags`.
 */
export function prepareOperationAttempt({
  kind,
  flags,
  fileInputs,
  positional,
  backendUrl
}: {
  kind: AttemptKind;
  flags: Record<string, string | true>;
  fileInputs: Record<string, string>;
  positional: string[];
  backendUrl: string;
}): PreparedAttempt {
  // `--new-operation` is boolean; the generic parser may have taken a following
  // positional argument as its value. Give it back.
  const newFlag = flags['--new-operation'];
  if (typeof newFlag === 'string') {
    positional.push(newFlag);
    flags['--new-operation'] = true;
  }
  const explicit =
    typeof flags['--operation-id'] === 'string'
      ? flags['--operation-id']
      : envelopeOperationId(flags, fileInputs);
  const retry = typeof flags['--retry-operation'] === 'string' ? flags['--retry-operation'] : null;
  const fresh = flags['--new-operation'] === true;
  if ([explicit, retry, fresh ? true : null].filter(Boolean).length > 1) {
    throw new CliError({
      message: 'Use only one of --operation-id, --retry-operation and --new-operation.'
    });
  }
  if (flags['--retry-operation'] === true || flags['--operation-id'] === true) {
    throw new CliError({ message: '--operation-id and --retry-operation need an id value.' });
  }
  delete flags['--retry-operation'];
  delete flags['--new-operation'];

  const requestDigest = attemptRequestDigest({ kind, flags, fileInputs, positional });
  const scopeDigest = attemptScopeDigest({ backendUrl, kind, flags });
  const now = new Date().toISOString();
  const pending = (operationId: string): AttemptRecord => ({
    version: 1,
    operationId,
    kind,
    requestDigest,
    scopeDigest,
    status: 'pending',
    createdAt: now,
    updatedAt: now
  });
  const tryPersist = (record: AttemptRecord): boolean => {
    try {
      writeAttempt(record);
      return true;
    } catch (error) {
      warn(
        `Could not save the ${KIND_LABEL[kind]} attempt in ${attemptsDirectory()}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  };
  const chosen = (operationId: string, persisted: boolean): PreparedAttempt => {
    flags['--operation-id'] = operationId;
    return { operationId, kind, persisted };
  };

  if (retry) {
    const record = readAttempt(retry);
    if (!record || record.kind !== kind) {
      throw new CliError({
        message:
          `No saved ${KIND_LABEL[kind]} attempt ${retry} on this machine. ` +
          `If you retained the id yourself, pass --operation-id ${retry} with the original request.`
      });
    }
    if (record.requestDigest !== requestDigest || record.scopeDigest !== scopeDigest) {
      throw new CliError({
        message:
          `Attempt ${retry} was made with a different request or target. Re-send the original ` +
          'request to retry it, or use --new-operation for separate work.'
      });
    }
    return chosen(retry, true);
  }

  if (explicit) {
    const persisted = readAttempt(explicit) !== null || tryPersist(pending(explicit));
    return chosen(explicit, persisted);
  }

  if (!fresh) {
    const match = listAttempts().find(
      record =>
        record.kind === kind &&
        record.requestDigest === requestDigest &&
        record.scopeDigest === scopeDigest
    );
    if (match?.status === 'pending') {
      warn(`Retrying unconfirmed attempt ${match.operationId} with the same operation id.`);
      return chosen(match.operationId, true);
    }
    if (match?.status === 'accepted') {
      if (kind !== 'record_work') return chosen(match.operationId, true);
      throw new CliError({
        message:
          `An identical record-work was already accepted as attempt ${match.operationId}` +
          `${match.missionId ? ` (mission ${match.missionId})` : ''}. ` +
          `Use --retry-operation ${match.operationId} to get its result again, or --new-operation to record separate work.`
      });
    }
  }

  const operationId = newOperationId(kind);
  if (tryPersist(pending(operationId))) return chosen(operationId, true);
  if (kind === 'record_work') {
    throw new CliError({
      message:
        'record-work needs a saved attempt or a caller-retained id to be safe to retry. ' +
        'Pass --operation-id <id> that you keep and reuse for retries of this work.'
    });
  }
  if (kind === 'publish_summary') {
    warn(
      `Publishing with unsaved operation id ${operationId}: keep it to retry a lost response; the server accepts only one publication per delivery.`
    );
    return chosen(operationId, false);
  }
  warn(
    'Delivering without a retry identity: a lost response cannot be replayed, but the server still refuses a second delivery of this session.'
  );
  return { operationId: null, kind, persisted: false };
}

/** Mark a persisted attempt accepted after a successful response. */
export function markAttemptAccepted(attempt: PreparedAttempt, result: unknown): void {
  if (!attempt.persisted || !attempt.operationId) return;
  const record = readAttempt(attempt.operationId);
  if (!record) return;
  const value = (result ?? {}) as Record<string, unknown>;
  const mission = value.mission as Record<string, unknown> | undefined;
  try {
    writeAttempt({
      ...record,
      status: 'accepted',
      updatedAt: new Date().toISOString(),
      ...(typeof value.deliveryId === 'string' ? { deliveryId: value.deliveryId } : {}),
      ...(mission && typeof mission.displayId === 'string' ? { missionId: mission.displayId } : {})
    });
  } catch {
    // The server receipt stays authoritative; a later identical retry still replays.
  }
}

/**
 * After a failure: a definite HTTP 4xx answer means nothing was accepted under
 * this attempt, so its pending record is dropped. Anything else (no response,
 * a 5xx, a gateway timeout) may have committed; keep the record and say how to
 * retry safely.
 */
export function settleFailedAttempt(attempt: PreparedAttempt, error: unknown): void {
  if (!attempt.operationId) return;
  const status = error instanceof CliError ? error.status : undefined;
  const code =
    error instanceof CliError && error.payload && typeof error.payload === 'object'
      ? (error.payload as { code?: unknown }).code
      : undefined;
  const definitive = status !== undefined && status >= 400 && status < 500;
  if (definitive) {
    const record = attempt.persisted ? readAttempt(attempt.operationId) : null;
    if (
      record?.status === 'pending' &&
      code !== 'delivery_operation_conflict' &&
      code !== 'mission_summary_already_published'
    ) {
      removeAttempt(attempt.operationId);
    }
    return;
  }
  warn(
    `The outcome of attempt ${attempt.operationId} is unknown. Re-run the same command ` +
      `(or add --retry-operation ${attempt.operationId}) to retry it safely; do not start a new operation.`
  );
}

export const OPERATION_ATTEMPT_FLAGS = OPERATION_FLAGS;
