import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  buildManagedBookmarkName,
  buildManagedShadowRepoPath,
  buildManagedSnapshotRoot,
  buildManagedWorkspaceName,
  buildManagedWorkspacePath
} from './paths';
import { resolveManagedSnapshotBaseDirectory } from './root';
import type { SnapshotBackend } from './types';

const execFileAsync = promisify(execFile);

export type SnapshotCommandResult = {
  stdout: string;
  stderr: string;
};

export type SnapshotCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

export interface SnapshotCommandRunner {
  run(args: string[], options?: SnapshotCommandOptions): Promise<SnapshotCommandResult>;
}

export type SnapshotProjectSource = {
  gitRemoteUrl?: string | null;
  projectId: string;
  sourceDirectory?: string | null;
};

export type ProjectSnapshotBinding = {
  backend: SnapshotBackend;
  gitRemoteUrl: string | null;
  jjVersion: string | null;
  projectId: string;
  shadowRepoPath: string;
  snapshotRoot: string;
};

export type WorkspaceBinding = ProjectSnapshotBinding & {
  baseGitCommitId: string | null;
  baseJjCommitId: string | null;
  retryIndex: number;
  sessionId: string;
  ticketId: string;
  ticketSequence: number;
  workspaceName: string;
  workspacePath: string;
};

export type SnapshotInput = {
  workspacePath: string;
};

export type DiffInput = {
  comparedToCommitId?: string | null;
  workspacePath: string;
};

export type RetryInput = {
  baseGitCommitId?: string | null;
  baseJjCommitId?: string | null;
  projectId: string;
  retryIndex?: number;
  sessionId: string;
  sourceBinding: ProjectSnapshotBinding;
  ticketId: string;
  ticketSequence: number;
};

export type ExportInput = {
  bookmarkName?: string | null;
  commitId: string;
  projectId: string;
  remoteName?: string | null;
  shadowRepoPath: string;
  ticketId?: string | null;
  workspaceName: string;
  workspacePath: string;
};

export type CleanupInput = {
  projectId: string;
  shadowRepoPath: string;
  workspaceName: string;
  workspacePath: string;
};

export type SnapshotHealth = {
  backend: SnapshotBackend;
  error?: string;
  jjVersion: string | null;
  ok: boolean;
  projectId: string;
};

export type CheckpointRef = {
  backend: SnapshotBackend;
  commitId: string | null;
  diff: string;
  operationId: string | null;
  summary: string | null;
  workspacePath: string;
};

export type UnifiedDiff = {
  backend: SnapshotBackend;
  commitId: string | null;
  diff: string;
  workspacePath: string;
};

export type GitExportRef = {
  backend: SnapshotBackend;
  bookmarkName: string;
  commitId: string;
  exported: boolean;
  output: string;
};

function trimOutput(value: string): string {
  return value.trim();
}

function buildIsolatedEnv(
  baseEnv: NodeJS.ProcessEnv,
  stripKeys: string[],
  overrides: Record<string, string | undefined> = {}
): NodeJS.ProcessEnv {
  const nextEnv = { ...baseEnv } as NodeJS.ProcessEnv;
  for (const key of stripKeys) {
    delete nextEnv[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === 'undefined') continue;
    nextEnv[key] = value;
  }
  return nextEnv;
}

function defaultJjEnv(): NodeJS.ProcessEnv {
  return buildIsolatedEnv(process.env, ['JJ_CONFIG', 'JJ_CONFIG_DIR', 'JJ_DATA_DIR'], {
    NO_COLOR: '1'
  });
}

function defaultGitEnv(): NodeJS.ProcessEnv {
  return buildIsolatedEnv(process.env, ['GIT_CONFIG_GLOBAL'], {
    NO_COLOR: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null'
  });
}

class SystemCommandRunner implements SnapshotCommandRunner {
  constructor(
    private readonly binary: string,
    private readonly baseEnv: () => NodeJS.ProcessEnv,
    private readonly defaultTimeoutMs: number
  ) {}

  async run(args: string[], options: SnapshotCommandOptions = {}): Promise<SnapshotCommandResult> {
    const { stdout, stderr } = await execFileAsync(this.binary, args, {
      cwd: options.cwd,
      env: buildIsolatedEnv(this.baseEnv(), [], options.env),
      maxBuffer: 10 * 1024 * 1024,
      timeout: options.timeoutMs ?? this.defaultTimeoutMs
    });

    return {
      stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
      stderr: typeof stderr === 'string' ? stderr : String(stderr ?? '')
    };
  }
}

async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureGitSource(
  sourceDirectory: string | null | undefined,
  gitRemoteUrl: string | null | undefined
): Promise<{ sourcePath: string; sourceType: 'directory' | 'remote' }> {
  const trimmedRemote = gitRemoteUrl?.trim();
  if (trimmedRemote) {
    return { sourcePath: trimmedRemote, sourceType: 'remote' };
  }

  if (!sourceDirectory?.trim()) {
    throw new Error('sourceDirectory or gitRemoteUrl is required for the JJ snapshot backend.');
  }

  const resolved = path.resolve(sourceDirectory.trim());
  const gitHead = path.join(resolved, '.git');
  if (!(await pathExists(gitHead))) {
    throw new Error(`Source directory is not a Git repository: ${resolved}`);
  }

  return { sourcePath: resolved, sourceType: 'directory' };
}

export class JjCliSnapshotBackend {
  readonly backend = 'jj' as const;

  constructor(
    private readonly options: {
      baseDirectory?: string;
      commandTimeoutMs?: number;
      jjBinaryPath?: string;
      runner?: SnapshotCommandRunner;
    } = {}
  ) {}

  private get runner(): SnapshotCommandRunner {
    return (
      this.options.runner ??
      new SystemCommandRunner(
        this.options.jjBinaryPath ?? 'jj',
        defaultJjEnv,
        this.options.commandTimeoutMs ?? 60_000
      )
    );
  }

  private resolveSnapshotRoot(projectId: string): string {
    const baseDirectory = this.options.baseDirectory ?? resolveManagedSnapshotBaseDirectory();
    return buildManagedSnapshotRoot(baseDirectory, projectId);
  }

  private resolveRepoPath(projectId: string): string {
    return buildManagedShadowRepoPath(
      this.options.baseDirectory ?? resolveManagedSnapshotBaseDirectory(),
      projectId
    );
  }

  private resolveWorkspacePath(projectId: string, workspaceName: string): string {
    return buildManagedWorkspacePath(
      this.options.baseDirectory ?? resolveManagedSnapshotBaseDirectory(),
      projectId,
      workspaceName
    );
  }

  async healthCheck(projectId: string): Promise<SnapshotHealth> {
    try {
      const result = await this.runner.run(['version']);
      return {
        backend: 'jj',
        jjVersion: trimOutput(result.stdout) || null,
        ok: true,
        projectId
      };
    } catch (error) {
      return {
        backend: 'jj',
        error: error instanceof Error ? error.message : 'Failed to execute jj version.',
        jjVersion: null,
        ok: false,
        projectId
      };
    }
  }

  async prepareProject(project: SnapshotProjectSource): Promise<ProjectSnapshotBinding> {
    const source = await ensureGitSource(project.sourceDirectory, project.gitRemoteUrl);
    const snapshotRoot = this.resolveSnapshotRoot(project.projectId);
    const shadowRepoPath = this.resolveRepoPath(project.projectId);
    await ensureDirectory(snapshotRoot);
    const version = await this.healthCheck(project.projectId);

    if (!(await pathExists(shadowRepoPath))) {
      const cloneArgs =
        source.sourceType === 'remote'
          ? ['git', 'clone', '--no-colocate', source.sourcePath, shadowRepoPath]
          : ['git', 'clone', '--no-colocate', source.sourcePath, shadowRepoPath];
      await this.runner.run(cloneArgs, {
        cwd: snapshotRoot
      });
    }

    return {
      backend: 'jj',
      gitRemoteUrl: project.gitRemoteUrl?.trim() || null,
      jjVersion: version.jjVersion,
      projectId: project.projectId,
      shadowRepoPath,
      snapshotRoot
    };
  }

  async createWorkspace(input: {
    baseGitCommitId?: string | null;
    baseJjCommitId?: string | null;
    projectId: string;
    retryIndex?: number;
    sessionId: string;
    sourceBinding: ProjectSnapshotBinding;
    ticketId: string;
    ticketSequence: number;
    workspaceName?: string;
  }): Promise<WorkspaceBinding> {
    const retryIndex = input.retryIndex ?? 1;
    const workspaceName =
      input.workspaceName ??
      buildManagedWorkspaceName({
        projectId: input.projectId,
        retryIndex,
        sessionId: input.sessionId,
        ticketSequence: input.ticketSequence
      });
    const workspacePath = this.resolveWorkspacePath(input.projectId, workspaceName);
    await ensureDirectory(path.dirname(workspacePath));
    if (!(await pathExists(workspacePath))) {
      await this.runner.run(
        ['--repository', input.sourceBinding.shadowRepoPath, 'workspace', 'add', workspacePath],
        {
          cwd: input.sourceBinding.snapshotRoot
        }
      );
    }

    const baseCommitId = input.baseJjCommitId ?? input.baseGitCommitId ?? null;
    if (baseCommitId) {
      await this.runner.run(['--repository', workspacePath, 'edit', baseCommitId], {
        cwd: input.sourceBinding.snapshotRoot
      });
    }

    return {
      ...input.sourceBinding,
      baseGitCommitId: input.baseGitCommitId ?? null,
      baseJjCommitId: input.baseJjCommitId ?? null,
      retryIndex,
      sessionId: input.sessionId,
      ticketId: input.ticketId,
      ticketSequence: input.ticketSequence,
      workspaceName,
      workspacePath
    };
  }

  async snapshot(input: SnapshotInput): Promise<CheckpointRef> {
    await this.runner.run(['--repository', input.workspacePath, 'util', 'snapshot'], {
      cwd: path.dirname(input.workspacePath)
    });

    const commitResult = await this.runner.run(
      [
        '--repository',
        input.workspacePath,
        'log',
        '-r',
        '@',
        '-T',
        'change_id ++ " " ++ commit_id'
      ],
      { cwd: path.dirname(input.workspacePath) }
    );
    const operationResult = await this.runner.run(
      [
        '--repository',
        input.workspacePath,
        'op',
        'log',
        '--at-op=@',
        '--ignore-working-copy',
        '-n',
        '1',
        '-T',
        'id'
      ],
      { cwd: path.dirname(input.workspacePath) }
    );
    const diffResult = await this.runner.run(
      ['--repository', input.workspacePath, 'diff', '--stat'],
      {
        cwd: path.dirname(input.workspacePath)
      }
    );

    const [changeId = null, commitId = null] = trimOutput(commitResult.stdout).split(/\s+/, 2);

    return {
      backend: 'jj',
      commitId: commitId ?? null,
      diff: diffResult.stdout,
      operationId: trimOutput(operationResult.stdout) || null,
      summary: changeId ?? null,
      workspacePath: input.workspacePath
    };
  }

  async diff(input: DiffInput): Promise<UnifiedDiff> {
    const args = ['--repository', input.workspacePath, 'diff'];
    if (input.comparedToCommitId) {
      args.push('-r', input.comparedToCommitId);
    }
    const result = await this.runner.run(args, {
      cwd: path.dirname(input.workspacePath)
    });

    return {
      backend: 'jj',
      commitId: input.comparedToCommitId ?? null,
      diff: result.stdout,
      workspacePath: input.workspacePath
    };
  }

  async createRetry(input: RetryInput): Promise<WorkspaceBinding> {
    return this.createWorkspace({
      baseGitCommitId: input.baseGitCommitId,
      baseJjCommitId: input.baseJjCommitId,
      projectId: input.projectId,
      retryIndex: input.retryIndex ?? 2,
      sessionId: input.sessionId,
      sourceBinding: input.sourceBinding,
      ticketId: input.ticketId,
      ticketSequence: input.ticketSequence
    });
  }

  async exportAccepted(input: ExportInput): Promise<GitExportRef> {
    const bookmarkName =
      input.bookmarkName ??
      buildManagedBookmarkName({
        attemptId: input.workspaceName,
        ticketId: input.ticketId ?? input.projectId
      });

    await this.runner.run(
      ['--repository', input.shadowRepoPath, 'bookmark', 'set', bookmarkName, '-r', input.commitId],
      {
        cwd: input.shadowRepoPath
      }
    );
    const exportResult = await this.runner.run(
      ['--repository', input.shadowRepoPath, 'git', 'export'],
      {
        cwd: input.shadowRepoPath
      }
    );

    if (input.remoteName) {
      await this.runner.run(
        [
          '--repository',
          input.shadowRepoPath,
          'git',
          'push',
          '--remote',
          input.remoteName,
          '--bookmark',
          bookmarkName
        ],
        { cwd: input.shadowRepoPath }
      );
    }

    return {
      backend: 'jj',
      bookmarkName,
      commitId: input.commitId,
      exported: true,
      output: exportResult.stdout
    };
  }

  async cleanupWorkspace(input: CleanupInput): Promise<void> {
    await this.runner.run(
      ['--repository', input.shadowRepoPath, 'workspace', 'forget', input.workspaceName],
      {
        cwd: input.shadowRepoPath
      }
    );
    await fs.rm(input.workspacePath, { recursive: true, force: true });
  }
}

export class GitWorktreeSnapshotBackend {
  readonly backend = 'git-worktree' as const;

  constructor(
    private readonly options: {
      baseDirectory?: string;
      commandTimeoutMs?: number;
      gitBinaryPath?: string;
      runner?: SnapshotCommandRunner;
    } = {}
  ) {}

  private get runner(): SnapshotCommandRunner {
    return (
      this.options.runner ??
      new SystemCommandRunner(
        this.options.gitBinaryPath ?? 'git',
        defaultGitEnv,
        this.options.commandTimeoutMs ?? 60_000
      )
    );
  }

  private resolveSnapshotRoot(projectId: string): string {
    const baseDirectory = this.options.baseDirectory ?? resolveManagedSnapshotBaseDirectory();
    return buildManagedSnapshotRoot(baseDirectory, projectId);
  }

  private resolveRepoPath(projectId: string): string {
    return buildManagedShadowRepoPath(
      this.options.baseDirectory ?? resolveManagedSnapshotBaseDirectory(),
      projectId
    );
  }

  private resolveWorkspacePath(projectId: string, workspaceName: string): string {
    return buildManagedWorkspacePath(
      this.options.baseDirectory ?? resolveManagedSnapshotBaseDirectory(),
      projectId,
      workspaceName
    );
  }

  async healthCheck(projectId: string): Promise<SnapshotHealth> {
    try {
      const result = await this.runner.run(['version']);
      return {
        backend: 'git-worktree',
        jjVersion: trimOutput(result.stdout) || null,
        ok: true,
        projectId
      };
    } catch (error) {
      return {
        backend: 'git-worktree',
        error: error instanceof Error ? error.message : 'Failed to execute git version.',
        jjVersion: null,
        ok: false,
        projectId
      };
    }
  }

  async prepareProject(project: SnapshotProjectSource): Promise<ProjectSnapshotBinding> {
    const snapshotRoot = this.resolveSnapshotRoot(project.projectId);
    const shadowRepoPath = this.resolveRepoPath(project.projectId);
    const sourceDirectory = project.sourceDirectory?.trim()
      ? path.resolve(project.sourceDirectory.trim())
      : null;
    const gitRemoteUrl = project.gitRemoteUrl?.trim() || null;

    await ensureDirectory(snapshotRoot);
    const version = await this.healthCheck(project.projectId);

    if (!(await pathExists(shadowRepoPath))) {
      if (sourceDirectory) {
        await this.runner.run(['clone', '--no-checkout', sourceDirectory, shadowRepoPath], {
          cwd: snapshotRoot
        });
      } else if (gitRemoteUrl) {
        await this.runner.run(['clone', '--no-checkout', gitRemoteUrl, shadowRepoPath], {
          cwd: snapshotRoot
        });
      } else {
        await ensureDirectory(shadowRepoPath);
        await this.runner.run(['init', shadowRepoPath], { cwd: snapshotRoot });
      }
    }

    return {
      backend: 'git-worktree',
      gitRemoteUrl,
      jjVersion: version.jjVersion,
      projectId: project.projectId,
      shadowRepoPath,
      snapshotRoot
    };
  }

  async createWorkspace(input: {
    baseGitCommitId?: string | null;
    baseJjCommitId?: string | null;
    projectId: string;
    retryIndex?: number;
    sessionId: string;
    sourceBinding: ProjectSnapshotBinding;
    ticketId: string;
    ticketSequence: number;
    workspaceName?: string;
  }): Promise<WorkspaceBinding> {
    const retryIndex = input.retryIndex ?? 1;
    const workspaceName =
      input.workspaceName ??
      buildManagedWorkspaceName({
        projectId: input.projectId,
        retryIndex,
        sessionId: input.sessionId,
        ticketSequence: input.ticketSequence
      });
    const workspacePath = this.resolveWorkspacePath(input.projectId, workspaceName);
    await ensureDirectory(path.dirname(workspacePath));
    if (!(await pathExists(workspacePath))) {
      const baseCommitId = input.baseGitCommitId ?? input.baseJjCommitId ?? 'HEAD';
      await this.runner.run(['worktree', 'add', workspacePath, baseCommitId], {
        cwd: input.sourceBinding.shadowRepoPath
      });
    }

    return {
      ...input.sourceBinding,
      baseGitCommitId: input.baseGitCommitId ?? null,
      baseJjCommitId: input.baseJjCommitId ?? null,
      retryIndex,
      sessionId: input.sessionId,
      ticketId: input.ticketId,
      ticketSequence: input.ticketSequence,
      workspaceName,
      workspacePath
    };
  }

  async snapshot(input: SnapshotInput): Promise<CheckpointRef> {
    const commitResult = await this.runner.run(['-C', input.workspacePath, 'rev-parse', 'HEAD'], {
      cwd: path.dirname(input.workspacePath)
    });
    const diffResult = await this.runner.run(['-C', input.workspacePath, 'diff', '--stat'], {
      cwd: path.dirname(input.workspacePath)
    });
    return {
      backend: 'git-worktree',
      commitId: trimOutput(commitResult.stdout) || null,
      diff: diffResult.stdout,
      operationId: null,
      summary: null,
      workspacePath: input.workspacePath
    };
  }

  async diff(input: DiffInput): Promise<UnifiedDiff> {
    const args = ['-C', input.workspacePath, 'diff'];
    if (input.comparedToCommitId) {
      args.push(input.comparedToCommitId);
    }
    const result = await this.runner.run(args, {
      cwd: path.dirname(input.workspacePath)
    });
    return {
      backend: 'git-worktree',
      commitId: input.comparedToCommitId ?? null,
      diff: result.stdout,
      workspacePath: input.workspacePath
    };
  }

  async createRetry(input: RetryInput): Promise<WorkspaceBinding> {
    return this.createWorkspace({
      baseGitCommitId: input.baseGitCommitId,
      baseJjCommitId: input.baseJjCommitId,
      projectId: input.projectId,
      retryIndex: input.retryIndex ?? 2,
      sessionId: input.sessionId,
      sourceBinding: input.sourceBinding,
      ticketId: input.ticketId,
      ticketSequence: input.ticketSequence
    });
  }

  async exportAccepted(input: ExportInput): Promise<GitExportRef> {
    const bookmarkName =
      input.bookmarkName ??
      buildManagedBookmarkName({
        attemptId: input.workspaceName,
        ticketId: input.ticketId ?? input.projectId
      });

    await this.runner.run(['-C', input.shadowRepoPath, 'branch', bookmarkName, input.commitId], {
      cwd: input.shadowRepoPath
    });
    return {
      backend: 'git-worktree',
      bookmarkName,
      commitId: input.commitId,
      exported: true,
      output: ''
    };
  }

  async cleanupWorkspace(input: CleanupInput): Promise<void> {
    await this.runner.run(['worktree', 'remove', input.workspacePath, '--force'], {
      cwd: input.shadowRepoPath
    });
    await fs.rm(input.workspacePath, { recursive: true, force: true });
  }
}

export async function createSnapshotBackend(options: {
  baseDirectory?: string;
  gitRemoteUrl?: string | null;
  prefer?: SnapshotBackend;
  projectId: string;
  sourceDirectory?: string | null;
}): Promise<JjCliSnapshotBackend | GitWorktreeSnapshotBackend> {
  if (options.prefer !== 'git-worktree') {
    const jjBackend = new JjCliSnapshotBackend({ baseDirectory: options.baseDirectory });
    const health = await jjBackend.healthCheck(options.projectId);
    if (health.ok) {
      return jjBackend;
    }
  }

  return new GitWorktreeSnapshotBackend({ baseDirectory: options.baseDirectory });
}
