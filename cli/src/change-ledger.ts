import {
  CAPTURE_GAP_CODES,
  type CaptureBindingState,
  type FileChangeSource
} from '@overlord/contract';
import {
  isExactEvidencePath,
  isOverlordManagedEvidencePath,
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

/**
 * `declared_edit` is a successful native connector observation; `agent_declared`
 * is an explicit agent declaration (`--paths`/`--paths-file`) for shell/script
 * outputs, deletes, and renames that native capture cannot name.
 */
export type LedgerSource = FileChangeSource;

export type LedgerEvidence = {
  idempotencyKey: string;
  filePath: string;
  source: LedgerSource;
  observedAt: string;
  hookHealth?: string;
  syncedAt?: string;
};

export type ChangeLedgerHealth = { at: string; code: string };

/**
 * Local capture diagnostics for one session. `bindingState` is configuration
 * evidence recorded at attach (never proof a hook ran); `callbackObservedAt` is
 * the first accepted scoped callback, even a harmless read. `syncedFingerprint`
 * remembers the last diagnostics the backend accepted so unchanged state is not
 * resent on every drain.
 */
export type ChangeLedgerCapture = {
  bindingState: CaptureBindingState;
  callbackObservedAt?: string;
  syncedFingerprint?: string;
};

export type ChangeLedgerSnapshot = {
  evidence: LedgerEvidence[];
  health: ChangeLedgerHealth[];
  capture: ChangeLedgerCapture;
};

const LEDGER_SCHEMA_VERSION = 3;

type Ledger = {
  schemaVersion: typeof LEDGER_SCHEMA_VERSION;
  workingDirectory: string;
  objectiveId: string;
  sessionKeyHash: string;
  evidence: LedgerEvidence[];
  health: ChangeLedgerHealth[];
  capture: ChangeLedgerCapture;
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
const STICKY_HEALTH_CODES: ReadonlySet<string> = new Set(CAPTURE_GAP_CODES);

/**
 * Bound the rolling health list without losing a capture gap: when over the cap,
 * the oldest non-gap entries are evicted first, so "some activity was not
 * captured" survives any amount of later healthy or diagnostic churn.
 */
function boundHealth(health: ChangeLedgerHealth[]): ChangeLedgerHealth[] {
  let excess = health.length - MAX_HEALTH_ENTRIES;
  if (excess <= 0) return health;
  const kept = health.filter(entry => {
    if (excess > 0 && !STICKY_HEALTH_CODES.has(entry.code)) {
      excess -= 1;
      return false;
    }
    return true;
  });
  return kept.slice(-MAX_HEALTH_ENTRIES);
}
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
  'observedAt',
  'hookHealth',
  'syncedAt'
]);
const LEDGER_HEALTH_KEYS = new Set(['at', 'code']);
const LEDGER_CAPTURE_KEYS = new Set(['bindingState', 'callbackObservedAt', 'syncedFingerprint']);
const CAPTURE_BINDING_STATES: readonly CaptureBindingState[] = ['bound', 'unbound', 'unknown'];
/** Health attached to every agent declaration; matches the backend's declared-path health. */
export const AGENT_DECLARED_HEALTH = 'agent_declared';
/** Schema v2 marked `--paths` generator declarations with this health on `declared_edit` rows. */
const LEGACY_GENERATOR_DECLARATION_HEALTH = 'agent_declared_generator_output';
const LEGACY_WINDOW_DISCARDED_HEALTH = 'legacy_window_evidence_discarded';
const LEGACY_V2_EVIDENCE_KEYS = new Set([
  ...LEDGER_EVIDENCE_KEYS,
  'quality',
  'overlap',
  'toolWindowId'
]);

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
    schemaVersion: LEDGER_SCHEMA_VERSION,
    workingDirectory: canonicalDirectory(input.workingDirectory),
    objectiveId: canonicalObjectiveId(input.objectiveId),
    sessionKeyHash: sessionKeyHash(input.sessionKey),
    evidence: [],
    health: [],
    capture: { bindingState: 'unknown' }
  };
}

function readLedger(input: LedgerIdentity): Ledger | null {
  const expected = emptyLedger(input);
  const target = ledgerPath(input);
  try {
    if (!existsSync(target)) return expected;
    const raw = readBoundedUtf8File(target, MAX_LEDGER_FILE_BYTES);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<Omit<Ledger, 'schemaVersion'>> & {
      schemaVersion?: unknown;
    };
    if (
      value.workingDirectory !== expected.workingDirectory ||
      value.objectiveId !== expected.objectiveId ||
      value.sessionKeyHash !== expected.sessionKeyHash ||
      !Array.isArray(value.evidence) ||
      !Array.isArray(value.health)
    ) {
      return null;
    }
    const health = value.health.filter(isStoredHealth);
    if (value.schemaVersion === 2) {
      return upgradeSchemaV2Ledger({ expected, evidence: value.evidence, health });
    }
    if (value.schemaVersion !== LEDGER_SCHEMA_VERSION) return null;
    const capture = readStoredCapture(value.capture);
    if (!capture) return null;
    return {
      ...expected,
      evidence: value.evidence.filter(isStoredEvidence).slice(0, MAX_LEDGER_EVIDENCE),
      health: boundHealth(health),
      capture
    };
  } catch {
    return null;
  }
}

/**
 * One-time v2 -> v3 upgrade. Readers see the upgraded shape immediately and the
 * next locked mutation persists it, so pending rows keep their idempotency keys
 * and sync markers. Native rows stay native and the known generator marker
 * becomes `agent_declared`. Window rows were never native evidence: they are
 * dropped with a visible health code rather than promoted. Binding state was not
 * recorded by v2 and is therefore unknown.
 */
function upgradeSchemaV2Ledger({
  expected,
  evidence,
  health
}: {
  expected: Ledger;
  evidence: unknown[];
  health: ChangeLedgerHealth[];
}): Ledger {
  const upgraded: LedgerEvidence[] = [];
  let discardedWindowRows = 0;
  for (const value of evidence.slice(0, MAX_LEDGER_EVIDENCE)) {
    if (!isStoredV2Evidence(value)) continue;
    if (value.source !== 'declared_edit') {
      discardedWindowRows += 1;
      continue;
    }
    const declared = value.hookHealth === LEGACY_GENERATOR_DECLARATION_HEALTH;
    const hookHealth = declared ? AGENT_DECLARED_HEALTH : value.hookHealth;
    upgraded.push({
      idempotencyKey: value.idempotencyKey,
      filePath: value.filePath,
      source: declared ? 'agent_declared' : 'declared_edit',
      observedAt: value.observedAt,
      ...(hookHealth ? { hookHealth } : {}),
      ...(value.syncedAt ? { syncedAt: value.syncedAt } : {})
    });
  }
  const ledger: Ledger = { ...expected, evidence: upgraded, health: [...health] };
  if (discardedWindowRows > 0) {
    appendHealth(ledger, `${LEGACY_WINDOW_DISCARDED_HEALTH}:${discardedWindowRows}`);
  }
  ledger.health = boundHealth(ledger.health);
  return ledger;
}

type StoredV2Evidence = Omit<LedgerEvidence, 'source'> & {
  source: 'declared_edit' | 'window_observed';
};

function isStoredV2Evidence(value: unknown): value is StoredV2Evidence {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(key => !LEGACY_V2_EVIDENCE_KEYS.has(key))
  ) {
    return false;
  }
  const entry = value as Partial<Omit<LedgerEvidence, 'source'>> & { source?: unknown };
  return (
    (entry.source === 'declared_edit' || entry.source === 'window_observed') &&
    isStoredEvidence({
      idempotencyKey: entry.idempotencyKey,
      filePath: entry.filePath,
      source: 'declared_edit',
      observedAt: entry.observedAt,
      ...(entry.hookHealth !== undefined ? { hookHealth: entry.hookHealth } : {}),
      ...(entry.syncedAt !== undefined ? { syncedAt: entry.syncedAt } : {})
    })
  );
}

function readStoredCapture(value: unknown): ChangeLedgerCapture | null {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(key => !LEDGER_CAPTURE_KEYS.has(key))
  ) {
    return null;
  }
  const capture = value as Partial<ChangeLedgerCapture>;
  if (!CAPTURE_BINDING_STATES.includes(capture.bindingState as CaptureBindingState)) return null;
  if (
    capture.callbackObservedAt !== undefined &&
    !isCanonicalUtcTimestamp(capture.callbackObservedAt)
  ) {
    return null;
  }
  if (
    capture.syncedFingerprint !== undefined &&
    (typeof capture.syncedFingerprint !== 'string' || capture.syncedFingerprint.length > 128)
  ) {
    return null;
  }
  return {
    bindingState: capture.bindingState as CaptureBindingState,
    ...(capture.callbackObservedAt ? { callbackObservedAt: capture.callbackObservedAt } : {}),
    ...(capture.syncedFingerprint ? { syncedFingerprint: capture.syncedFingerprint } : {})
  };
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
    (entry.source === 'declared_edit' || entry.source === 'agent_declared') &&
    isCanonicalUtcTimestamp(entry.observedAt) &&
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
      ledger.health = boundHealth(ledger.health);
      writeLedger(normalized, ledger);
      return result;
    });
  } catch {
    // Change tracking is advisory. A local lock/write failure must not disrupt a tool call.
    return fallback;
  }
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
  if (isOverlordManagedEvidencePath(relative)) return { reason: 'ignored_path' };
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

type AppendResult = {
  appended: number;
  accepted: string[];
  rejected: Array<{ path: string; reason: string }>;
};

function appendEvidenceToLedger(
  ledger: Ledger,
  input: { filePaths: unknown[]; source: LedgerSource; hookHealth?: string }
): AppendResult {
  const result: AppendResult = { appended: 0, accepted: [], rejected: [] };
  const now = new Date().toISOString();
  if (input.source !== 'declared_edit' && input.source !== 'agent_declared') {
    appendHealth(ledger, 'invalid_evidence_source');
    return result;
  }
  const source = input.source;
  const hookHealth =
    typeof input.hookHealth === 'string' ? boundedHealthCode(input.hookHealth) : '';
  const root = ledger.workingDirectory;
  const ignore = loadIgnoreRules(root);
  if (ignore.unavailable) {
    appendHealth(ledger, 'ignore_policy_unavailable');
    for (const rawPath of input.filePaths.slice(0, MAX_PATHS_PER_APPEND)) {
      result.rejected.push({ path: String(rawPath), reason: 'ignore_policy_unavailable' });
    }
    return result;
  }
  if (input.filePaths.length > MAX_PATHS_PER_APPEND) {
    appendHealth(ledger, 'path_input_truncated');
  }
  const rejectedCounts = new Map<string, number>();
  const reject = (rawPath: unknown, reason: string): void => {
    rejectedCounts.set(reason, (rejectedCounts.get(reason) ?? 0) + 1);
    result.rejected.push({ path: typeof rawPath === 'string' ? rawPath : String(rawPath), reason });
  };
  let capacityReached = false;
  const seen = new Set(ledger.evidence.map(entry => `${entry.filePath}\0${entry.source}`));
  for (const rawPath of input.filePaths.slice(0, MAX_PATHS_PER_APPEND)) {
    if (typeof rawPath !== 'string') {
      reject(rawPath, 'invalid_path');
      continue;
    }
    const normalized = normalizeWorkspacePath({ root, rawPath, ignoreRules: ignore.rules });
    if ('reason' in normalized) {
      reject(rawPath, normalized.reason);
      continue;
    }
    const key = `${normalized.filePath}\0${source}`;
    if (seen.has(key)) {
      if (!result.accepted.includes(normalized.filePath)) {
        result.accepted.push(normalized.filePath);
      }
      continue;
    }
    if (ledger.evidence.length >= MAX_LEDGER_EVIDENCE) {
      capacityReached = true;
      reject(rawPath, 'ledger_capacity_reached');
      continue;
    }
    ledger.evidence.push({
      idempotencyKey: randomUUID(),
      filePath: normalized.filePath,
      source,
      observedAt: now,
      ...(hookHealth ? { hookHealth } : {})
    });
    seen.add(key);
    result.accepted.push(normalized.filePath);
    result.appended += 1;
  }
  if (hookHealth) appendHealth(ledger, hookHealth);
  if (capacityReached) appendHealth(ledger, 'ledger_capacity_reached');
  for (const [reason, count] of rejectedCounts) {
    if (reason !== 'ledger_capacity_reached') appendHealth(ledger, `${reason}:${count}`);
  }
  return result;
}

/** Append successful native edit paths (`declared_edit`); returns the number of new rows. */
export function appendChangeEvidence(
  input: LedgerIdentity & {
    filePaths: string[];
    source: LedgerSource;
    hookHealth?: string;
  }
): number {
  if (!Array.isArray(input.filePaths)) return 0;
  return mutateLedger(input, ledger => appendEvidenceToLedger(ledger, input).appended, 0);
}

export type DeclaredPathsResult = {
  /** Normalized repository-relative paths now declared (including repeats already in the ledger). */
  accepted: string[];
  rejected: Array<{ path: string; reason: string }>;
  /** False when local storage could not be read or written; nothing was recorded. */
  recorded: boolean;
};

/**
 * Record agent-declared paths (shell/script/generator outputs, deletes, both
 * rename endpoints) as `agent_declared`. Paths are normalized against the
 * session's canonical working directory with the same rules as native capture:
 * absent targets are valid, while traversal, out-of-root symlinks, ignored and
 * Overlord-managed paths are rejected with a reason. Never inspects VCS.
 */
export function declareChangePaths(
  input: LedgerIdentity & { filePaths: unknown[] }
): DeclaredPathsResult {
  const unrecorded: DeclaredPathsResult = { accepted: [], rejected: [], recorded: false };
  if (!Array.isArray(input.filePaths)) return unrecorded;
  return mutateLedger(
    input,
    ledger => {
      const result = appendEvidenceToLedger(ledger, {
        filePaths: input.filePaths,
        source: 'agent_declared',
        hookHealth: AGENT_DECLARED_HEALTH
      });
      return { accepted: result.accepted, rejected: result.rejected, recorded: true };
    },
    unrecorded
  );
}

/** Persist the binding declared at attach. Configuration evidence only; never proof a hook ran. */
export function recordChangeLedgerBinding(
  input: LedgerIdentity & { bindingState: CaptureBindingState }
): void {
  if (!CAPTURE_BINDING_STATES.includes(input.bindingState)) return;
  mutateLedger(
    input,
    ledger => {
      ledger.capture = { ...ledger.capture, bindingState: input.bindingState };
    },
    undefined
  );
}

/**
 * Record the first accepted scoped callback for this session, including a
 * harmless read. It is a separate fact from a successful native edit.
 */
export function recordChangeLedgerCallback(input: LedgerIdentity): void {
  if (readLedger(input)?.capture.callbackObservedAt) return;
  mutateLedger(
    input,
    ledger => {
      if (ledger.capture.callbackObservedAt) return;
      ledger.capture = { ...ledger.capture, callbackObservedAt: new Date().toISOString() };
    },
    undefined
  );
}

/** Bounded capture diagnostics in the `sync-changes --capture-json` shape. */
export function changeLedgerCapturePayload(snapshot: ChangeLedgerSnapshot): {
  bindingState: CaptureBindingState;
  callbackObservedAt?: string;
  health: Array<{ code: string; at: string }>;
} {
  return {
    bindingState: snapshot.capture.bindingState,
    ...(snapshot.capture.callbackObservedAt
      ? { callbackObservedAt: snapshot.capture.callbackObservedAt }
      : {}),
    health: snapshot.health.map(entry => ({ code: entry.code, at: entry.at }))
  };
}

export function changeLedgerCaptureFingerprint(snapshot: ChangeLedgerSnapshot): string {
  return createHash('sha256')
    .update(JSON.stringify(changeLedgerCapturePayload(snapshot)))
    .digest('hex');
}

/** Remember diagnostics the backend accepted, unless local state changed meanwhile. */
export function markChangeLedgerCaptureSynced(
  input: LedgerIdentity & { fingerprint: string }
): void {
  mutateLedger(
    input,
    ledger => {
      const current = changeLedgerCaptureFingerprint(ledger);
      if (current === input.fingerprint) {
        ledger.capture = { ...ledger.capture, syncedFingerprint: input.fingerprint };
      }
    },
    undefined,
    { requireExisting: true }
  );
}

/** Evidence, health and capture state of one ledger, or null when it cannot be read. */
export function readChangeLedgerSnapshot(input: LedgerIdentity): ChangeLedgerSnapshot | null {
  const objectiveId = canonicalObjectiveId(input.objectiveId);
  const sessionKey = typeof input.sessionKey === 'string' ? input.sessionKey.trim() : '';
  if (!objectiveId || !sessionKey) return null;
  const ledger = readLedger({ ...input, objectiveId, sessionKey });
  return ledger
    ? { evidence: ledger.evidence, health: ledger.health, capture: ledger.capture }
    : null;
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

/** Same path policy as durable declarations, for unavailable local storage. */
export function prepareDeclaredChangeEvidence(input: LedgerIdentity & { filePaths: string[] }) {
  const ledger = emptyLedger(input);
  const result = appendEvidenceToLedger(ledger, {
    filePaths: input.filePaths,
    source: 'agent_declared',
    hookHealth: AGENT_DECLARED_HEALTH
  });
  return { evidence: ledger.evidence, rejected: result.rejected };
}
