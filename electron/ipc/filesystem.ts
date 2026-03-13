import { ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const DEFAULT_MAX_FILES = 2000;
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_ENTRIES_PER_DIRECTORY = 5000;
const DEFAULT_GIT_TIMEOUT_MS = 15_000;
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

function parseGitStatus(stdout: string): Array<{
  originalPath?: string | null;
  path: string;
  stagedStatus: string;
  status: string;
  unstagedStatus: string;
}> {
  const entries = stdout.split('\0').filter(Boolean);
  const files: Array<{
    originalPath?: string | null;
    path: string;
    stagedStatus: string;
    status: string;
    unstagedStatus: string;
  }> = [];

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

async function getGitStatus(directory: string) {
  const { branch, repoRoot } = await resolveGitRepo(directory);
  const statusResult = await runGitCommand(repoRoot, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all'
  ]);

  return {
    branch,
    files: parseGitStatus(statusResult.output),
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

async function listProjectFiles(
  rootDirectory: string,
  options?: { maxDepth?: number; maxEntriesPerDirectory?: number; maxFiles?: number }
): Promise<{ files: string[]; truncated: boolean }> {
  const maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES;
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

export function registerFilesystemIpc(): void {
  ipcMain.handle('filesystem:directory-exists', async (_event, directory?: string) => {
    const resolvedDirectory = normalizeDirectory(directory);
    if (!resolvedDirectory) return false;

    const stat = await fs.stat(resolvedDirectory).catch(() => null);
    return Boolean(stat?.isDirectory());
  });

  ipcMain.handle(
    'filesystem:list-project-files',
    async (
      _event,
      payload?: {
        directory?: string;
        maxDepth?: number;
        maxEntriesPerDirectory?: number;
        maxFiles?: number;
      }
    ) => {
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

  ipcMain.handle('filesystem:get-git-status', async (_event, payload?: { directory?: string }) => {
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
      return {
        ...result,
        linkedDirectory: resolvedDirectory
      };
    } catch (error) {
      return {
        branch: null,
        files: [],
        linkedDirectory: resolvedDirectory,
        repoRoot: null,
        error: error instanceof Error ? error.message : 'Failed to read Git status.'
      };
    }
  });

  ipcMain.handle(
    'filesystem:get-git-diff',
    async (
      _event,
      payload?: { directory?: string; originalPath?: string; path?: string; status?: string }
    ) => {
      const resolvedDirectory = normalizeDirectory(payload?.directory);
      const relativePath = payload?.path?.trim();
      if (!resolvedDirectory) {
        return {
          diff: '',
          path: null,
          repoRoot: null,
          status: payload?.status ?? null,
          error: 'Linked directory does not exist or is not a directory.'
        };
      }
      if (!relativePath) {
        return {
          diff: '',
          path: null,
          repoRoot: null,
          status: payload?.status ?? null,
          error: 'A file path is required.'
        };
      }

      try {
        const result = await getGitDiff(
          resolvedDirectory,
          relativePath,
          payload?.status,
          payload?.originalPath
        );
        return {
          ...result,
          path: relativePath,
          status: payload?.status ?? null
        };
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
}
