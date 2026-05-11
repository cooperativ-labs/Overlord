/**
 * LocalWorkspaceClient — executes filesystem + git operations against a local
 * directory using child_process + fs. Node-only; consumed by the Electron main
 * process and by the remote helper daemon (where "local" is the remote host).
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { countLines, GitFileStats, parseGitStatus, parseNumStat, toPosixPath } from './git-parse';
import type {
  AggregateDiffResult,
  CommitAndPushOptions,
  CommitAndPushResult,
  CreatePullRequestOptions,
  GitBranchesResult,
  GitBranchOperationResult,
  GitBranchOptions,
  GitCreatePullRequestResult,
  GitDiffOptions,
  GitDiffResult,
  GitPullResult,
  GitPushResult,
  GitStatusFile,
  GitStatusResult,
  ListFilesOptions,
  ListFilesResult,
  ReadFileOptions,
  ReadFileResult,
  WorkspaceClient,
  WorkspaceHealth
} from './types';

const execFileAsync = promisify(execFile);

const DEFAULT_MAX_FILES = 2000;
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_ENTRIES_PER_DIRECTORY = 5000;
const DEFAULT_GIT_TIMEOUT_MS = 15_000;
const DEFAULT_GH_TIMEOUT_MS = 30_000;
const DEFAULT_READ_MAX_BYTES = 512 * 1024;
const MAX_UNTRACKED_FILES_FOR_STATS = 50;
const MAX_UNTRACKED_FILE_BYTES_FOR_STATS = 512 * 1024;
const MAX_UNTRACKED_FILES_FOR_AGGREGATE_DIFF = 25;
const MAX_UNTRACKED_FILE_BYTES_FOR_AGGREGATE_DIFF = 512 * 1024;

const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.jj',
  '.next',
  'node_modules',
  'dist',
  'dist-electron',
  'release',
  '.turbo'
]);

async function runGit(
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

async function resolveRepo(
  directory: string
): Promise<{ branch: string | null; repoRoot: string }> {
  const topLevel = await runGit(directory, ['rev-parse', '--show-toplevel']);
  const repoRoot = topLevel.output.trim();
  if (!repoRoot) throw new Error('Directory is not inside a Git repository.');

  const branch = await runGit(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    allowFailure: true
  });
  return {
    branch: branch.ok ? branch.output.trim() || null : null,
    repoRoot
  };
}

async function runJj(
  cwd: string,
  args: string[],
  options: { allowFailure?: boolean } = {}
): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout } = await execFileAsync('jj', args, {
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

async function resolveJjRepo(directory: string): Promise<{ repoRoot: string }> {
  const root = await runJj(directory, ['--repository', directory, 'root']);
  const repoRoot = root.output.trim();
  if (!repoRoot) throw new Error('Directory is not inside a JJ repository.');
  return { repoRoot };
}

async function isJjWorkspace(directory: string): Promise<boolean> {
  // Always verify the jj binary is executable, even if a .jj directory is present.
  // Without this check, a repo with a .jj folder on a machine without jj installed
  // would pass the stat check and then crash with "spawn jj ENOENT" when the code
  // tries to run jj commands without allowFailure.
  const root = await runJj(directory, ['--repository', directory, 'root'], { allowFailure: true });
  return root.ok && root.output.trim().length > 0;
}

function parseJjStatus(output: string): GitStatusFile[] {
  return output
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean)
    .filter(line => /^[A-Z?] /.test(line))
    .map(line => {
      const code = line.slice(0, 1);
      const filePath = line.slice(2).trim();
      const status =
        code === 'A' || code === '?'
          ? 'untracked'
          : code === 'D'
            ? 'deleted'
            : code === 'R'
              ? 'renamed'
              : 'modified';
      return {
        linesAdded: null,
        linesRemoved: null,
        originalPath: null,
        path: toPosixPath(filePath),
        stagedStatus: ' ',
        status,
        unstagedStatus: code
      };
    });
}

function normalizeGitOutput(output: string): string {
  return output.trim();
}

async function resolveDefaultBranch(repoRoot: string): Promise<string | null> {
  const symbolic = await runGit(
    repoRoot,
    ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
    {
      allowFailure: true
    }
  );
  const ref = symbolic.ok ? symbolic.output.trim() : '';
  if (ref.startsWith('origin/')) return ref.slice('origin/'.length) || null;
  return null;
}

async function pushCurrentBranch(repoRoot: string, branch: string): Promise<{ output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['push'], {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
      timeout: DEFAULT_GIT_TIMEOUT_MS * 4
    });
    return { output: `${stdout ?? ''}${stderr ?? ''}` };
  } catch (error) {
    const stderr =
      error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
        ? error.stderr
        : '';
    const stdout =
      error instanceof Error && 'stdout' in error && typeof error.stdout === 'string'
        ? error.stdout
        : '';
    const combined = `${stdout}${stderr}`.trim();

    if (/has no upstream branch/i.test(combined)) {
      const upstream = await execFileAsync('git', ['push', '--set-upstream', 'origin', branch], {
        cwd: repoRoot,
        maxBuffer: 10 * 1024 * 1024,
        timeout: DEFAULT_GIT_TIMEOUT_MS * 4
      });
      return { output: `${upstream.stdout ?? ''}${upstream.stderr ?? ''}` };
    }

    const msg =
      combined ||
      (error instanceof Error ? error.message : 'git push failed. Ensure an upstream is set.');
    throw new Error(msg, { cause: error });
  }
}

async function readUntrackedStats(
  repoRoot: string,
  relativePath: string
): Promise<GitFileStats | null> {
  try {
    const absolutePath = path.join(repoRoot, relativePath);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile() || stat.size > MAX_UNTRACKED_FILE_BYTES_FOR_STATS) {
      return null;
    }
    const content = await fs.readFile(absolutePath, 'utf8');
    return { linesAdded: countLines(content), linesRemoved: 0 };
  } catch {
    return null;
  }
}

async function getGitFileStats(
  repoRoot: string,
  files: Array<Pick<GitStatusFile, 'status' | 'path'>>
): Promise<Map<string, GitFileStats>> {
  const tracked = await runGit(
    repoRoot,
    ['-c', 'core.quotepath=false', 'diff', '--numstat', '--find-renames', '--find-copies', 'HEAD'],
    { allowFailure: true }
  );
  const stats = parseNumStat(tracked.output);
  const untrackedFilesForStats = files
    .filter(file => file.status === 'untracked' && !stats.has(file.path))
    .slice(0, MAX_UNTRACKED_FILES_FOR_STATS);

  await Promise.all(
    untrackedFilesForStats.map(async file => {
      const untracked = await readUntrackedStats(repoRoot, file.path);
      if (untracked) stats.set(file.path, untracked);
    })
  );
  return stats;
}

export class LocalWorkspaceClient implements WorkspaceClient {
  readonly kind = 'local' as const;
  readonly workingDirectory: string;

  constructor(workingDirectory: string) {
    const trimmed = workingDirectory?.trim();
    if (!trimmed) throw new Error('workingDirectory is required.');
    this.workingDirectory = path.resolve(trimmed);
  }

  async checkHealth(): Promise<WorkspaceHealth> {
    const stat = await fs.stat(this.workingDirectory).catch(() => null);
    if (!stat?.isDirectory()) {
      return { ok: false, error: 'Working directory does not exist or is not a directory.' };
    }
    return { ok: true };
  }

  async directoryExists(): Promise<boolean> {
    const stat = await fs.stat(this.workingDirectory).catch(() => null);
    return Boolean(stat?.isDirectory());
  }

  async listProjectFiles(options?: ListFilesOptions): Promise<ListFilesResult> {
    const maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES;
    const rootDirectory = this.workingDirectory;

    const repoRootResult = await runGit(rootDirectory, ['rev-parse', '--show-toplevel'], {
      allowFailure: true
    });
    const repoRoot = repoRootResult.output.trim();

    if (repoRootResult.ok && repoRoot) {
      const relativeRoot = path.relative(repoRoot, rootDirectory);
      const normalizedRelativeRoot =
        relativeRoot && relativeRoot !== '.' ? toPosixPath(relativeRoot) : null;
      const args = ['-C', repoRoot, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'];
      if (normalizedRelativeRoot) args.push('--', normalizedRelativeRoot);

      const result = await runGit(repoRoot, args, { allowFailure: true });
      if (result.ok) {
        let files = result.output
          .split('\0')
          .map(entry => entry.trim())
          .filter(Boolean)
          .map(entry => toPosixPath(path.relative(rootDirectory, path.join(repoRoot, entry))))
          .filter(entry => entry.length > 0 && !entry.startsWith('../') && entry !== '..')
          .sort((left, right) => left.localeCompare(right));
        const truncated = files.length > maxFiles;
        if (truncated) files = files.slice(0, maxFiles);
        return { files, linkedDirectory: rootDirectory, truncated };
      }
    }

    const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
    const maxEntriesPerDirectory =
      options?.maxEntriesPerDirectory ?? DEFAULT_MAX_ENTRIES_PER_DIRECTORY;
    const files: string[] = [];
    let truncated = false;

    const walk = async (current: string, depth: number): Promise<void> => {
      if (truncated || depth > maxDepth) return;
      let entries: Array<{ isDirectory: () => boolean; isFile: () => boolean; name: string }>;
      try {
        const raw = await fs.readdir(current, { withFileTypes: true });
        entries = raw.map(e => ({
          isDirectory: () => e.isDirectory(),
          isFile: () => e.isFile(),
          name: String(e.name)
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
        const absolutePath = path.join(current, entry.name);
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
    };

    await walk(rootDirectory, 0);
    return { files, linkedDirectory: rootDirectory, truncated };
  }

  async readFile(options: ReadFileOptions): Promise<ReadFileResult> {
    const maxBytes = options.maxBytes ?? DEFAULT_READ_MAX_BYTES;
    const relative = options.path.trim();
    if (!relative)
      return { content: '', path: options.path, truncated: false, error: 'path is required.' };

    const absolute = path.resolve(this.workingDirectory, relative);
    if (!absolute.startsWith(this.workingDirectory)) {
      return {
        content: '',
        path: options.path,
        truncated: false,
        error: 'Path escapes workspace.'
      };
    }

    try {
      const handle = await fs.open(absolute, 'r');
      try {
        const stat = await handle.stat();
        const size = Number(stat.size);
        const readLength = Math.min(size, maxBytes);
        const buffer = Buffer.alloc(readLength);
        await handle.read(buffer, 0, readLength, 0);
        return {
          content: buffer.toString('utf8'),
          path: options.path,
          truncated: size > maxBytes
        };
      } finally {
        await handle.close();
      }
    } catch (error) {
      return {
        content: '',
        path: options.path,
        truncated: false,
        error: error instanceof Error ? error.message : 'Failed to read file.'
      };
    }
  }

  async getGitStatus(): Promise<GitStatusResult> {
    try {
      if (await isJjWorkspace(this.workingDirectory)) {
        const { repoRoot } = await resolveJjRepo(this.workingDirectory);
        const statusResult = await runJj(repoRoot, ['--repository', repoRoot, 'status']);
        return {
          branch: null,
          files: parseJjStatus(statusResult.output),
          linkedDirectory: this.workingDirectory,
          repoRoot
        };
      }

      const { branch, repoRoot } = await resolveRepo(this.workingDirectory);
      const statusResult = await runGit(repoRoot, [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=normal'
      ]);
      const files = parseGitStatus(statusResult.output);
      const stats = await getGitFileStats(repoRoot, files);
      return {
        branch,
        files: files.map(file => {
          const fileStats = stats.get(file.path);
          return {
            ...file,
            linesAdded: fileStats?.linesAdded ?? null,
            linesRemoved: fileStats?.linesRemoved ?? null
          };
        }),
        linkedDirectory: this.workingDirectory,
        repoRoot
      };
    } catch (error) {
      return {
        branch: null,
        files: [],
        linkedDirectory: this.workingDirectory,
        repoRoot: null,
        error: error instanceof Error ? error.message : 'Failed to read Git status.'
      };
    }
  }

  async getGitDiff(options: GitDiffOptions): Promise<GitDiffResult> {
    const relativePath = options.path.trim();
    if (!relativePath) {
      return {
        diff: '',
        path: null,
        repoRoot: null,
        status: options.status ?? null,
        error: 'A file path is required.'
      };
    }
    try {
      if (await isJjWorkspace(this.workingDirectory)) {
        const { repoRoot } = await resolveJjRepo(this.workingDirectory);
        const normalizedPath = toPosixPath(relativePath);
        const result = await runJj(repoRoot, [
          '--repository',
          repoRoot,
          'diff',
          '--git',
          '--',
          normalizedPath
        ]);
        return {
          diff: result.output,
          path: relativePath,
          repoRoot,
          status: options.status ?? null
        };
      }

      const { repoRoot } = await resolveRepo(this.workingDirectory);
      const normalizedPath = toPosixPath(relativePath);
      const normalizedOriginal = options.originalPath?.trim()
        ? toPosixPath(options.originalPath.trim())
        : null;

      if (options.status === 'untracked') {
        const fullPath = path.join(repoRoot, normalizedPath);
        const result = await runGit(
          repoRoot,
          ['diff', '--no-index', '--no-ext-diff', '--unified=3', '--', '/dev/null', fullPath],
          { allowFailure: true }
        );
        return {
          diff: result.output,
          path: relativePath,
          repoRoot,
          status: options.status ?? null
        };
      }

      if ((options.status === 'renamed' || options.status === 'copied') && normalizedOriginal) {
        const result = await runGit(repoRoot, [
          'diff',
          '--no-ext-diff',
          '--unified=3',
          '--find-renames',
          'HEAD',
          '--',
          normalizedOriginal,
          normalizedPath
        ]);
        return {
          diff: result.output,
          path: relativePath,
          repoRoot,
          status: options.status ?? null
        };
      }

      const result = await runGit(repoRoot, [
        'diff',
        '--no-ext-diff',
        '--unified=3',
        'HEAD',
        '--',
        normalizedPath
      ]);
      return { diff: result.output, path: relativePath, repoRoot, status: options.status ?? null };
    } catch (error) {
      return {
        diff: '',
        path: relativePath,
        repoRoot: null,
        status: options.status ?? null,
        error: error instanceof Error ? error.message : 'Failed to read Git diff.'
      };
    }
  }

  async getAggregateDiff(): Promise<AggregateDiffResult> {
    try {
      if (await isJjWorkspace(this.workingDirectory)) {
        const { repoRoot } = await resolveJjRepo(this.workingDirectory);
        const [statusResult, diffResult] = await Promise.all([
          runJj(repoRoot, ['--repository', repoRoot, 'status'], { allowFailure: true }),
          runJj(repoRoot, ['--repository', repoRoot, 'diff', '--git'], { allowFailure: true })
        ]);
        const files = parseJjStatus(statusResult.output);
        return {
          branch: null,
          diff: diffResult.output,
          filesChanged: files.length,
          repoRoot,
          status: statusResult.output
        };
      }

      const { branch, repoRoot } = await resolveRepo(this.workingDirectory);
      const statusResult = await runGit(repoRoot, ['status', '--short']);
      const trackedDiff = await runGit(
        repoRoot,
        ['-c', 'core.quotepath=false', 'diff', 'HEAD', '--no-color', '--unified=2'],
        { allowFailure: true }
      );
      const untrackedResult = await runGit(
        repoRoot,
        ['ls-files', '--others', '--exclude-standard', '-z'],
        { allowFailure: true }
      );
      const untrackedFiles = untrackedResult.output.split('\0').filter(Boolean);

      let untrackedDiff = '';
      for (const relPath of untrackedFiles.slice(0, MAX_UNTRACKED_FILES_FOR_AGGREGATE_DIFF)) {
        const fullPath = path.join(repoRoot, relPath);
        const stat = await fs.stat(fullPath).catch(() => null);
        if (!stat?.isFile()) continue;
        if (stat.size > MAX_UNTRACKED_FILE_BYTES_FOR_AGGREGATE_DIFF) {
          untrackedDiff += `diff --git a/${relPath} b/${relPath}\n`;
          untrackedDiff += `new file mode 100644\n`;
          untrackedDiff += `--- /dev/null\n`;
          untrackedDiff += `+++ b/${relPath}\n`;
          untrackedDiff += `@@ -0,0 +1 @@\n`;
          untrackedDiff += `+[untracked file omitted: ${stat.size} bytes exceeds ${MAX_UNTRACKED_FILE_BYTES_FOR_AGGREGATE_DIFF} byte preview limit]\n\n`;
          continue;
        }
        const piece = await runGit(
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

  async getGitBranches(): Promise<GitBranchesResult> {
    try {
      if (await isJjWorkspace(this.workingDirectory)) {
        const { repoRoot } = await resolveJjRepo(this.workingDirectory);
        // For jj+git colocated repos, try to surface the git branch as well.
        const gitInfo = await resolveRepo(repoRoot).catch(() => null);
        const defaultBranch = gitInfo
          ? await resolveDefaultBranch(repoRoot).catch(() => null)
          : null;
        return {
          branches: [],
          currentBranch: gitInfo?.branch ?? null,
          defaultBranch,
          repoRoot
        };
      }

      const { branch, repoRoot } = await resolveRepo(this.workingDirectory);
      const defaultBranch = await resolveDefaultBranch(repoRoot);
      const refs = await runGit(repoRoot, [
        'for-each-ref',
        '--format=%(refname:short)\t%(HEAD)\t%(upstream:short)',
        'refs/heads'
      ]);
      const branches = refs.output
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
          const [name, headMarker, upstreamRaw] = line.split('\t');
          return {
            current: headMarker === '*',
            name,
            upstream: upstreamRaw?.trim() ? upstreamRaw.trim() : null
          };
        })
        .sort((left, right) => {
          if (left.current && !right.current) return -1;
          if (!left.current && right.current) return 1;
          return left.name.localeCompare(right.name);
        });

      return {
        branches,
        currentBranch: branch,
        defaultBranch,
        repoRoot
      };
    } catch (error) {
      return {
        branches: [],
        currentBranch: null,
        defaultBranch: null,
        repoRoot: null,
        error: error instanceof Error ? error.message : 'Failed to read Git branches.'
      };
    }
  }

  async checkoutBranch(options: GitBranchOptions): Promise<GitBranchOperationResult> {
    const branchName = options.name.trim();
    if (!branchName) return { ok: false, branch: null, error: 'Branch name is required.' };

    try {
      const { repoRoot } = await resolveRepo(this.workingDirectory);
      await runGit(repoRoot, ['checkout', branchName]);
      const next = await resolveRepo(repoRoot);
      return { ok: true, branch: next.branch };
    } catch (error) {
      return {
        ok: false,
        branch: null,
        error: error instanceof Error ? error.message : 'Failed to switch branches.'
      };
    }
  }

  async createBranch(options: GitBranchOptions): Promise<GitBranchOperationResult> {
    const branchName = options.name.trim();
    if (!branchName) return { ok: false, branch: null, error: 'Branch name is required.' };

    try {
      const { repoRoot } = await resolveRepo(this.workingDirectory);
      await runGit(repoRoot, ['checkout', '-b', branchName]);
      const next = await resolveRepo(repoRoot);
      return { ok: true, branch: next.branch };
    } catch (error) {
      return {
        ok: false,
        branch: null,
        error: error instanceof Error ? error.message : 'Failed to create branch.'
      };
    }
  }

  async pullBranch(): Promise<GitPullResult> {
    try {
      const { branch, repoRoot } = await resolveRepo(this.workingDirectory);
      if (!branch) throw new Error('Cannot pull from a detached HEAD. Check out a branch first.');
      const result = await execFileAsync('git', ['pull', '--ff-only'], {
        cwd: repoRoot,
        maxBuffer: 10 * 1024 * 1024,
        timeout: DEFAULT_GIT_TIMEOUT_MS * 4
      });
      return {
        ok: true,
        branch,
        output: normalizeGitOutput(`${result.stdout ?? ''}${result.stderr ?? ''}`)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to pull the current branch.';
      return {
        ok: false,
        branch: null,
        output: '',
        error: message
      };
    }
  }

  async pushBranch(): Promise<GitPushResult> {
    try {
      const { branch, repoRoot } = await resolveRepo(this.workingDirectory);
      if (!branch) throw new Error('Cannot push from a detached HEAD. Check out a branch first.');
      const result = await pushCurrentBranch(repoRoot, branch);
      return {
        ok: true,
        branch,
        pushed: true,
        output: normalizeGitOutput(result.output)
      };
    } catch (error) {
      return {
        ok: false,
        branch: null,
        pushed: false,
        output: '',
        error: error instanceof Error ? error.message : 'Failed to push the current branch.'
      };
    }
  }

  async commitAndPush(options: CommitAndPushOptions): Promise<CommitAndPushResult> {
    const message = options.message.trim();
    if (!message) {
      return {
        ok: false,
        branch: null,
        commitSha: null,
        pushed: false,
        error: 'Commit message cannot be empty.'
      };
    }
    try {
      const { branch, repoRoot } = await resolveRepo(this.workingDirectory);
      if (!branch) throw new Error('Cannot push from a detached HEAD. Check out a branch first.');

      await runGit(repoRoot, ['add', '-A']);
      const staged = await runGit(repoRoot, ['diff', '--cached', '--name-only']);
      if (!staged.output.trim()) throw new Error('No staged changes to commit.');

      await runGit(repoRoot, ['commit', '-m', message]);
      const shaResult = await runGit(repoRoot, ['rev-parse', 'HEAD'], { allowFailure: true });
      const commitSha = shaResult.ok ? shaResult.output.trim() || null : null;
      await pushCurrentBranch(repoRoot, branch);

      return { ok: true, branch, commitSha, pushed: true };
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

  async createPullRequest(options: CreatePullRequestOptions): Promise<GitCreatePullRequestResult> {
    const title = options.title.trim();
    const body = options.body.trim();
    if (!title)
      return { ok: false, branch: null, number: null, url: null, error: 'PR title is required.' };
    if (!body)
      return { ok: false, branch: null, number: null, url: null, error: 'PR body is required.' };

    try {
      const { branch, repoRoot } = await resolveRepo(this.workingDirectory);
      if (!branch) {
        throw new Error('Cannot create a PR from a detached HEAD. Check out a branch first.');
      }

      const defaultBranch = await resolveDefaultBranch(repoRoot);
      const baseBranch = options.baseBranch?.trim() || defaultBranch || undefined;

      if (baseBranch && branch === baseBranch) {
        throw new Error('Switch to a feature branch before creating a pull request.');
      }

      const args = ['pr', 'create', '--head', branch, '--title', title, '--body', body];
      if (baseBranch) args.push('--base', baseBranch);

      const result = await execFileAsync('gh', args, {
        cwd: repoRoot,
        maxBuffer: 10 * 1024 * 1024,
        timeout: DEFAULT_GH_TIMEOUT_MS
      });

      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
      const url =
        output
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean)
          .at(-1) ?? null;
      const number = url ? Number(url.match(/\/pull\/(\d+)(?:\/|$)/)?.[1] ?? NaN) : NaN;

      return {
        ok: true,
        branch,
        number: Number.isFinite(number) ? number : null,
        url
      };
    } catch (error) {
      return {
        ok: false,
        branch: null,
        number: null,
        url: null,
        error: error instanceof Error ? error.message : 'Failed to create a GitHub pull request.'
      };
    }
  }
}
