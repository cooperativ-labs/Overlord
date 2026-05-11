import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type CommandResult = { stdout: string; stderr: string };

export type LocalCheckpointBackend = 'jj' | 'git';

export type LocalCheckpointInput = {
  backendPreference?: 'auto' | LocalCheckpointBackend;
  checkpointKind: 'delivery' | 'manual' | 'objective';
  projectId: string;
  ticketId: string;
  objectiveId?: string | null;
  sessionId: string;
  workspacePath: string;
  workspaceName?: string | null;
  summary?: string | null;
  runner?: (command: string, args: string[], options?: { cwd?: string }) => Promise<CommandResult>;
};

export type LocalCheckpointResult = {
  backend: LocalCheckpointBackend;
  workspacePath: string;
  workspaceName: string | null;
  jjChangeId: string | null;
  jjCommitId: string | null;
  jjOperationId: string | null;
  gitCommitId: string | null;
  diffStat: string | null;
};

async function defaultRunner(
  command: string,
  args: string[],
  options: { cwd?: string } = {}
): Promise<CommandResult> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60_000
  });
  return {
    stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
    stderr: typeof stderr === 'string' ? stderr : String(stderr ?? '')
  };
}

async function commandOk(
  runner: LocalCheckpointInput['runner'],
  command: string,
  args: string[],
  cwd: string
): Promise<boolean> {
  try {
    await (runner ?? defaultRunner)(command, args, { cwd });
    return true;
  } catch {
    return false;
  }
}

async function hasJjRepo(workspacePath: string, runner?: LocalCheckpointInput['runner']) {
  const dotJj = await fs.stat(path.join(workspacePath, '.jj')).catch(() => null);
  if (dotJj) return true;
  return commandOk(runner, 'jj', ['--repository', workspacePath, 'root'], workspacePath);
}

async function hasGitRepo(workspacePath: string, runner?: LocalCheckpointInput['runner']) {
  return commandOk(
    runner,
    'git',
    ['-C', workspacePath, 'rev-parse', '--show-toplevel'],
    workspacePath
  );
}

export async function createLocalCheckpoint(
  input: LocalCheckpointInput
): Promise<LocalCheckpointResult> {
  const workspacePath = path.resolve(input.workspacePath.trim());
  const runner = input.runner ?? defaultRunner;
  const preference = input.backendPreference ?? 'auto';

  const useJj =
    preference === 'jj' || (preference === 'auto' && (await hasJjRepo(workspacePath, runner)));

  if (useJj) {
    await runner('jj', ['--repository', workspacePath, 'util', 'snapshot'], { cwd: workspacePath });
    const commit = await runner(
      'jj',
      ['--repository', workspacePath, 'log', '-r', '@', '-T', 'change_id ++ " " ++ commit_id'],
      { cwd: workspacePath }
    );
    const operation = await runner(
      'jj',
      [
        '--repository',
        workspacePath,
        'op',
        'log',
        '--at-op=@',
        '--ignore-working-copy',
        '-n',
        '1',
        '-T',
        'id'
      ],
      { cwd: workspacePath }
    );
    const diff = await runner('jj', ['--repository', workspacePath, 'diff', '--stat'], {
      cwd: workspacePath
    });
    const [jjChangeId = null, jjCommitId = null] = commit.stdout.trim().split(/\s+/, 2);

    return {
      backend: 'jj',
      workspacePath,
      workspaceName: input.workspaceName ?? path.basename(workspacePath),
      jjChangeId,
      jjCommitId,
      jjOperationId: operation.stdout.trim() || null,
      gitCommitId: null,
      diffStat: diff.stdout.trim() || null
    };
  }

  if (!(await hasGitRepo(workspacePath, runner))) {
    throw new Error(`No JJ or Git repository was found at ${workspacePath}.`);
  }

  const commit = await runner('git', ['-C', workspacePath, 'rev-parse', 'HEAD'], {
    cwd: workspacePath
  });
  const diff = await runner('git', ['-C', workspacePath, 'diff', '--stat', 'HEAD'], {
    cwd: workspacePath
  });

  return {
    backend: 'git',
    workspacePath,
    workspaceName: input.workspaceName ?? path.basename(workspacePath),
    jjChangeId: null,
    jjCommitId: null,
    jjOperationId: null,
    gitCommitId: commit.stdout.trim() || null,
    diffStat: diff.stdout.trim() || null
  };
}
