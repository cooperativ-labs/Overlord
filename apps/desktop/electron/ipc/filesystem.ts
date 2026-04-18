import { ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { parseSshCommand, shellEscape } from '../../../../lib/ssh/shell-utils';

const DEFAULT_MAX_FILES = 2000;
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_ENTRIES_PER_DIRECTORY = 5000;
const DEFAULT_GIT_TIMEOUT_MS = 15_000;
const DEFAULT_SSH_FILE_TIMEOUT_MS = 30_000;
const execFileAsync = promisify(execFile);

const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.next',
  'node_modules',
  'dist',
  'dist-electron',
  'release',
  '.turbo'
]);

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function normalizeDirectory(directory?: string): string | undefined {
  const trimmed = directory?.trim();
  if (!trimmed) return undefined;
  return path.resolve(trimmed);
}

function normalizeGitStatus(code: string): string {
  if (code === '??') return 'untracked';
  if (code.includes('R')) return 'renamed';
  if (code.includes('C')) return 'copied';
  if (code.includes('D')) return 'deleted';
  if (code.includes('A')) return 'added';
  if (code.includes('T')) return 'typechange';
  return 'modified';
}

type GitStatusFile = {
  linesAdded?: number | null;
  linesRemoved?: number | null;
  originalPath?: string | null;
  path: string;
  stagedStatus: string;
  status: string;
  unstagedStatus: string;
};

type GitFileStats = {
  linesAdded: number | null;
  linesRemoved: number | null;
};

async function runGitCommand(
  cwd: string,
  args: string[],
  options: { allowFailure?: boolean } = {}
): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: DEFAULT_GIT_TIMEOUT_MS
    });
    return { ok: true, output: stdout };
  } catch (error) {
    if (options.allowFailure) {
      const output =
        error instanceof Error && 'stdout' in error && typeof error.stdout === 'string'
          ? error.stdout
          : '';
      return { ok: false, output };
    }
    throw error;
  }
}

async function resolveGitRepo(directory: string): Promise<{
  branch: string | null;
  repoRoot: string;
}> {
  const topLevel = await runGitCommand(directory, ['rev-parse', '--show-toplevel']);
  const repoRoot = topLevel.output.trim();
  if (!repoRoot) {
    throw new Error('Linked directory is not inside a Git repository.');
  }

  const branchResult = await runGitCommand(
    repoRoot,
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    { allowFailure: true }
  );

  return {
    branch: branchResult.ok ? branchResult.output.trim() || null : null,
    repoRoot
  };
}

function parseGitStatus(stdout: string): GitStatusFile[] {
  const entries = stdout.split('\0').filter(Boolean);
  const files: GitStatusFile[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const x = entry[0] ?? ' ';
    const y = entry[1] ?? ' ';
    const pathValue = entry.slice(3);
    const isRenameOrCopy = x === 'R' || x === 'C' || y === 'R' || y === 'C';
    const originalPath = isRenameOrCopy ? (entries[index + 1] ?? null) : null;

    if (isRenameOrCopy) {
      index += 1;
    }

    if (!pathValue) continue;

    files.push({
      originalPath: originalPath ? toPosixPath(originalPath) : null,
      path: toPosixPath(pathValue),
      stagedStatus: x,
      status: normalizeGitStatus(`${x}${y}`),
      unstagedStatus: y
    });
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function parseRenameTarget(value: string): { originalPath: string; path: string } | null {
  const braceMatch = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(value);
  if (braceMatch) {
    const [, prefix, originalSegment, nextSegment, suffix] = braceMatch;
    return {
      originalPath: `${prefix}${originalSegment}${suffix}`,
      path: `${prefix}${nextSegment}${suffix}`
    };
  }

  const separator = ' => ';
  const separatorIndex = value.indexOf(separator);
  if (separatorIndex === -1) return null;

  return {
    originalPath: value.slice(0, separatorIndex),
    path: value.slice(separatorIndex + separator.length)
  };
}

function parseNumStat(stdout: string): Map<string, GitFileStats> {
  const stats = new Map<string, GitFileStats>();
  const lines = stdout
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean);

  for (const line of lines) {
    const [addedRaw, removedRaw, ...pathParts] = line.split('\t');
    const pathValue = pathParts.join('\t').trim();
    if (!pathValue) continue;

    const parsedPath = parseRenameTarget(pathValue);
    const nextPath = parsedPath?.path ?? pathValue;

    stats.set(toPosixPath(nextPath), {
      linesAdded: addedRaw === '-' ? null : Number.parseInt(addedRaw, 10),
      linesRemoved: removedRaw === '-' ? null : Number.parseInt(removedRaw, 10)
    });
  }

  return stats;
}

function countLines(value: string): number {
  if (value.length === 0) return 0;
  return value.split('\n').length;
}

async function readUntrackedFileStats(
  repoRoot: string,
  relativePath: string
): Promise<GitFileStats | null> {
  try {
    const fullPath = path.join(repoRoot, relativePath);
    const content = await fs.readFile(fullPath, 'utf8');
    return {
      linesAdded: countLines(content),
      linesRemoved: 0
    };
  } catch {
    return null;
  }
}

async function getGitFileStats(
  repoRoot: string,
  files: GitStatusFile[]
): Promise<Map<string, GitFileStats>> {
  const trackedResult = await runGitCommand(
    repoRoot,
    ['-c', 'core.quotepath=false', 'diff', '--numstat', '--find-renames', '--find-copies', 'HEAD'],
    { allowFailure: true }
  );

  const stats = parseNumStat(trackedResult.output);

  await Promise.all(
    files.map(async file => {
      if (file.status !== 'untracked' || stats.has(file.path)) return;
      const untrackedStats = await readUntrackedFileStats(repoRoot, file.path);
      if (untrackedStats) {
        stats.set(file.path, untrackedStats);
      }
    })
  );

  return stats;
}

async function getGitStatus(directory: string) {
  const { branch, repoRoot } = await resolveGitRepo(directory);
  const statusResult = await runGitCommand(repoRoot, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all'
  ]);

  const files = parseGitStatus(statusResult.output);
  const fileStats = await getGitFileStats(repoRoot, files);

  return {
    branch,
    files: files.map(file => {
      const stats = fileStats.get(file.path);
      return {
        ...file,
        linesAdded: stats?.linesAdded ?? null,
        linesRemoved: stats?.linesRemoved ?? null
      };
    }),
    repoRoot
  };
}

async function getGitDiff(
  directory: string,
  relativePath: string,
  status?: string,
  originalPath?: string
) {
  const { repoRoot } = await resolveGitRepo(directory);
  const normalizedPath = toPosixPath(relativePath.trim());
  const normalizedOriginalPath = originalPath?.trim() ? toPosixPath(originalPath.trim()) : null;
  if (!normalizedPath) {
    throw new Error('A file path is required.');
  }

  if (status === 'untracked') {
    const fullPath = path.join(repoRoot, normalizedPath);
    const result = await runGitCommand(
      repoRoot,
      ['diff', '--no-index', '--no-ext-diff', '--unified=3', '--', '/dev/null', fullPath],
      { allowFailure: true }
    );
    return { diff: result.output, repoRoot };
  }

  if ((status === 'renamed' || status === 'copied') && normalizedOriginalPath) {
    const result = await runGitCommand(repoRoot, [
      'diff',
      '--no-ext-diff',
      '--unified=3',
      '--find-renames',
      'HEAD',
      '--',
      normalizedOriginalPath,
      normalizedPath
    ]);
    return { diff: result.output, repoRoot };
  }

  const result = await runGitCommand(repoRoot, [
    'diff',
    '--no-ext-diff',
    '--unified=3',
    'HEAD',
    '--',
    normalizedPath
  ]);
  return { diff: result.output, repoRoot };
}

async function runRemoteGitCommand(
  sshParts: string[],
  remoteDirectory: string,
  args: string[],
  options: { allowFailure?: boolean } = {}
): Promise<{ ok: boolean; output: string }> {
  const gitCmd = ['git', ...args].map(shellEscape).join(' ');
  const remoteScript = `cd ${shellEscape(remoteDirectory)} && ${gitCmd}`;
  const [sshBin, ...sshArgs] = sshParts;
  try {
    const { stdout } = await execFileAsync(sshBin ?? 'ssh', [...sshArgs, remoteScript], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: DEFAULT_GIT_TIMEOUT_MS
    });
    return { ok: true, output: stdout };
  } catch (error) {
    if (options.allowFailure) {
      const output =
        error instanceof Error && 'stdout' in error && typeof error.stdout === 'string'
          ? error.stdout
          : '';
      return { ok: false, output };
    }
    throw error;
  }
}

async function resolveRemoteGitRepo(
  sshParts: string[],
  remoteDirectory: string
): Promise<{ branch: string | null; repoRoot: string }> {
  const topLevel = await runRemoteGitCommand(sshParts, remoteDirectory, [
    'rev-parse',
    '--show-toplevel'
  ]);
  const repoRoot = topLevel.output.trim();
  if (!repoRoot) {
    throw new Error('Remote directory is not inside a Git repository.');
  }
  const branchResult = await runRemoteGitCommand(
    sshParts,
    repoRoot,
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    { allowFailure: true }
  );
  return {
    branch: branchResult.ok ? branchResult.output.trim() || null : null,
    repoRoot
  };
}

async function readRemoteUntrackedFileStats(
  sshParts: string[],
  remoteFilePath: string
): Promise<GitFileStats | null> {
  const [sshBin, ...sshArgs] = sshParts;
  try {
    const remoteScript = `awk 'END{print NR}' ${shellEscape(remoteFilePath)}`;
    const { stdout } = await execFileAsync(sshBin ?? 'ssh', [...sshArgs, remoteScript], {
      maxBuffer: 1024 * 1024,
      timeout: DEFAULT_GIT_TIMEOUT_MS
    });
    const lines = Number.parseInt(stdout.trim(), 10);
    return { linesAdded: Number.isNaN(lines) ? null : lines, linesRemoved: 0 };
  } catch {
    return null;
  }
}

async function getRemoteGitFileStats(
  sshParts: string[],
  repoRoot: string,
  files: GitStatusFile[]
): Promise<Map<string, GitFileStats>> {
  const trackedResult = await runRemoteGitCommand(
    sshParts,
    repoRoot,
    ['-c', 'core.quotepath=false', 'diff', '--numstat', '--find-renames', '--find-copies', 'HEAD'],
    { allowFailure: true }
  );
  const stats = parseNumStat(trackedResult.output);
  await Promise.all(
    files.map(async file => {
      if (file.status !== 'untracked' || stats.has(file.path)) return;
      const remoteFilePath = `${repoRoot}/${file.path}`;
      const untrackedStats = await readRemoteUntrackedFileStats(sshParts, remoteFilePath);
      if (untrackedStats) stats.set(file.path, untrackedStats);
    })
  );
  return stats;
}

async function getRemoteGitStatus(sshCommand: string, remoteDirectory: string) {
  const sshParts = parseSshCommand(sshCommand);
  const { branch, repoRoot } = await resolveRemoteGitRepo(sshParts, remoteDirectory);
  const statusResult = await runRemoteGitCommand(sshParts, repoRoot, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all'
  ]);
  const files = parseGitStatus(statusResult.output);
  const fileStats = await getRemoteGitFileStats(sshParts, repoRoot, files);
  return {
    branch,
    files: files.map(file => {
      const stats = fileStats.get(file.path);
      return {
        ...file,
        linesAdded: stats?.linesAdded ?? null,
        linesRemoved: stats?.linesRemoved ?? null
      };
    }),
    repoRoot
  };
}

async function getRemoteGitDiff(
  sshCommand: string,
  remoteDirectory: string,
  relativePath: string,
  status?: string,
  originalPath?: string
) {
  const sshParts = parseSshCommand(sshCommand);
  const { repoRoot } = await resolveRemoteGitRepo(sshParts, remoteDirectory);
  const normalizedPath = toPosixPath(relativePath.trim());
  const normalizedOriginalPath = originalPath?.trim() ? toPosixPath(originalPath.trim()) : null;
  if (!normalizedPath) throw new Error('A file path is required.');

  if (status === 'untracked') {
    const fullRemotePath = `${repoRoot}/${normalizedPath}`;
    const result = await runRemoteGitCommand(
      sshParts,
      repoRoot,
      ['diff', '--no-index', '--no-ext-diff', '--unified=3', '--', '/dev/null', fullRemotePath],
      { allowFailure: true }
    );
    return { diff: result.output, repoRoot };
  }

  if ((status === 'renamed' || status === 'copied') && normalizedOriginalPath) {
    const result = await runRemoteGitCommand(sshParts, repoRoot, [
      'diff',
      '--no-ext-diff',
      '--unified=3',
      '--find-renames',
      'HEAD',
      '--',
      normalizedOriginalPath,
      normalizedPath
    ]);
    return { diff: result.output, repoRoot };
  }

  const result = await runRemoteGitCommand(sshParts, repoRoot, [
    'diff',
    '--no-ext-diff',
    '--unified=3',
    'HEAD',
    '--',
    normalizedPath
  ]);
  return { diff: result.output, repoRoot };
}

async function listProjectFiles(
  rootDirectory: string,
  options?: { maxDepth?: number; maxEntriesPerDirectory?: number; maxFiles?: number }
): Promise<{ files: string[]; truncated: boolean }> {
  const maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES;
  const repoRootResult = await runGitCommand(rootDirectory, ['rev-parse', '--show-toplevel'], {
    allowFailure: true
  });
  const repoRoot = repoRootResult.output.trim();
  if (repoRootResult.ok && repoRoot) {
    const relativeRoot = path.relative(repoRoot, rootDirectory);
    const normalizedRelativeRoot =
      relativeRoot && relativeRoot !== '.' ? toPosixPath(relativeRoot) : null;
    const repoAwareArgs = [
      '-C',
      repoRoot,
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard'
    ];
    if (normalizedRelativeRoot) {
      repoAwareArgs.push('--', normalizedRelativeRoot);
    }

    const repoAwareResult = await runGitCommand(repoRoot, repoAwareArgs, { allowFailure: true });
    if (repoAwareResult.ok) {
      let files = repoAwareResult.output
        .split('\0')
        .map(entry => entry.trim())
        .filter(Boolean)
        .map(entry => toPosixPath(path.relative(rootDirectory, path.join(repoRoot, entry))))
        .filter(entry => entry.length > 0 && !entry.startsWith('../') && entry !== '..')
        .sort((left, right) => left.localeCompare(right));

      const truncated = files.length > maxFiles;
      if (truncated) {
        files = files.slice(0, maxFiles);
      }

      return { files, truncated };
    }
  }

  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxEntriesPerDirectory =
    options?.maxEntriesPerDirectory ?? DEFAULT_MAX_ENTRIES_PER_DIRECTORY;
  const files: string[] = [];
  let truncated = false;

  async function walk(currentDirectory: string, depth: number): Promise<void> {
    if (truncated || depth > maxDepth) return;

    let entries: Array<{
      isDirectory(): boolean;
      isFile(): boolean;
      name: string;
    }>;
    try {
      const rawEntries = await fs.readdir(currentDirectory, { withFileTypes: true });
      entries = rawEntries.map(entry => ({
        isDirectory: () => entry.isDirectory(),
        isFile: () => entry.isFile(),
        name: String(entry.name)
      }));
    } catch {
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));

    if (entries.length > maxEntriesPerDirectory) {
      entries = entries.slice(0, maxEntriesPerDirectory);
      truncated = true;
    }

    for (const entry of entries) {
      if (truncated) return;

      const absolutePath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        await walk(absolutePath, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;

      files.push(toPosixPath(path.relative(rootDirectory, absolutePath)));
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
    }
  }

  await walk(rootDirectory, 0);
  return { files, truncated };
}

async function listRemoteProjectFiles(
  sshCommand: string,
  remoteDirectory: string,
  options?: { maxFiles?: number; maxDepth?: number }
): Promise<{ files: string[]; truncated: boolean }> {
  const maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES;
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const sshParts = parseSshCommand(sshCommand);
  const [sshBin, ...sshArgs] = sshParts;

  const gitCmd = [
    `cd ${shellEscape(remoteDirectory)}`,
    `git rev-parse --show-toplevel >/dev/null 2>&1`,
    `git ls-files -z --cached --others --exclude-standard -- .`
  ].join(' && ');

  try {
    const { stdout } = await execFileAsync(sshBin ?? 'ssh', [...sshArgs, gitCmd], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: DEFAULT_SSH_FILE_TIMEOUT_MS
    });

    let files = stdout
      .split('\0')
      .map(line => line.trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));

    const truncated = files.length > maxFiles;
    if (truncated) {
      files = files.slice(0, maxFiles);
    }

    return { files, truncated };
  } catch {
    // Fall back to the generic filesystem walker for non-git directories or older shells.
  }

  const ignoredDirs = [...IGNORED_DIRECTORY_NAMES].map(d => `-name ${shellEscape(d)}`).join(' -o ');
  const findCmd = [
    `cd ${shellEscape(remoteDirectory)}`,
    `find . -maxdepth ${maxDepth}`,
    `\\( ${ignoredDirs} -o -name '.*' \\) -prune`,
    `-o -type f -print`,
    `| head -n ${maxFiles + 1}`,
    `| sort`
  ].join(' && ');

  const { stdout } = await execFileAsync(sshBin ?? 'ssh', [...sshArgs, findCmd], {
    maxBuffer: 10 * 1024 * 1024,
    timeout: DEFAULT_SSH_FILE_TIMEOUT_MS
  });

  let files = stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => (line.startsWith('./') ? line.slice(2) : line));

  let truncated = false;
  if (files.length > maxFiles) {
    files = files.slice(0, maxFiles);
    truncated = true;
  }

  return { files, truncated };
}

async function remoteDirectoryExists(
  sshCommand: string,
  remoteDirectory: string
): Promise<boolean> {
  const sshParts = parseSshCommand(sshCommand);
  const [sshBin, ...sshArgs] = sshParts;
  const remoteScript = `test -d ${shellEscape(remoteDirectory)} && echo EXISTS`;
  try {
    const { stdout } = await execFileAsync(sshBin ?? 'ssh', [...sshArgs, remoteScript], {
      timeout: 10_000
    });
    return stdout.trim() === 'EXISTS';
  } catch {
    return false;
  }
}

async function checkSshConnection(sshCommand: string): Promise<{ ok: boolean; error?: string }> {
  const sshParts = parseSshCommand(sshCommand);
  const [sshBin, ...sshArgs] = sshParts;
  try {
    const { stdout } = await execFileAsync(sshBin ?? 'ssh', [...sshArgs, 'echo OK'], {
      timeout: 5_000
    });
    return { ok: stdout.trim() === 'OK' };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'SSH connection failed.'
    };
  }
}

async function getAggregateDiff(directory: string): Promise<{
  branch: string | null;
  diff: string;
  filesChanged: number;
  repoRoot: string;
  status: string;
}> {
  const { branch, repoRoot } = await resolveGitRepo(directory);
  const statusResult = await runGitCommand(repoRoot, ['status', '--short']);
  const trackedDiff = await runGitCommand(
    repoRoot,
    ['-c', 'core.quotepath=false', 'diff', 'HEAD', '--no-color', '--unified=2'],
    { allowFailure: true }
  );

  const untrackedResult = await runGitCommand(
    repoRoot,
    ['ls-files', '--others', '--exclude-standard', '-z'],
    { allowFailure: true }
  );
  const untrackedFiles = untrackedResult.output.split('\0').filter(Boolean);

  let untrackedDiff = '';
  for (const relPath of untrackedFiles.slice(0, 50)) {
    const fullPath = path.join(repoRoot, relPath);
    const piece = await runGitCommand(
      repoRoot,
      ['diff', '--no-index', '--no-ext-diff', '--unified=2', '--', '/dev/null', fullPath],
      { allowFailure: true }
    );
    if (piece.output) untrackedDiff += piece.output + '\n';
  }

  const filesChanged =
    (statusResult.output.match(/\n/g)?.length ?? 0) + (statusResult.output.trim() ? 1 : 0);
  return {
    branch,
    diff: trackedDiff.output + (untrackedDiff ? `\n${untrackedDiff}` : ''),
    filesChanged,
    repoRoot,
    status: statusResult.output
  };
}

async function gitCommitAndPush(
  directory: string,
  message: string
): Promise<{ branch: string | null; commitSha: string | null; pushed: boolean }> {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    throw new Error('Commit message cannot be empty.');
  }

  const { branch, repoRoot } = await resolveGitRepo(directory);
  if (!branch) {
    throw new Error('Cannot push from a detached HEAD. Check out a branch first.');
  }

  // Stage all changes (tracked edits, deletions, and untracked files).
  await runGitCommand(repoRoot, ['add', '-A']);

  // Bail out if nothing is staged.
  const staged = await runGitCommand(repoRoot, ['diff', '--cached', '--name-only']);
  if (!staged.output.trim()) {
    throw new Error('No staged changes to commit.');
  }

  await runGitCommand(repoRoot, ['commit', '-m', trimmedMessage]);

  const shaResult = await runGitCommand(repoRoot, ['rev-parse', 'HEAD'], { allowFailure: true });
  const commitSha = shaResult.ok ? shaResult.output.trim() || null : null;

  // Push to the upstream for the current branch. Git will emit a helpful error
  // if no upstream is configured; surface it to the user so they can set one.
  try {
    await execFileAsync('git', ['push'], {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
      timeout: DEFAULT_GIT_TIMEOUT_MS * 4
    });
  } catch (error) {
    const stderr =
      error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
        ? error.stderr
        : '';
    const message =
      stderr ||
      (error instanceof Error ? error.message : 'git push failed. Ensure an upstream is set.');
    throw new Error(message, { cause: error });
  }

  return { branch, commitSha, pushed: true };
}

export function registerFilesystemIpc(): void {
  ipcMain.handle(
    'filesystem:directory-exists',
    async (
      _event,
      payload?: string | { directory?: string; sshCommand?: string; remoteDirectory?: string }
    ) => {
      // Support legacy bare-string signature and new object signature
      if (typeof payload === 'string' || payload === undefined) {
        const resolvedDirectory = normalizeDirectory(payload);
        if (!resolvedDirectory) return false;
        const stat = await fs.stat(resolvedDirectory).catch(() => null);
        return Boolean(stat?.isDirectory());
      }

      if (payload.sshCommand?.trim()) {
        const remoteDir = payload.remoteDirectory?.trim() ?? '';
        if (!remoteDir) return false;
        return remoteDirectoryExists(payload.sshCommand.trim(), remoteDir);
      }

      const resolvedDirectory = normalizeDirectory(payload.directory);
      if (!resolvedDirectory) return false;
      const stat = await fs.stat(resolvedDirectory).catch(() => null);
      return Boolean(stat?.isDirectory());
    }
  );

  ipcMain.handle(
    'filesystem:list-project-files',
    async (
      _event,
      payload?: {
        directory?: string;
        sshCommand?: string;
        remoteDirectory?: string;
        maxDepth?: number;
        maxEntriesPerDirectory?: number;
        maxFiles?: number;
      }
    ) => {
      if (payload?.sshCommand?.trim()) {
        const remoteDir = payload.remoteDirectory?.trim() ?? '';
        if (!remoteDir) {
          return {
            files: [],
            linkedDirectory: null,
            truncated: false,
            error: 'Remote working directory is required when using SSH.'
          };
        }
        try {
          const { files, truncated } = await listRemoteProjectFiles(
            payload.sshCommand.trim(),
            remoteDir,
            payload
          );
          return { files, linkedDirectory: remoteDir, truncated };
        } catch (error) {
          return {
            files: [],
            linkedDirectory: remoteDir,
            truncated: false,
            error: error instanceof Error ? error.message : 'Failed to list remote project files.'
          };
        }
      }

      const resolvedDirectory = normalizeDirectory(payload?.directory);
      if (!resolvedDirectory) {
        return {
          files: [],
          linkedDirectory: null,
          truncated: false,
          error: 'Linked directory does not exist or is not a directory.'
        };
      }

      const { files, truncated } = await listProjectFiles(resolvedDirectory, payload);
      return {
        files,
        linkedDirectory: resolvedDirectory,
        truncated
      };
    }
  );

  ipcMain.handle('filesystem:check-ssh-connection', async (_event, sshCommand?: string) => {
    if (!sshCommand?.trim()) {
      return { ok: false, error: 'SSH command is required.' };
    }
    return checkSshConnection(sshCommand.trim());
  });

  ipcMain.handle(
    'filesystem:get-git-status',
    async (
      _event,
      payload?: { directory?: string; sshCommand?: string; remoteDirectory?: string }
    ) => {
      if (payload?.sshCommand?.trim()) {
        const remoteDir = payload.remoteDirectory?.trim() ?? '';
        if (!remoteDir) {
          return {
            branch: null,
            files: [],
            linkedDirectory: null,
            repoRoot: null,
            error: 'Remote working directory is required when using SSH.'
          };
        }
        try {
          const result = await getRemoteGitStatus(payload.sshCommand.trim(), remoteDir);
          return { ...result, linkedDirectory: remoteDir };
        } catch (error) {
          return {
            branch: null,
            files: [],
            linkedDirectory: remoteDir,
            repoRoot: null,
            error: error instanceof Error ? error.message : 'Failed to read remote Git status.'
          };
        }
      }

      const resolvedDirectory = normalizeDirectory(payload?.directory);
      if (!resolvedDirectory) {
        return {
          branch: null,
          files: [],
          linkedDirectory: null,
          repoRoot: null,
          error: 'Linked directory does not exist or is not a directory.'
        };
      }
      try {
        const result = await getGitStatus(resolvedDirectory);
        return { ...result, linkedDirectory: resolvedDirectory };
      } catch (error) {
        return {
          branch: null,
          files: [],
          linkedDirectory: resolvedDirectory,
          repoRoot: null,
          error: error instanceof Error ? error.message : 'Failed to read Git status.'
        };
      }
    }
  );

  ipcMain.handle(
    'filesystem:get-git-diff',
    async (
      _event,
      payload?: {
        directory?: string;
        originalPath?: string;
        path?: string;
        status?: string;
        sshCommand?: string;
        remoteDirectory?: string;
      }
    ) => {
      const relativePath = payload?.path?.trim();
      if (!relativePath) {
        return {
          diff: '',
          path: null,
          repoRoot: null,
          status: payload?.status ?? null,
          error: 'A file path is required.'
        };
      }

      if (payload?.sshCommand?.trim()) {
        const remoteDir = payload.remoteDirectory?.trim() ?? '';
        if (!remoteDir) {
          return {
            diff: '',
            path: relativePath,
            repoRoot: null,
            status: payload?.status ?? null,
            error: 'Remote working directory is required when using SSH.'
          };
        }
        try {
          const result = await getRemoteGitDiff(
            payload.sshCommand.trim(),
            remoteDir,
            relativePath,
            payload?.status,
            payload?.originalPath
          );
          return { ...result, path: relativePath, status: payload?.status ?? null };
        } catch (error) {
          return {
            diff: '',
            path: relativePath,
            repoRoot: null,
            status: payload?.status ?? null,
            error: error instanceof Error ? error.message : 'Failed to read remote Git diff.'
          };
        }
      }

      const resolvedDirectory = normalizeDirectory(payload?.directory);
      if (!resolvedDirectory) {
        return {
          diff: '',
          path: null,
          repoRoot: null,
          status: payload?.status ?? null,
          error: 'Linked directory does not exist or is not a directory.'
        };
      }
      try {
        const result = await getGitDiff(
          resolvedDirectory,
          relativePath,
          payload?.status,
          payload?.originalPath
        );
        return { ...result, path: relativePath, status: payload?.status ?? null };
      } catch (error) {
        return {
          diff: '',
          path: relativePath,
          repoRoot: null,
          status: payload?.status ?? null,
          error: error instanceof Error ? error.message : 'Failed to read Git diff.'
        };
      }
    }
  );

  ipcMain.handle(
    'filesystem:get-aggregate-diff',
    async (_event, payload?: { directory?: string }) => {
      const resolvedDirectory = normalizeDirectory(payload?.directory);
      if (!resolvedDirectory) {
        return {
          branch: null,
          diff: '',
          filesChanged: 0,
          repoRoot: null,
          status: '',
          error: 'Linked directory does not exist or is not a directory.'
        };
      }
      try {
        const result = await getAggregateDiff(resolvedDirectory);
        return { ...result };
      } catch (error) {
        return {
          branch: null,
          diff: '',
          filesChanged: 0,
          repoRoot: null,
          status: '',
          error: error instanceof Error ? error.message : 'Failed to read aggregate Git diff.'
        };
      }
    }
  );

  ipcMain.handle(
    'filesystem:git-commit-and-push',
    async (_event, payload?: { directory?: string; message?: string }) => {
      const resolvedDirectory = normalizeDirectory(payload?.directory);
      if (!resolvedDirectory) {
        return {
          ok: false,
          branch: null,
          commitSha: null,
          pushed: false,
          error: 'Linked directory does not exist or is not a directory.'
        };
      }
      try {
        const result = await gitCommitAndPush(resolvedDirectory, payload?.message ?? '');
        return { ok: true, ...result };
      } catch (error) {
        return {
          ok: false,
          branch: null,
          commitSha: null,
          pushed: false,
          error: error instanceof Error ? error.message : 'Failed to commit and push.'
        };
      }
    }
  );
}
