import {
  isExactEvidencePath,
  MAX_EVIDENCE_PATH_LENGTH
} from '@overlord/core/service/agent-session/pure/evidence-path';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, realpathSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import { resolveGlobalDataDir } from './config.js';
import {
  canonicalDirectory,
  readBoundedUtf8File,
  withLocalFileLock,
  writeOwnerOnlyFileAtomically
} from './local-file-storage.js';

export type LedgerSource = 'declared_edit' | 'window_observed';
export type LedgerQuality = 'direct' | 'window';

export type LedgerEvidence = {
  idempotencyKey: string;
  filePath: string;
  source: LedgerSource;
  quality: LedgerQuality;
  overlap: boolean;
  toolWindowId?: string;
  observedAt: string;
  hookHealth?: string;
  syncedAt?: string;
};

export type ChangeLedgerHealth = { at: string; code: string };

type Ledger = {
  schemaVersion: 2;
  workingDirectory: string;
  objectiveId: string;
  sessionKeyHash: string;
  evidence: LedgerEvidence[];
  health: ChangeLedgerHealth[];
};

type LedgerIdentity = {
  workingDirectory: string;
  objectiveId: string;
  sessionKey: string;
};

type IgnoreRule = { negated: boolean; regex: RegExp };

const MAX_PATHS_PER_APPEND = 512;
/** Hard bound for one objective/session ledger across arbitrarily long sessions. */
const MAX_LEDGER_EVIDENCE = 10_000;
const MAX_HEALTH_ENTRIES = 32;
const MAX_HEALTH_CODE_LENGTH = 160;
const MAX_IGNORE_FILE_BYTES = 64 * 1024;
const MAX_IGNORE_LINES = 512;
const MAX_IGNORE_RULES = 256;
const MAX_IGNORE_LINE_LENGTH = 2_000;
/** Includes 10k worst-case metadata rows while bounding corrupted local state reads. */
const MAX_LEDGER_FILE_BYTES = 32 * 1024 * 1024;
const LEDGER_EVIDENCE_KEYS = new Set([
  'idempotencyKey',
  'filePath',
  'source',
  'quality',
  'overlap',
  'toolWindowId',
  'observedAt',
  'hookHealth',
  'syncedAt'
]);
const LEDGER_HEALTH_KEYS = new Set(['at', 'code']);

function canonicalObjectiveId(objectiveId: string): string {
  return typeof objectiveId === 'string' ? objectiveId.trim() : '';
}

function ledgerPath(input: LedgerIdentity): string {
  const material = `${canonicalDirectory(input.workingDirectory)}\0${canonicalObjectiveId(input.objectiveId)}\0${input.sessionKey.trim()}`;
  const key = createHash('sha256').update(material).digest('hex');
  return path.join(resolveGlobalDataDir(), 'change-ledgers', `${key}.json`);
}

function sessionKeyHash(sessionKey: string): string {
  return createHash('sha256').update(sessionKey.trim()).digest('hex');
}

function emptyLedger(input: LedgerIdentity): Ledger {
  return {
    schemaVersion: 2,
    workingDirectory: canonicalDirectory(input.workingDirectory),
    objectiveId: canonicalObjectiveId(input.objectiveId),
    sessionKeyHash: sessionKeyHash(input.sessionKey),
    evidence: [],
    health: []
  };
}

function readLedger(input: LedgerIdentity): Ledger | null {
  const expected = emptyLedger(input);
  const target = ledgerPath(input);
  try {
    if (!existsSync(target)) return expected;
    const raw = readBoundedUtf8File(target, MAX_LEDGER_FILE_BYTES);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<Ledger>;
    if (
      value.schemaVersion !== 2 ||
      value.workingDirectory !== expected.workingDirectory ||
      value.objectiveId !== expected.objectiveId ||
      value.sessionKeyHash !== expected.sessionKeyHash ||
      !Array.isArray(value.evidence) ||
      !Array.isArray(value.health)
    ) {
      return null;
    }
    return {
      ...expected,
      evidence: value.evidence.filter(isStoredEvidence).slice(0, MAX_LEDGER_EVIDENCE),
      health: value.health.filter(isStoredHealth).slice(-MAX_HEALTH_ENTRIES)
    };
  } catch {
    return null;
  }
}

function isStoredEvidence(value: unknown): value is LedgerEvidence {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(key => !LEDGER_EVIDENCE_KEYS.has(key))
  ) {
    return false;
  }
  const entry = value as Partial<LedgerEvidence>;
  return (
    typeof entry.idempotencyKey === 'string' &&
    boundedOpaqueIdentifier(entry.idempotencyKey) === entry.idempotencyKey &&
    isExactEvidencePath(entry.filePath) &&
    ['declared_edit', 'window_observed'].includes(String(entry.source)) &&
    ['direct', 'window'].includes(String(entry.quality)) &&
    ((entry.source === 'declared_edit' && entry.quality === 'direct') ||
      (entry.source === 'window_observed' && entry.quality === 'window')) &&
    typeof entry.overlap === 'boolean' &&
    isCanonicalUtcTimestamp(entry.observedAt) &&
    (entry.toolWindowId === undefined ||
      (typeof entry.toolWindowId === 'string' &&
        boundedOpaqueIdentifier(entry.toolWindowId) === entry.toolWindowId)) &&
    (entry.hookHealth === undefined ||
      (typeof entry.hookHealth === 'string' &&
        boundedHealthCode(entry.hookHealth) === entry.hookHealth)) &&
    (entry.syncedAt === undefined || isCanonicalUtcTimestamp(entry.syncedAt))
  );
}

function isStoredHealth(value: unknown): value is ChangeLedgerHealth {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(key => !LEDGER_HEALTH_KEYS.has(key))
  ) {
    return false;
  }
  const entry = value as Partial<ChangeLedgerHealth>;
  return (
    isCanonicalUtcTimestamp(entry.at) &&
    typeof entry.code === 'string' &&
    entry.code.length > 0 &&
    boundedHealthCode(entry.code) === entry.code
  );
}

function writeLedger(input: LedgerIdentity, ledger: Ledger): void {
  writeOwnerOnlyFileAtomically(ledgerPath(input), JSON.stringify(ledger));
}

function mutateLedger<T>(
  input: LedgerIdentity,
  mutation: (ledger: Ledger) => T,
  fallback: T,
  options: { requireExisting?: boolean } = {}
): T {
  const objectiveId = canonicalObjectiveId(input.objectiveId);
  const sessionKey = typeof input.sessionKey === 'string' ? input.sessionKey.trim() : '';
  if (!objectiveId || !sessionKey) return fallback;
  const normalized = { ...input, objectiveId, sessionKey };
  const target = ledgerPath(normalized);
  try {
    return withLocalFileLock(target, () => {
      if (options.requireExisting && !existsSync(target)) return fallback;
      const ledger = readLedger(normalized);
      if (!ledger) return fallback;
      const result = mutation(ledger);
      ledger.health = ledger.health.slice(-MAX_HEALTH_ENTRIES);
      writeLedger(normalized, ledger);
      return result;
    });
  } catch {
    // Change tracking is advisory. A local lock/write failure must not disrupt a tool call.
    return fallback;
  }
}

function qualityForSource(source: LedgerSource): LedgerQuality {
  if (source === 'declared_edit') return 'direct';
  return 'window';
}

function boundedHealthCode(code: string): string {
  const trimmed = code.trim();
  if (!/^[a-z0-9][a-z0-9_.:-]*$/i.test(trimmed)) return 'invalid_health_code';
  return trimmed.slice(0, MAX_HEALTH_CODE_LENGTH);
}

function boundedOpaqueIdentifier(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!/^[a-z0-9][a-z0-9_.:-]*$/i.test(trimmed)) return '';
  return trimmed.slice(0, 200);
}

function isCanonicalUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 24) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function appendHealth(ledger: Ledger, code: string): void {
  const bounded = boundedHealthCode(code);
  if (!bounded) return;
  ledger.health = ledger.health.filter(entry => entry.code !== bounded);
  ledger.health.push({ at: new Date().toISOString(), code: bounded });
}

function ignoreGlobToRegExp(glob: string): string {
  let output = '';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index] ?? '';
    if (character === '*') {
      if (glob[index + 1] === '*') {
        index += 1;
        if (glob[index + 1] === '/') {
          index += 1;
          output += '(.*/)?';
        } else {
          output += '.*';
        }
      } else {
        output += '[^/]*';
      }
    } else if (character === '?') {
      output += '[^/]';
    } else {
      output += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return output;
}

function compileIgnorePattern(rawPattern: string): IgnoreRule | null {
  let pattern = rawPattern;
  let negated = false;
  if (pattern.startsWith('!')) {
    negated = true;
    pattern = pattern.slice(1);
  }
  if (pattern.startsWith('\\#') || pattern.startsWith('\\!')) pattern = pattern.slice(1);
  const directoryOnly = pattern.endsWith('/');
  if (directoryOnly) pattern = pattern.slice(0, -1);
  if (!pattern) return null;
  const anchored = pattern.includes('/');
  if (pattern.startsWith('/')) pattern = pattern.slice(1);
  if (!pattern) return null;
  const prefix = anchored ? '^' : '(^|/)';
  const suffix = directoryOnly ? '/.*$' : '(/.*)?$';
  try {
    return {
      negated,
      regex: new RegExp(`${prefix}${ignoreGlobToRegExp(pattern)}${suffix}`)
    };
  } catch {
    return null;
  }
}

function loadIgnoreRules(root: string): { rules: IgnoreRule[]; unavailable: boolean } {
  const target = path.join(root, '.overlordignore');
  if (!existsSync(target)) return { rules: [], unavailable: false };
  const contents = readBoundedUtf8File(target, MAX_IGNORE_FILE_BYTES);
  if (contents === null) return { rules: [], unavailable: true };
  const lines = contents.split('\n');
  if (lines.length > MAX_IGNORE_LINES || lines.some(line => line.length > MAX_IGNORE_LINE_LENGTH)) {
    return { rules: [], unavailable: true };
  }
  const rules: IgnoreRule[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const rule = compileIgnorePattern(line);
    if (!rule) continue;
    rules.push(rule);
    if (rules.length > MAX_IGNORE_RULES) return { rules: [], unavailable: true };
  }
  return { rules, unavailable: false };
}

function isIgnoredPath(rules: IgnoreRule[], relativePath: string): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.regex.test(relativePath)) ignored = !rule.negated;
  }
  return ignored;
}

function canonicalCandidate(absolutePath: string): string {
  let existing = absolutePath;
  const suffix: string[] = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return path.resolve(absolutePath);
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  try {
    return path.resolve(realpathSync(existing), ...suffix);
  } catch {
    return path.resolve(absolutePath);
  }
}

function normalizeWorkspacePath({
  root,
  rawPath,
  ignoreRules
}: {
  root: string;
  rawPath: string;
  ignoreRules: IgnoreRule[];
}): { filePath: string } | { reason: string } {
  const trimmed = rawPath.trim();
  if (trimmed !== rawPath) return { reason: 'invalid_path' };
  if (!trimmed || trimmed.includes('\0')) return { reason: 'invalid_path' };
  if (path.sep === '/' && trimmed.includes('\\')) return { reason: 'invalid_path' };
  if (trimmed.length > root.length + MAX_EVIDENCE_PATH_LENGTH + 2) {
    return { reason: 'path_too_long' };
  }
  let candidate: string;
  try {
    candidate = canonicalCandidate(
      path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(root, trimmed)
    );
  } catch {
    return { reason: 'invalid_path' };
  }
  const relative = path.relative(root, candidate).replace(/\\/g, '/');
  if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
    return { reason: 'outside_workspace_path' };
  }
  if (relative.length > MAX_EVIDENCE_PATH_LENGTH) return { reason: 'path_too_long' };
  if (!isExactEvidencePath(relative)) return { reason: 'invalid_path' };
  if (isIgnoredPath(ignoreRules, relative)) return { reason: 'ignored_path' };
  return { filePath: relative };
}

export function resetChangeLedger(input: LedgerIdentity): void {
  const objectiveId = canonicalObjectiveId(input.objectiveId);
  const sessionKey = typeof input.sessionKey === 'string' ? input.sessionKey.trim() : '';
  if (!objectiveId || !sessionKey) return;
  const normalized = { ...input, objectiveId, sessionKey };
  try {
    withLocalFileLock(ledgerPath(normalized), () =>
      writeLedger(normalized, emptyLedger(normalized))
    );
  } catch {
    // Advisory local state; attach must continue when storage is unavailable.
  }
}

export function appendChangeEvidence(
  input: LedgerIdentity & {
    filePaths: string[];
    source: LedgerSource;
    quality?: LedgerQuality;
    overlap?: boolean;
    toolWindowId?: string;
    hookHealth?: string;
  }
): number {
  if (!Array.isArray(input.filePaths)) return 0;
  return mutateLedger(
    input,
    ledger => {
      const now = new Date().toISOString();
      if (input.source !== 'declared_edit' && input.source !== 'window_observed') {
        appendHealth(ledger, 'invalid_evidence_source');
        return 0;
      }
      const source = input.source;
      const expectedQuality = qualityForSource(source);
      if (input.quality !== undefined && input.quality !== expectedQuality) {
        appendHealth(ledger, 'source_quality_mismatch');
        return 0;
      }
      const quality = input.quality ?? expectedQuality;
      const toolWindowId = boundedOpaqueIdentifier(input.toolWindowId);
      const hookHealth =
        typeof input.hookHealth === 'string' ? boundedHealthCode(input.hookHealth) : '';
      const root = ledger.workingDirectory;
      const ignore = loadIgnoreRules(root);
      if (ignore.unavailable) {
        appendHealth(ledger, 'ignore_policy_unavailable');
        return 0;
      }
      if (input.filePaths.length > MAX_PATHS_PER_APPEND) {
        appendHealth(ledger, 'path_input_truncated');
      }
      const rejected = new Map<string, number>();
      let capacityReached = false;
      const seen = new Set(ledger.evidence.map(entry => `${entry.filePath}\0${entry.source}`));
      let appended = 0;
      for (const rawPath of input.filePaths.slice(0, MAX_PATHS_PER_APPEND)) {
        if (typeof rawPath !== 'string') {
          rejected.set('invalid_path', (rejected.get('invalid_path') ?? 0) + 1);
          continue;
        }
        const normalized = normalizeWorkspacePath({ root, rawPath, ignoreRules: ignore.rules });
        if ('reason' in normalized) {
          rejected.set(normalized.reason, (rejected.get(normalized.reason) ?? 0) + 1);
          continue;
        }
        if (seen.has(`${normalized.filePath}\0${source}`)) continue;
        if (ledger.evidence.length >= MAX_LEDGER_EVIDENCE) {
          capacityReached = true;
          continue;
        }
        ledger.evidence.push({
          idempotencyKey: randomUUID(),
          filePath: normalized.filePath,
          source,
          quality,
          overlap: input.overlap === true,
          ...(toolWindowId ? { toolWindowId } : {}),
          observedAt: now,
          ...(hookHealth ? { hookHealth } : {})
        });
        seen.add(`${normalized.filePath}\0${source}`);
        appended += 1;
      }
      if (hookHealth) appendHealth(ledger, hookHealth);
      if (capacityReached) appendHealth(ledger, 'ledger_capacity_reached');
      for (const [reason, count] of rejected) appendHealth(ledger, `${reason}:${count}`);
      return appended;
    },
    0
  );
}

export function recordChangeLedgerHealth(input: LedgerIdentity & { code: string }): void {
  mutateLedger(input, ledger => appendHealth(ledger, input.code), undefined);
}

export function readChangeLedgerHealth(input: LedgerIdentity): ChangeLedgerHealth[] {
  return readLedger(input)?.health ?? [];
}

export function readChangeLedgerEvidence(input: LedgerIdentity): LedgerEvidence[] {
  return readLedger(input)?.evidence ?? [];
}

export function readUnsyncedChangeEvidence(input: LedgerIdentity): LedgerEvidence[] {
  return readChangeLedgerEvidence(input).filter(entry => !entry.syncedAt);
}

export function markChangeEvidenceSynced(
  input: LedgerIdentity & {
    evidence: Array<Pick<LedgerEvidence, 'idempotencyKey' | 'filePath'>>;
  }
): void {
  mutateLedger(
    input,
    ledger => {
      const accepted = new Set(
        input.evidence.map(entry => `${entry.idempotencyKey}\0${entry.filePath}`)
      );
      const now = new Date().toISOString();
      ledger.evidence = ledger.evidence.map(entry =>
        accepted.has(`${entry.idempotencyKey}\0${entry.filePath}`)
          ? { ...entry, syncedAt: now }
          : entry
      );
    },
    undefined,
    { requireExisting: true }
  );
}

/**
 * Delete a completed ledger only when no unsynchronized evidence remains.
 * The check and unlink share the ledger mutation lock, so an append that wins
 * the race is preserved for a later sync instead of being discarded.
 */
export function removeChangeLedger(input: LedgerIdentity): boolean {
  const objectiveId = canonicalObjectiveId(input.objectiveId);
  const sessionKey = typeof input.sessionKey === 'string' ? input.sessionKey.trim() : '';
  if (!objectiveId || !sessionKey) return false;
  const normalized = { ...input, objectiveId, sessionKey };
  const target = ledgerPath(normalized);
  try {
    return withLocalFileLock(target, () => {
      if (!existsSync(target)) return true;
      const ledger = readLedger(normalized);
      if (!ledger) return false;
      if (ledger.evidence.some(entry => !entry.syncedAt)) return false;
      unlinkSync(target);
      return true;
    });
  } catch {
    return false;
  }
}
