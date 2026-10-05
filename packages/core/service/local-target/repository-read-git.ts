// Target-side bodies for the agent-facing repository reads (contract v152,
// coo:1108.zg8m): structured Git status, bounded UTF-8 file reads, and literal
// text search. The resource-addressed diff lives beside them in
// `current-diff-git.ts`. Everything here is read-only: Git runs through the
// hardened inspection runner, files are read with `fs`, nothing is fetched,
// checked out, built, or locked.

import { closeSync, openSync, readSync, realpathSync } from 'node:fs';

import { neutralizedFilterArgs, runInspectionGit } from './git-run.ts';
import {
  isSensitiveRepositoryPath,
  resolveContainedRepositoryPath,
  statOrNull
} from './repository-paths.ts';
import type {
  GitStatusData,
  GitStatusEntry,
  LocalTargetErrorCode,
  ReadGitStatusInput,
  ReadRepositoryFileInput,
  RepositoryFileData,
  RepositoryReadTargetValue,
  RepositorySearchData,
  RepositorySearchHit,
  SearchRepositoryTextInput
} from './types.ts';

/** Contracted defaults (`REPOSITORY_READ_DEFAULT_BOUNDS` in `@overlord/contract`). */
export const REPOSITORY_READ_TARGET_BOUNDS = {
  commandTimeoutMs: 20_000,
  readFileBytes: 64 * 1024,
  readFileCeilingBytes: 8 * 1024 * 1024,
  diffBytes: 128 * 1024,
  searchBytes: 128 * 1024,
  searchHits: 100,
  searchLineChars: 400,
  searchQueryChars: 256,
  statusEntriesPerClass: 1000,
  statusOutputBytes: 2 * 1024 * 1024,
  diffPaths: 50
} as const;

/** Clamp an optional caller bound to `(0, ceiling]`, defaulting to `fallback`. */
export function clampBound(value: unknown, fallback: number, ceiling = fallback): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), ceiling);
}

export type RepositoryReadFailure = { ok: false; code: LocalTargetErrorCode; message: string };

export interface RepositoryRootInfo {
  ok: true;
  realRoot: string;
  isGitRepository: boolean;
  head: string | null;
  branch: string | null;
  /** The resource root's path inside its repository (`rev-parse --show-prefix`), `''` at the top. */
  prefix: string;
  /** Filter-driver overrides for commands that read worktree content. */
  filterArgs: string[];
}

/** A deadline shared by every Git call one read makes. */
export class ReadDeadline {
  readonly #endsAt: number;
  constructor(
    budgetMs: number,
    readonly signal?: AbortSignal
  ) {
    this.#endsAt = Date.now() + budgetMs;
  }
  remaining(): number {
    return Math.max(1, this.#endsAt - Date.now());
  }
}

async function gitLine(
  root: string,
  args: string[],
  deadline: ReadDeadline
): Promise<string | null> {
  const result = await runInspectionGit({
    cwd: root,
    args,
    timeoutMs: deadline.remaining(),
    maxBytes: 4096,
    signal: deadline.signal
  });
  if (result.exitCode !== 0) return null;
  const value = result.stdout.toString('utf8').trim();
  return value.length > 0 ? value : null;
}

/**
 * Resolve the resource root on this machine and read HEAD and branch. A
 * missing directory is `RESOURCE_MISSING`; a directory that is not a Git
 * checkout is reported (some reads still work on plain directories).
 */
export async function inspectRepositoryRoot(
  repoPath: string,
  deadline: ReadDeadline
): Promise<RepositoryRootInfo | RepositoryReadFailure> {
  let realRoot: string;
  try {
    realRoot = realpathSync(repoPath);
  } catch {
    return {
      ok: false,
      code: 'RESOURCE_MISSING',
      message: 'The resource directory is not present on this execution target.'
    };
  }
  if (!statOrNull(realRoot)?.isDirectory()) {
    return {
      ok: false,
      code: 'RESOURCE_MISSING',
      message: 'The resource path is not a directory.'
    };
  }
  const inside = await gitLine(realRoot, ['rev-parse', '--is-inside-work-tree'], deadline);
  if (inside !== 'true') {
    return {
      ok: true,
      realRoot,
      isGitRepository: false,
      head: null,
      branch: null,
      prefix: '',
      filterArgs: []
    };
  }
  const [head, branch, prefix] = await Promise.all([
    gitLine(realRoot, ['rev-parse', '--verify', '--quiet', 'HEAD'], deadline),
    gitLine(realRoot, ['branch', '--show-current'], deadline),
    gitLine(realRoot, ['rev-parse', '--show-prefix'], deadline)
  ]);
  return {
    ok: true,
    realRoot,
    isGitRepository: true,
    head,
    branch,
    prefix: prefix ?? '',
    filterArgs: neutralizedFilterArgs(realRoot)
  };
}

function value<T>(
  root: Pick<RepositoryRootInfo, 'head' | 'branch'>,
  data: T,
  extra: Partial<RepositoryReadTargetValue<T>> = {}
): RepositoryReadTargetValue<T> {
  return {
    outcome: 'ok',
    head: root.head,
    branch: root.branch,
    observedAt: new Date().toISOString(),
    truncated: false,
    data,
    ...extra
  };
}

function interrupted<T>(
  root: Pick<RepositoryRootInfo, 'head' | 'branch'>,
  data: T,
  run: { timedOut: boolean; aborted: boolean }
): RepositoryReadTargetValue<T> | null {
  if (!run.timedOut && !run.aborted) return null;
  return value(root, data, {
    outcome: 'timeout',
    message: run.aborted ? 'The read was cancelled.' : 'The read timed out on the target.'
  });
}

// ---- git status ---------------------------------------------------------------

function parseStatusV2(
  output: Buffer,
  limit: number,
  prefix: string
): { data: GitStatusData; truncated: boolean } {
  // Porcelain paths are relative to the repository top; report them relative
  // to the resource root, which may be a subdirectory.
  const local = (p: string) =>
    prefix && p.startsWith(prefix) ? p.slice(prefix.length) || './' : p;
  const data: GitStatusData = {
    branch: null,
    head: null,
    upstream: null,
    ahead: null,
    behind: null,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: []
  };
  let truncated = false;
  const push = <T>(list: T[], item: T) => {
    if (list.length < limit) list.push(item);
    else truncated = true;
  };
  const records = output.toString('utf8').split('\0');
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]!;
    if (!record) continue;
    if (record.startsWith('# ')) {
      const [, key, ...rest] = record.split(' ');
      const val = rest.join(' ');
      if (key === 'branch.oid') data.head = val === '(initial)' ? null : val;
      else if (key === 'branch.head') data.branch = val === '(detached)' ? null : val;
      else if (key === 'branch.upstream') data.upstream = val;
      else if (key === 'branch.ab') {
        const match = /^\+(\d+) -(\d+)$/.exec(val);
        if (match) {
          data.ahead = Number(match[1]);
          data.behind = Number(match[2]);
        }
      }
      continue;
    }
    const kind = record[0];
    if (kind === '?') {
      push(data.untracked, local(record.slice(2)));
      continue;
    }
    if (kind !== '1' && kind !== '2' && kind !== 'u') continue;
    // Porcelain v2 fixed fields precede the path: 8 for `1`, 9 for `2`, 10 for `u`.
    const fixed = kind === '1' ? 8 : kind === '2' ? 9 : 10;
    const fields = record.split(' ');
    const xy = fields[1] ?? '..';
    const filePath = local(fields.slice(fixed).join(' '));
    let originalPath: string | null = null;
    if (kind === '2') {
      originalPath = records[i + 1] ? local(records[i + 1]!) : null;
      i += 1;
    }
    const entry: GitStatusEntry = {
      path: filePath,
      originalPath,
      index: xy[0] ?? '.',
      worktree: xy[1] ?? '.'
    };
    if (kind === 'u') {
      push(data.conflicted, entry);
      continue;
    }
    if (entry.index !== '.') push(data.staged, entry);
    if (entry.worktree !== '.') push(data.unstaged, entry);
  }
  return { data, truncated };
}

export async function readGitStatusGit(
  input: ReadGitStatusInput,
  signal?: AbortSignal
): Promise<RepositoryReadTargetValue<GitStatusData | null> | RepositoryReadFailure> {
  const deadline = new ReadDeadline(REPOSITORY_READ_TARGET_BOUNDS.commandTimeoutMs, signal);
  const root = await inspectRepositoryRoot(input.repoPath, deadline);
  if (!root.ok) return root;
  if (!root.isGitRepository) {
    return {
      ok: false,
      code: 'NOT_GIT_REPOSITORY',
      message: 'The resource is not a Git checkout.'
    };
  }
  const limit = clampBound(
    input.maxEntriesPerClass,
    REPOSITORY_READ_TARGET_BOUNDS.statusEntriesPerClass
  );
  const run = await runInspectionGit({
    cwd: root.realRoot,
    args: [
      'status',
      '--porcelain=v2',
      '--branch',
      '-z',
      '--untracked-files=normal',
      '--ignore-submodules=all',
      '--',
      '.'
    ],
    timeoutMs: deadline.remaining(),
    maxBytes: REPOSITORY_READ_TARGET_BOUNDS.statusOutputBytes,
    signal,
    filterArgs: root.filterArgs
  });
  const stopped = interrupted(root, null, run);
  if (stopped) return stopped;
  if (run.exitCode !== 0 && !run.truncated) {
    return { ok: false, code: 'GIT_COMMAND_FAILED', message: 'git status failed on the target.' };
  }
  const parsed = parseStatusV2(run.stdout, limit, root.prefix);
  return value(
    { head: parsed.data.head ?? root.head, branch: parsed.data.branch ?? root.branch },
    parsed.data,
    { truncated: parsed.truncated || run.truncated }
  );
}

// ---- read file -----------------------------------------------------------------

/** Cut `text` to at most `maxBytes` UTF-8 bytes without splitting a code point. */
export function cutUtf8(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) return text;
  let end = maxBytes;
  // Step back over continuation bytes (10xxxxxx) to a code-point boundary.
  while (end > 0 && (buffer[end]! & 0xc0) === 0x80) end -= 1;
  return buffer.subarray(0, end).toString('utf8');
}

function readPrefix(absolutePath: string, bytes: number): Buffer {
  const fd = openSync(absolutePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    let offset = 0;
    while (offset < bytes) {
      const read = readSync(fd, buffer, offset, bytes - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    return buffer.subarray(0, offset);
  } finally {
    closeSync(fd);
  }
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export async function readRepositoryFileGit(
  input: ReadRepositoryFileInput,
  signal?: AbortSignal
): Promise<RepositoryReadTargetValue<RepositoryFileData | null> | RepositoryReadFailure> {
  const deadline = new ReadDeadline(REPOSITORY_READ_TARGET_BOUNDS.commandTimeoutMs, signal);
  const root = await inspectRepositoryRoot(input.repoPath, deadline);
  if (!root.ok) return root;
  if (typeof input.relativePath !== 'string' || input.relativePath.trim() === '') {
    return value(root, null, { outcome: 'denied', message: 'A file path is required.' });
  }
  const contained = resolveContainedRepositoryPath(root.realRoot, input.relativePath);
  if (!contained.ok)
    return value(root, null, { outcome: contained.outcome, message: contained.message });
  const stats = statOrNull(contained.absolutePath);
  if (!stats) return value(root, null, { outcome: 'not_found', message: 'No such file.' });
  if (!stats.isFile()) {
    return value(root, null, {
      outcome: 'unavailable',
      message: 'The path is not a regular file.'
    });
  }
  const totalBytes = Number(stats.size);
  const metadataOnly: RepositoryFileData = {
    relativePath: contained.relativePath,
    totalBytes,
    totalLines: null,
    startLine: null,
    endLine: null,
    content: null
  };
  if (totalBytes > REPOSITORY_READ_TARGET_BOUNDS.readFileCeilingBytes) {
    return value(root, metadataOnly, {
      outcome: 'oversized',
      message: 'The file is too large to read; only its size is reported.'
    });
  }
  const raw = readPrefix(contained.absolutePath, totalBytes);
  if (raw.subarray(0, 8192).includes(0)) {
    return value(root, metadataOnly, { outcome: 'binary', message: 'The file is binary.' });
  }
  let text: string;
  try {
    text = utf8Decoder.decode(raw);
  } catch {
    return value(root, metadataOnly, {
      outcome: 'binary',
      message: 'The file is not valid UTF-8.'
    });
  }
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const totalLines = lines.length;
  const startLine = Math.max(1, Math.floor(Number(input.startLine ?? 1)) || 1);
  const requestedEnd = Math.floor(Number(input.endLine ?? totalLines));
  if (!Number.isFinite(requestedEnd) || requestedEnd < startLine) {
    return value(root, null, { outcome: 'denied', message: 'The line range is invalid.' });
  }
  const endLimit = Math.min(requestedEnd, totalLines);
  const maxBytes = clampBound(input.maxBytes, REPOSITORY_READ_TARGET_BOUNDS.readFileBytes);
  const selected: string[] = [];
  let used = 0;
  let truncated = false;
  let lastLine = startLine - 1;
  for (let line = startLine; line <= endLimit; line += 1) {
    const content = lines[line - 1]!;
    const cost = Buffer.byteLength(content, 'utf8') + 1;
    if (used + cost > maxBytes) {
      truncated = true;
      if (selected.length === 0) {
        selected.push(cutUtf8(content, maxBytes));
        lastLine = line;
      }
      break;
    }
    selected.push(content);
    used += cost;
    lastLine = line;
  }
  return value(
    root,
    {
      relativePath: contained.relativePath,
      totalBytes,
      totalLines,
      startLine: startLine > totalLines ? null : startLine,
      endLine: lastLine >= startLine ? lastLine : null,
      content: selected.join('\n')
    },
    { truncated }
  );
}

// ---- search text -----------------------------------------------------------------

export async function searchRepositoryTextGit(
  input: SearchRepositoryTextInput,
  signal?: AbortSignal
): Promise<RepositoryReadTargetValue<RepositorySearchData | null> | RepositoryReadFailure> {
  const deadline = new ReadDeadline(REPOSITORY_READ_TARGET_BOUNDS.commandTimeoutMs, signal);
  const root = await inspectRepositoryRoot(input.repoPath, deadline);
  if (!root.ok) return root;
  const query = typeof input.query === 'string' ? input.query : '';
  if (
    query.length === 0 ||
    query.length > REPOSITORY_READ_TARGET_BOUNDS.searchQueryChars ||
    /[\0\r\n]/.test(query)
  ) {
    return value(root, null, {
      outcome: 'denied',
      message: 'The search text is empty or invalid.'
    });
  }
  let scope = '.';
  if (input.relativePath) {
    const contained = resolveContainedRepositoryPath(root.realRoot, input.relativePath);
    if (!contained.ok)
      return value(root, null, { outcome: contained.outcome, message: contained.message });
    scope = contained.relativePath || '.';
  }
  const caseSensitive = input.caseSensitive !== false;
  const maxHits = clampBound(input.maxHits, REPOSITORY_READ_TARGET_BOUNDS.searchHits);
  const maxBytes = clampBound(input.maxBytes, REPOSITORY_READ_TARGET_BOUNDS.searchBytes);
  const args = [
    'grep',
    '--line-number',
    '--null',
    '-I',
    '--no-color',
    '--fixed-strings',
    ...(caseSensitive ? [] : ['--ignore-case']),
    ...(root.isGitRepository ? ['--untracked'] : ['--no-index', '--exclude-standard']),
    '-e',
    query,
    '--',
    `:(literal)${scope}`
  ];
  // Capture more than the content bound so sensitive hits dropped below do not
  // starve the result; the returned text is still cut to `maxBytes`.
  const run = await runInspectionGit({
    cwd: root.realRoot,
    args,
    timeoutMs: deadline.remaining(),
    maxBytes: maxBytes * 2,
    signal,
    filterArgs: root.filterArgs
  });
  const data: RepositorySearchData = { query, caseSensitive, hits: [] };
  const stopped = interrupted(root, data, run);
  if (stopped) return stopped;
  if (run.exitCode !== 0 && run.exitCode !== 1 && !run.truncated) {
    return { ok: false, code: 'GIT_COMMAND_FAILED', message: 'Text search failed on the target.' };
  }
  let truncated = run.truncated;
  let used = 0;
  const lines = run.stdout.toString('utf8').split('\n');
  if (run.truncated) lines.pop(); // the last record may be cut mid-way
  for (const record of lines) {
    if (!record) continue;
    const first = record.indexOf('\0');
    const second = record.indexOf('\0', first + 1);
    if (first < 0 || second < 0) continue;
    const filePath = record.slice(0, first);
    if (isSensitiveRepositoryPath(filePath)) continue;
    const line = Number(record.slice(first + 1, second));
    let text = record.slice(second + 1);
    if (text.length > REPOSITORY_READ_TARGET_BOUNDS.searchLineChars) {
      text = `${text.slice(0, REPOSITORY_READ_TARGET_BOUNDS.searchLineChars)}…`;
    }
    const hit: RepositorySearchHit = { path: filePath, line, text };
    const cost = Buffer.byteLength(filePath, 'utf8') + Buffer.byteLength(text, 'utf8') + 16;
    if (data.hits.length >= maxHits || used + cost > maxBytes) {
      truncated = true;
      break;
    }
    data.hits.push(hit);
    used += cost;
  }
  return value(root, data, { truncated });
}
