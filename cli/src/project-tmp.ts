import {
  type Dirent,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';

import { canonicalDirectory } from './local-file-storage.js';

export const PROJECT_TMP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Retention for `sessions/<id>/` scratch directories that no live session owns.
 * This window applies to old scratch directories without a harness marker.
 */
export const PROJECT_TMP_SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;
export const PROJECT_TMP_SESSIONS_DIRNAME = 'sessions';
const HARNESS_SCRATCH_MARKER = '.overlord-harness-scratch';

export function projectTmpDir(workingDirectory: string): string {
  return path.join(workingDirectory, '.overlord', 'tmp');
}

export function projectTmpSessionsDir(workingDirectory: string): string {
  return path.join(projectTmpDir(workingDirectory), PROJECT_TMP_SESSIONS_DIRNAME);
}

/**
 * Shared temp root for harnesses that ignore `TMPDIR` and read their own variable
 * (Claude Code reads only `CLAUDE_CODE_TMPDIR`). Kept at a short, stable path rather
 * than a per-launch `sessions/<id>/` directory because the harness binds Unix sockets
 * beneath it.
 */
export const PROJECT_TMP_HARNESS_DIRNAME = 'harness';

/**
 * Claude Code binds `<CLAUDE_CODE_TMPDIR>/cc-socks/<pid>.sock`. Unix socket paths are
 * capped at 104 bytes on macOS (108 on Linux); past that Claude starts without its
 * messaging socket. Reserve room for a 7-digit pid and the terminating NUL.
 */
const UNIX_SOCKET_PATH_MAX_BYTES = 104;
const CLAUDE_SOCKET_SUFFIX_BYTES = Buffer.byteLength('/cc-socks/1234567.sock') + 1;

export function projectHarnessTmpDir(workingDirectory: string): string {
  return path.join(projectTmpDir(workingDirectory), PROJECT_TMP_HARNESS_DIRNAME);
}

/**
 * The `CLAUDE_CODE_TMPDIR` value for a checkout, or null when the checkout path is
 * so deep that Claude's messaging socket would not fit (Claude then keeps its default).
 */
export function claudeCodeTmpDir(workingDirectory: string): string | null {
  const dir = projectHarnessTmpDir(workingDirectory);
  return Buffer.byteLength(dir) + CLAUDE_SOCKET_SUFFIX_BYTES <= UNIX_SOCKET_PATH_MAX_BYTES
    ? dir
    : null;
}

/** Create the private (0700) harness temp root Claude Code requires. */
export function ensureHarnessTmpDir(workingDirectory: string): void {
  const dir = claudeCodeTmpDir(workingDirectory);
  if (!dir) return;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function safeTmpNamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Directory name for one launch's private scratch space:
 * `<objective-or-mission slug>-<execution request id | pid>`.
 */
export function sessionScratchName({
  missionDisplayId,
  objectiveDisplayId,
  executionRequestId
}: {
  missionDisplayId: string;
  objectiveDisplayId?: string | null;
  executionRequestId?: string | null;
}): string {
  const identity = objectiveDisplayId?.trim()
    ? `objective-${safeTmpNamePart(objectiveDisplayId)}`
    : `mission-${safeTmpNamePart(missionDisplayId)}`;
  const request = executionRequestId?.trim()
    ? safeTmpNamePart(executionRequestId)
    : `${process.pid}`;
  return `${identity || 'launch'}-${request || 'launch'}`;
}

/** True when `candidate` is a direct child of `<cwd>/.overlord/tmp/sessions/`. */
export function isSessionScratchDir(workingDirectory: string, candidate: string): boolean {
  const resolved = path.resolve(candidate);
  const candidateCheckout = path.resolve(resolved, '../../../..');
  return (
    path.dirname(resolved) === projectTmpSessionsDir(candidateCheckout) &&
    canonicalDirectory(candidateCheckout) === canonicalDirectory(workingDirectory)
  );
}

/** Keep the exported scratch path valid across protocol sessions in one harness. */
export function ensureHarnessScratchDir(workingDirectory: string, scratchDir: string): void {
  if (!isSessionScratchDir(workingDirectory, scratchDir)) return;
  mkdirSync(scratchDir, { recursive: true, mode: 0o700 });
  if (!lstatSync(scratchDir).isDirectory()) return;
  try {
    writeFileSync(path.join(scratchDir, HARNESS_SCRATCH_MARKER), '', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

export function removeLaunchBriefing(workingDirectory: string, contextFile: string | null): void {
  if (!contextFile) return;
  const resolved = path.resolve(contextFile);
  if (path.dirname(resolved) !== path.resolve(projectTmpDir(workingDirectory))) return;
  if (!resolved.endsWith('.md')) return;
  try {
    unlinkSync(resolved);
  } catch {
    // Best-effort cleanup only.
  }
}

export function ensureProjectTmpDir(workingDirectory: string): string {
  const tmpDir = projectTmpDir(workingDirectory);
  mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

/** Decides whether a `sessions/<name>` directory belongs to a live session. */
export type SessionLivenessCheck = (sessionDirName: string) => boolean;

export function pruneStaleProjectTmp({
  workingDirectory,
  create = false,
  now = Date.now(),
  retentionMs = PROJECT_TMP_RETENTION_MS,
  sessionRetentionMs = PROJECT_TMP_SESSION_RETENTION_MS,
  isSessionLive = () => false
}: {
  workingDirectory: string;
  create?: boolean;
  now?: number;
  retentionMs?: number;
  sessionRetentionMs?: number;
  isSessionLive?: SessionLivenessCheck;
}): void {
  const tmpDir = projectTmpDir(workingDirectory);
  if (!create && !existsSync(tmpDir)) return;
  if (create) ensureProjectTmpDir(workingDirectory);
  const cutoff = now - retentionMs;
  pruneChildren(tmpDir, cutoff, {
    sessionsDir: projectTmpSessionsDir(workingDirectory),
    sessionCutoff: now - sessionRetentionMs,
    fileCutoff: cutoff,
    isSessionLive
  });
}

export function pruneProjectTmpContents(
  workingDirectory: string,
  {
    isSessionLive = () => false,
    force = false
  }: { isSessionLive?: SessionLivenessCheck; force?: boolean } = {}
): {
  warned: boolean;
  removedCount: number;
  /** Live session scratch directories left in place (pass `force` to remove). */
  skippedCount: number;
} {
  const overlordDir = path.join(workingDirectory, '.overlord');
  if (!existsSync(overlordDir)) {
    return { warned: true, removedCount: 0, skippedCount: 0 };
  }

  const tmpDir = projectTmpDir(workingDirectory);
  if (!existsSync(tmpDir)) {
    return { warned: false, removedCount: 0, skippedCount: 0 };
  }

  let removedCount = 0;
  let skippedCount = 0;
  const entries = readdirSync(tmpDir, { withFileTypes: true, encoding: 'utf8' });
  for (const entry of entries) {
    const target = path.join(tmpDir, entry.name);
    if (entry.name === PROJECT_TMP_HARNESS_DIRNAME && entry.isDirectory() && !force) {
      // Shared by every running Claude Code session in this checkout (scratchpads,
      // task output, messaging sockets), so only files past retention are removed.
      pruneChildren(target, Date.now() - PROJECT_TMP_RETENTION_MS);
      continue;
    }
    if (entry.name === PROJECT_TMP_SESSIONS_DIRNAME && entry.isDirectory() && !force) {
      for (const session of readdirSync(target, { withFileTypes: true, encoding: 'utf8' })) {
        if (session.isDirectory() && isSessionLive(session.name)) {
          skippedCount += 1;
          continue;
        }
        removeEntry(path.join(target, session.name), session.isSymbolicLink());
        removedCount += 1;
      }
      continue;
    }
    removeEntry(target, entry.isSymbolicLink());
    removedCount += 1;
  }
  return { warned: false, removedCount, skippedCount };
}

function removeEntry(target: string, isSymbolicLink: boolean): void {
  if (isSymbolicLink) {
    unlinkSync(target);
    return;
  }
  rmSync(target, { recursive: true, force: true });
}

type SessionPruneOptions = {
  sessionsDir: string;
  sessionCutoff: number;
  fileCutoff: number;
  isSessionLive: SessionLivenessCheck;
};

function pruneSessionDirs(sessionsDir: string, options: SessionPruneOptions): void {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(sessionsDir, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return;
  }
  for (const entry of entries) {
    const target = path.join(sessionsDir, entry.name);
    if (entry.isDirectory() && options.isSessionLive(entry.name)) continue;
    try {
      if (entry.isDirectory() && existsSync(path.join(target, HARNESS_SCRATCH_MARKER))) {
        // A delivered protocol session can leave an open harness indefinitely.
        // Age out files, while preserving the directory exported to its shell.
        pruneChildren(target, options.fileCutoff, undefined, HARNESS_SCRATCH_MARKER);
        continue;
      }
      const stats = lstatSync(target);
      if (stats.mtimeMs > options.sessionCutoff) continue;
      removeEntry(target, stats.isSymbolicLink());
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function pruneChildren(
  directory: string,
  cutoff: number,
  sessions?: SessionPruneOptions,
  preservedEntry?: string
): void {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(directory, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name === preservedEntry) continue;
    const target = path.join(directory, entry.name);
    if (sessions && entry.isDirectory() && target === sessions.sessionsDir) {
      // Session scratch is owned per launch: live ones are kept regardless of
      // age, orphaned ones expire on the shorter session window.
      pruneSessionDirs(target, sessions);
      continue;
    }
    // `Dirent.isDirectory()` is false for symlinks, so a link to a directory is
    // pruned as a leaf (the link itself, never its target).
    if (entry.isDirectory()) {
      pruneDirectory(target, cutoff);
      continue;
    }
    pruneLeaf(target, cutoff);
  }
}

function pruneDirectory(directory: string, cutoff: number): void {
  pruneChildren(directory, cutoff);

  try {
    const stats = lstatSync(directory);
    if (stats.mtimeMs > cutoff) return;
  } catch {
    return;
  }

  try {
    if (readdirSync(directory).length === 0) {
      rmSync(directory, { recursive: true, force: true });
    }
  } catch {
    // Best-effort cleanup only.
  }
}

function pruneLeaf(target: string, cutoff: number): void {
  try {
    // lstat: a dangling symlink must be judged (and removed) by the link's own
    // mtime. statSync follows the link, throws ENOENT, and the entry is skipped
    // forever.
    const stats = lstatSync(target);
    if (stats.mtimeMs > cutoff) return;
    // A socket's mtime is its bind time, so age says nothing about whether a
    // long-running harness still listens on it.
    if (stats.isSocket()) return;
    if (stats.isSymbolicLink()) {
      // `rmSync({ recursive, force })` resolves the link first; on a dangling
      // link that is ENOENT, which `force` swallows, leaving the link in place.
      unlinkSync(target);
      return;
    }
    rmSync(target, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup only.
  }
}
